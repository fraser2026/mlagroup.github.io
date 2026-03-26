// ═══ REGISTRY: LOAD ═══════════════════════════════════════════
async function loadSystems(){
  if(!currentOrg)return;
  var results=await Promise.all([
    sb.from('ai_systems').select('*,system_compliance(id,status)').eq('org_id',currentOrg.id).order('updated_at',{ascending:false}),
    sb.from('registry_assessments').select('system_id,overall_score').eq('org_id',currentOrg.id).order('created_at',{ascending:false}),
    sb.from('control_assignments').select('system_id,status').eq('org_id',currentOrg.id)
  ]);
  allSystems=results[0].error?[]:(results[0].data||[]);
  var assessments=results[1].data||[];
  var assignments=results[2].data||[];
  var assessBySystem={};
  for(var a=0;a<assessments.length;a++){var as=assessments[a];if(as.system_id&&!assessBySystem[as.system_id])assessBySystem[as.system_id]=as.overall_score}
  var assignBySystem={};
  for(var c=0;c<assignments.length;c++){var ca=assignments[c];if(ca.system_id){if(!assignBySystem[ca.system_id])assignBySystem[ca.system_id]={total:0,done:0};assignBySystem[ca.system_id].total++;if(ca.status==='implemented'||ca.status==='verified')assignBySystem[ca.system_id].done++}}
  for(var s=0;s<allSystems.length;s++){allSystems[s]._assessScore=assessBySystem[allSystems[s].id]||null;var ca2=assignBySystem[allSystems[s].id];allSystems[s]._ctrlPct=(ca2&&ca2.total>0)?Math.round(ca2.done/ca2.total*100):null}
  renderRegistryStats();renderSystemTable();
  if(allSystems.length>0){document.getElementById('sys-count-badge').textContent=allSystems.length;document.getElementById('sys-count-badge').style.display='inline-flex'}
  document.getElementById('dash-sys-count').textContent=allSystems.length||'0';
}
function getCP(sys){var aScore=(sys._assessScore!==null&&sys._assessScore!==undefined)?sys._assessScore:null;var cPct=(sys._ctrlPct!==null&&sys._ctrlPct!==undefined)?sys._ctrlPct:null;var pPct=null;if(allPolicies.length){var pubPols=allPolicies.filter(function(p){return p.requires_acknowledgment&&p.published_at});if(pubPols.length){var acked=pubPols.filter(function(p){return allAcknowledgments.find(function(a){return a.policy_id===p.id&&a.version_acknowledged===p.version})}).length;pPct=Math.round(acked/pubPols.length*100)}}if(aScore===null&&cPct===null&&pPct===null){var sc=sys.system_compliance||[];if(sc.length)return Math.round(sc.filter(function(c){return c.status==='compliant'||c.status==='not_applicable'}).length/sc.length*100);return null}var blended=(aScore!==null?aScore*0.5:0)+(cPct!==null?cPct*0.35:0)+(pPct!==null?pPct*0.15:0);return Math.round(blended)}
function renderRegistryStats(){
  document.getElementById('reg-total').textContent=allSystems.length;
  document.getElementById('reg-high').textContent=allSystems.filter(s=>s.risk_tier==='high'||s.risk_tier==='unacceptable').length;
  document.getElementById('reg-prod').textContent=allSystems.filter(s=>s.deployment_status==='production').length;
  if(allControls.length){const g=getGovScore();document.getElementById('reg-compliance').textContent=g.score+'%';document.getElementById('reg-compliance-sub').textContent=getMaturity(g.score)}
  else{document.getElementById('reg-compliance').textContent='—';document.getElementById('reg-compliance-sub').textContent='Run controls'}
}
function renderSystemTable(){
  const filtered=regFilter==='all'?allSystems:allSystems.filter(s=>s.deployment_status===regFilter);
  document.getElementById('reg-table-count').textContent=filtered.length+' system'+(filtered.length!==1?'s':'');
  if(!filtered.length){document.getElementById('reg-table-wrap').innerHTML='<div class="empty-state"><h4>'+(allSystems.length===0?'No systems registered yet':'No systems match this filter')+'</h4><p>'+(allSystems.length===0?'Register your first AI system.':'Try a different filter.')+'</p>'+(allSystems.length===0?'<button class="btn-dl" onclick="openAddSystem()" style="display:inline-flex;"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Register First System</button>':'')+'</div>';return}
  document.getElementById('reg-table-wrap').innerHTML='<div style="overflow-x:auto;"><table class="sys-table"><thead><tr><th>System</th><th>Risk Tier</th><th>Status</th><th>Maturity</th><th>Updated</th></tr></thead><tbody>'+filtered.map(sys=>{const tier=sys.risk_tier||'none';const cp=getCP(sys);const cpC=cp===null?'#64748b':cp>=85?'#22c55e':cp>=70?'#38bdf8':cp>=50?'#fbbf24':'#ef4444';return '<tr onclick="openSystemDetail(\''+sys.id+'\')"><td><div class="sys-name">'+esc(sys.name)+'</div><div class="sys-desc">'+esc(sys.description||'')+'</div></td><td><span class="tier-pill tier-'+tier+'">'+(TIER_LABELS[tier]||'Unclassified')+'</span></td><td><span class="status-pill status-'+sys.deployment_status+'">'+(STATUS_LABELS[sys.deployment_status]||sys.deployment_status)+'</span></td><td style="min-width:100px;">'+(cp!==null?'<div style="display:flex;align-items:center;gap:8px;"><div class="cprogress-bar" style="flex:1;"><div class="cprogress-fill" style="width:'+cp+'%;background:'+cpC+';"></div></div><span style="font-size:.72rem;color:'+cpC+';font-weight:600;">'+cp+'%</span></div>':'<span style="font-size:.72rem;color:#64748b;">Not assessed</span>')+'</td><td style="font-size:.72rem;color:var(--muted);white-space:nowrap;">'+fmtDate(sys.updated_at)+'</td></tr>'}).join('')+'</tbody></table></div>';
}
function setRegFilter(s,btn){regFilter=s;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderSystemTable()}
 
// ═══ SYSTEM DETAIL ════════════════════════════════════════════
const ASSESS_STATUS_LABELS={submitted:'Awaiting MLA Review',in_review:'Under Review',controls_issued:'Controls Issued'};
const ASSESS_STATUS_COLORS={submitted:'#fde047',in_review:'#93c5fd',controls_issued:'#4ade80'};
const Q_LABELS={yes:'Yes',no:'No',unsure:'Unsure'};
 
async function openSystemDetail(sysId){
  currentSystemId=sysId;const sys=allSystems.find(s=>s.id===sysId);if(!sys)return;
  const[{data:assessments},{data:auditLog}]=await Promise.all([sb.from('registry_assessments').select('*').eq('system_id',sysId).order('requested_at',{ascending:false}),sb.from('registry_audit_log').select('*').eq('entity_id',sysId).order('created_at',{ascending:false})]);
  const tier=sys.risk_tier||'none';
  document.getElementById('det-name').textContent=sys.name;
  var riskBg='rgba(148,163,184,0.15)';var riskColor='#94a3b8';var riskLabel=TIER_LABELS[tier]||'Unclassified';
  if(tier==='high'||tier==='unacceptable'){riskBg='rgba(239,68,68,0.15)';riskColor='#ef4444'}else if(tier==='limited'){riskBg='rgba(251,191,36,0.15)';riskColor='#fbbf24'}else if(tier==='minimal'||tier==='low'){riskBg='rgba(34,197,94,0.15)';riskColor='#22c55e'}
  document.getElementById('det-tier-badge').innerHTML='<span style="display:inline-flex;align-items:center;padding:4px 14px;border-radius:20px;font-size:0.78rem;font-weight:600;font-family:DM Sans,sans-serif;background:'+riskBg+';color:'+riskColor+';">'+esc(riskLabel)+'</span>';
  var metaParts=[];
  if(sys.department)metaParts.push('<span><span style="color:#cbd5e1;">Department</span> <span style="color:#94a3b8;">' + esc(sys.department) + '</span></span>');
  if(sys.system_owner)metaParts.push('<span><span style="color:#cbd5e1;">Owner</span> <span style="color:#94a3b8;">' + esc(sys.system_owner) + '</span></span>');
  metaParts.push('<span><span style="color:#cbd5e1;">Added</span> <span style="color:#94a3b8;">' + fmtDate(sys.created_at) + '</span></span>');
  document.getElementById('det-subtitle').innerHTML=metaParts.join('<span style="color:var(--muted2);"> &middot; </span>');
  document.getElementById('det-subtitle').style.cssText='display:flex;align-items:center;gap:24px;margin-top:6px;flex-wrap:wrap;font-size:0.8rem;color:#94a3b8;font-family:DM Sans,sans-serif;';
  var tagParts=[];
  if(sys.deployment_status)tagParts.push(STATUS_LABELS[sys.deployment_status]||sys.deployment_status);
  if(sys.system_type)tagParts.push(TYPE_LABELS[sys.system_type]||sys.system_type);
  if(sys.purpose_category)tagParts.push(sys.purpose_category.replace(/_/g,' '));
  var latestA=(assessments&&assessments.length)?assessments[0]:null;
  if(latestA)tagParts.push(ASSESS_STATUS_LABELS[latestA.status]||latestA.status);
  var tagsEl=document.getElementById('det-tags');
  if(tagsEl)tagsEl.innerHTML=tagParts.map(function(t){return '<span style="padding:3px 10px;border-radius:12px;font-size:0.7rem;background:rgba(56,189,248,0.1);color:#38bdf8;font-weight:500;">'+esc(t)+'</span>'}).join('');
  // Overview
  document.getElementById('tab-overview').innerHTML='<div style="margin-bottom:16px;"><div class="stat-label" style="margin-bottom:6px;">Description</div><p style="font-size:.82rem;color:var(--sub);line-height:1.7;">'+esc(sys.description||'No description provided.')+'</p></div><div class="meta-grid"><div class="meta-item"><label>System ID</label><span class="meta-id">'+esc(sys.id)+'</span></div><div class="meta-item"><label>System Type</label><span>'+esc(TYPE_LABELS[sys.system_type]||'—')+'</span></div><div class="meta-item"><label>Vendor</label><span>'+esc(sys.vendor||'—')+'</span></div><div class="meta-item"><label>Department</label><span>'+esc(sys.department||'—')+'</span></div><div class="meta-item"><label>System Owner</label><span>'+esc(sys.system_owner||'—')+'</span></div><div class="meta-item"><label>Deployment</label><span><span class="status-pill status-'+sys.deployment_status+'">'+(STATUS_LABELS[sys.deployment_status]||'')+'</span></span></div><div class="meta-item"><label>Purpose Category</label><span>'+esc(sys.purpose_category?sys.purpose_category.replace(/_/g,' '):'—')+'</span></div><div class="meta-item"><label>Risk Tier</label><span><span class="tier-pill tier-'+tier+'">'+(TIER_LABELS[tier]||'Unclassified')+'</span></span></div>'+(sys.risk_tier_rationale?'<div class="meta-item" style="grid-column:1/-1;"><label>Classification Rationale</label><span>'+esc(sys.risk_tier_rationale)+'</span></div>':'')+'<div class="meta-item"><label>Registered</label><span>'+fmtDate(sys.created_at)+'</span></div><div class="meta-item"><label>Last Updated</label><span>'+fmtDate(sys.updated_at)+'</span></div></div>';
  // Assessment tab
  renderAssessmentTab(assessments||[]);
  // System controls tab
  await renderSystemControlsTab(sysId);
  // Audit with names
  const logs=auditLog||[];
  if(!logs.length)document.getElementById('tab-audit').innerHTML='<div class="empty-state" style="padding:28px 0;"><h4>No audit entries</h4><p>Entries are created automatically on system changes.</p></div>';
  else{const nm=await loadNames(logs.map(e=>e.user_id));document.getElementById('tab-audit').innerHTML='<div class="audit-timeline">'+logs.map((entry,i)=>{const a=fmtAudit(entry,nm);return '<div class="audit-item"><div class="audit-line"><div class="audit-node"></div>'+(i<logs.length-1?'<div class="audit-connector"></div>':'')+'</div><div class="audit-content"><div class="audit-action">'+a.text+'</div><div class="audit-meta">'+esc(a.who)+' · '+a.time+'</div></div></div>'}).join('')+'</div>'}
  // Reset tabs
  document.querySelectorAll('#view-registry-detail .tab-btn').forEach(b=>b.classList.remove('active'));document.querySelectorAll('#view-registry-detail .tab-btn')[0].classList.add('active');
  document.querySelectorAll('#view-registry-detail .tab-panel').forEach(p=>p.classList.remove('active'));document.getElementById('tab-overview').classList.add('active');
  navigate('registry-detail',null);document.getElementById('nav-registry').classList.add('active');
}
 
async function renderAssessmentTab(assessments){
  const el=document.getElementById('tab-assessment');
  if(!assessments.length){
    el.innerHTML='<div class="empty-state" style="padding:36px 0;"><h4>No assessments yet</h4><p style="max-width:360px;margin:0 auto 20px;">Run an assessment to have MLA Group review this AI system and provide tailored compliance controls.</p><button class="btn-dl" onclick="openAssessmentModal()" style="display:inline-flex;"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Run Assessment</button></div>';
    return;
  }
  const nm=await loadNames(assessments.map(a=>a.requested_by).concat(assessments.map(a=>a.completed_by).filter(Boolean)));
  el.innerHTML=assessments.map((a,i)=>{
    const stCol=ASSESS_STATUS_COLORS[a.status]||'var(--muted)';
    const stLabel=ASSESS_STATUS_LABELS[a.status]||a.status;
    const isLatest=i===0;
    return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:12px;">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">'+
        '<div style="display:flex;align-items:center;gap:10px;">'+
          '<span style="font-size:.65rem;font-weight:700;padding:3px 10px;border-radius:100px;color:'+stCol+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">'+esc(stLabel)+'</span>'+
          (isLatest?'<span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#4ade80;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);padding:2px 7px;border-radius:100px;">Latest</span>':'')+
        '</div>'+
        '<div style="font-size:.72rem;color:var(--muted);">'+fmtDateLong(a.requested_at)+'</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:14px;">'+
        '<div style="font-size:.75rem;"><span style="color:var(--muted);">Personal data:</span> <span style="color:var(--sub);">'+(Q_LABELS[a.processes_personal_data]||'—')+'</span></div>'+
        '<div style="font-size:.75rem;"><span style="color:var(--muted);">Automated decisions:</span> <span style="color:var(--sub);">'+(Q_LABELS[a.makes_automated_decisions]||'—')+'</span></div>'+
        '<div style="font-size:.75rem;"><span style="color:var(--muted);">Affects individuals:</span> <span style="color:var(--sub);">'+(Q_LABELS[a.affects_individuals]||'—')+'</span></div>'+
        '<div style="font-size:.75rem;"><span style="color:var(--muted);">Synthetic content:</span> <span style="color:var(--sub);">'+(Q_LABELS[a.generates_synthetic_content]||'—')+'</span></div>'+
      '</div>'+
      (a.client_notes?'<div style="font-size:.76rem;color:var(--muted);line-height:1.65;background:rgba(255,255,255,0.02);border-left:2px solid var(--border);padding:8px 12px;border-radius:0 6px 6px 0;margin-bottom:12px;">'+esc(a.client_notes)+'</div>':'')+
      '<div style="font-size:.7rem;color:var(--muted);">Submitted by '+esc(nm[a.requested_by]||'Unknown')+'</div>'+
      (a.status==='controls_issued'?'<div style="margin-top:14px;padding:14px 16px;background:rgba(34,197,94,0.04);border:1px solid rgba(34,197,94,0.12);border-radius:8px;"><div style="font-size:.72rem;font-weight:700;color:#4ade80;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">MLA Controls Issued</div>'+(a.mla_notes?'<div style="font-size:.78rem;color:var(--sub);line-height:1.65;">'+esc(a.mla_notes)+'</div>':'')+'<div style="font-size:.68rem;color:var(--muted);margin-top:6px;">Completed by '+(nm[a.completed_by]||'MLA Group')+' · '+fmtDateLong(a.completed_at)+'</div></div>':'')+
      (a.status==='submitted'||a.status==='in_review'?'<div style="margin-top:14px;padding:14px 16px;background:rgba(37,99,235,0.04);border:1px solid rgba(37,99,235,0.12);border-radius:8px;"><div style="font-size:.78rem;color:var(--sub);line-height:1.65;">Your assessment has been submitted. MLA Group will review this AI system and provide tailored compliance controls. You will be notified when results are ready.</div></div>':'')+
    '</div>'}).join('');
}
 
// System-level controls tab
async function renderSystemControlsTab(sysId){
  const el=document.getElementById('tab-sys-controls');
 
  if(!allControls.length)await loadControls();
  // Get assignments for this specific system
  const{data:sysAssignments}=await sb.from('control_assignments').select('*').eq('system_id',sysId).eq('org_id',currentOrg.id);
  var allSysCtrl=sysAssignments||[];
  // Only include org-level controls if this system has been assessed
  const{data:sysAssessCheck}=await sb.from('registry_assessments').select('id').eq('system_id',sysId).limit(1);
  if(sysAssessCheck&&sysAssessCheck.length){
    const{data:orgAssignments}=await sb.from('control_assignments').select('*').eq('org_id',currentOrg.id).is('system_id',null);
    allSysCtrl=allSysCtrl.concat(orgAssignments||[]);
  }
  
  if(!allSysCtrl.length){
    el.innerHTML='<div class="empty-state" style="padding:36px 0;"><h4>No controls triggered yet</h4><p style="max-width:380px;margin:0 auto 20px;">Run an assessment on this AI system. Controls will be automatically triggered based on governance gaps identified.</p><button class="btn-dl" onclick="openAssessmentModal()" style="display:inline-flex;"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Run Assessment</button></div>';
    return;
  }
  
  const done=allSysCtrl.filter(a=>a.status==='implemented'||a.status==='verified').length;
  const total=allSysCtrl.length;
  const pct=total>0?Math.round(done/total*100):0;
  const pctCol=pct>=70?'#4ade80':pct>=40?'#fbbf24':'#f87171';
  
  let html='<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;"><div style="flex:1;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;"><span style="font-size:1.5rem;font-weight:700;color:'+pctCol+';">'+pct+'%</span><span style="font-size:.72rem;color:var(--muted);">'+done+' of '+total+' controls implemented</span></div><div class="cprogress-bar" style="height:6px;"><div class="cprogress-fill" style="width:'+pct+'%;background:'+pctCol+';"></div></div></div></div>';
  
  // Group by type
  const groups={organisation:[],system:[],assurance:[]};
  allSysCtrl.forEach(a=>{
    const ctrl=allControls.find(c=>c.id===a.control_id);
    if(ctrl)groups[ctrl.control_type].push({assign:a,ctrl});
  });
  
  const typeLabels={organisation:'Organisation Controls',system:'System Controls',assurance:'Assurance Controls'};
  ['organisation','system','assurance'].forEach(t=>{
    const items=groups[t];if(!items.length)return;
    html+='<div style="margin-bottom:16px;"><div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.13em;color:'+TYPE_COLORS[t]+';padding:8px 0 6px;display:flex;align-items:center;gap:10px;">'+typeLabels[t]+'<span style="flex:1;height:1px;background:var(--border);"></span></div>';
    items.forEach(({assign:a,ctrl:c})=>{
      const st=a.status||'not_started';
      html+='<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.03);cursor:pointer;" onclick="openControlDetail(\''+c.id+'\',\''+a.id+'\')">'+
        '<div style="width:24px;height:24px;border-radius:6px;background:'+TYPE_BG[t]+';border:1px solid '+TYPE_BORDER[t]+';display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:'+TYPE_COLORS[t]+';flex-shrink:0;">'+c.control_number+'</div>'+
        '<div style="flex:1;min-width:0;"><div style="font-size:.8rem;font-weight:600;color:var(--main);">'+esc(c.title)+'</div></div>'+
        '<span style="font-size:.62rem;font-weight:700;padding:3px 9px;border-radius:100px;white-space:nowrap;color:'+CTRL_STATUS_C[st]+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">'+CTRL_STATUS_L[st]+'</span>'+
      '</div>';
    });
    html+='</div>';
  });
  
  el.innerHTML=html;
}
 
// Assessment modal → now redirects to assessment.html
function openAssessmentModal(){
  if(!currentSystemId)return;
  window.location.href='assessment.html?system_id='+currentSystemId;
}
function closeAssessmentModal(){}
 
async function renderAssessmentTab(assessments){
  const el=document.getElementById('tab-assessment');
  if(!assessments.length){
    el.innerHTML='<div class="empty-state" style="padding:36px 0;"><h4>No assessments yet</h4><p style="max-width:360px;margin:0 auto 20px;">Run an assessment to evaluate this AI system\u2019s governance maturity across 7 domains and receive a risk score.</p><button class="btn-dl" onclick="openAssessmentModal()" style="display:inline-flex;"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Run Assessment</button></div>';
    return;
  }
  const BAND_L={high:'High Risk',medium:'Medium Risk',low:'Low Risk'};
  const BAND_C={high:'#f87171',medium:'#fde047',low:'#4ade80'};
  const nm=await loadNames(assessments.map(a=>a.requested_by).concat(assessments.map(a=>a.completed_by).filter(Boolean)));
  el.innerHTML=assessments.map((a,i)=>{
    const band=a.risk_band||'medium';
    const score=a.overall_score;
    const stLabel=ASSESS_STATUS_LABELS[a.status]||a.status;
    const stCol=ASSESS_STATUS_COLORS[a.status]||'var(--muted)';
    const isLatest=i===0;
    const ss=a.section_scores||{};
    const tv=a.tier_validation;
    // Section score bars
    const secBars=Object.entries(ss).map(([k,v])=>{
      const pct=v.score||0;
      const col=pct>=70?'#4ade80':pct>=40?'#fde047':'#f87171';
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="font-size:.7rem;color:var(--muted);width:160px;text-align:right;flex-shrink:0;">'+esc(v.title||k)+'</span><div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:2px;"></div></div><span style="font-size:.68rem;color:'+col+';width:32px;text-align:right;font-weight:600;">'+pct+'%</span></div>';
    }).join('');
    return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:20px 22px;margin-bottom:12px;">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">'+
        '<div style="display:flex;align-items:center;gap:10px;">'+
          (score!==null&&score!==undefined?'<span style="font-size:1.8rem;font-weight:700;color:'+(BAND_C[band]||'var(--muted)')+';">'+score+'%</span>':'')+
          '<span style="font-size:.65rem;font-weight:700;padding:3px 10px;border-radius:100px;color:'+(BAND_C[band]||'var(--muted)')+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">'+(BAND_L[band]||band)+'</span>'+
          (isLatest?'<span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#4ade80;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);padding:2px 7px;border-radius:100px;">Latest</span>':'')+
        '</div>'+
        '<div style="display:flex;align-items:center;gap:8px;">'+
          '<span style="font-size:.65rem;font-weight:700;padding:3px 10px;border-radius:100px;color:'+stCol+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">'+esc(stLabel)+'</span>'+
          '<span style="font-size:.72rem;color:var(--muted);">'+fmtDateLong(a.requested_at)+'</span>'+
        '</div>'+
      '</div>'+
      (Object.keys(ss).length?'<div style="margin-bottom:14px;">'+secBars+'</div>':'')+
      (tv&&tv.mismatch?'<div style="font-size:.76rem;color:var(--amber);background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:8px;padding:10px 14px;margin-bottom:12px;line-height:1.6;">'+esc(tv.message||'Risk tier mismatch detected. MLA Group recommends reviewing the classification.')+'</div>':'')+
      (a.client_notes?'<div style="font-size:.76rem;color:var(--muted);line-height:1.65;background:rgba(255,255,255,0.02);border-left:2px solid var(--border);padding:8px 12px;border-radius:0 6px 6px 0;margin-bottom:12px;">'+esc(a.client_notes)+'</div>':'')+
      '<div style="font-size:.7rem;color:var(--muted);">Submitted by '+esc(nm[a.requested_by]||'Unknown')+(a.sector?' · '+esc(a.sector):'')+'</div>'+
      (a.status==='controls_issued'?'<div style="margin-top:14px;padding:14px 16px;background:rgba(34,197,94,0.04);border:1px solid rgba(34,197,94,0.12);border-radius:8px;"><div style="font-size:.72rem;font-weight:700;color:#4ade80;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">MLA Controls Issued</div>'+(a.mla_notes?'<div style="font-size:.78rem;color:var(--sub);line-height:1.65;">'+esc(a.mla_notes)+'</div>':'')+'<div style="font-size:.68rem;color:var(--muted);margin-top:6px;">Completed by '+(nm[a.completed_by]||'MLA Group')+' · '+fmtDateLong(a.completed_at)+'</div></div>':'')+
      (a.status==='submitted'?'<div style="margin-top:14px;padding:14px 16px;background:rgba(37,99,235,0.04);border:1px solid rgba(37,99,235,0.12);border-radius:8px;"><div style="font-size:.78rem;color:var(--sub);line-height:1.65;">Your assessment has been submitted. MLA Group will review this AI system and provide tailored compliance controls. You will be notified when results are ready.</div></div>':'')+
      '<div style="margin-top:12px;display:flex;gap:8px;">'+(isPaidTier()?'<a href="system-report.html?aid='+a.id+'" class="btn-dl" style="text-decoration:none;display:inline-flex;" target="_blank"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>View Report</a>':'<button onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing()" style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:7px;font-size:.75rem;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif;color:var(--sky);background:transparent;border:1px solid rgba(96,165,250,0.25);white-space:nowrap;"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/></svg>Upgrade to View Report</button>')+'</div>'+
    '</div>'}).join('');
}
function switchDetailTab(id,btn){document.querySelectorAll('#view-registry-detail .tab-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('#view-registry-detail .tab-panel').forEach(p=>p.classList.remove('active'));document.getElementById('tab-'+id).classList.add('active')}
 
// ═══ ADD/EDIT SYSTEM ══════════════════════════════════════════
function openAddSystem(){var orgPlan=currentOrg?currentOrg.plan:'free';var sysLimit=(orgPlan==='professional')?999:1;if(allSystems.length>=sysLimit){var sysMsg='';if(orgPlan==='essentials')sysMsg='You have reached your Essentials plan limit of 1 AI system. Upgrade for unlimited systems, multi-user access, and more.';else if(orgPlan==='professional')sysMsg='Need more from your governance platform? Enterprise includes unlimited users, dedicated advisory, and more.';else sysMsg='You have reached your free plan limit of 1 AI system. Subscribe to unlock more systems, governance certification, and more.';openUpgradeModal(sysMsg);return}document.getElementById('sysmod-id').value='';document.getElementById('sysmod-title').textContent='Register AI System';document.getElementById('sysmod-sub').textContent='Add a new system to the governance registry';document.getElementById('sysmod-submit').innerHTML='<svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg> Register System';clearSystemForm();document.getElementById('system-modal').classList.add('open')}
function openEditSystem(){const sys=allSystems.find(s=>s.id===currentSystemId);if(!sys)return;document.getElementById('sysmod-id').value=sys.id;document.getElementById('sysmod-title').textContent='Edit System';document.getElementById('sysmod-sub').textContent=sys.name;document.getElementById('sysmod-submit').innerHTML='Save Changes';document.getElementById('sysmod-name').value=sys.name||'';document.getElementById('sysmod-desc').value=sys.description||'';document.getElementById('sysmod-vendor').value=sys.vendor||'';document.getElementById('sysmod-type').value=sys.system_type||'';document.getElementById('sysmod-purpose').value=sys.purpose_category||'';document.getElementById('sysmod-tier').value=sys.risk_tier||'';document.getElementById('sysmod-status').value=sys.deployment_status||'planned';document.getElementById('sysmod-rationale').value=sys.risk_tier_rationale||'';document.getElementById('sysmod-owner').value=sys.system_owner||'';document.getElementById('sysmod-dept').value=sys.department||'';document.getElementById('sysmod-notes').value=sys.notes||'';onPurposeChange();document.getElementById('system-modal').classList.add('open')}
function clearSystemForm(){['sysmod-name','sysmod-desc','sysmod-vendor','sysmod-rationale','sysmod-owner','sysmod-dept','sysmod-notes'].forEach(id=>document.getElementById(id).value='');document.getElementById('sysmod-type').value='';document.getElementById('sysmod-purpose').value='';document.getElementById('sysmod-tier').value='';document.getElementById('sysmod-status').value='planned';document.getElementById('sysmod-tier-hint').style.display='none';document.getElementById('sysmod-rationale-wrap').style.display='none';document.getElementById('sysmod-error').style.display='none'}
function closeSystemModal(){document.getElementById('system-modal').classList.remove('open')}
function onPurposeChange(){const purpose=document.getElementById('sysmod-purpose').value;const suggested=PURPOSE_TIER_MAP[purpose];const hint=document.getElementById('sysmod-tier-hint');const tierSel=document.getElementById('sysmod-tier');const rw=document.getElementById('sysmod-rationale-wrap');
  if(suggested){hint.innerHTML='Suggested tier: <strong>'+(TIER_LABELS[suggested])+'</strong> — based on EU AI Act Annex III.';hint.style.display='block';tierSel.value=suggested}else if(purpose==='other'){hint.innerHTML='Please classify manually.';hint.style.display='block'}else hint.style.display='none';
  rw.style.display=(tierSel.value&&tierSel.value!==suggested)?'block':'none';tierSel.onchange=()=>{rw.style.display=(tierSel.value&&tierSel.value!==suggested)?'block':'none'}}
async function submitSystem(){
  const name=document.getElementById('sysmod-name').value.trim();const owner=document.getElementById('sysmod-owner').value.trim();const errEl=document.getElementById('sysmod-error');
  if(!name||!owner){errEl.textContent='System name and owner are required.';errEl.style.display='block';return}errEl.style.display='none';
  const btn=document.getElementById('sysmod-submit');const origH=btn.innerHTML;btn.textContent='Saving…';btn.disabled=true;if(!currentOrg)await ensureOrg();
  const payload={org_id:currentOrg.id,name,description:document.getElementById('sysmod-desc').value.trim()||null,vendor:document.getElementById('sysmod-vendor').value.trim()||null,system_type:document.getElementById('sysmod-type').value||null,purpose_category:document.getElementById('sysmod-purpose').value||null,risk_tier:document.getElementById('sysmod-tier').value||null,risk_tier_rationale:document.getElementById('sysmod-rationale').value.trim()||null,risk_tier_set_by:document.getElementById('sysmod-tier').value?currentUser.id:null,deployment_status:document.getElementById('sysmod-status').value,system_owner:owner,department:document.getElementById('sysmod-dept').value.trim()||null,notes:document.getElementById('sysmod-notes').value.trim()||null};
  const editId=document.getElementById('sysmod-id').value;
  if(!editId){var sysLimit=1;var orgPlan=currentOrg?currentOrg.plan:'free';if(orgPlan==='professional')sysLimit=999;if(allSystems.length>=sysLimit){errEl.textContent='Your '+(orgPlan||'free')+' plan allows '+(sysLimit>=999?'unlimited':sysLimit)+' AI system'+(sysLimit!==1?'s':'')+'. Upgrade to Professional for unlimited systems.';errEl.style.display='block';btn.innerHTML=origH;btn.disabled=false;return}}
  try{if(editId){const{error}=await sb.from('ai_systems').update(payload).eq('id',editId);if(error)throw error;await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'system_updated',entity_type:'ai_system',entity_id:editId,changes:{_actor_name:actorName()}})}
    else{payload.created_by=currentUser.id;const{error}=await sb.from('ai_systems').insert(payload);if(error)throw error}
    closeSystemModal();await loadSystems();if(editId)openSystemDetail(editId);
  }catch(err){errEl.textContent='Error: '+err.message;errEl.style.display='block'}finally{btn.innerHTML=origH;btn.disabled=false}}
 
