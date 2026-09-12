function inviteLandingUrl(token){
  return location.origin+location.pathname.replace(/portal\.html.*/,'login.html')+'?invite='+encodeURIComponent(token);
}

async function consumePendingInvite(){
  var params=new URLSearchParams(location.search);
  var token=params.get('invite')||localStorage.getItem('ra_invite');
  if(!token||!currentUser)return null;
  var result=await sb.rpc('accept_org_invite',{p_token:token});
  localStorage.removeItem('ra_invite');
  if(params.get('invite'))history.replaceState(null,'',location.pathname+(location.hash||''));
  var payload=result.data;
  if(typeof payload==='string'){
    try{payload=JSON.parse(payload)}catch(e){payload=null}
  }
  if(result.error){
    console.warn('Invite accept failed',result.error);
    return {ok:false,error:result.error.message||'Invitation could not be accepted'};
  }
  if(!payload||payload.ok===false)return {ok:false,error:(payload&&payload.error)||'Invitation could not be accepted'};
  return payload;
}

async function renderUsersPage(){
  if(!currentOrg)await ensureOrg();
  var wrap=document.getElementById('users-page');
  if(!wrap||!currentOrg)return;
  var limit=orgSeatLimit(currentOrg.plan);
  var usedRpc=await sb.rpc('org_seats_used',{p_org_id:currentOrg.id});
  var used=(usedRpc.data!=null)?usedRpc.data:1;
  var manage=canManageMembers();
  var{data:members}=await sb.from('org_members').select('*').eq('org_id',currentOrg.id).order('created_at',{ascending:true});
  members=members||[];
  var{data:invites}=manage
    ? await sb.from('org_invites').select('*').eq('org_id',currentOrg.id).is('accepted_at',null).is('revoked_at',null).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false})
    : {data:[]};
  invites=invites||[];
  var ids=members.map(function(m){return m.user_id}).concat(invites.map(function(i){return i.invited_by}).filter(Boolean));
  var{data:memberProfiles}=ids.length?await sb.from('profiles').select('id,full_name,email').in('id',ids):{data:[]};
  var profMap={};(memberProfiles||[]).forEach(function(p){profMap[p.id]=p});
  var seatNote=used+' of '+limit+' seats used';
  if((currentOrg.plan||'free')!=='professional'&&(currentOrg.plan||'')!=='enterprise'){
    seatNote+='. Professional includes 5 seats';
  }
  var inviteForm='';
  if(manage){
    if(used>=limit){
      inviteForm='<p class="users-copy">Seat limit reached. Upgrade to Professional for 5 seats, or revoke a pending invite.</p>'+
        ((currentOrg.plan||'')!=='professional'?'<button type="button" class="btn-topbar btn-topbar-primary" onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing()">View plans</button>':'');
    }else{
      inviteForm=
        '<div class="users-invite">'+
          '<div><label class="field-label" for="invite-email">Work email</label><input type="email" class="field-input" id="invite-email" placeholder="colleague@organisation.com" autocomplete="off"></div>'+
          '<div><label class="field-label" for="invite-role">Role</label><select class="field-input" id="invite-role"><option value="editor">Editor</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select></div>'+
          '<div class="users-invite-actions"><button type="button" class="btn-topbar btn-topbar-primary" onclick="submitOrgInvite()">Send invite</button></div>'+
        '</div>'+
        '<p class="users-copy" id="invite-msg" hidden></p>';
    }
  }else{
    inviteForm='<p class="users-copy">Only owners and admins can invite people or change roles.</p>';
  }
  wrap.innerHTML=
    '<div class="stats-grid stats-grid-4" style="margin-bottom:16px;">'+
      '<div class="stat-card"><div class="stat-label">Members</div><div class="stat-value">'+members.length+'</div><div class="stat-sub">Accepted</div></div>'+
      '<div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value">'+invites.length+'</div><div class="stat-sub">Invites</div></div>'+
      '<div class="stat-card"><div class="stat-label">Seats</div><div class="stat-value">'+used+'/'+limit+'</div><div class="stat-sub">'+esc(PLAN_LABELS[currentOrg.plan]||currentOrg.plan||'Free')+'</div></div>'+
    '</div>'+
    '<div class="panel" style="margin-bottom:16px;"><div class="panel-header"><div class="panel-title">Invite a colleague</div><div class="panel-sub">'+esc(seatNote)+'</div></div><div class="panel-body">'+inviteForm+'</div></div>'+
    '<div class="panel" style="margin-bottom:16px;"><div class="panel-header"><div class="panel-title">Members</div><div class="panel-sub">Role-based access</div></div><div id="users-members-wrap">'+renderMemberRows(members,profMap,manage)+'</div></div>'+
    (invites.length?'<div class="panel"><div class="panel-header"><div class="panel-title">Pending invitations</div></div><div id="users-invites-wrap">'+invites.map(function(inv){
      return '<div class="member-row"><div class="member-info"><div class="member-name">'+esc(inv.email)+'</div><div class="member-email">Expires '+fmtDate(inv.expires_at)+' · '+(MEMBER_ROLE_LABELS[inv.role]||inv.role)+'</div></div>'+
        (manage?'<button type="button" class="btn-topbar btn-topbar-ghost" onclick="revokeOrgInvite(\''+inv.id+'\')">Revoke</button>':'')+
        '</div>';
    }).join('')+'</div></div>':'')+
    '<div class="panel" style="margin-top:16px;"><div class="panel-header"><div class="panel-title">Roles</div></div><div class="panel-body users-roles">'+
      '<p class="users-copy"><strong>Owner:</strong> billing, members, and all registry actions. One per organisation.</p>'+
      '<p class="users-copy"><strong>Admin:</strong> invite, change roles, and edit systems. Cannot remove the owner.</p>'+
      '<p class="users-copy"><strong>Editor:</strong> register and update AI systems, controls, and assessments.</p>'+
      '<p class="users-copy"><strong>Viewer:</strong> read the registry and reports. Cannot change records.</p>'+
    '</div></div>';
}

function renderMemberRows(members,profMap,manage){
  if(!members.length)return '<div class="empty-state" style="padding:24px 0;"><p>No members found.</p></div>';
  return members.map(function(m){
    var p=profMap[m.user_id]||{};
    var name=p.full_name||'Unknown';
    var email=p.email||'Not set';
    var init=name.split(' ').map(function(w){return w[0]}).join('').substring(0,2).toUpperCase();
    var roleCtrl='<span class="role-chip role-'+(m.role||'viewer')+'">'+(MEMBER_ROLE_LABELS[m.role]||m.role)+'</span>';
    if(manage&&m.role!=='owner'){
      roleCtrl='<select class="field-input users-role-select" aria-label="Role for '+esc(name)+'" onchange="changeOrgMemberRole(\''+m.id+'\',this.value)">'+
        ['admin','editor','viewer'].map(function(r){
          return '<option value="'+r+'"'+(m.role===r?' selected':'')+'>'+(MEMBER_ROLE_LABELS[r]||r)+'</option>';
        }).join('')+'</select>';
    }
    var remove=manage&&m.role!=='owner'&&m.user_id!==currentUser.id
      ?'<button type="button" class="btn-topbar btn-topbar-ghost" onclick="removeOrgMember(\''+m.id+'\',\''+esc(name)+'\')">Remove</button>':'';
    return '<div class="member-row"><div class="member-avatar">'+esc(init)+'</div><div class="member-info"><div class="member-name">'+esc(name)+(m.user_id===currentUser.id?' (you)':'')+'</div><div class="member-email">'+esc(email)+'</div></div>'+roleCtrl+remove+'</div>';
  }).join('');
}

async function submitOrgInvite(){
  var emailEl=document.getElementById('invite-email');
  var roleEl=document.getElementById('invite-role');
  var msg=document.getElementById('invite-msg');
  var email=emailEl?emailEl.value.trim():'';
  var role=roleEl?roleEl.value:'editor';
  if(!email||!currentOrg)return;
  var result=await sb.rpc('invite_org_member',{p_org_id:currentOrg.id,p_email:email,p_role:role});
  var payload=result.data;
  if(typeof payload==='string'){try{payload=JSON.parse(payload)}catch(e){payload=null}}
  if(result.error||!payload||payload.ok===false){
    if(msg){msg.hidden=false;msg.textContent=(payload&&payload.error)||result.error&&result.error.message||'Invite failed';}
    return;
  }
  var url=inviteLandingUrl(payload.token);
  try{await navigator.clipboard.writeText(url)}catch(e){}
  if(msg){
    msg.hidden=false;
    msg.innerHTML='Invite created for <strong>'+esc(payload.email)+'</strong>. Link copied — send it to them. They must sign in with that email.';
  }
  if(emailEl)emailEl.value='';
  await renderUsersPage();
}

async function revokeOrgInvite(id){
  await sb.rpc('revoke_org_invite',{p_invite_id:id});
  await renderUsersPage();
}
async function changeOrgMemberRole(memberId,role){
  var result=await sb.rpc('set_org_member_role',{p_member_id:memberId,p_role:role});
  var payload=result.data;
  if(typeof payload==='string'){try{payload=JSON.parse(payload)}catch(e){payload=null}}
  if(result.error||!payload||payload.ok===false){
    alert((payload&&payload.error)||(result.error&&result.error.message)||'Could not change role');
  }
  await refreshSidebarContext();
  await renderUsersPage();
}
async function removeOrgMember(memberId,name){
  if(!confirm('Remove '+name+' from this organisation?'))return;
  var result=await sb.rpc('remove_org_member',{p_member_id:memberId});
  var payload=result.data;
  if(typeof payload==='string'){try{payload=JSON.parse(payload)}catch(e){payload=null}}
  if(result.error||!payload||payload.ok===false){
    alert((payload&&payload.error)||(result.error&&result.error.message)||'Could not remove member');
    return;
  }
  await renderUsersPage();
}
