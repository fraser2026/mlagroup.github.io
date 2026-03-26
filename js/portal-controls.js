// ═══ GOVERNANCE CONTROLS ══════════════════════════════════════
const TYPE_COLORS={organisation:'#60a5fa',system:'#f87171',assurance:'#fbbf24'};
const TYPE_BG={organisation:'rgba(96,165,250,0.08)',system:'rgba(248,113,113,0.08)',assurance:'rgba(251,191,36,0.08)'};
const TYPE_BORDER={organisation:'rgba(96,165,250,0.2)',system:'rgba(248,113,113,0.2)',assurance:'rgba(251,191,36,0.2)'};
const PILLAR_COLORS={visibility:'#60a5fa',accountability:'#c4b5fd',control:'#4ade80',assurance:'#fbbf24'};
const CTRL_STATUS_L={not_started:'Not Started',in_progress:'In Progress',implemented:'Implemented',verified:'Verified'};
const CTRL_STATUS_C={not_started:'var(--muted)',in_progress:'#93c5fd',implemented:'#4ade80',verified:'#4ade80'};
const MATURITY_BANDS=[{max:30,label:'Initial'},{max:50,label:'Developing'},{max:70,label:'Structured'},{max:85,label:'Managed'},{max:100,label:'Governance Ready'}];
let allControls=[],allTasks=[],allAssignments=[],currentControlId=null; let allComplianceRules=[];
 
async function navigateControls(navEl){navigate('controls',navEl);if(!currentOrg)await ensureOrg();await loadControls();await loadScoreHistory();}
 
async function loadControls(){
  if(!currentOrg)return;
  const[{data:controls},{data:tasks},{data:assignments}]=await Promise.all([
    sb.from('governance_controls').select('*').eq('is_active',true).order('display_order'),
    sb.from('control_tasks').select('*').order('display_order'),
    sb.from('control_assignments').select('*').eq('org_id',currentOrg.id)
  ]);
  allControls=controls||[];allTasks=tasks||[];allAssignments=assignments||[];
  renderControlsList();
  // Update badge — use assignment counts not control category counts
  const done=allAssignments.filter(a=>a.status==='implemented'||a.status==='verified').length;
  const total=allAssignments.length;
  if(total){document.getElementById('ctrl-count-badge').textContent=done+'/'+total;document.getElementById('ctrl-count-badge').style.display='inline-flex'}
  else{document.getElementById('ctrl-count-badge').style.display='none'}
}
 
function getGovScore(){
  const typeWeights={organisation:0.30,system:0.40,assurance:0.30};
  const byType={organisation:{done:0,total:0},system:{done:0,total:0},assurance:{done:0,total:0}};
  // Org-level controls (1,2): count once each
  allControls.filter(c=>c.is_org_level).forEach(c=>{
    byType.organisation.total++;
    const a=allAssignments.find(x=>x.control_id===c.id&&!x.system_id);
    if(a&&(a.status==='implemented'||a.status==='verified'))byType.organisation.done++;
  });
  // Per-system controls: group into system vs assurance
  allControls.filter(c=>!c.is_org_level).forEach(c=>{
    const bucket=c.control_type==='assurance'?'assurance':'system';
    const sysAssigns=allAssignments.filter(x=>x.control_id===c.id&&x.system_id);
    if(sysAssigns.length){
      sysAssigns.forEach(a=>{
        byType[bucket].total++;
        if(a.status==='implemented'||a.status==='verified')byType[bucket].done++;
      });
    }else{byType[bucket].total++}
  });
  let score=0;
  Object.entries(byType).forEach(([t,d])=>{
    const pct=d.total>0?d.done/d.total:0;
    score+=pct*typeWeights[t]*100;
  });
  return{score:Math.round(score),byType};
}
 
function getMaturity(score){return MATURITY_BANDS.find(b=>score<=b.max)?.label||'Initial'}
 
function renderControlsList(){
  const gov=getGovScore();
  document.getElementById('gov-score').textContent=gov.score+'%';
  document.getElementById('gov-score').style.color=gov.score>=70?'#4ade80':gov.score>=40?'#fbbf24':'#f87171';
  document.getElementById('gov-maturity').textContent=getMaturity(gov.score);
  ['organisation','system','assurance'].forEach(t=>{
    const d=gov.byType[t];const pct=d.total>0?Math.round(d.done/d.total*100):0;
    document.getElementById('gov-'+t.substring(0,3)+'-pct').textContent=pct+'%';
    document.getElementById('gov-'+t.substring(0,3)+'-count').textContent=d.done+' of '+d.total+' implemented';
  });
  // Build system name lookup
  const sysNames={};allSystems.forEach(s=>{sysNames[s.id]=s.name});
  // Render org-level controls
  const orgCtrls=allControls.filter(c=>c.is_org_level);
  const perSysCtrls=allControls.filter(c=>!c.is_org_level);
  
  // Organisation section: show org-level controls
  const orgEl=document.getElementById('controls-org-section');
  if(orgCtrls.length){
    var orgItems=orgCtrls.map(function(c){var a=allAssignments.find(function(x){return x.control_id===c.id&&!x.system_id});var st=a?a.status:'not_started';return{ctrl:c,assign:a,st:st}});
    orgItems.sort(function(a,b){return controlUrgency(a.st,a.assign)-controlUrgency(b.st,b.assign)});
    orgEl.innerHTML='<div class="panel"><div class="panel-header"><div class="panel-title" style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:'+TYPE_COLORS.organisation+';"></span>Organisation Controls</div><div class="panel-sub">Applies once per organisation</div></div><div style="padding:4px 20px 8px;font-size:.72rem;color:var(--muted);line-height:1.5;">Governance policies and structures that apply across your entire organisation.</div>'+
    orgItems.map(function(item){return renderControlRow(item.ctrl,item.st,'organisation',null,item.assign?item.assign.id:null,item.assign)}).join('')+'</div>';
  }
  
  // System & Assurance: group by AI system
  const sysEl=document.getElementById('controls-sys-section');
  const assEl=document.getElementById('controls-ass-section');
  
  // Get unique systems that have assignments
  const systemIds=[...new Set(allAssignments.filter(a=>a.system_id).map(a=>a.system_id))];
  
  if(!systemIds.length&&perSysCtrls.length){
    sysEl.innerHTML='<div class="panel"><div class="panel-header"><div class="panel-title" style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:'+TYPE_COLORS.system+';"></span>System & Assurance Controls</div></div><div class="empty-state" style="padding:28px 0;"><h4>No system controls triggered yet</h4><p>Run an assessment on an AI system to trigger applicable controls.</p></div></div>';
    assEl.innerHTML='';
    return;
  }
  
  let sysHtml='';let assHtml='';
  systemIds.forEach(sysId=>{
    const sysName=sysNames[sysId]||'Unknown System';
    const sysAssigns=allAssignments.filter(a=>a.system_id===sysId);
    // Split into system controls and assurance controls
    const sysList=[];const assList=[];
    sysAssigns.forEach(a=>{
      const ctrl=allControls.find(c=>c.id===a.control_id);
      if(!ctrl)return;
      if(ctrl.control_type==='assurance')assList.push({ctrl,assign:a});
      else sysList.push({ctrl,assign:a});
    });
    if(sysList.length){
      sysHtml+='<div class="panel" style="margin-bottom:12px;"><div class="panel-header"><div class="panel-title" style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:'+TYPE_COLORS.system+';"></span>'+esc(sysName)+'</div><div class="panel-sub">'+sysList.length+' controls</div></div>'+
      sysList.sort(function(a,b){return controlUrgency(a.assign.status,a.assign)-controlUrgency(b.assign.status,b.assign)}).map(function(item){return renderControlRow(item.ctrl,item.assign.status,'system',sysId,item.assign.id,item.assign)}).join('')+'</div>';
    }
    if(assList.length){
      assHtml+='<div class="panel" style="margin-bottom:12px;"><div class="panel-header"><div class="panel-title" style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:'+TYPE_COLORS.assurance+';"></span>'+esc(sysName)+' — Assurance</div><div class="panel-sub">'+assList.length+' controls</div></div><div style="padding:4px 20px 8px;font-size:.72rem;color:var(--muted);line-height:1.5;">Independent checks and audit processes that verify your governance is working.</div>'+
      assList.sort(function(a,b){return controlUrgency(a.assign.status,a.assign)-controlUrgency(b.assign.status,b.assign)}).map(function(item){return renderControlRow(item.ctrl,item.assign.status,'assurance',sysId,item.assign.id,item.assign)}).join('')+'</div>';
    }
  });
  sysEl.innerHTML=sysHtml||'';
  assEl.innerHTML=assHtml||'';
}
 
function controlUrgency(st,assign){
  var today=new Date().toISOString().split('T')[0];
  if(assign&&assign.due_date&&assign.due_date<today&&st!=='implemented'&&st!=='verified')return 0;
  if(st==='not_started')return 1;
  if(st==='in_progress')return 2;
  if(st==='implemented')return 3;
  if(st==='verified')return 4;
  return 5;
}

function renderControlRow(c,st,type,sysId,assignId,assign){
  var aid=assignId?"'"+assignId+"'":"null";
  var today=new Date().toISOString().split('T')[0];
  var isOverdue=assign&&assign.due_date&&assign.due_date<today&&st!=='implemented'&&st!=='verified';
  var dueMeta='';
  if(isOverdue)dueMeta=' <span style="font-size:.62rem;color:#f87171;font-weight:600;margin-left:4px;">OVERDUE</span>';
  else if(assign&&assign.due_date&&st!=='implemented'&&st!=='verified')dueMeta=' <span style="font-size:.62rem;color:var(--muted);margin-left:4px;">Due '+fmtDate(assign.due_date+'T00:00:00')+'</span>';
  var leftBorder=isOverdue?'border-left:3px solid #f87171;padding-left:17px;':'';
  var hoverOut=isOverdue?'rgba(239,68,68,0.03)':'none';
  return '<div style="display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.03);cursor:pointer;transition:background .1s;'+leftBorder+'background:'+hoverOut+';" onclick="openControlDetail(\''+c.id+'\','+aid+')" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\''+hoverOut+'\'">'+
    '<div style="width:28px;height:28px;border-radius:8px;background:'+TYPE_BG[type]+';border:1px solid '+TYPE_BORDER[type]+';display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:'+TYPE_COLORS[type]+';flex-shrink:0;">'+c.control_number+'</div>'+
    '<div style="flex:1;min-width:0;"><div style="font-size:.82rem;font-weight:600;color:var(--main);margin-bottom:2px;">'+esc(c.title)+dueMeta+'</div><div style="font-size:.7rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(c.description.substring(0,100))+'...</div></div>'+
    '<span style="font-size:.65rem;font-weight:700;padding:3px 10px;border-radius:100px;white-space:nowrap;color:'+CTRL_STATUS_C[st]+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">'+CTRL_STATUS_L[st]+'</span>'+
  '</div>';
}
 
let currentAssignId=null; // tracks the specific assignment being edited
 
async function openControlDetail(ctrlId,assignId){
  currentControlId=ctrlId;
  const ctrl=allControls.find(c=>c.id===ctrlId);if(!ctrl)return;
  // Find or create the right assignment
  let assign=null;
  if(assignId){
    assign=allAssignments.find(a=>a.id===assignId);
  }
  if(!assign){
    // For org-level controls, find/create org assignment
    if(ctrl.is_org_level){
      assign=allAssignments.find(a=>a.control_id===ctrlId&&!a.system_id);
      if(!assign){
        const{data,error}=await sb.from('control_assignments').insert({control_id:ctrlId,org_id:currentOrg.id,system_id:null,status:'not_started',triggered_by:'manual'}).select().single();
        if(!error&&data){assign=data;allAssignments.push(data)}
      }
    }
  }
  if(!assign){navigate('controls',document.getElementById('nav-controls'));return}
  currentAssignId=assign.id;
  
  const tasks=allTasks.filter(t=>t.control_id===ctrlId).sort((a,b)=>a.display_order-b.display_order);
  const taskResp=assign?.task_responses||{};
  // System context
  const sysName=assign.system_id?allSystems.find(s=>s.id===assign.system_id)?.name:null;
  
  // Header badges
  const tCol=TYPE_COLORS[ctrl.control_type];const tBg=TYPE_BG[ctrl.control_type];const tBor=TYPE_BORDER[ctrl.control_type];
  document.getElementById('cd-type-badge').textContent=ctrl.control_type;
  document.getElementById('cd-type-badge').style.cssText='font-size:.6rem;font-weight:700;padding:3px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:.08em;color:'+tCol+';background:'+tBg+';border:1px solid '+tBor;
  const pCol=PILLAR_COLORS[ctrl.pillar]||'var(--muted)';
  document.getElementById('cd-pillar-badge').textContent=ctrl.pillar;
  document.getElementById('cd-pillar-badge').style.cssText='font-size:.6rem;font-weight:700;padding:3px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:.08em;color:'+pCol+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)';
  const st=assign?.status||'not_started';
  document.getElementById('cd-status-badge').textContent=CTRL_STATUS_L[st];
  document.getElementById('cd-status-badge').style.cssText='font-size:.65rem;font-weight:700;padding:3px 10px;border-radius:100px;color:'+CTRL_STATUS_C[st]+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)';
 
  document.getElementById('cd-title').textContent=ctrl.title+(sysName?' — '+sysName:'')+(ctrl.is_org_level?' (Global)':'');
  document.getElementById('cd-desc').textContent=ctrl.description;
  document.getElementById('cd-purpose').textContent=ctrl.purpose||'';
  document.getElementById('cd-task-count').textContent=tasks.length+' tasks';

  // Task progress bar
  var tasksDone=0;
  var tasksTotal=tasks.length;
  tasks.forEach(function(t){
    var val=taskResp['task_'+t.task_number]||'';
    if(t.task_type==='checkbox'&&val==='done')tasksDone++;
    else if(t.task_type==='fields'){
      var fields=t.options?.fields||[];
      var allFilled=fields.length>0&&fields.every(function(f){return(taskResp['task_'+t.task_number+'_'+f]||'').trim()!==''});
      if(allFilled)tasksDone++;
    }
    else if(t.task_type!=='checkbox'&&val.trim()!=='')tasksDone++;
  });
  var taskPct=tasksTotal>0?Math.round(tasksDone/tasksTotal*100):0;
  var taskPctCol=taskPct>=100?'#4ade80':taskPct>=50?'#fbbf24':'var(--sky)';
  var isComplete=assign&&(assign.status==='implemented'||assign.status==='verified');
  var progressEl=document.getElementById('cd-progress-bar');
  if(tasksTotal>0){
    progressEl.innerHTML='<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 20px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><div style="display:flex;align-items:center;gap:10px;"><span style="font-size:.85rem;font-weight:700;color:'+taskPctCol+';">'+taskPct+'%</span><span style="font-size:.78rem;color:var(--sub);font-weight:500;">'+tasksDone+' of '+tasksTotal+' tasks complete</span></div>'+(isComplete?'<span style="font-size:.65rem;font-weight:700;padding:3px 10px;border-radius:100px;color:#4ade80;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.18);">Implemented</span>':(taskPct===100?'<span style="font-size:.72rem;color:#4ade80;font-weight:600;">Ready to mark as Implemented</span>':''))+'</div><div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;"><div style="height:100%;width:'+taskPct+'%;background:'+taskPctCol+';border-radius:3px;transition:width .4s ease;"></div></div></div>';
  }else{
    progressEl.innerHTML='';
  }

  // Check for linked policy needing acknowledgment
  var linkedPolBanner='';
  if(allPolicies.length){
    var linkedPol=allPolicies.find(function(p){return p.linked_control_id===ctrlId&&p.published_at&&p.requires_acknowledgment});
    if(linkedPol){
      var polAcked=allAcknowledgments.find(function(a){return a.policy_id===linkedPol.id&&a.version_acknowledged===linkedPol.version});
      if(!polAcked){
        linkedPolBanner='<div style="background:rgba(96,165,250,0.05);border:1px solid rgba(96,165,250,0.18);border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:14px;"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#60a5fa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/></svg><div style="flex:1;"><div style="font-size:.82rem;font-weight:600;color:var(--main);margin-bottom:2px;">Linked policy requires your acknowledgment</div><div style="font-size:.75rem;color:var(--muted);line-height:1.5;">The policy &ldquo;'+esc(linkedPol.title)+'&rdquo; (v'+esc(linkedPol.version)+') is linked to this control and needs to be acknowledged before this control can be considered fully implemented.</div></div><button class="btn-topbar btn-topbar-primary" style="flex-shrink:0;padding:6px 14px;font-size:.72rem;" onclick="openPolicyDetail(\''+linkedPol.id+'\')">Review Policy</button></div>';
      }
    }
  }
 
  // Render linked policy banner above tasks
  var tasksPanel=document.getElementById('cd-tasks').parentElement.parentElement;
  if(linkedPolBanner){
    var bannerEl=document.getElementById('cd-policy-banner');
    if(bannerEl)bannerEl.remove();
    tasksPanel.insertAdjacentHTML('beforebegin','<div id="cd-policy-banner">'+linkedPolBanner+'</div>');
  }else{
    var oldBanner=document.getElementById('cd-policy-banner');
    if(oldBanner)oldBanner.remove();
  }

  // Render tasks
  document.getElementById('cd-tasks').innerHTML=tasks.map(t=>{
    const val=taskResp['task_'+t.task_number]||'';
    let input='';
    if(t.task_type==='checkbox')input='<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:.82rem;color:var(--sub);"><input type="checkbox" data-task="'+t.task_number+'" '+(val==='done'?'checked':'')+' style="accent-color:var(--accent);width:16px;height:16px;"> Mark as complete</label>';
    else if(t.task_type==='select'){const opts=t.options?.options||[];input='<select class="field-input" data-task="'+t.task_number+'" style="margin-bottom:0;"><option value="">Select</option>'+opts.map(o=>'<option'+(val===o?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>'}
    else if(t.task_type==='text')input='<textarea class="field-input" data-task="'+t.task_number+'" rows="2" style="margin-bottom:0;min-height:60px;" placeholder="Enter details…">'+esc(val)+'</textarea>';
    else if(t.task_type==='fields'){const fields=t.options?.fields||[];input=fields.map(f=>'<div style="margin-bottom:8px;"><label style="font-size:.68rem;color:var(--muted);margin-bottom:3px;display:block;">'+esc(f)+'</label><input type="text" class="field-input" data-task="'+t.task_number+'" data-field="'+esc(f)+'" value="'+esc((taskResp['task_'+t.task_number+'_'+f])||'')+'" style="margin-bottom:0;" placeholder="'+esc(f)+'"></div>').join('')}
    return '<div style="padding:14px 0;border-bottom:1px solid var(--border);"><div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;"><span style="width:22px;height:22px;border-radius:6px;background:rgba(37,99,235,0.1);border:1px solid rgba(37,99,235,0.2);display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:700;color:var(--sky);flex-shrink:0;">'+t.task_number+'</span><div><div style="font-size:.82rem;font-weight:600;color:var(--main);margin-bottom:3px;">'+esc(t.title)+'</div><div style="font-size:.76rem;color:var(--muted);line-height:1.6;">'+esc(t.description||'')+'</div></div></div>'+input+'</div>'}).join('');
 
  // Evidence types
  const evTypes=ctrl.evidence_types||[];
  document.getElementById('cd-evidence-types').innerHTML=evTypes.length?'<strong style="color:var(--main);font-size:.72rem;">Suggested evidence:</strong> '+evTypes.map(e=>esc(e)).join(' · '):'';
 
  // Load existing evidence with download links
  const{data:evidence}=await sb.from('evidence_uploads').select('*').eq('control_assignment_id',assign.id).order('uploaded_at',{ascending:false});
  if(evidence&&evidence.length){
    const evHtml=[];
    for(const e of evidence){
      const{data:urlData}=await sb.storage.from('governance-reports').createSignedUrl(e.file_path,3600);
      const url=urlData?.signedUrl||'#';
      evHtml.push('<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--sky)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/></svg><div style="flex:1;min-width:0;"><div style="font-size:.78rem;color:var(--main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(e.file_name)+'</div><div style="font-size:.68rem;color:var(--muted);">'+fmtDateLong(e.uploaded_at)+'</div></div><a href="'+url+'" target="_blank" style="flex-shrink:0;font-size:.72rem;font-weight:600;color:var(--sky);text-decoration:none;padding:5px 10px;border:1px solid rgba(96,165,250,0.2);border-radius:6px;transition:background .15s;" onmouseover="this.style.background=\'rgba(96,165,250,0.08)\'" onmouseout="this.style.background=\'none\'">View</a></div>');
    }
    document.getElementById('cd-evidence-list').innerHTML=evHtml.join('');
  }else{
    document.getElementById('cd-evidence-list').innerHTML='<div style="font-size:.78rem;color:var(--muted);padding:8px 0;">No evidence uploaded yet.</div>';
  }
 
  // Update buttons based on current status
  const cBtn=document.getElementById('cd-complete-btn');
  if(st==='implemented'||st==='verified'){cBtn.textContent='Implemented ✓';cBtn.disabled=true}
  else{cBtn.textContent='Mark as Implemented';cBtn.disabled=false}
 
  // Load support requests for this control
  await loadSupportForControl(assign.id);
 
  await loadAssignmentUI(assign);
  navigate('control-detail',null);
  document.getElementById('nav-controls').classList.add('active');
}
 
async function saveControlProgress(){
  if(!currentAssignId||!currentOrg)return;
  const assign=allAssignments.find(a=>a.id===currentAssignId);if(!assign)return;
  const resp={};
  document.querySelectorAll('#cd-tasks [data-task]').forEach(el=>{
    const tn=el.dataset.task;
    if(el.type==='checkbox')resp['task_'+tn]=el.checked?'done':'';
    else if(el.dataset.field)resp['task_'+tn+'_'+el.dataset.field]=el.value;
    else resp['task_'+tn]=el.value;
  });
  const btn=document.getElementById('cd-save-btn');btn.textContent='Saving…';btn.disabled=true;
  const newStatus=assign.status==='not_started'?'in_progress':assign.status;
  await sb.from('control_assignments').update({task_responses:resp,status:newStatus}).eq('id',assign.id);
  assign.task_responses=resp;assign.status=newStatus;
  btn.textContent='Saved';btn.disabled=false;
  setTimeout(()=>{btn.textContent='Save Progress'},2000);
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'control_updated',entity_type:'governance_control',entity_id:currentControlId,changes:{_actor_name:actorName(),control:allControls.find(c=>c.id===currentControlId)?.title}});
}
 
async function markControlComplete(){
  if(!currentAssignId||!currentOrg)return;
  const assign=allAssignments.find(a=>a.id===currentAssignId);if(!assign)return;
  // Save tasks first
  await saveControlProgress();
  const btn=document.getElementById('cd-complete-btn');btn.textContent='Updating…';btn.disabled=true;
  await sb.from('control_assignments').update({status:'implemented',completed_by:currentUser.id,completed_at:new Date().toISOString()}).eq('id',assign.id);
  assign.status='implemented';
  document.getElementById('cd-status-badge').textContent='Implemented';
  document.getElementById('cd-status-badge').style.color='#4ade80';
  btn.textContent='Implemented ✓';
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'control_implemented',entity_type:'governance_control',entity_id:currentControlId,changes:{_actor_name:actorName(),control:allControls.find(c=>c.id===currentControlId)?.title}});
  await loadControls();
await snapshotGovernanceScore('control_status_changed', currentControlId);
 
}
 
async function uploadEvidence(){
  const fileInput=document.getElementById('evidence-file');
  const file=fileInput.files[0];if(!file)return;
  if(file.size>5*1024*1024){alert('File must be under 5MB.');return}
  if(!currentAssignId)return;
  const assign=allAssignments.find(a=>a.id===currentAssignId);if(!assign)return;
  const path='evidence/'+currentOrg.id+'/'+assign.id+'/'+Date.now()+'_'+file.name;
  const{error:upErr}=await sb.storage.from('governance-reports').upload(path,file,{contentType:file.type,upsert:false});
  if(upErr){alert('Upload failed: '+upErr.message);return}
  await sb.from('evidence_uploads').insert({control_assignment_id:assign.id,org_id:currentOrg.id,system_id:assign.system_id||null,file_name:file.name,file_path:path,file_type:file.type,file_size:file.size,uploaded_by:currentUser.id});
  fileInput.value='';
  openControlDetail(currentControlId,currentAssignId);
}
 
// ═══ SUPPORT REQUESTS ═════════════════════════════════════════
async function loadSupportForControl(assignId){
  const histEl=document.getElementById('cd-support-history');
  const formEl=document.getElementById('cd-support-form');
  if(!assignId){histEl.innerHTML='';return}
  // Load all requests for this assignment
  const{data:requests}=await sb.from('support_requests').select('*').eq('control_assignment_id',assignId).order('requested_at',{ascending:true});
  const openReq=(requests||[]).find(r=>r.status==='open'||r.status==='responded');
  
  if(!requests||!requests.length){
    // No requests — show new request form
    histEl.innerHTML='';
    formEl.innerHTML='<p style="font-size:.78rem;color:var(--muted);line-height:1.6;margin-bottom:12px;">If you need help implementing this control, request guidance from an MLA governance expert.</p><textarea class="field-input" id="cd-support-msg" rows="3" placeholder="Describe what you need help with…" style="margin-bottom:8px;"></textarea><button class="btn-topbar btn-topbar-primary" onclick="submitSupportRequest()" style="padding:6px 14px;font-size:.75rem;">Request MLA Expert</button><div id="cd-support-status" style="font-size:.75rem;margin-top:8px;display:none;"></div>';
    return;
  }
  
  // Has requests — show conversation thread
  let threadHtml='';
  for(const req of requests){
    // Load messages for this request
    const{data:msgs}=await sb.from('support_messages').select('*').eq('request_id',req.id).order('created_at',{ascending:true});
    const allMsgs=msgs||[];
    const nm=await loadNames([req.requested_by,...allMsgs.map(m=>m.sender_id)]);
    const isOpen=req.status==='open';
    
    threadHtml+='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:12px;">';
    threadHtml+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;"><span style="font-size:.62rem;font-weight:700;padding:3px 9px;border-radius:100px;text-transform:uppercase;letter-spacing:.08em;color:'+(isOpen?'#fbbf24':req.status==='responded'?'#4ade80':'var(--muted)')+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">'+(isOpen?'Awaiting MLA Response':req.status==='responded'?'MLA Responded':'Closed')+'</span><span style="font-size:.68rem;color:var(--muted);">'+fmtDateLong(req.requested_at)+'</span></div>';
    
    // Original message
    threadHtml+='<div style="margin-bottom:10px;"><div style="font-size:.68rem;color:var(--sky);font-weight:600;margin-bottom:4px;">'+esc(nm[req.requested_by]||'You')+'</div><div style="font-size:.8rem;color:var(--sub);line-height:1.7;background:rgba(37,99,235,0.03);border-left:2px solid var(--accent);padding:8px 12px;border-radius:0 6px 6px 0;">'+esc(req.client_message)+'</div></div>';
    
    // Legacy MLA response (from old support_requests.mla_response)
    if(req.mla_response&&!allMsgs.some(m=>m.sender_type==='mla')){
      threadHtml+='<div style="margin-bottom:10px;"><div style="font-size:.68rem;color:#4ade80;font-weight:600;margin-bottom:4px;">MLA Group</div><div style="font-size:.8rem;color:var(--sub);line-height:1.7;background:rgba(34,197,94,0.03);border-left:2px solid #22c55e;padding:8px 12px;border-radius:0 6px 6px 0;">'+esc(req.mla_response)+'</div><div style="font-size:.68rem;color:var(--muted);margin-top:4px;">'+fmtDateLong(req.responded_at)+'</div></div>';
    }
    
    // Thread messages
    allMsgs.forEach(m=>{
      const isMLA=m.sender_type==='mla';
      const col=isMLA?'#4ade80':'var(--sky)';
      const bgCol=isMLA?'rgba(34,197,94,0.03)':'rgba(37,99,235,0.03)';
      const borderCol=isMLA?'#22c55e':'var(--accent)';
      const name=isMLA?'MLA Group':esc(nm[m.sender_id]||'You');
      threadHtml+='<div style="margin-bottom:10px;"><div style="font-size:.68rem;color:'+col+';font-weight:600;margin-bottom:4px;">'+name+' <span style="color:var(--muted);font-weight:400;">'+fmtDateLong(m.created_at)+'</span></div><div style="font-size:.8rem;color:var(--sub);line-height:1.7;background:'+bgCol+';border-left:2px solid '+borderCol+';padding:8px 12px;border-radius:0 6px 6px 0;">'+esc(m.message)+'</div>';
      if(m.file_name)threadHtml+='<div style="margin-top:6px;font-size:.72rem;color:var(--sky);cursor:pointer;" onclick="viewSupportFile(\''+esc(m.file_path)+'\')">📎 '+esc(m.file_name)+'</div>';
      threadHtml+='</div>';
    });
    
    threadHtml+='</div>';
  }
  histEl.innerHTML=threadHtml;
  
  // Reply form — if there's an active request, show reply box
  if(openReq){
    formEl.innerHTML='<div style="border-top:1px solid var(--border);padding-top:12px;"><textarea class="field-input" id="cd-support-msg" rows="2" placeholder="Reply to MLA Group…" style="margin-bottom:8px;"></textarea><div style="display:flex;gap:8px;align-items:center;"><input type="file" id="support-file" style="display:none;" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" /><button class="btn-topbar btn-topbar-ghost" onclick="document.getElementById(\'support-file\').click()" style="padding:5px 10px;font-size:.72rem;">Attach File</button><span id="support-file-name" style="font-size:.7rem;color:var(--muted);"></span><button class="btn-topbar btn-topbar-primary" onclick="sendSupportReply(\''+openReq.id+'\')" style="margin-left:auto;padding:6px 14px;font-size:.75rem;">Send Reply</button></div><div id="cd-support-status" style="font-size:.75rem;margin-top:8px;display:none;"></div></div>';
    const fileInput=document.getElementById('support-file');
    if(fileInput)fileInput.onchange=function(){document.getElementById('support-file-name').textContent=this.files[0]?.name||''};
  }else{
    // All requests closed — show new request option
    formEl.innerHTML='<div style="border-top:1px solid var(--border);padding-top:12px;"><textarea class="field-input" id="cd-support-msg" rows="2" placeholder="Ask a new question…" style="margin-bottom:8px;"></textarea><button class="btn-topbar btn-topbar-primary" onclick="submitSupportRequest()" style="padding:6px 14px;font-size:.75rem;">New Request</button><div id="cd-support-status" style="font-size:.75rem;margin-top:8px;display:none;"></div></div>';
  }
}
 
async function viewSupportFile(filePath){
  const{data}=await sb.storage.from('governance-reports').createSignedUrl(filePath,3600);
  if(data?.signedUrl)window.open(data.signedUrl,'_blank');
}
 
async function submitSupportRequest(){
  if(!currentAssignId||!currentControlId||!currentOrg)return;
  const msg=document.getElementById('cd-support-msg').value.trim();
  const stEl=document.getElementById('cd-support-status');
  if(!msg){stEl.style.display='block';stEl.style.color='var(--red)';stEl.textContent='Please describe what you need help with.';return}
  stEl.style.display='none';
  const assign=allAssignments.find(a=>a.id===currentAssignId);
  const{data:req,error}=await sb.from('support_requests').insert({
    control_assignment_id:currentAssignId,control_id:currentControlId,org_id:currentOrg.id,
    system_id:assign?.system_id||null,client_message:msg,requested_by:currentUser.id
  }).select('id').single();
  if(error){stEl.style.display='block';stEl.style.color='var(--red)';stEl.textContent='Error: '+error.message;return}
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'support_requested',entity_type:'governance_control',entity_id:assign?.system_id||currentControlId,changes:{_actor_name:actorName(),control:allControls.find(c=>c.id===currentControlId)?.title}});
  await loadSupportForControl(currentAssignId);
}
 
async function sendSupportReply(reqId){
  if(!currentOrg)return;
  const msg=document.getElementById('cd-support-msg').value.trim();
  const stEl=document.getElementById('cd-support-status');
  if(!msg){stEl.style.display='block';stEl.style.color='var(--red)';stEl.textContent='Please enter a message.';return}
  stEl.style.display='none';
  // Upload file if attached
  let fileName=null,filePath=null,fileType=null;
  const fileInput=document.getElementById('support-file');
  if(fileInput&&fileInput.files[0]){
    const file=fileInput.files[0];
    if(file.size>5*1024*1024){stEl.style.display='block';stEl.style.color='var(--red)';stEl.textContent='File must be under 5MB.';return}
    filePath='support/'+currentOrg.id+'/'+reqId+'/'+Date.now()+'_'+file.name;
    const{error:upErr}=await sb.storage.from('governance-reports').upload(filePath,file,{contentType:file.type});
    if(upErr){stEl.style.display='block';stEl.style.color='var(--red)';stEl.textContent='File upload failed.';return}
    fileName=file.name;fileType=file.type;
  }
  const{error}=await sb.from('support_messages').insert({
    request_id:reqId,sender_id:currentUser.id,sender_type:'client',message:msg,
    file_name:fileName,file_path:filePath,file_type:fileType
  });
  if(error){stEl.style.display='block';stEl.style.color='var(--red)';stEl.textContent='Error: '+error.message;return}
  await loadSupportForControl(currentAssignId);
}


// ═══ PHASE 4A: SCORE HISTORY ══════════════════════════════════

async function snapshotGovernanceScore(triggerEvent, triggerRef=null){
  if(!currentOrg||!allControls.length)return;
  const gov=getGovScore();
  const orgPct=Math.round(gov.byType.organisation.total>0?gov.byType.organisation.done/gov.byType.organisation.total*100:0);
  const sysPct=Math.round(gov.byType.system.total>0?gov.byType.system.done/gov.byType.system.total*100:0);
  const assPct=Math.round(gov.byType.assurance.total>0?gov.byType.assurance.done/gov.byType.assurance.total*100:0);
  await sb.from('governance_score_history').insert({
    org_id:currentOrg.id,
    composite_score:gov.score,
    org_layer_score:orgPct,
    system_layer_score:sysPct,
    assurance_layer_score:assPct,
    controls_total:allAssignments.length,
    controls_implemented:allAssignments.filter(a=>a.status==='implemented'||a.status==='verified').length,
    trigger_event:triggerEvent,
    trigger_ref:triggerRef||null,
    created_by:currentUser?.id||null
  });
  await loadScoreHistory();
}

async function loadScoreHistory(){
  var el=document.getElementById('score-history-chart');
  if(!el||!currentOrg)return;
  var result=await sb.from('governance_score_history')
    .select('composite_score,org_layer_score,system_layer_score,assurance_layer_score,snapshot_at,trigger_event')
    .eq('org_id',currentOrg.id)
    .order('snapshot_at',{ascending:true})
    .limit(20);
  var history=(result.data)||[];
  if(history.length<2){
    el.innerHTML='<div style="text-align:center;padding:32px 0;font-size:.78rem;color:var(--muted);">Implement controls to start building your score trend.</div>';
    return;
  }
  var W=660,H=180,PL=40,PR=20,PT=20,PB=32;
  var cW=W-PL-PR,cH=H-PT-PB;
  var xS=function(i){return PL+(i/(history.length-1))*cW};
  var yS=function(v){return PT+cH-((v)/100)*cH};
  var last=history[history.length-1];
  var prev=history.length>=2?history[history.length-2]:null;
  var delta=prev?(last.composite_score-prev.composite_score):0;
  var deltaSign=delta>=0?'+':'';
  var deltaCol=delta>0?'#22c55e':delta<0?'#ef4444':'#64748b';
  var deltaArrow=delta>0?'\u2191':delta<0?'\u2193':'';
  var pts=[];
  for(var i=0;i<history.length;i++){pts.push(xS(i).toFixed(1)+','+yS(history[i].composite_score).toFixed(1))}
  var linePath='M'+pts.join('L');
  var areaPath=linePath+' L'+xS(history.length-1).toFixed(1)+','+yS(0).toFixed(1)+' L'+xS(0).toFixed(1)+','+yS(0).toFixed(1)+'Z';
  var fmtLabel=function(iso){return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'})};
  var labelIdxs=[0];
  if(history.length>2)labelIdxs.push(Math.floor((history.length-1)/2));
  labelIdxs.push(history.length-1);
  var gridLines='';
  var gridVals=[0,25,50,75,100];
  for(var g=0;g<gridVals.length;g++){var v=gridVals[g];gridLines+='<line x1="'+PL+'" y1="'+yS(v).toFixed(1)+'" x2="'+(W-PR)+'" y2="'+yS(v).toFixed(1)+'" stroke="rgba(148,163,184,0.06)" stroke-width="1"/>'+'<text x="'+(PL-8)+'" y="'+(yS(v)+3).toFixed(1)+'" text-anchor="end" fill="#64748b" font-size="9" font-weight="500" font-family="DM Sans,sans-serif">'+v+'%</text>'}
  var dots='';
  for(var d=0;d<history.length;d++){dots+='<circle cx="'+xS(d).toFixed(1)+'" cy="'+yS(history[d].composite_score).toFixed(1)+'" r="3" fill="#38bdf8" stroke="rgba(15,23,42,1)" stroke-width="2"/>'}
  var xLabels='';
  for(var x=0;x<labelIdxs.length;x++){var li=labelIdxs[x];xLabels+='<text x="'+xS(li).toFixed(1)+'" y="'+(H+2)+'" text-anchor="middle" fill="#64748b" font-size="9" font-weight="500" font-family="DM Sans,sans-serif">'+fmtLabel(history[li].snapshot_at)+'</text>'}
  el.innerHTML='<div style="display:flex;align-items:flex-start;gap:24px;">'+'<div style="flex-shrink:0;width:120px;padding-top:4px;">'+'<div style="font-size:2.2rem;font-weight:700;color:#fff;font-family:DM Sans,sans-serif;line-height:1;">'+last.composite_score+'%</div>'+'<div style="font-size:0.7rem;color:#64748b;margin-top:4px;">Current Score</div>'+'<div style="font-size:0.78rem;font-weight:600;color:'+deltaCol+';margin-top:6px;">'+deltaArrow+' '+deltaSign+delta+' pts</div>'+'</div>'+'<div style="flex:1;min-width:0;">'+'<svg viewBox="0 0 '+W+' '+(H+8)+'" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;min-height:160px;">'+'<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">'+'<stop offset="0%" stop-color="rgba(56,189,248,0.15)"/>'+'<stop offset="100%" stop-color="rgba(56,189,248,0)"/>'+'</linearGradient></defs>'+gridLines+'<path d="'+areaPath+'" fill="url(#sg)"/>'+'<path d="'+linePath+'" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+dots+xLabels+'</svg>'+'</div>'+'</div>';
}

