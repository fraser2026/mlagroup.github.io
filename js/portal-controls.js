// ═══ GOVERNANCE CONTROLS ══════════════════════════════════════
/* Control type and pillar are categories, not states, so RGA-001
   gives them no colour — they are told apart by their label. Status
   is a state, so it keeps functional colour. */
const TYPE_COLORS={organisation:'var(--ra-text)',system:'var(--ra-text)',assurance:'var(--ra-text)'};
const TYPE_BG={organisation:'none',system:'none',assurance:'none'};
const TYPE_BORDER={organisation:'var(--ra-border)',system:'var(--ra-border)',assurance:'var(--ra-border)'};
const PILLAR_COLORS={visibility:'var(--ra-text-3)',accountability:'var(--ra-text-3)',control:'var(--ra-text-3)',assurance:'var(--ra-text-3)'};
const CTRL_STATUS_L={not_started:'Not Started',in_progress:'In Progress',implemented:'Implemented',verified:'Verified'};
const CTRL_STATUS_C={not_started:'var(--ra-text-3)',in_progress:'var(--ra-text-2)',implemented:'var(--ra-ok)',verified:'var(--ra-ok)'};
let allControls=[],allTasks=[],allAssignments=[],currentControlId=null; let allComplianceRules=[];

function titleCaseLabel(s){
  return String(s||'').replace(/[_-]+/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase()});
}
function fieldHint(label){
  var l=String(label||'').toLowerCase();
  if(l.indexOf('vendor')!==-1)return 'e.g. OpenAI';
  if(l.indexOf('service')!==-1)return 'e.g. Model hosting';
  if(l.indexOf('capability')!==-1)return 'e.g. Generative text';
  if(l.indexOf('owner')!==-1)return 'Named individual';
  if(l.indexOf('department')!==-1)return 'e.g. Operations';
  if(l.indexOf('email')!==-1)return 'name@company.com';
  if(l.indexOf('date')!==-1)return 'dd/mm/yyyy';
  return '';
}
 
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
 
function renderControlsList(){
  const gov=getGovScore();
  document.getElementById('gov-score').textContent=gov.score+'%';
  document.getElementById('gov-maturity').textContent=raLevelText(gov.score);
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
    orgEl.innerHTML='<div class="panel"><div class="panel-header"><div class="panel-title">Organisation Controls</div><div class="panel-sub">Applies once per organisation</div></div><div class="panel-note">Governance policies and structures that apply across your entire organisation.</div>'+
    orgItems.map(function(item){return renderControlRow(item.ctrl,item.st,'organisation',null,item.assign?item.assign.id:null,item.assign)}).join('')+'</div>';
  }
  
  // System & Assurance: group by AI system
  const sysEl=document.getElementById('controls-sys-section');
  const assEl=document.getElementById('controls-ass-section');
  
  // Get unique systems that have assignments
  const systemIds=[...new Set(allAssignments.filter(a=>a.system_id).map(a=>a.system_id))];
  
  if(!systemIds.length&&perSysCtrls.length){
    sysEl.innerHTML='<div class="panel"><div class="panel-header"><div class="panel-title">System &amp; Assurance Controls</div></div><div class="empty-state"><h4>No system controls triggered yet</h4><p>Run an assessment on an AI system to trigger applicable controls.</p></div></div>';
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
      sysHtml+='<div class="panel"><div class="panel-header"><div class="panel-title">'+esc(sysName)+'</div><div class="panel-sub">'+sysList.length+' controls</div></div>'+
      sysList.sort(function(a,b){return controlUrgency(a.assign.status,a.assign)-controlUrgency(b.assign.status,b.assign)}).map(function(item){return renderControlRow(item.ctrl,item.assign.status,'system',sysId,item.assign.id,item.assign)}).join('')+'</div>';
    }
    if(assList.length){
      assHtml+='<div class="panel"><div class="panel-header"><div class="panel-title">'+esc(sysName)+' — Assurance</div><div class="panel-sub">'+assList.length+' controls</div></div><div class="panel-note">Independent checks and audit processes that verify your governance is working.</div>'+
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
  if(isOverdue)dueMeta=' <span class="row-flag">Overdue</span>';
  else if(assign&&assign.due_date&&st!=='implemented'&&st!=='verified')dueMeta=' <span class="row-due">Due '+fmtDate(assign.due_date+'T00:00:00')+'</span>';
  return '<div class="row-item row-item--padded'+(isOverdue?' is-overdue':'')+'" onclick="openControlDetail(\''+c.id+'\','+aid+')">'+
    '<div class="row-marker row-marker--icon" aria-hidden="true"><svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l5.5 3v5c0 3.5-3 5.5-5.5 7-2.5-1.5-5.5-3.5-5.5-7v-5z"/></svg></div>'+
    '<div class="row-main"><div class="row-title"><span class="row-kicker">C'+c.control_number+'</span>'+esc(c.title)+dueMeta+'</div><div class="row-desc row-desc--truncate">'+esc(c.description.substring(0,100))+'…</div></div>'+
    '<span class="state-label" style="color:'+CTRL_STATUS_C[st]+';">'+CTRL_STATUS_L[st]+'</span>'+
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
  var typeBadge=document.getElementById('cd-type-badge');
  typeBadge.textContent=titleCaseLabel(ctrl.control_type);
  typeBadge.removeAttribute('style');typeBadge.className='tag';
  var pillarBadge=document.getElementById('cd-pillar-badge');
  pillarBadge.textContent=titleCaseLabel(ctrl.pillar);
  pillarBadge.removeAttribute('style');pillarBadge.className='tag';
  const st=assign?.status||'not_started';
  var statusBadge=document.getElementById('cd-status-badge');
  statusBadge.textContent=CTRL_STATUS_L[st];
  statusBadge.removeAttribute('style');statusBadge.className='state-label';
  statusBadge.style.color=CTRL_STATUS_C[st];
 
  document.getElementById('cd-title').textContent=ctrl.title+(sysName?': '+sysName:'')+(ctrl.is_org_level?' (Global)':'');
  document.getElementById('cd-desc').textContent=ctrl.description;
  document.getElementById('cd-purpose').textContent=ctrl.purpose||'';
  document.getElementById('cd-task-count').textContent=tasks.length+' task'+(tasks.length===1?'':'s');

  // Task progress bar — status lives in the header badge, not duplicated here
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
  var isComplete=assign&&(assign.status==='implemented'||assign.status==='verified');
  var progressEl=document.getElementById('cd-progress-bar');
  if(tasksTotal>0){
    var progressFlag=(!isComplete&&taskPct===100)?'<span class="state-label ctrl-summary__flag">Ready to mark as implemented</span>':'';
    progressEl.innerHTML='<div class="ctrl-summary"><div class="ctrl-summary__head"><span class="ctrl-summary__pct ra-num">'+taskPct+'%</span><span class="ctrl-summary__note">'+tasksDone+' of '+tasksTotal+' tasks complete</span>'+progressFlag+'</div><div class="cprogress-bar"><div class="cprogress-fill" style="width:'+taskPct+'%;"></div></div></div>';
  }else{
    progressEl.innerHTML='';
  }

  // Linked policy banner — use the dedicated slot in the markup
  var linkedPolBanner='';
  if(allPolicies.length){
    var linkedPol=allPolicies.find(function(p){return p.linked_control_id===ctrlId&&p.published_at&&p.requires_acknowledgment});
    if(linkedPol){
      var polAcked=allAcknowledgments.find(function(a){return a.policy_id===linkedPol.id&&a.version_acknowledged===linkedPol.version});
      if(!polAcked){
        linkedPolBanner='<div class="callout callout--accent"><div class="callout__body"><div class="callout__title">Linked policy requires acknowledgment</div><div class="callout__desc">Acknowledge &ldquo;'+esc(linkedPol.title)+'&rdquo; (v'+esc(linkedPol.version)+') before this control can be marked fully implemented.</div></div><div class="callout__actions"><button class="btn-topbar btn-topbar-primary btn-sm" onclick="openPolicyDetail(\''+linkedPol.id+'\')">Review policy</button></div></div>';
      }
    }
  }
  var bannerEl=document.getElementById('cd-policy-banner');
  if(bannerEl)bannerEl.innerHTML=linkedPolBanner;

  // Render tasks
  document.getElementById('cd-tasks').innerHTML=tasks.map(t=>{
    const val=taskResp['task_'+t.task_number]||'';
    let input='';
    if(t.task_type==='checkbox')input='<label class="check-row"><input type="checkbox" data-task="'+t.task_number+'" '+(val==='done'?'checked':'')+'> Mark as complete</label>';
    else if(t.task_type==='select'){const opts=t.options?.options||[];input='<select class="field-input" data-task="'+t.task_number+'"><option value="">Select…</option>'+opts.map(o=>'<option'+(val===o?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>'}
    else if(t.task_type==='text')input='<textarea class="field-input" data-task="'+t.task_number+'" rows="3" placeholder="Add notes or findings">'+esc(val)+'</textarea>';
    else if(t.task_type==='fields'){
      const fields=t.options?.fields||[];
      input='<div class="task-fields">'+fields.map(function(f){
        var hint=fieldHint(f);
        return '<div class="field-group"><label class="field-label">'+esc(f)+'</label><input type="text" class="field-input" data-task="'+t.task_number+'" data-field="'+esc(f)+'" value="'+esc((taskResp['task_'+t.task_number+'_'+f])||'')+'"'+(hint?' placeholder="'+esc(hint)+'"':'')+'></div>';
      }).join('')+'</div>';
    }
    return '<div class="task-row"><div class="task-row__head"><span class="row-marker row-marker--sm">'+t.task_number+'</span><div><div class="row-title">'+esc(t.title)+'</div><div class="row-desc">'+esc(t.description||'')+'</div></div></div><div class="task-row__body">'+input+'</div></div>'}).join('');
 
  // Evidence types
  const evTypes=ctrl.evidence_types||[];
  document.getElementById('cd-evidence-types').innerHTML=evTypes.length?'<strong>Suggested evidence:</strong> '+evTypes.map(e=>esc(e)).join(', '):'';
 
  // Load existing evidence with download links
  const{data:evidence}=await sb.from('evidence_uploads').select('*').eq('control_assignment_id',assign.id).order('uploaded_at',{ascending:false});
  if(evidence&&evidence.length){
    const evHtml=[];
    for(const e of evidence){
      const{data:urlData}=await sb.storage.from('governance-reports').createSignedUrl(e.file_path,3600);
      const url=urlData?.signedUrl||'#';
      evHtml.push('<div class="evidence-row"><svg viewBox="0 0 16 16" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/></svg><div class="evidence-row__main"><div class="evidence-row__name">'+esc(e.file_name)+'</div><div class="evidence-row__date">'+fmtDateLong(e.uploaded_at)+'</div></div><a href="'+url+'" target="_blank" class="btn-topbar btn-topbar-ghost btn-sm">View</a></div>');
    }
    document.getElementById('cd-evidence-list').innerHTML=evHtml.join('');
  }else{
    document.getElementById('cd-evidence-list').innerHTML='<div class="empty-inline">No evidence uploaded yet.</div>';
  }
 
  // Update buttons based on current status
  const cBtn=document.getElementById('cd-complete-btn');
  if(st==='implemented'||st==='verified'){cBtn.textContent='Implemented';cBtn.disabled=true}
  else{cBtn.textContent='Mark as implemented';cBtn.disabled=false}
 
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
  setTimeout(()=>{btn.textContent='Save progress'},2000);
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
  document.getElementById('cd-status-badge').style.color='var(--ra-ok)';
  btn.textContent='Implemented';
  var progressFlag=document.querySelector('#cd-progress-bar .ctrl-summary__flag');
  if(progressFlag)progressFlag.remove();
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
    formEl.innerHTML='<p class="form-note">If you need help implementing this control, request guidance from a RegAnchor governance expert.</p><textarea class="field-input" id="cd-support-msg" rows="3" placeholder="Describe what you need help with…"></textarea><button class="btn-topbar btn-topbar-primary btn-sm" onclick="submitSupportRequest()">Request RegAnchor Expert</button><div id="cd-support-status" class="form-status"></div>';
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
    
    threadHtml+='<div class="thread">';
    threadHtml+='<div class="thread__head"><span class="state-label" style="color:'+(isOpen?'var(--ra-warn)':req.status==='responded'?'var(--ra-ok)':'var(--ra-text-3)')+';">'+(isOpen?'Awaiting RegAnchor Response':req.status==='responded'?'RegAnchor Responded':'Closed')+'</span><span class="thread__date">'+fmtDateLong(req.requested_at)+'</span></div>';

    // Original message. Who is speaking is carried by the label, not
    // by a tint — client and RegAnchor differ in rule weight only.
    threadHtml+='<div class="msg"><div class="msg__from">'+esc(nm[req.requested_by]||'You')+'</div><div class="msg__body">'+esc(req.client_message)+'</div></div>';

    // Legacy RegAnchor-side response (from old support_requests.mla_response)
    if(req.mla_response&&!allMsgs.some(m=>m.sender_type==='mla')){
      threadHtml+='<div class="msg msg--them"><div class="msg__from">RegAnchor</div><div class="msg__body">'+esc(req.mla_response)+'</div><div class="msg__meta">'+fmtDateLong(req.responded_at)+'</div></div>';
    }

    // Thread messages
    allMsgs.forEach(m=>{
      const isMLA=m.sender_type==='mla';
      const name=isMLA?'RegAnchor':esc(nm[m.sender_id]||'You');
      threadHtml+='<div class="msg'+(isMLA?' msg--them':'')+'"><div class="msg__from">'+name+' <span class="msg__meta">'+fmtDateLong(m.created_at)+'</span></div><div class="msg__body">'+esc(m.message)+'</div>';
      if(m.file_name)threadHtml+='<div class="msg__file" onclick="viewSupportFile(\''+esc(m.file_path)+'\')">'+esc(m.file_name)+'</div>';
      threadHtml+='</div>';
    });
    
    threadHtml+='</div>';
  }
  histEl.innerHTML=threadHtml;
  
  // Reply form — if there's an active request, show reply box
  if(openReq){
    formEl.innerHTML='<div class="reply-box"><textarea class="field-input" id="cd-support-msg" rows="2" placeholder="Reply to RegAnchor…"></textarea><div class="reply-box__actions"><input type="file" id="support-file" style="display:none;" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" /><button class="btn-topbar btn-topbar-ghost btn-sm" onclick="document.getElementById(\'support-file\').click()">Attach File</button><span id="support-file-name" class="reply-box__file"></span><button class="btn-topbar btn-topbar-primary btn-sm" style="margin-left:auto;" onclick="sendSupportReply(\''+openReq.id+'\')">Send Reply</button></div><div id="cd-support-status" class="form-status"></div></div>';
    const fileInput=document.getElementById('support-file');
    if(fileInput)fileInput.onchange=function(){document.getElementById('support-file-name').textContent=this.files[0]?.name||''};
  }else{
    // All requests closed — show new request option
    formEl.innerHTML='<div class="reply-box"><textarea class="field-input" id="cd-support-msg" rows="2" placeholder="Ask a new question…"></textarea><button class="btn-topbar btn-topbar-primary btn-sm" onclick="submitSupportRequest()">New Request</button><div id="cd-support-status" class="form-status"></div></div>';
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
  if(!msg){stEl.style.display='block';stEl.style.color='var(--ra-risk)';stEl.textContent='Please describe what you need help with.';return}
  stEl.style.display='none';
  const assign=allAssignments.find(a=>a.id===currentAssignId);
  const{data:req,error}=await sb.from('support_requests').insert({
    control_assignment_id:currentAssignId,control_id:currentControlId,org_id:currentOrg.id,
    system_id:assign?.system_id||null,client_message:msg,requested_by:currentUser.id
  }).select('id').single();
  if(error){stEl.style.display='block';stEl.style.color='var(--ra-risk)';stEl.textContent='Error: '+error.message;return}
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'support_requested',entity_type:'governance_control',entity_id:assign?.system_id||currentControlId,changes:{_actor_name:actorName(),control:allControls.find(c=>c.id===currentControlId)?.title}});
  await loadSupportForControl(currentAssignId);
}
 
async function sendSupportReply(reqId){
  if(!currentOrg)return;
  const msg=document.getElementById('cd-support-msg').value.trim();
  const stEl=document.getElementById('cd-support-status');
  if(!msg){stEl.style.display='block';stEl.style.color='var(--ra-risk)';stEl.textContent='Please enter a message.';return}
  stEl.style.display='none';
  // Upload file if attached
  let fileName=null,filePath=null,fileType=null;
  const fileInput=document.getElementById('support-file');
  if(fileInput&&fileInput.files[0]){
    const file=fileInput.files[0];
    if(file.size>5*1024*1024){stEl.style.display='block';stEl.style.color='var(--ra-risk)';stEl.textContent='File must be under 5MB.';return}
    filePath='support/'+currentOrg.id+'/'+reqId+'/'+Date.now()+'_'+file.name;
    const{error:upErr}=await sb.storage.from('governance-reports').upload(filePath,file,{contentType:file.type});
    if(upErr){stEl.style.display='block';stEl.style.color='var(--ra-risk)';stEl.textContent='File upload failed.';return}
    fileName=file.name;fileType=file.type;
  }
  const{error}=await sb.from('support_messages').insert({
    request_id:reqId,sender_id:currentUser.id,sender_type:'client',message:msg,
    file_name:fileName,file_path:filePath,file_type:fileType
  });
  if(error){stEl.style.display='block';stEl.style.color='var(--ra-risk)';stEl.textContent='Error: '+error.message;return}
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
    el.innerHTML='<div class="empty-inline" style="text-align:center;padding:32px 0;">Implement controls to start building your score trend.</div>';
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
  // Direction of travel is a state, so it keeps its colour.
  var deltaCol=delta>0?'var(--ra-ok)':delta<0?'var(--ra-risk)':'var(--ra-text-3)';
  var deltaArrow=delta>0?'\u2191':delta<0?'\u2193':'';
  var pts=[];
  for(var i=0;i<history.length;i++){pts.push(xS(i).toFixed(1)+','+yS(history[i].composite_score).toFixed(1))}
  var linePath='M'+pts.join('L');
  var fmtLabel=function(iso){return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'})};
  var labelIdxs=[0];
  if(history.length>2)labelIdxs.push(Math.floor((history.length-1)/2));
  labelIdxs.push(history.length-1);
  var gridLines='';
  var gridVals=[0,25,50,75,100];
  // Tokens throughout, so the chart follows the theme rather than
  // pinning itself to hexes that only ever worked on navy.
  for(var g=0;g<gridVals.length;g++){var v=gridVals[g];gridLines+='<line x1="'+PL+'" y1="'+yS(v).toFixed(1)+'" x2="'+(W-PR)+'" y2="'+yS(v).toFixed(1)+'" stroke="var(--ra-border)" stroke-width="1"/>'+'<text x="'+(PL-8)+'" y="'+(yS(v)+3).toFixed(1)+'" text-anchor="end" fill="var(--ra-text-3)" font-size="9" font-weight="500">'+v+'%</text>'}
  var dots='';
  for(var d=0;d<history.length;d++){dots+='<circle class="trend-dot" cx="'+xS(d).toFixed(1)+'" cy="'+yS(history[d].composite_score).toFixed(1)+'" r="2.5" fill="var(--ra-blurple)"/>'}
  var xLabels='';
  for(var x=0;x<labelIdxs.length;x++){var li=labelIdxs[x];xLabels+='<text x="'+xS(li).toFixed(1)+'" y="'+(H+2)+'" text-anchor="middle" fill="var(--ra-text-3)" font-size="9" font-weight="500">'+fmtLabel(history[li].snapshot_at)+'</text>'}
  el.innerHTML='<div class="trend">'+
    '<div class="trend__reading">'+
      '<div class="trend__num ra-num" data-count-to="'+last.composite_score+'">0%</div>'+
      '<div class="trend__label">Current score</div>'+
      '<div class="trend__delta" style="color:'+deltaCol+';">'+deltaArrow+' '+deltaSign+delta+' pts</div>'+
    '</div>'+
    '<div class="trend__chart">'+
      '<svg viewBox="0 0 '+W+' '+(H+8)+'" xmlns="http://www.w3.org/2000/svg">'+gridLines+
      '<path class="trend-line" d="'+linePath+'" fill="none" stroke="var(--ra-blurple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
      dots+xLabels+'</svg>'+
    '</div>'+
  '</div>';
  requestAnimationFrame(function(){animateScoreTrend(el,last.composite_score)});
}

function animateScoreTrend(root,targetScore){
  if(!root)return;
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var numEl=root.querySelector('.trend__num');
  var path=root.querySelector('.trend-line');
  var dots=root.querySelectorAll('.trend-dot');
  if(numEl){
    if(reduce){numEl.textContent=Math.round(targetScore)+'%'}
    else{
      var start=performance.now(),duration=900;
      var ease=function(t){return 1-Math.pow(1-t,3)};
      function tick(now){
        var t=Math.min(1,(now-start)/duration);
        numEl.textContent=Math.round(targetScore*ease(t))+'%';
        if(t<1)requestAnimationFrame(tick);
        else numEl.textContent=Math.round(targetScore)+'%';
      }
      requestAnimationFrame(tick);
    }
  }
  if(path&&path.getTotalLength){
    var len=path.getTotalLength();
    if(reduce){
      path.style.strokeDasharray='none';
      path.style.strokeDashoffset='0';
      dots.forEach(function(d){d.style.opacity='1'});
    }else{
      path.style.strokeDasharray=String(len);
      path.style.strokeDashoffset=String(len);
      dots.forEach(function(d){d.style.opacity='0'});
      void path.getBoundingClientRect();
      path.style.transition='stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)';
      path.style.strokeDashoffset='0';
      dots.forEach(function(d,i){
        d.style.transition='opacity .25s ease '+(650+i*40)+'ms';
        d.style.opacity='1';
      });
    }
  }
}

