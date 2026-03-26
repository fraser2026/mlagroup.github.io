// ═══ PHASE 4C: COMPLIANCE AUTOMATION ENGINE ═══════════════════

async function loadAndRunComplianceEngine(){
  if(!currentOrg)return;
  try{
    var result=await sb.from('compliance_rules').select('*').eq('is_active',true);
    allComplianceRules=result.data||[];
    if(allComplianceRules.length)await runComplianceEngine();
  }catch(err){console.error('Compliance engine load error:',err)}
}

async function runComplianceEngine(){
  if(!currentOrg||!allComplianceRules.length)return;
  for(var i=0;i<allComplianceRules.length;i++){
    var rule=allComplianceRules[i];
    try{
      await evaluateRule(rule);
    }catch(err){console.error('Rule eval error:',rule.id,err)}
  }
  // Refresh controls if any were auto-advanced
  await loadControls();
}

async function evaluateRule(rule){
  var params=rule.condition_params||{};
  switch(rule.condition_type){
    case 'registry_threshold':
      await evalRegistryThreshold(rule,params);
      break;
    case 'audit_log_exists':
      await evalAuditLogExists(rule,params);
      break;
    case 'assessment_age_days':
      if(params.status==='in_progress'){
        await evalControlOverdue(rule,params);
      }else{
        await evalAssessmentAge(rule,params);
      }
      break;
    case 'score_drop_threshold':
      await evalScoreDrop(rule,params);
      break;
  }
}

async function evalRegistryThreshold(rule,params){
  var minSystems=params.min_systems||1;
  if(allSystems.length<minSystems)return;
  if(!rule.control_id)return;
  var assign=allAssignments.find(function(a){return a.control_id===rule.control_id&&!a.system_id});
  if(!assign)return;
  if(assign.status==='implemented'||assign.status==='verified')return;
  // Check if already fired
  if(await alreadyLogged(rule.id,null))return;
  // Auto-advance to implemented
  await sb.from('control_assignments').update({status:'implemented',completed_at:new Date().toISOString()}).eq('id',assign.id);
  assign.status='implemented';
  await logAutomation(rule.id,null,'control_advanced','Auto-completed: '+allSystems.length+' system(s) registered, meets threshold of '+minSystems);
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'control_implemented',entity_type:'governance_control',entity_id:rule.control_id,changes:{_actor_name:'Compliance Engine',_is_mla:false,control:allControls.find(function(c){return c.id===rule.control_id})?.title||'Control',automation_rule:rule.rule_name}});
  await snapshotGovernanceScore('automation_rule_fired',rule.id);
}

async function evalAuditLogExists(rule,params){
  if(!rule.control_id)return;
  var assign=allAssignments.find(function(a){return a.control_id===rule.control_id&&!a.system_id});
  if(!assign)return;
  if(assign.status!=='not_started')return;
  if(await alreadyLogged(rule.id,null))return;
  var logResult=await sb.from('registry_audit_log').select('id').eq('org_id',currentOrg.id).limit(1);
  if(!logResult.data||!logResult.data.length)return;
  await sb.from('control_assignments').update({status:'in_progress'}).eq('id',assign.id);
  assign.status='in_progress';
  await logAutomation(rule.id,null,'control_advanced','Auto-progressed: audit log entries detected for organisation');
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'control_updated',entity_type:'governance_control',entity_id:rule.control_id,changes:{_actor_name:'Compliance Engine',_is_mla:false,control:allControls.find(function(c){return c.id===rule.control_id})?.title||'Control',automation_rule:rule.rule_name}});
}

async function evalAssessmentAge(rule,params){
  var days=params.days||90;
  var cutoff=new Date(Date.now()-days*24*60*60*1000).toISOString();
  for(var i=0;i<allSystems.length;i++){
    var sys=allSystems[i];
    if(await alreadyLogged(rule.id,sys.id))continue;
    var aResult=await sb.from('registry_assessments').select('requested_at').eq('system_id',sys.id).order('requested_at',{ascending:false}).limit(1);
    var last=aResult.data&&aResult.data.length?aResult.data[0]:null;
    if(!last||last.requested_at<cutoff){
      await maybeCreateAlert('assessment_due','warning','Assessment Due: '+sys.name,sys.name+' has not been assessed in over '+days+' days. Run a new assessment to keep your governance score current.',sys.id,'ai_system');
      await logAutomation(rule.id,sys.id,'alert_created','Assessment overdue by '+days+'+ days for '+sys.name);
    }
  }
}

async function evalControlOverdue(rule,params){
  var days=params.days||60;
  var cutoff=new Date(Date.now()-days*24*60*60*1000).toISOString();
  var overdue=allAssignments.filter(function(a){return a.status==='in_progress'&&a.updated_at&&a.updated_at<cutoff});
  for(var i=0;i<overdue.length;i++){
    var a=overdue[i];
    if(await alreadyLogged(rule.id,a.id))continue;
    var ctrl=allControls.find(function(c){return c.id===a.control_id});
    var ctrlName=ctrl?ctrl.title:'A governance control';
    await maybeCreateAlert('control_overdue','warning','Control Overdue: '+ctrlName,ctrlName+' has been in progress for over '+days+' days without completion.',a.id,'control_assignment');
    await logAutomation(rule.id,a.id,'alert_created','Control overdue: '+ctrlName+' in progress for '+days+'+ days');
  }
}

async function evalScoreDrop(rule,params){
  var threshold=params.drop_threshold||10;
  if(await alreadyLogged(rule.id,null))return;
  var hResult=await sb.from('governance_score_history').select('composite_score,snapshot_at').eq('org_id',currentOrg.id).order('snapshot_at',{ascending:false}).limit(2);
  var history=hResult.data;
  if(!history||history.length<2)return;
  var drop=history[1].composite_score-history[0].composite_score;
  if(drop>=threshold){
    await maybeCreateAlert('score_drop','critical','Governance Score Drop Detected','Your governance score has fallen by '+drop+' points to '+history[0].composite_score+'%. Review your controls and take action.',null,null);
    await logAutomation(rule.id,null,'alert_created','Score dropped by '+drop+' points (threshold: '+threshold+')');
  }
}

async function alreadyLogged(ruleId,entityId){
  var q=sb.from('compliance_automation_log').select('id').eq('org_id',currentOrg.id).eq('rule_id',ruleId);
  if(entityId)q=q.eq('system_id',entityId);
  else q=q.is('system_id',null);
  var result=await q.limit(1);
  return result.data&&result.data.length>0;
}

async function logAutomation(ruleId,systemId,outcome,detail){
  await sb.from('compliance_automation_log').insert({
    org_id:currentOrg.id,
    system_id:systemId||null,
    rule_id:ruleId,
    triggered_at:new Date().toISOString(),
    outcome:outcome,
    outcome_detail:detail||null
  });
}

 // ═══ PHASE 4B: ALERTS ═════════════════════════════════════════
 const EMAILJS_SVC='service_umdte26';
const EMAILJS_TPL='template_o6h9et7';
const EMAILJS_KEY='vxitc5LFJHMfNcmUL';

async function navigateAlerts(){
  navigate('alerts',null);
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  if(!currentOrg)await ensureOrg();
  await renderAlertsView();
}

async function checkAndCreateAlerts(){
  if(!currentOrg||!currentUser)return;
  try{
    // Score drop check
    const{data:history}=await sb.from('governance_score_history').select('composite_score,snapshot_at').eq('org_id',currentOrg.id).order('snapshot_at',{ascending:false}).limit(2);
    if(history&&history.length===2){
      const drop=history[1].composite_score-history[0].composite_score;
      if(drop>=10){
        await maybeCreateAlert('score_drop','critical','Governance Score Drop Detected',`Your governance score has fallen by ${drop} points to ${history[0].composite_score}%. Review your controls and take action to restore your compliance position.`,null,null);
      }
    }
    // Control overdue check
    const sixtyDaysAgo=new Date(Date.now()-60*24*60*60*1000).toISOString();
    const{data:overdue}=await sb.from('control_assignments').select('*').eq('org_id',currentOrg.id).eq('status','in_progress').lt('updated_at',sixtyDaysAgo);
    if(overdue&&overdue.length){
      for(const a of overdue){
        const ctrl=allControls.find(c=>c.id===a.control_id);
        const ctrlName=ctrl?.title||'A governance control';
        await maybeCreateAlert('control_overdue','warning','Control Overdue: '+ctrlName,`${ctrlName} has been in progress for over 60 days without completion. Open the control and complete the implementation tasks.`,a.id,'control_assignment');
      }
    }
    // Assessment due check
    const ninetyDaysAgo=new Date(Date.now()-90*24*60*60*1000).toISOString();
    for(const sys of allSystems){
      const{data:assessments}=await sb.from('registry_assessments').select('requested_at').eq('system_id',sys.id).order('requested_at',{ascending:false}).limit(1);
      const last=assessments&&assessments.length?assessments[0]:null;
      if(!last||last.requested_at<ninetyDaysAgo){
        await maybeCreateAlert('assessment_due','warning','Assessment Due: '+sys.name,`${sys.name} has not been assessed in over 90 days. Run a new assessment to keep your governance score current and accurate.`,sys.id,'ai_system');
      }
    }
    await loadAlerts();
    if(document.getElementById('view-alerts').classList.contains('active'))await renderAlertsView();
  }catch(err){console.error('Alert check error:',err)}
}

async function maybeCreateAlert(type,severity,title,body,refId,refType){
  // Deduplicate — don't create if unresolved alert of same type+ref already exists
  const query=sb.from('governance_alerts').select('id').eq('org_id',currentOrg.id).eq('alert_type',type).is('resolved_at',null).eq('is_dismissed',false);
  if(refId)query.eq('ref_id',refId);
  const{data:existing}=await query.limit(1);
  if(existing&&existing.length)return;
  const{data,error}=await sb.from('governance_alerts').insert({org_id:currentOrg.id,alert_type:type,severity,title,body,ref_id:refId||null,ref_type:refType||null}).select().single();
  if(!error&&data)await sendAlertEmail(title,body);
}

async function sendAlertEmail(title,body){
  try{
    if(typeof emailjs==='undefined')return;
    emailjs.init(EMAILJS_KEY);
    await emailjs.send(EMAILJS_SVC,EMAILJS_TPL,{
      to_name:currentProfile?.full_name?.split(' ')[0]||'there',
      to_email:currentUser.email,
      alert_title:title,
      alert_body:body
    });
  }catch(err){console.error('EmailJS send error:',err)}
}

async function loadAlerts(){
  if(!currentOrg)return[];
  const{data}=await sb.from('governance_alerts').select('*').eq('org_id',currentOrg.id).eq('is_dismissed',false).order('created_at',{ascending:false}).limit(50);
  const alerts=data||[];
  const unread=alerts.filter(a=>!a.is_read&&!a.resolved_at).length;
  updateBellCount(unread);
  return alerts;
}

function updateBellCount(count){
  const badge=document.getElementById('bell-badge');
  if(!badge)return;
  if(count>0){badge.textContent=count>9?'9+':count;badge.style.display='flex'}
  else badge.style.display='none';
}

async function renderAlertsView(){
  const el=document.getElementById('alerts-list');
  if(!el||!currentOrg)return;
  const alerts=await loadAlerts();
  // Mark all visible as read
  const unreadIds=alerts.filter(a=>!a.is_read&&!a.resolved_at).map(a=>a.id);
  if(unreadIds.length){
    await sb.from('governance_alerts').update({is_read:true}).in('id',unreadIds);
    updateBellCount(0);
  }
  // Update stat cards
  const active=alerts.filter(a=>!a.resolved_at);
  const resolved=alerts.filter(a=>a.resolved_at);
  document.getElementById('alert-stat-unread').textContent=unreadIds.length||'0';
  document.getElementById('alert-stat-active').textContent=active.length||'0';
  document.getElementById('alert-stat-resolved').textContent=resolved.length||'0';
  if(!active.length){
    el.innerHTML='<div class="empty-state"><h4>No active alerts</h4><p>Your governance platform is monitoring for score drops, overdue controls, and assessments due for review.</p></div>';
    return;
  }
  const SEV_C={info:'#60a5fa',warning:'#fbbf24',critical:'#f87171'};
  const SEV_BG={info:'rgba(96,165,250,0.06)',warning:'rgba(251,191,36,0.06)',critical:'rgba(239,68,68,0.06)'};
  const TYPE_L={score_drop:'Score Drop',control_overdue:'Control Overdue',assessment_due:'Assessment Due',control_regression:'Regression',compliance_rule_fired:'Automation'};
  el.innerHTML=active.map(a=>{
    const col=SEV_C[a.severity]||'var(--muted)';
    const bg=SEV_BG[a.severity]||'rgba(255,255,255,0.02)';
    return `<div style="background:${bg};border:1px solid rgba(255,255,255,0.06);border-left:3px solid ${col};border-radius:10px;padding:18px 20px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${col};background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);padding:2px 8px;border-radius:100px;">${esc(a.severity)}</span>
          <span style="font-size:.68rem;color:var(--muted);">${TYPE_L[a.alert_type]||a.alert_type}</span>
        </div>
        <span style="font-size:.68rem;color:var(--muted);white-space:nowrap;">${fmtDate(a.created_at)}</span>
      </div>
      <div style="font-size:.88rem;font-weight:600;color:var(--main);margin-bottom:6px;">${esc(a.title)}</div>
      <div style="font-size:.78rem;color:var(--sub);line-height:1.65;margin-bottom:14px;">${esc(a.body||'')}</div>
      <div style="display:flex;gap:8px;">
        ${(a.alert_type==='support_response'&&a.ref_id)?'<button onclick="viewAlertSource(\''+a.ref_id+'\',\''+a.ref_type+'\')" class="btn-topbar btn-topbar-ghost" style="padding:5px 12px;font-size:.72rem;">View Conversation</button>':''}
        <button onclick="resolveAlert('${a.id}')" class="btn-topbar btn-topbar-primary" style="padding:5px 12px;font-size:.72rem;">Mark Resolved</button>
        <button onclick="dismissAlert('${a.id}')" class="btn-topbar btn-topbar-ghost" style="padding:5px 12px;font-size:.72rem;">Dismiss</button>
      </div>
    </div>`;
  }).join('');
}

async function resolveAlert(alertId){
  await sb.from('governance_alerts').update({resolved_at:new Date().toISOString(),resolved_by:currentUser.id,is_read:true}).eq('id',alertId);
  await renderAlertsView();
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'control_updated',entity_type:'governance_alert',entity_id:alertId,changes:{_actor_name:actorName(),control:'Alert resolved'}});
}

async function dismissAlert(alertId){
  await sb.from('governance_alerts').update({is_dismissed:true}).eq('id',alertId);
  await renderAlertsView();
}

async function viewAlertSource(refId,refType){
  if(refType==='support_request'){
    var assign=allAssignments.find(function(a){return a.id===refId});
    if(!assign){
      var result=await sb.from('control_assignments').select('id,control_id').eq('id',refId).single();
      if(result.data)assign=result.data;
    }
    if(assign&&assign.control_id){
      await openControlDetail(assign.control_id,assign.id);
      setTimeout(function(){var el=document.getElementById('cd-support');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},500);
      return;
    }
  }
  navigateControls(document.getElementById('nav-controls'));
}
 
