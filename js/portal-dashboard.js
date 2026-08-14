// ═══ ACTIVITY CLICK ROUTING ═══════════════════════════════════
function getActivityClick(entry){
  var et=entry.entity_type;var eid=entry.entity_id;var act=entry.action;
  if(act==='system_created'||act==='system_updated'||act==='risk_tier_set'||act==='risk_tier_changed'||act==='assessment_submitted'||act==='assessment_requested'||act==='mla_review_updated'){
    return "openSystemDetail('"+eid+"')";
  }
  if(act==='compliance_status_updated'){
    return "openSystemDetail('"+eid+"')";
  }
  if(act==='control_assigned'){
    return "navigateControls(document.getElementById('nav-controls'))";
  }
  if(act==='control_updated'||act==='control_implemented'){
    var assignForCtrl=allAssignments.find(function(a){return a.control_id===eid});
    var aid=assignForCtrl?assignForCtrl.id:null;
    if(aid)return "openControlDetail('"+eid+"','"+aid+"')";
    return "navigateControls(document.getElementById('nav-controls'))";
  }
  if(act==='support_requested'||act==='support_responded'){
    var assignForSupport=allAssignments.find(function(a){return a.control_id===eid||a.system_id===eid});
    if(assignForSupport)return "openControlDetail('"+assignForSupport.control_id+"','"+assignForSupport.id+"')";
    return "navigateControls(document.getElementById('nav-controls'))";
  }
  if(act==='policy_adopted'||act==='policy_acknowledged'||act==='policy_esigned'){
    return "openPolicyDetail('"+eid+"')";
  }
  if(act==='member_invited'||act==='member_joined'||act==='member_role_changed'||act==='member_removed'){
    return "navigateUsers(document.getElementById('nav-users'))";
  }
  return null;
}
 
// ═══ PHASE 3: TASK OWNERSHIP ══════════════════════════════════
var orgMembersCache=[];
 
async function loadOrgMembers(){
  if(!currentOrg)return[];
  if(orgMembersCache.length)return orgMembersCache;
  var result=await sb.from('org_members').select('user_id').eq('org_id',currentOrg.id);
  var memberIds=(result.data||[]).map(function(m){return m.user_id});
  if(!memberIds.length)return[];
  var profileResult=await sb.from('profiles').select('id,full_name,email').in('id',memberIds);
  orgMembersCache=(profileResult.data||[]).map(function(p){return{id:p.id,name:p.full_name||p.email||'Unknown'}});
  return orgMembersCache;
}
 
async function populateAssignDropdown(){
  var select=document.getElementById('cd-assign-to');
  if(!select)return;
  var members=await loadOrgMembers();
  var html='<option value="">Unassigned</option>';
  members.forEach(function(m){
    html+='<option value="'+m.id+'">'+esc(m.name)+'</option>';
  });
  select.innerHTML=html;
}
 
async function loadAssignmentUI(assign){
  await populateAssignDropdown();
  var select=document.getElementById('cd-assign-to');
  var dateInput=document.getElementById('cd-due-date');
  var prioritySelect=document.getElementById('cd-priority');
  var infoEl=document.getElementById('cd-assign-info');
  var statusEl=document.getElementById('cd-assign-status');
  if(statusEl){statusEl.hidden=true;statusEl.textContent=''}
  if(!assign){if(infoEl)infoEl.hidden=true;return}
  select.value=assign.assigned_to||'';
  dateInput.value=assign.due_date||'';
  prioritySelect.value=assign.priority||'medium';
  if(assign.assigned_at&&assign.assigned_by){
    var nm=await loadNames([assign.assigned_by]);
    infoEl.textContent='Assigned by '+(nm[assign.assigned_by]||'Unknown')+' on '+fmtDateLong(assign.assigned_at);
    infoEl.hidden=false;
  }else{
    infoEl.textContent='';
    infoEl.hidden=true;
  }
}
 
async function saveAssignment(){
  if(!currentAssignId||!currentOrg)return;
  var assign=allAssignments.find(function(a){return a.id===currentAssignId});
  if(!assign)return;
  var assignTo=document.getElementById('cd-assign-to').value||null;
  var dueDate=document.getElementById('cd-due-date').value||null;
  var priority=document.getElementById('cd-priority').value||'medium';
  var statusEl=document.getElementById('cd-assign-status');
  var infoEl=document.getElementById('cd-assign-info');
  var update={assigned_to:assignTo,due_date:dueDate,priority:priority};
  // Only set assigned_by/at if newly assigning
  if(assignTo&&!assign.assigned_to){
    update.assigned_by=currentUser.id;
    update.assigned_at=new Date().toISOString();
  }else if(!assignTo){
    update.assigned_by=null;
    update.assigned_at=null;
  }
  var result=await sb.from('control_assignments').update(update).eq('id',currentAssignId);
  if(result.error){
    statusEl.hidden=false;statusEl.style.color='var(--ra-risk)';statusEl.textContent='Error saving: '+result.error.message;return;
  }
  // Update local cache
  assign.assigned_to=assignTo;assign.due_date=dueDate;assign.priority=priority;
  assign.assigned_by=update.assigned_by!==undefined?update.assigned_by:assign.assigned_by;
  assign.assigned_at=update.assigned_at!==undefined?update.assigned_at:assign.assigned_at;
  if(assign.assigned_at&&assign.assigned_by){
    var assigner=await loadNames([assign.assigned_by]);
    infoEl.textContent='Assigned by '+(assigner[assign.assigned_by]||'Unknown')+' on '+fmtDateLong(assign.assigned_at);
    infoEl.hidden=false;
  }else{
    infoEl.textContent='';
    infoEl.hidden=true;
  }
  statusEl.hidden=false;statusEl.style.color='var(--ra-ok)';statusEl.textContent='Saved';
  setTimeout(function(){statusEl.hidden=true},2000);
  // Audit log for assignment changes
  if(assignTo){
    var nm=await loadNames([assignTo]);
    await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'control_assigned',entity_type:'governance_control',entity_id:currentControlId,changes:{_actor_name:actorName(),control:allControls.find(function(c){return c.id===currentControlId})?.title,assigned_to_name:nm[assignTo]||'Unknown',due_date:dueDate,priority:priority}});
  }
}
 
async function renderMyTasks(){
  var panel=document.getElementById('my-tasks-panel');
  if(!panel||!currentUser)return;
  panel.style.display='block';
  var myTasks=(allAssignments||[]).filter(function(a){
    return a.assigned_to===currentUser.id&&a.status!=='implemented'&&a.status!=='verified';
  });
  var assessTasks=[];
  if(currentOrg){
    var logResult=await sb.from('registry_audit_log').select('id,action,entity_id,created_at,changes,user_id').eq('org_id',currentOrg.id).in('action',['assessment_requested','assessment_submitted']).order('created_at',{ascending:false}).limit(200);
    var latest={};
    (logResult.data||[]).forEach(function(entry){
      var sid=entry.entity_id;
      if(!sid||latest[sid])return;
      latest[sid]=entry;
    });
    Object.keys(latest).forEach(function(sid){
      var entry=latest[sid];
      if(entry.action!=='assessment_requested')return;
      var sys=allSystems.find(function(s){return s.id===sid});
      assessTasks.push({
        id:entry.id,
        system_id:sid,
        name:(entry.changes&&entry.changes._system_name)||(sys&&sys.name)||'AI system',
        created_at:entry.created_at
      });
    });
  }
  if(!myTasks.length&&!assessTasks.length){
    document.getElementById('my-tasks-count').textContent='None assigned to you';
    document.getElementById('my-tasks-body').innerHTML='<div class="empty-inline">Requested assessments and control work assigned to you appear here.</div>';
    return;
  }
  var total=myTasks.length+assessTasks.length;
  document.getElementById('my-tasks-count').textContent=total+' task'+(total!==1?'s':'');
  var sysNames={};allSystems.forEach(function(s){sysNames[s.id]=s.name});
  var PRIORITY_C={low:'var(--ra-text-3)',medium:'var(--ra-text-2)',high:'var(--ra-warn)',critical:'var(--ra-risk)'};
  var PRIORITY_L={low:'Low',medium:'Medium',high:'High',critical:'Critical'};
  var today=new Date().toISOString().split('T')[0];
  var assessHtml=assessTasks.sort(function(a,b){return String(b.created_at||'').localeCompare(String(a.created_at||''))}).map(function(t){
    return '<div class="row-item">' +
      '<div class="row-marker row-marker--icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/></svg></div>' +
      '<div class="row-main"><div class="row-title">'+esc(t.name)+'</div><div class="row-meta"><span>Requested '+fmtDate(t.created_at)+'</span></div></div>' +
      '<button type="button" class="btn-topbar btn-topbar-primary btn-sm" onclick="openQueuedAssessment(\''+t.system_id+'\')">Run assessment</button>' +
    '</div>';
  }).join('');
  var body=document.getElementById('my-tasks-body');
  var controlHtml=myTasks.sort(function(a,b){
    var aOverdue=a.due_date&&a.due_date<today?1:0;
    var bOverdue=b.due_date&&b.due_date<today?1:0;
    if(bOverdue!==aOverdue)return bOverdue-aOverdue;
    if(a.due_date&&b.due_date)return a.due_date.localeCompare(b.due_date);
    if(a.due_date)return -1;if(b.due_date)return 1;return 0;
  }).map(function(a){
    var ctrl=allControls.find(function(c){return c.id===a.control_id});
    if(!ctrl)return '';
    var sysName=a.system_id?sysNames[a.system_id]:null;
    var isOverdue=a.due_date&&a.due_date<today;
    var dueText=a.due_date?fmtDate(a.due_date+'T00:00:00'):'No due date';
    var dueColor=isOverdue?'var(--ra-risk)':a.due_date?'var(--ra-text-2)':'var(--ra-text-3)';
    var priCol=PRIORITY_C[a.priority]||'var(--ra-text-3)';
    var aid="'"+a.id+"'";
    return '<div class="row-item" onclick="openControlDetail(\''+ctrl.id+'\','+aid+')">' +
      '<div class="row-marker">'+ctrl.control_number+'</div>' +
      '<div class="row-main"><div class="row-title">'+esc(ctrl.title)+(sysName?' — '+esc(sysName):'')+'</div><div class="row-meta"><span style="color:'+dueColor+';">'+(isOverdue?'Overdue — ':'')+dueText+'</span><span style="color:'+priCol+';">'+PRIORITY_L[a.priority]+'</span></div></div>' +
      '<span class="state-label" style="color:'+CTRL_STATUS_C[a.status]+';">'+CTRL_STATUS_L[a.status]+'</span>' +
    '</div>';
  }).join('');
  body.innerHTML=assessHtml+controlHtml;
}
 
// ═══ DASHBOARD: NEXT STEPS ════════════════════════════════════

async function renderNextSteps(){
  var panel=document.getElementById('next-steps-panel');
  if(!panel||!currentOrg)return;
  var steps=[];

  // 1. No AI systems — first-time prompt
  if(!allSystems.length){
    steps.push({icon:'<rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="7" width="14" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/>',color:'var(--ra-text-3)',title:'Register your first AI system',desc:'Add an AI system to begin building your governance registry.',action:'openAddSystem()',label:'Add System',urgent:false});
  }

  // 2. Systems without assessments
  if(allSystems.length){
    var assessedResult=await sb.from('registry_assessments').select('system_id').eq('org_id',currentOrg.id);
    var assessedIds={};
    (assessedResult.data||[]).forEach(function(a){assessedIds[a.system_id]=true});
    allSystems.forEach(function(s){
      if(!assessedIds[s.id]){
        steps.push({icon:'<path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/>',color:'var(--ra-text-3)',title:'Run assessment on '+s.name,desc:'Evaluate governance maturity and trigger tailored controls.',action:"currentSystemId='"+s.id+"';openAssessmentModal()",label:'Assess',urgent:false});
      }
    });
  }

  // 3. Pending policies — always reload fresh data
  if(currentOrg){
    var polLoad=await sb.from('policy_documents').select('*').eq('org_id',currentOrg.id).eq('is_active',true);
    allPolicies=polLoad.data||[];
    var ackLoad=await sb.from('policy_acknowledgments').select('*').eq('org_id',currentOrg.id).eq('user_id',currentUser.id);
    allAcknowledgments=ackLoad.data||[];
  }
  allPolicies.forEach(function(p){
    if(!p.requires_acknowledgment||!p.published_at)return;
    var acked=allAcknowledgments.find(function(a){return a.policy_id===p.id&&a.version_acknowledged===p.version});
    if(!acked){
      steps.push({icon:'<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/>',color:'var(--ra-text-3)',title:'Acknowledge: '+p.title,desc:'Review and acknowledge this governance policy (v'+p.version+').',action:"openPolicyDetail('"+p.id+"')",label:'Review',urgent:false});
    }
  });

  // 4. Overdue controls
  var today=new Date().toISOString().split('T')[0];
  var overdueIds={};
  allAssignments.forEach(function(a){
    if(a.due_date&&a.due_date<today&&a.status!=='implemented'&&a.status!=='verified'){
      var ctrl=allControls.find(function(c){return c.id===a.control_id});
      if(!ctrl)return;
      overdueIds[a.id]=true;
      steps.push({icon:'<circle cx="8" cy="8" r="7"/><path d="M8 4v4l2.5 2.5"/>',color:'var(--ra-risk)',title:'Overdue: '+ctrl.title,desc:'Due '+fmtDate(a.due_date+'T00:00:00')+'. Take action to stay compliant.',action:"openControlDetail('"+ctrl.id+"','"+a.id+"')",label:'Open',urgent:true});
    }
  });

  // 5. Not-started controls (top 3, skip any already shown as overdue)
  var notStartedCount=0;
  allAssignments.forEach(function(a){
    if(notStartedCount>=3)return;
    if(a.status!=='not_started')return;
    if(overdueIds[a.id])return;
    var ctrl=allControls.find(function(c){return c.id===a.control_id});
    if(!ctrl)return;
    var sysName=a.system_id?(allSystems.find(function(s){return s.id===a.system_id})||{}).name:null;
    steps.push({icon:'<path d="M8 1.5l5.5 3v5c0 3.5-3 5.5-5.5 7-2.5-1.5-5.5-3.5-5.5-7v-5z"/>',color:'var(--ra-text-3)',title:'Start: '+ctrl.title+(sysName?' — '+sysName:''),desc:'Begin implementing this governance control.',action:"openControlDetail('"+ctrl.id+"','"+a.id+"')",label:'Open',urgent:false});
    notStartedCount++;
  });

  // Nothing to do — positive state
  if(!steps.length){
    if(allAssignments.length){
      panel.style.display='block';
      panel.innerHTML='<div class="panel"><div class="panel-header"><div class="panel-title">Next Steps</div></div><div class="panel-body"><div class="all-clear"><svg viewBox="0 0 16 16" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3 3 7-7"/></svg><div class="all-clear__title">All caught up</div><div class="all-clear__desc">Your governance controls, policies, and assessments are all up to date.</div></div></div></div>';
    }else{
      panel.style.display='none';
    }
    return;
  }

  // Sort: urgent first, then in order
  steps.sort(function(a,b){return (b.urgent?1:0)-(a.urgent?1:0)});

  // Cap at 8 items
  if(steps.length>8)steps=steps.slice(0,8);

  var remaining=steps.length;
  panel.style.display='block';
  panel.innerHTML='<div class="panel"><div class="panel-header"><div class="panel-title">Next Steps</div><div class="panel-sub">'+remaining+' action'+(remaining!==1?'s':'')+' to complete</div></div><div class="panel-body">'+
  steps.map(function(s){
    return '<div class="row-item" onclick="'+s.action+'">'+
      '<div class="row-marker"><svg viewBox="0 0 16 16" fill="none" stroke="'+s.color+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg></div>'+
      '<div class="row-main"><div class="row-title">'+esc(s.title)+'</div><div class="row-desc">'+esc(s.desc)+'</div></div>'+
      '<button class="btn-topbar '+(s.urgent?'btn-topbar-primary':'btn-topbar-ghost')+' btn-sm" onclick="event.stopPropagation();'+s.action+'">'+s.label+'</button>'+
    '</div>';
  }).join('')+'</div></div>';
}

// Add policies to topbar titles
