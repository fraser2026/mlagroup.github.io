// ═══ ACTIVITY CLICK ROUTING ═══════════════════════════════════
function getActivityClick(entry){
  var et=entry.entity_type;var eid=entry.entity_id;var act=entry.action;
  if(act==='system_created'||act==='system_updated'||act==='risk_tier_set'||act==='risk_tier_changed'||act==='assessment_submitted'||act==='mla_review_updated'){
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
  if(!assign){infoEl.style.display='none';return}
  if(assign.assigned_to)select.value=assign.assigned_to;
  if(assign.due_date)dateInput.value=assign.due_date;
  if(assign.priority)prioritySelect.value=assign.priority;
  // Show assignment info
  if(assign.assigned_at&&assign.assigned_by){
    var nm=await loadNames([assign.assigned_by]);
    infoEl.innerHTML='Assigned by '+esc(nm[assign.assigned_by]||'Unknown')+' on '+fmtDateLong(assign.assigned_at);
    infoEl.style.display='block';
  }else{
    infoEl.style.display='none';
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
    statusEl.style.display='block';statusEl.style.color='var(--red)';statusEl.textContent='Error saving: '+result.error.message;return;
  }
  // Update local cache
  assign.assigned_to=assignTo;assign.due_date=dueDate;assign.priority=priority;
  assign.assigned_by=update.assigned_by||assign.assigned_by;
  assign.assigned_at=update.assigned_at||assign.assigned_at;
  statusEl.style.display='block';statusEl.style.color='#4ade80';statusEl.textContent='Saved';
  setTimeout(function(){statusEl.style.display='none'},2000);
  // Audit log for assignment changes
  if(assignTo){
    var nm=await loadNames([assignTo]);
    await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'control_assigned',entity_type:'governance_control',entity_id:currentControlId,changes:{_actor_name:actorName(),control:allControls.find(function(c){return c.id===currentControlId})?.title,assigned_to_name:nm[assignTo]||'Unknown',due_date:dueDate,priority:priority}});
  }
}
 
async function renderMyTasks(){
  if(!currentUser||!allAssignments.length||!allControls.length)return;
  var myTasks=allAssignments.filter(function(a){
    return a.assigned_to===currentUser.id&&a.status!=='implemented'&&a.status!=='verified';
  });
  var panel=document.getElementById('my-tasks-panel');
  if(!panel)return;
  if(!myTasks.length){panel.style.display='none';return}
  panel.style.display='block';
  document.getElementById('my-tasks-count').textContent=myTasks.length+' task'+(myTasks.length!==1?'s':'');
  var sysNames={};allSystems.forEach(function(s){sysNames[s.id]=s.name});
  var PRIORITY_C={low:'var(--muted)',medium:'#93c5fd',high:'#fbbf24',critical:'#f87171'};
  var PRIORITY_L={low:'Low',medium:'Medium',high:'High',critical:'Critical'};
  var today=new Date().toISOString().split('T')[0];
  var body=document.getElementById('my-tasks-body');
  body.innerHTML=myTasks.sort(function(a,b){
    // Sort: overdue first, then by due date, then by priority
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
    var dueColor=isOverdue?'#f87171':a.due_date?'var(--sub)':'var(--muted)';
    var priCol=PRIORITY_C[a.priority]||'var(--muted)';
    var tCol=TYPE_COLORS[ctrl.control_type]||'var(--muted)';
    var tBg=TYPE_BG[ctrl.control_type]||'rgba(255,255,255,0.04)';
    var tBor=TYPE_BORDER[ctrl.control_type]||'rgba(255,255,255,0.08)';
    var aid="'"+a.id+"'";
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.03);cursor:pointer;" onclick="openControlDetail(\''+ctrl.id+'\','+aid+')" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'none\'">' +
      '<div style="width:28px;height:28px;border-radius:8px;background:'+tBg+';border:1px solid '+tBor+';display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:'+tCol+';flex-shrink:0;">'+ctrl.control_number+'</div>' +
      '<div style="flex:1;min-width:0;"><div style="font-size:.82rem;font-weight:600;color:var(--main);margin-bottom:2px;">'+esc(ctrl.title)+(sysName?' — '+esc(sysName):'')+'</div><div style="display:flex;align-items:center;gap:8px;font-size:.7rem;"><span style="color:'+dueColor+';">'+(isOverdue?'Overdue — ':'')+dueText+'</span><span style="color:'+priCol+';">'+PRIORITY_L[a.priority]+'</span></div></div>' +
      '<span style="font-size:.62rem;font-weight:700;padding:3px 9px;border-radius:100px;white-space:nowrap;color:'+CTRL_STATUS_C[a.status]+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">'+CTRL_STATUS_L[a.status]+'</span>' +
    '</div>';
  }).join('');
}
 
// ═══ DASHBOARD: NEXT STEPS ════════════════════════════════════

async function renderNextSteps(){
  var panel=document.getElementById('next-steps-panel');
  if(!panel||!currentOrg)return;
  var steps=[];

  // 1. No AI systems — first-time prompt
  if(!allSystems.length){
    steps.push({icon:'<rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="7" width="14" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/>',color:'#60a5fa',title:'Register your first AI system',desc:'Add an AI system to begin building your governance registry.',action:'openAddSystem()',label:'Add System',urgent:false});
  }

  // 2. Systems without assessments
  if(allSystems.length){
    var assessedResult=await sb.from('registry_assessments').select('system_id').eq('org_id',currentOrg.id);
    var assessedIds={};
    (assessedResult.data||[]).forEach(function(a){assessedIds[a.system_id]=true});
    allSystems.forEach(function(s){
      if(!assessedIds[s.id]){
        steps.push({icon:'<path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/>',color:'#fbbf24',title:'Run assessment on '+s.name,desc:'Evaluate governance maturity and trigger tailored controls.',action:"currentSystemId='"+s.id+"';openAssessmentModal()",label:'Assess',urgent:false});
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
      steps.push({icon:'<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/>',color:'#c4b5fd',title:'Acknowledge: '+p.title,desc:'Review and acknowledge this governance policy (v'+p.version+').',action:"openPolicyDetail('"+p.id+"')",label:'Review',urgent:false});
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
      steps.push({icon:'<circle cx="8" cy="8" r="7"/><path d="M8 4v4l2.5 2.5"/>',color:'#f87171',title:'Overdue: '+ctrl.title,desc:'Due '+fmtDate(a.due_date+'T00:00:00')+'. Take action to stay compliant.',action:"openControlDetail('"+ctrl.id+"','"+a.id+"')",label:'Open',urgent:true});
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
    steps.push({icon:'<path d="M8 1.5l5.5 3v5c0 3.5-3 5.5-5.5 7-2.5-1.5-5.5-3.5-5.5-7v-5z"/>',color:'#4ade80',title:'Start: '+ctrl.title+(sysName?' — '+sysName:''),desc:'Begin implementing this governance control.',action:"openControlDetail('"+ctrl.id+"','"+a.id+"')",label:'Open',urgent:false});
    notStartedCount++;
  });

  // Nothing to do — positive state
  if(!steps.length){
    if(allAssignments.length){
      panel.style.display='block';
      panel.innerHTML='<div class="panel"><div class="panel-header"><div class="panel-title">Next Steps</div></div><div class="panel-body" style="text-align:center;padding:24px 20px;"><div style="width:36px;height:36px;border-radius:10px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3 3 7-7"/></svg></div><div style="font-size:.85rem;font-weight:600;color:var(--main);margin-bottom:4px;">All caught up</div><div style="font-size:.78rem;color:var(--muted);line-height:1.6;">Your governance controls, policies, and assessments are all up to date.</div></div></div>';
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
  panel.innerHTML='<div class="panel"><div class="panel-header"><div class="panel-title">Next Steps</div><div class="panel-sub">'+remaining+' action'+(remaining!==1?'s':'')+' to complete</div></div><div class="panel-body" style="padding:6px 20px;">'+
  steps.map(function(s,i){
    var border=i<steps.length-1?'border-bottom:1px solid rgba(255,255,255,0.03);':'';
    return '<div style="display:flex;align-items:center;gap:14px;padding:12px 0;'+border+'cursor:pointer;transition:background .1s;margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:8px;" onclick="'+s.action+'" onmouseover="this.style.background=\'rgba(255,255,255,0.03)\'" onmouseout="this.style.background=\'none\'">'+
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="'+s.color+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg></div>'+
      '<div style="flex:1;min-width:0;"><div style="font-size:.82rem;font-weight:600;color:var(--main);margin-bottom:2px;">'+esc(s.title)+'</div><div style="font-size:.72rem;color:var(--muted);line-height:1.5;">'+esc(s.desc)+'</div></div>'+
      '<button class="btn-topbar '+(s.urgent?'btn-topbar-primary':'btn-topbar-ghost')+'" style="flex-shrink:0;padding:5px 12px;font-size:.72rem;" onclick="event.stopPropagation();'+s.action+'">'+s.label+'</button>'+
    '</div>';
  }).join('')+'</div></div>';
}

// Add policies to topbar titles
