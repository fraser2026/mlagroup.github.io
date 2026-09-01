const SUPABASE_URL='https://hueftewwenjaiagdoqmb.supabase.co';
const SUPABASE_KEY='sb_publishable_Am0Ot4bWLoMb5pIhN50byQ_n3QIujY5';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const BAND_LABELS={low:'Low Risk',lowmod:'Low-Moderate',moderate:'Moderate',high:'High Risk',critical:'Critical'};
const TIER_LABELS={unacceptable:'Unacceptable',high:'High Risk',limited:'Limited',minimal:'Minimal'};
const STATUS_LABELS={planned:'Planned',development:'Development',pilot:'Pilot',production:'Production',decommissioned:'Decommissioned'};
const PLAN_LABELS={free:'Free',essentials:'Essentials',professional:'Professional',enterprise:'Enterprise'};
const TYPE_LABELS={third_party:'Third Party',in_house:'In-House',hybrid:'Hybrid'};
const MEMBER_ROLE_LABELS={owner:'Owner',admin:'Admin',editor:'Editor',viewer:'Viewer',member:'Member'};
function canManageMembers(){return currentMemberRole==='owner'||currentMemberRole==='admin'}
function canWriteRegistry(){return currentMemberRole==='owner'||currentMemberRole==='admin'||currentMemberRole==='editor'||currentMemberRole==='member'}
function orgSeatLimit(plan){var p=(plan||'free').toLowerCase();if(p==='professional')return 5;if(p==='enterprise')return 50;return 1}
/* Paid plan badge only when subscription is live; DB default plan=essentials + status=none must read Free. */
function hasLiveSubscription(org){
  if(!org)return false;
  var st=org.subscription_status;
  return st==='active'||st==='trialing';
}
function orgPlanKey(org){
  if(!org||!hasLiveSubscription(org))return 'free';
  var p=(org.plan||'').toLowerCase();
  if(p==='essentials'||p==='professional'||p==='enterprise')return p;
  return 'free';
}
function orgTierBadgeLabel(org){
  var key=orgPlanKey(org);
  if(key==='essentials')return 'Essentials tier';
  if(key==='professional')return 'Professional tier';
  if(key==='enterprise')return 'Enterprise';
  return 'Free tier';
}
function orgMembershipTierLabel(org){
  return PLAN_LABELS[orgPlanKey(org)]||'Free';
}
function showTierUpgrade(org){
  var key=orgPlanKey(org);
  return key==='free'||key==='essentials';
}
const PURPOSE_TIER_MAP={biometric_identification:'high',critical_infrastructure:'high',education_access:'high',employment_management:'high',essential_services_access:'high',law_enforcement:'high',migration_border:'high',justice_administration:'high',customer_chatbot:'limited',content_generation:'limited',emotion_recognition:'limited',internal_automation:'minimal',data_analytics:'minimal'};
let currentUser=null,currentProfile=null,currentResults=[],isPaid=false;
let currentOrg=null,allSystems=[],currentSystemId=null,regFilter='all',regSearchQuery='',regSelected={},regSelectMode=false,regRowMenuId=null;
let currentMemberRole=null;
let profilesCache={};
 
function fmtDate(iso){return iso?new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):''}
function fmtDateLong(iso){return iso?new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Not set'}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
async function signOut(){await sb.auth.signOut();window.location.href='login.html'}
function actorName(){return currentProfile?.full_name||currentUser?.email?.split('@')[0]||'Unknown'} function isPaidTier(){return currentOrg&&(currentOrg.plan==='essentials'||currentOrg.plan==='professional')&&currentOrg.subscription_status==='active'}
 
// ═══ AUDIT FORMATTING ═════════════════════════════════════════
const AUDIT_FIELD_LABELS={
  name:'name',description:'description',vendor:'vendor',system_type:'system type',
  purpose_category:'purpose',risk_tier:'risk class',risk_tier_rationale:'classification rationale',
  deployment_status:'deployment status',system_owner:'owner',department:'department',notes:'notes'
};
function fmtAuditValue(field,value){
  if(value==null||value==='')return 'not set';
  if(field==='deployment_status')return STATUS_LABELS[value]||value;
  if(field==='risk_tier')return TIER_LABELS[value]||value;
  if(field==='system_type')return TYPE_LABELS[value]||value;
  return String(value);
}
function fmtSystemUpdated(c,opts){
  opts=opts||{};
  var name=c._system_name||(typeof c.name==='string'?c.name:(c.name&&c.name.new))||'';
  var nameHtml=name?'<strong>'+esc(name)+'</strong>':'this system';
  var skipName=!!opts.omitSystemName;
  var ofName=skipName?'':' of '+nameHtml;
  var forName=skipName?'':' for '+nameHtml;
  var parts=[];
  var status=c.deployment_status;
  if(status&&typeof status==='object'&&('new' in status||'old' in status)){
    var neu=fmtAuditValue('deployment_status',status.new);
    var old=status.old!=null&&status.old!==''?fmtAuditValue('deployment_status',status.old):null;
    if(status.new==='decommissioned'){
      parts.push((skipName?'Marked as decommissioned':'Decommissioned '+nameHtml)+(old?' (was '+esc(old)+')':''));
    }else if(old){
      parts.push('Changed deployment status'+ofName+' from '+esc(old)+' to <strong>'+esc(neu)+'</strong>');
    }else{
      parts.push('Set deployment status'+ofName+' to <strong>'+esc(neu)+'</strong>');
    }
  }
  var owner=c.system_owner;
  if(owner&&typeof owner==='object'&&('new' in owner||'old' in owner)){
    var ownNew=esc(fmtAuditValue('system_owner',owner.new));
    var ownOld=owner.old?esc(fmtAuditValue('system_owner',owner.old)):null;
    if(ownOld)parts.push('Reassigned owner'+ofName+' from '+ownOld+' to <strong>'+ownNew+'</strong>');
    else parts.push('Assigned owner'+ofName+' to <strong>'+ownNew+'</strong>');
  }
  var tier=c.risk_tier;
  if(tier&&typeof tier==='object'&&('new' in tier||'old' in tier)){
    var tNew=esc(fmtAuditValue('risk_tier',tier.new));
    var tOld=tier.old?esc(fmtAuditValue('risk_tier',tier.old)):'Unclassified';
    if(skipName)parts.push('Reclassified from '+tOld+' to <strong>'+tNew+'</strong>');
    else parts.push('Reclassified '+nameHtml+' from '+tOld+' to <strong>'+tNew+'</strong>');
  }
  Object.keys(c).forEach(function(k){
    if(k.charAt(0)==='_'||k==='deployment_status'||k==='system_owner'||k==='risk_tier')return;
    var d=c[k];
    if(!d||typeof d!=='object'||!(('old' in d)||('new' in d)))return;
    var label=AUDIT_FIELD_LABELS[k]||k.replace(/_/g,' ');
    var from=fmtAuditValue(k,d.old);
    var to=fmtAuditValue(k,d.new);
    if(from===to)return;
    parts.push('Updated '+label+forName+' from '+esc(from)+' to <strong>'+esc(to)+'</strong>');
  });
  if(parts.length)return parts.join('. ');
  return skipName?'Updated system details':'Updated system details'+(name?' for '+nameHtml:'');
}
function fmtAudit(entry,namesMap,opts){
  const c=entry.changes||{};const who=(namesMap||{})[entry.user_id]||c._actor_name||'System';
  let text='';
  switch(entry.action){
    case 'system_created':text=`Registered new AI system: <strong>${esc(c.name||'')}</strong>`;break;
    case 'system_updated':text=fmtSystemUpdated(c,opts);break;
    case 'risk_tier_set':text=`Classified as <strong>${TIER_LABELS[c.risk_tier?.new]||c.risk_tier?.new||''}</strong> under EU AI Act`;break;
    case 'risk_tier_changed':text=`Reclassified from ${TIER_LABELS[c.risk_tier?.old]||'Unclassified'} to <strong>${TIER_LABELS[c.risk_tier?.new]||''}</strong>`;break;
    case 'compliance_status_updated':text=`Updated compliance status across ${c.obligation_count||c.updated_count||'multiple'} obligations`;break;
    case 'assessment_submitted':text='Submitted an assessment for review by RegAnchor';break;
    case 'assessment_requested':text='Requested an assessment of <strong>'+esc(c._system_name||'an AI system')+'</strong>';break;
    case 'control_updated':text='Updated progress on <strong>'+esc(c.control||'')+'</strong>';break;
    case 'control_implemented':text='Marked <strong>'+esc(c.control||'')+'</strong> as implemented';break;
    case 'mla_review_updated':text='RegAnchor updated assessment status to <strong>'+(c.status==='controls_issued'?'Controls Issued':c.status==='in_review'?'Under Review':c.status||'')+'</strong>';break;
    case 'control_assigned':text='Assigned <strong>'+esc(c.control||'')+'</strong> to <strong>'+esc(c.assigned_to_name||'a team member')+'</strong>'+(c.due_date?' — due '+c.due_date:'');break;     case 'policy_adopted':text='Adopted policy <strong>'+esc(c.policy||'')+'</strong>';break;     case 'policy_acknowledged':text='Acknowledged policy <strong>'+esc(c.policy||'')+'</strong> (v'+esc(c.version||'')+')';break;     case 'policy_esigned':text='E-signed policy <strong>'+esc(c.policy||'')+'</strong> (v'+esc(c.version||'')+')';break;     case 'support_requested':text='Requested RegAnchor expert help on <strong>'+esc(c.control||'')+'</strong>';break;
    case 'support_responded':text='RegAnchor responded to support request on <strong>'+esc(c.control||'')+'</strong>';break;
    case 'member_invited':text='Invited <strong>'+esc(c.email||'a colleague')+'</strong> as '+(MEMBER_ROLE_LABELS[c.role]||c.role||'member');break;
    case 'member_joined':text='Joined the organisation as '+(MEMBER_ROLE_LABELS[c.role]||c.role||'member');break;
    case 'member_role_changed':text='Changed a member role from '+(MEMBER_ROLE_LABELS[c.old]||c.old||'')+' to <strong>'+(MEMBER_ROLE_LABELS[c.new]||c.new||'')+'</strong>';break;
    case 'member_removed':text='Removed a member'+(c.role?' ('+(MEMBER_ROLE_LABELS[c.role]||c.role)+')':'');break;
    default:text=entry.action.replace(/_/g,' ');
  }
  // Override actor name for RegAnchor-side actions
  if(c._is_mla)return{who:'RegAnchor',text,time:fmtDateLong(entry.created_at)};
  return {who,text,time:fmtDateLong(entry.created_at)};
}
async function loadNames(userIds){
  const missing=[...new Set(userIds)].filter(id=>id&&!profilesCache[id]);
  if(missing.length){const{data}=await sb.from('profiles').select('id,full_name,email').in('id',missing);(data||[]).forEach(p=>{profilesCache[p.id]=p.full_name||p.email||'Unknown'})}
  const map={};userIds.forEach(id=>{if(id)map[id]=profilesCache[id]||'Unknown'});return map;
}
 
// ═══ NAVIGATION ═══════════════════════════════════════════════
// Four stable domains: Overview, Governance, Intelligence, Administration.
// Detail views highlight their parent nav item via NAV_PARENT.
const NAV_PARENT={
  'registry-detail':'registry',
  'control-detail':'controls',
  'policy-detail':'policies'
};
const topbarTitles={
  dashboard:{label:'Dashboard',icon:'<rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>'},
  reports:{label:'Reports',icon:'<path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/><path d="M5 7h6M5 10h4"/>'},
  registry:{label:'Registry',icon:'<path d="M2 3h12v10H2z"/><path d="M5 3V1h6v2"/><path d="M2 7h12M2 10h12"/>'},
  'registry-detail':{label:'System Detail',icon:'<path d="M2 3h12v10H2z"/><path d="M5 3V1h6v2"/><path d="M2 7h12M2 10h12"/>'},
  org:{label:'Organisation',icon:'<path d="M2 14V4l6-2 6 2v10"/><path d="M6 14V8h4v6"/><path d="M2 7h12"/>'},
  policies:{label:'Policies',icon:'<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/>'},
  'policy-detail':{label:'Policy Detail',icon:'<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/>'},
  controls:{label:'Controls',icon:'<path d="M8 1.5l5.5 3v5c0 3.5-3 5.5-5.5 7-2.5-1.5-5.5-3.5-5.5-7v-5z"/>'},
  'control-detail':{label:'Control Detail',icon:'<path d="M8 1.5l5.5 3v5c0 3.5-3 5.5-5.5 7-2.5-1.5-5.5-3.5-5.5-7v-5z"/>'},
  evidence:{label:'Evidence',icon:'<path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/><path d="M5 9l2 2 4-4"/>'},
  assessments:{label:'Assessments',icon:'<path d="M3 2h10v12H3z"/><path d="M6 5h4M6 8h4M6 11h2"/>'},
  documents:{label:'Documents',icon:'<path d="M2 3h5l2 2h5v8H2z"/><path d="M5 9h6M5 12h4"/>'},
  analytics:{label:'Analytics',icon:'<path d="M2 12V7M6 12V4M10 12V8M14 12V5"/>'},
  insights:{label:'Insights',icon:'<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1"/>'},
  'risk-trends':{label:'Risk Trends',icon:'<path d="M1 12l4-4 3 3 4-5 3 3"/>'},
  benchmarks:{label:'Benchmarks',icon:'<path d="M2 13h12"/><path d="M4 13V7M8 13V4M12 13V9"/>'},
  'audit-log':{label:'Audit Log',icon:'<path d="M3 2h10v12H3z"/><path d="M6 5h4M6 8h4M6 11h2"/>'},
  users:{label:'Users',icon:'<circle cx="6" cy="5" r="2.5"/><path d="M1 13c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5"/>'},
  settings:{label:'Settings',icon:'<circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42"/>'},
  billing:{label:'Billing',icon:'<rect x="1" y="3" width="14" height="10" rx="1"/><path d="M1 7h14"/>'},
  plans:{label:'Subscription',icon:'<path d="M2 4h12v9H2z"/><path d="M5 4V2h6v2"/><path d="M5 8h6"/>'},
  integrations:{label:'Integrations',icon:'<path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 01-8 0V5z"/><path d="M6 11v3M10 11v3"/>'},
  'api-keys':{label:'API Keys',icon:'<circle cx="5" cy="8" r="2.5"/><path d="M7.2 8h7v2.5M11 8v2.5"/>'},
  alerts:{label:'Notifications',icon:'<path d="M8 1a5 5 0 015 5v3l1.5 2H1.5L3 9V6a5 5 0 015-5z"/><path d="M6.5 13a1.5 1.5 0 003 0"/>'},
  referral:{label:'Referrals',icon:'<circle cx="5" cy="6" r="2"/><circle cx="11" cy="4" r="2"/><path d="M1 14c0-2.2 1.8-4 4-4s4 1.8 4 4"/><path d="M11 8c1.7 0 3 1.3 3 3v3"/>'}
};

function navElFor(viewId){
  const key=NAV_PARENT[viewId]||viewId;
  return document.querySelector('.nav-item[data-nav="'+key+'"]');
}

let navHistory=[];
function hashForView(viewId){
  if(viewId==='registry-detail'&&currentSystemId)return '#registry-detail-'+currentSystemId;
  if(viewId==='control-detail'&&typeof currentControlId!=='undefined'&&currentControlId)return '#control-detail-'+currentControlId;
  if(viewId==='policy-detail'&&typeof currentPolicyId!=='undefined'&&currentPolicyId)return '#policy-detail-'+currentPolicyId;
  return '#'+viewId;
}
function rememberPortalReturn(){
  try{
    var h=location.hash||'#dashboard';
    if(h.charAt(0)!=='#')h='#dashboard';
    sessionStorage.setItem('ra_portal_return', h);
  }catch(e){}
}
function navigate(viewId,navEl,skipHistory){
  const view=document.getElementById('view-'+viewId);
  if(!view)return;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  const activeEl=navEl||navElFor(viewId);
  if(activeEl)activeEl.classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  view.classList.add('active');
  const t=topbarTitles[viewId];
  if(t)document.getElementById('topbar-title').innerHTML=`<svg viewBox="0 0 16 16" style="width:15px;height:15px;stroke:var(--ra-text);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;">${t.icon}</svg>${t.label}`;
  const tr=document.getElementById('topbar-right');
  var addSys=canWriteRegistry()?'<button class="btn-topbar btn-topbar-primary" onclick="openAddSystem()"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Add AI System</button>':'';
  if(viewId==='users'&&canManageMembers())tr.innerHTML='<button class="btn-topbar btn-topbar-primary" onclick="document.getElementById(\'invite-email\')&&document.getElementById(\'invite-email\').focus()">Invite colleague</button><button class="btn-topbar btn-topbar-ghost" onclick="signOut()">Sign out</button>';
  else if(viewId==='registry')tr.innerHTML=addSys+'<button class="btn-topbar btn-topbar-ghost" onclick="signOut()">Sign out</button>';
  else if(viewId==='registry-detail'||viewId==='org'||viewId==='controls'||viewId==='control-detail')tr.innerHTML='<button class="btn-topbar btn-topbar-ghost" onclick="signOut()">Sign out</button>';
  else tr.innerHTML=addSys+'<button class="btn-topbar btn-topbar-ghost" onclick="signOut()">Sign out</button>';
  closeSidebar();
  window.scrollTo(0,0);
  var hash=hashForView(viewId);
  if(!skipHistory){history.pushState({view:viewId,hash:hash},'',hash);navHistory.push(viewId)}
  else history.replaceState({view:viewId,hash:hash},'',hash);
}
window.addEventListener('popstate',function(e){
  if(e.state&&e.state.hash)applyPortalHash(e.state.hash,true);
  else if(e.state&&e.state.view)applyPortalHash('#'+e.state.view,true);
});
async function navigateRegistry(navEl){
  navigate('registry',navEl);
  if(!currentOrg)await ensureOrg();
  /* Always reload — skipping when allSystems.length > 0 left stale
     assessment scores after new assessments, and control-coverage
     stats that depended on a parallel loadControls race. */
  await Promise.all([loadSystems(), loadControls()]);
  renderRegistryStats();
}
async function navigateOrg(navEl){navigate('org',navEl);if(!currentOrg)await ensureOrg();await renderOrgPage()}
async function navigateUsers(navEl){navigate('users',navEl);if(!currentOrg)await ensureOrg();if(typeof renderUsersPage==='function')await renderUsersPage()}
function openSidebar(){
  var overlay=document.getElementById('overlay');
  document.getElementById('sidebar').classList.add('open');
  if(overlay){
    overlay.hidden=false;
    // Force a frame so opacity can transition after [hidden] is cleared
    void overlay.offsetWidth;
    overlay.classList.add('show');
  }
  document.documentElement.classList.add('sidebar-open');
}
function closeSidebar(){
  var overlay=document.getElementById('overlay');
  document.getElementById('sidebar').classList.remove('open');
  if(overlay){
    overlay.classList.remove('show');
    var hide=function(){
      if(!overlay.classList.contains('show')) overlay.hidden=true;
      overlay.removeEventListener('transitionend', hide);
    };
    overlay.addEventListener('transitionend', hide);
    // Fallback if transitionend does not fire
    setTimeout(hide, 250);
  }
  document.documentElement.classList.remove('sidebar-open');
}
 
// ═══ INIT ═════════════════════════════════════════════════════
async function init(){
  const urlPreview=new URLSearchParams(window.location.search);
  const isPreview=urlPreview.get('preview')==='1'||urlPreview.get('preview')==='true';

  const{data:{session}}=await sb.auth.getSession();
  if(!session){
    if(isPreview){
      // Design mode: stay out of login so subscription return UX can be shaped offline
      showPortalSubscriptionPreview(urlPreview.get('plan')||'essentials');
      return;
    }
    window.location.href='login.html';
    return;
  }
  currentUser=session.user;
  // maybeSingle avoids PostgREST 406 when the profile row is missing (common after
  // auth signup without a successful profiles insert).
  const[{data:profile},{data:entitlements}]=await Promise.all([
    sb.from('profiles').select('full_name,organisation,paid,org_id,email').eq('id',currentUser.id).maybeSingle(),
    sb.from('entitlements').select('id,diagnostic_id,status').eq('user_id',currentUser.id).eq('status','active')
  ]);
  currentProfile=profile;
  if(!currentProfile){
    // Insert-only self-heal: never upsert privileged fields (role/paid).
    // Those must stay server-controlled; profiles RLS should also be enabled separately.
    const fallbackName=currentUser.user_metadata?.full_name||currentUser.email.split('@')[0];
    const{data:created,error:createErr}=await sb.from('profiles').insert({
      id:currentUser.id,
      email:currentUser.email,
      full_name:fallbackName
    }).select('full_name,organisation,paid,org_id,email').maybeSingle();
    if(createErr){
      // Race: row may have appeared; re-read without overwriting anything.
      const{data:again}=await sb.from('profiles').select('full_name,organisation,paid,org_id,email').eq('id',currentUser.id).maybeSingle();
      currentProfile=again||{full_name:fallbackName,organisation:'',paid:false,org_id:null,email:currentUser.email};
    }else{
      currentProfile=created||{full_name:fallbackName,organisation:'',paid:false,org_id:null,email:currentUser.email};
    }
  }
  isPaid=(entitlements&&entitlements.length>0)||currentProfile?.paid===true;
  const paidIds=new Set((entitlements||[]).map(e=>e.diagnostic_id).filter(Boolean));
  const fullName=currentProfile?.full_name||currentUser.email.split('@')[0];
  const initials=fullName.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  profilesCache[currentUser.id]=fullName;
  document.getElementById('sidebar-name').textContent=fullName;
  document.getElementById('sidebar-avatar').textContent=initials;
  if(currentProfile?.full_name){const p=currentProfile.full_name.split(' ');document.getElementById('set-first').value=p[0]||'';document.getElementById('set-last').value=p.slice(1).join(' ')||''}
  document.getElementById('set-org').value=currentProfile?.organisation||'';document.getElementById('set-email').value=currentUser.email;
  document.getElementById('referral-link').textContent=location.host+'/ref/'+currentUser.id.substring(0,8);
  const{data:results}=await sb.from('diagnostic_results').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
  currentResults=results||[];
  document.getElementById('paywall-banner').style.display=(isPaid||isPaidTier())?'none':'flex'; document.getElementById('tier-banner').style.display=isPaidTier()?'none':'flex'; document.getElementById('controls-tier-banner').style.display=isPaidTier()?'none':'flex';
  renderReports(paidIds);
  var bootHash=window.location.hash||'#dashboard';
  // Always provision org — subscriptions need currentOrg even when org_id is still null.
  consumePendingInvite().then(function(){
    return ensureOrg();
  }).then(function(){
    return Promise.all([loadSystems(),loadControls(),refreshSidebarContext()]);
  }).then(function(){
    /* loadSystems may finish before loadControls; paint coverage again
       once both are present so the top stats are stable. */
    if(typeof renderRegistryStats==='function')renderRegistryStats();
    renderDashboard(paidIds);
    loadScoreHistory();
    loadAssessmentReports();
    handleDeepLink(bootHash);
    loadAlerts();
    setTimeout(function(){checkAndCreateAlerts();loadAndRunComplianceEngine()},3000);
  }).catch(function(){renderDashboard(paidIds)});
}

function showPortalSubscriptionPreview(plan){
  document.title='[Preview] Portal | RegAnchor';
  var app=document.querySelector('.app');
  if(app)app.style.display='none';
  var planLabel=plan==='professional'?'Professional':'Essentials';
  var wrap=document.createElement('div');
  wrap.id='portal-sub-preview';
  wrap.innerHTML=
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--ra-bg,#fff);font-family:var(--ra-font-product,Inter,sans-serif);">'+
      '<div style="width:100%;max-width:440px;border:1px solid var(--ra-border,#E6EBF1);padding:32px 28px;">'+
        '<div style="height:3px;background:var(--ra-blurple,#533AFD);margin:-32px -28px 24px;width:calc(100% + 56px);"></div>'+
        '<div style="font-size:0.68rem;letter-spacing:0.08em;color:var(--ra-text-3,#697386);margin-bottom:8px;">Payment confirmed · preview</div>'+
        '<h1 style="font-family:var(--ra-font-brand,\'IBM Plex Sans\',sans-serif);font-size:1.5rem;font-weight:500;color:var(--ra-ink,#0A0E14);letter-spacing:-0.02em;line-height:1.2;margin:0 0 10px;">'+planLabel+' is<br><span style="color:var(--ra-text-3,#697386);font-weight:400;">now active.</span></h1>'+
        '<p style="font-size:0.85rem;color:var(--ra-text-2,#425466);line-height:1.6;margin:0 0 22px;">Your organisation subscription is linked. Continue to the dashboard, register systems, or open the plans page to manage billing.</p>'+
        '<div style="display:flex;flex-direction:column;gap:8px;">'+
          '<a href="portal.html" style="display:block;text-align:center;padding:12px 16px;background:var(--ra-blurple,#533AFD);color:#fff;text-decoration:none;font-size:0.88rem;font-weight:500;border-radius:4px;">Open portal (sign in if needed)</a>'+
          '<a href="portal.html?goto=plans" style="display:block;text-align:center;padding:11px 16px;border:1px solid var(--ra-border,#E6EBF1);color:var(--ra-ink,#0A0E14);text-decoration:none;font-size:0.84rem;border-radius:4px;">View subscription plans</a>'+
          '<a href="design-checkout.html" style="display:block;text-align:center;padding:10px;color:var(--ra-text-3,#697386);font-size:0.78rem;text-decoration:none;">← Design launcher</a>'+
        '</div>'+
      '</div>'+
    '</div>';
  document.body.appendChild(wrap);
}

async function refreshSidebarContext(){
  var roleEl=document.getElementById('sidebar-role');
  var subEl=document.getElementById('dash-subtext');
  if(!currentOrg){
    if(roleEl)roleEl.textContent='Member';
    if(subEl)subEl.textContent='Organisation overview and recent activity';
    return;
  }
  var role='member';
  try{
    var mem=await sb.from('org_members').select('role').eq('org_id',currentOrg.id).eq('user_id',currentUser.id).limit(1);
    if(mem.data&&mem.data[0]&&mem.data[0].role)role=mem.data[0].role;
  }catch(e){}
  currentMemberRole=role;
  if(roleEl)roleEl.textContent=MEMBER_ROLE_LABELS[role]||(role.charAt(0).toUpperCase()+role.slice(1));
  if(subEl)subEl.textContent=currentOrg.name;
}
function applyPortalHash(raw, skipHistory){
  var h=String(raw||'').replace(/^#/,'');
  if(!h||h==='dashboard'){
    navigate('dashboard',document.getElementById('nav-dashboard'),!!skipHistory);
    return;
  }
  if(h.indexOf('registry-detail-')===0){
    var sysId=h.slice('registry-detail-'.length);
    if(sysId&&typeof openSystemDetail==='function'){openSystemDetail(sysId);return}
  }
  if(h.indexOf('control-detail-')===0){
    var ctrlId=h.slice('control-detail-'.length);
    if(ctrlId&&typeof openControlDetail==='function'){openControlDetail(ctrlId);return}
  }
  if(h.indexOf('policy-detail-')===0){
    var polId=h.slice('policy-detail-'.length);
    if(polId&&typeof openPolicyDetail==='function'){openPolicyDetail(polId);return}
  }
  if(h==='registry'&&typeof navigateRegistry==='function'){navigateRegistry(document.getElementById('nav-registry'));return}
  if(h==='org'&&typeof navigateOrg==='function'){navigateOrg(document.getElementById('nav-org'));return}
  if(h==='users'&&typeof navigateUsers==='function'){navigateUsers(document.getElementById('nav-users'));return}
  if(h==='billing'&&typeof navigateBilling==='function'){navigateBilling(document.getElementById('nav-billing'));return}
  if(h==='controls'&&typeof navigateControls==='function'){navigateControls(document.getElementById('nav-controls'));return}
  if(h==='policies'&&typeof navigatePolicies==='function'){navigatePolicies(document.getElementById('nav-policies'));return}
  if(h==='alerts'&&typeof navigateAlerts==='function'){navigateAlerts();return}
  if(h==='plans'){
    navigate('plans',document.getElementById('nav-plans'),!!skipHistory);
    if(typeof updatePortalPricing==='function')updatePortalPricing();
    return;
  }
  if(document.getElementById('view-'+h))navigate(h,navElFor(h),!!skipHistory);
}
function handleDeepLink(bootHash){
  var urlParams=new URLSearchParams(window.location.search);
  var goto=urlParams.get('goto');
  if(goto==='plans'){
    history.replaceState(null,'',window.location.pathname+'#plans');
    navigate('plans',document.getElementById('nav-plans'));updatePortalPricing();
    var plan=urlParams.get('plan');
    var period=urlParams.get('period');
    if(period==='annual')portalAnnual=true;
    if(plan&&typeof portalSubscribe==='function'){
      updatePortalPricing();
      setTimeout(function(){portalSubscribe(plan)},400);
    }
    return;
  }
  if(goto&&goto.startsWith('system-controls-')){
    var scId=goto.replace('system-controls-','');
    if(scId){
      openSystemDetail(scId).then(function(){
        switchDetailTab('sys-controls',document.querySelectorAll('#view-registry-detail .tab-btn')[2]);
      });
      return;
    }
  }
  if(urlParams.get('subscription')==='success'){
    navigate('dashboard',document.getElementById('nav-dashboard'),true);
    setTimeout(function(){var sb2=document.getElementById('cert-card-panel');if(sb2)sb2.scrollIntoView({behavior:'smooth'})},2000);
    return;
  }
  applyPortalHash(bootHash||window.location.hash,true);
}
 
// ═══ AUTO-PROVISIONING ════════════════════════════════════════
async function ensureOrg(){
  if(currentOrg)return currentOrg;
  const{data:membership}=await sb.from('org_members').select('org_id,role').eq('user_id',currentUser.id).limit(1).maybeSingle();
  if(membership&&membership.org_id){
    const{data:fromMem}=await sb.from('organisations').select('*').eq('id',membership.org_id).maybeSingle();
    if(fromMem){
      currentOrg=fromMem;
      currentMemberRole=membership.role||'viewer';
      if(!currentProfile)currentProfile={};
      if(currentProfile.org_id!==fromMem.id){
        await sb.from('profiles').update({org_id:fromMem.id}).eq('id',currentUser.id);
        currentProfile.org_id=fromMem.id;
      }
      return fromMem;
    }
  }
  if(currentProfile?.org_id){const{data}=await sb.from('organisations').select('*').eq('id',currentProfile.org_id).maybeSingle();if(data){currentOrg=data;return data}}
  const{data:existing}=await sb.from('organisations').select('*').eq('created_by',currentUser.id).limit(1).maybeSingle();
  if(existing){currentOrg=existing;if(!currentProfile)currentProfile={};if(!currentProfile.org_id){await sb.from('profiles').update({org_id:existing.id}).eq('id',currentUser.id);currentProfile.org_id=existing.id}return existing}
  let orgName=currentProfile?.organisation||'My Organisation';
  // Pull sector/size from most recent diagnostic
  let orgSector=null,orgSize=null;
  if(currentResults.length){orgSector=currentResults[0].sector||null;orgSize=currentResults[0].org_size||null}
  else{const{data:dr}=await sb.from('diagnostic_results').select('sector,org_size,organisation').eq('user_id',currentUser.id).order('created_at',{ascending:false}).limit(1).maybeSingle();if(dr){orgSector=dr.sector;orgSize=dr.org_size;if(dr.organisation)orgName=dr.organisation}}
  const{data:newOrg,error}=await sb.from('organisations').insert({name:orgName,created_by:currentUser.id,sector:orgSector,org_size:orgSize,plan:'free'}).select().maybeSingle();
  if(error){console.error('Org creation error:',error);return null}
  await sb.from('org_members').insert({org_id:newOrg.id,user_id:currentUser.id,role:'owner',accepted_at:new Date().toISOString()});
  await sb.from('profiles').update({org_id:newOrg.id}).eq('id',currentUser.id);if(!currentProfile)currentProfile={};currentProfile.org_id=newOrg.id;currentOrg=newOrg;currentMemberRole='owner';return newOrg;
}
 

// ═══ ORGANISATION PAGE ════════════════════════════════════════
async function renderOrgPage(){
  if(!currentOrg)return;
  const plan=orgMembershipTierLabel(currentOrg);
  const subSt=currentOrg.subscription_status==='active'?'Active':currentOrg.subscription_status==='trialing'?'Trial':currentOrg.subscription_status==='none'?'Not subscribed':currentOrg.subscription_status||'Not set';
  document.getElementById('org-profile-grid').innerHTML='<div class="meta-item"><label>Organisation Name</label><span>'+esc(currentOrg.name)+'</span></div><div class="meta-item"><label>Sector</label><span>'+esc(currentOrg.sector||'Not set')+'</span></div><div class="meta-item"><label>Organisation Size</label><span>'+esc(currentOrg.org_size||'Not set')+'</span></div><div class="meta-item"><label>Organisation ID</label><span class="meta-id">'+esc(currentOrg.id)+'</span></div>';
  document.getElementById('org-sub-grid').innerHTML='<div class="meta-item"><label>Registry Phase</label><span>Phase 1</span></div><div class="meta-item"><label>Membership Tier</label><span>'+esc(plan)+'</span></div><div class="meta-item"><label>Subscription Status</label><span>'+esc(subSt)+'</span></div><div class="meta-item"><label>AI Systems Registered</label><span>'+allSystems.length+'</span></div>';
  const{data:members}=await sb.from('org_members').select('*').eq('org_id',currentOrg.id).order('created_at',{ascending:true});
  if(!members||!members.length){document.getElementById('org-members-wrap').innerHTML='<div class="empty-state" style="padding:24px 0;"><p>No members found.</p></div>';return}
  document.getElementById('org-member-count').textContent=members.length+' member'+(members.length!==1?'s':'');
  const{data:memberProfiles}=await sb.from('profiles').select('id,full_name,email').in('id',members.map(m=>m.user_id));
  const profMap={};(memberProfiles||[]).forEach(p=>{profMap[p.id]=p});
  const sysByUser={};allSystems.forEach(s=>{sysByUser[s.created_by]=(sysByUser[s.created_by]||0)+1});
  document.getElementById('org-members-wrap').innerHTML=members.map(m=>{const p=profMap[m.user_id]||{};const name=p.full_name||'Unknown';const email=p.email||'Not set';const init=name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();const sc=sysByUser[m.user_id]||0;
    return '<div class="member-row"><div class="member-avatar">'+esc(init)+'</div><div class="member-info"><div class="member-name">'+esc(name)+'</div><div class="member-email">'+esc(email)+'</div></div><div style="font-size:.72rem;color:var(--muted);text-align:right;min-width:70px;">'+sc+' system'+(sc!==1?'s':'')+'</div><span class="role-chip role-'+(m.role||'viewer')+'">'+(MEMBER_ROLE_LABELS[m.role]||m.role||'viewer')+'</span></div>'}).join('')+
    (canManageMembers()?'<div class="member-row"><button type="button" class="btn-topbar btn-topbar-primary" onclick="navigateUsers(document.getElementById(\'nav-users\'))">Manage access</button></div>':'');
}
 
// ═══ DASHBOARD ════════════════════════════════════════════════

/* The organisation's Compliance Bar, shown once. RGA-002 rule 04
   forbids deploying it alone, so raMaturityBlock pairs it with the
   numeral and the named tier — the bar carries the visual, the text
   carries the precision. */
function renderOrgMaturity(gov){
  var el=document.getElementById('dash-maturity');
  if(!el)return;
  var done=allAssignments.filter(function(a){return a.status==='implemented'||a.status==='verified'}).length;
  var total=allAssignments.length;
  el.style.display='block';
  el.innerHTML='<div class="maturity-panel__label">Organisational maturity</div>'+
    raMaturityBlock(gov.score,{animate:true})+
    (total?'<div class="maturity-panel__note">'+done+' of '+total+' assigned controls implemented</div>':'');
  requestAnimationFrame(function(){animateMaturity(el)});
}

async function renderDashboard(paidIds){
  document.getElementById('dash-count').textContent=currentResults.length||'0';
  var scoreEl=document.getElementById('dash-score');
  if(scoreEl){
    if(currentResults.length>0){
      scoreEl.className='stat-value';
      scoreEl.textContent=(currentResults[0].adjusted_score||0)+'%';
    }else{
      // No diagnostic yet — CTA replaces "Not set" (same primary as Add AI System)
      scoreEl.className='stat-value stat-value--cta';
      scoreEl.innerHTML='<a href="diagnostic.html" class="btn-topbar btn-topbar-primary">Run Diagnostic</a>';
    }
  }
  document.getElementById('dash-sys-count').textContent=allSystems.length||'0';
  if(allControls.length){const g=getGovScore();document.getElementById('dash-compliance').textContent=g.score+'%';document.getElementById('dash-gov-maturity').textContent='Control coverage';renderOrgMaturity(g)}
  else{document.getElementById('dash-compliance').textContent='Not set'}
  var subEl=document.getElementById('dash-subtext');
  if(subEl&&currentOrg)subEl.textContent=currentOrg.name;
  var tierEl=document.getElementById('dash-tier-badge');
  if(tierEl){
    var planLabel=orgTierBadgeLabel(currentOrg);
    tierEl.innerHTML='<span class="plan-label">'+planLabel+'</span>'+(showTierUpgrade(currentOrg)?'<button class="btn-inline" onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing();">Upgrade</button>':'');
  }
  const feed=[];
  currentResults.forEach(r=>{const band=r.risk_band||'moderate';feed.push({time:new Date(r.created_at),html:'Diagnostic completed — <strong>'+esc(r.organisation||'Assessment')+'</strong><br>'+(BAND_LABELS[band]||band)+' · '+(r.adjusted_score||0)+'%',date:fmtDate(r.created_at),click:"navigate('reports',document.getElementById('nav-reports'))"})});
  if(currentOrg){const{data:auditEntries}=await sb.from('registry_audit_log').select('*').eq('org_id',currentOrg.id).order('created_at',{ascending:false}).limit(20);
    if(auditEntries&&auditEntries.length){const nm=await loadNames(auditEntries.map(e=>e.user_id));
      auditEntries.forEach(entry=>{const a=fmtAudit(entry,nm);var clickAction=getActivityClick(entry);feed.push({time:new Date(entry.created_at),html:a.text+'<br><span class="activity-who">'+esc(a.who)+'</span>',date:fmtDate(entry.created_at),click:clickAction})})}}
  feed.sort((a,b)=>b.time-a.time);
  const actEl=document.getElementById('dash-activity');
  if(!feed.length)actEl.innerHTML='<div class="empty-inline">No activity yet. Run your first diagnostic to get started.</div>';
  else actEl.innerHTML=feed.slice(0,8).map(f=>'<div class="activity-item'+(f.click?' is-clickable':'')+'"'+(f.click?' onclick="'+f.click+'"':'')+'><div class="activity-dot"></div><div class="activity-body">'+f.html+'</div><div class="activity-time">'+f.date+'</div></div>').join('');
  renderMyTasks();
  renderNextSteps();
  renderCertificateCard();
}
 
// ═══ REPORTS ══════════════════════════════════════════════════
function renderReports(paidIds){
  // Diagnostic reports
  const dc=document.getElementById('reports-diagnostic');
  if(!currentResults.length){
    dc.innerHTML='<div style="text-align:center;padding:20px 0;"><div style="font-size:.82rem;color:var(--muted);margin-bottom:12px;">No diagnostic reports yet.</div><a href="diagnostic.html" class="btn-topbar btn-topbar-primary">Run Diagnostic</a></div>';
    return;
  }
  dc.innerHTML='<div class="result-list">'+currentResults.map(function(r){
    var band=r.risk_band||'moderate';
    var paid=isPaid||isPaidTier()||paidIds.has(r.id);
    var btn=paid
      ? '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn-topbar btn-topbar-primary" onclick="downloadReport(\''+r.id+'\')"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>View</button><button type="button" class="btn-pdf" id="pdf-btn-'+r.id+'" onclick="savePDF(\''+r.id+'\')"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>Download</button></div>'
      : '<a href="pricing.html" class="btn-topbar btn-topbar-primary">Unlock — £295</a>';
    return '<div class="result-card"><div><div class="result-org">'+esc(r.organisation||'Diagnostic')+'</div><div class="result-meta"><span>'+fmtDate(r.created_at)+'</span>'+(r.sector?'<span>'+esc(r.sector)+'</span>':'')+'</div></div><div class="result-right"><div class="score-badge"><div class="score-num score-'+band+'">'+(r.adjusted_score||0)+'%</div><div class="score-lbl">Exposure</div></div><div class="band-pill band-'+band+'">'+(BAND_LABELS[band]||band)+'</div>'+btn+'</div></div>';
  }).join('')+'</div>';
}
async function loadAssessmentReports(){
  if(!currentOrg)return;
  const{data:assessments}=await sb.from('registry_assessments').select('*').eq('org_id',currentOrg.id).order('requested_at',{ascending:false});
  const ac=document.getElementById('reports-assessments');
  if(!assessments||!assessments.length){ac.innerHTML='<div style="text-align:center;padding:20px 0;font-size:.82rem;color:var(--muted);">No system assessments yet. Run an assessment from the Registry.</div>';return}
  const sysNames={};allSystems.forEach(s=>{sysNames[s.id]=s.name});
  const BAND_R={high:'High Risk',medium:'Medium Risk',moderate:'Moderate Risk',lowmod:'Low-Moderate',low:'Low Risk',critical:'Critical'};
  ac.innerHTML='<div class="result-list">'+assessments.map(a=>{
    const band=a.risk_band||'medium';const sn=sysNames[a.system_id]||'AI System';
    var reportBtn=isPaidTier()?'<a href="system-report.html?aid='+a.id+'" target="_blank" class="btn-topbar btn-topbar-primary"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>View</a>':'<button type="button" onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing()" class="btn-topbar btn-topbar-primary">Upgrade to View</button>';return '<div class="result-card"><div><div class="result-org">'+esc(sn)+'</div><div class="result-meta"><span>'+fmtDate(a.requested_at)+'</span>'+(a.sector?'<span>'+esc(a.sector)+'</span>':'')+'<span>v'+(a.questionnaire_version||'1.0.0')+'</span></div></div><div class="result-right"><div class="score-badge"><div class="score-num score-'+band+'">'+(a.overall_score!==null?a.overall_score+'%':'Not set')+'</div><div class="score-lbl">Governance</div></div><div class="band-pill band-'+band+'">'+(BAND_R[band]||band)+'</div>'+reportBtn+'</div></div>';
  }).join('')+'</div>';
}
 
// ═══ SETTINGS ═════════════════════════════════════════════════
async function saveProfile(){const first=document.getElementById('set-first').value.trim();const last=document.getElementById('set-last').value.trim();const org=document.getElementById('set-org').value.trim();const full=(first+' '+last).trim();const{error}=await sb.from('profiles').upsert({id:currentUser.id,full_name:full,organisation:org},{onConflict:'id'});if(!error){document.getElementById('sidebar-name').textContent=full||currentUser.email.split('@')[0];const ini=full.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();document.getElementById('sidebar-avatar').textContent=ini;if(currentOrg&&org!==currentOrg.name){await sb.from('organisations').update({name:org}).eq('id',currentOrg.id);currentOrg.name=org;refreshSidebarContext();var orgGrid=document.getElementById('org-profile-grid');if(orgGrid){orgGrid.innerHTML='<div class="meta-item"><label>Organisation Name</label><span>'+esc(currentOrg.name)+'</span></div><div class="meta-item"><label>Sector</label><span>'+esc(currentOrg.sector||'Not set')+'</span></div><div class="meta-item"><label>Organisation Size</label><span>'+esc(currentOrg.org_size||'Not set')+'</span></div><div class="meta-item"><label>Organisation ID</label><span class="meta-id">'+esc(currentOrg.id)+'</span></div>'}}alert('Profile saved.')}else alert('Error saving.')}
async function changePassword(){const pw=document.getElementById('set-pw').value;const pw2=document.getElementById('set-pw2').value;const msg=document.getElementById('set-pw-msg');msg.style.display='block';if(pw.length<8){msg.style.color='var(--ra-risk)';msg.textContent='Min. 8 characters.';return}if(pw!==pw2){msg.style.color='var(--ra-risk)';msg.textContent='Passwords do not match.';return}const{error}=await sb.auth.updateUser({password:pw});if(error){msg.style.color='var(--ra-risk)';msg.textContent=error.message}else{msg.style.color='var(--ra-ok)';msg.textContent='Password updated.';document.getElementById('set-pw').value='';document.getElementById('set-pw2').value=''}}
function copyReferral(){const link=document.getElementById('referral-link').textContent;navigator.clipboard.writeText('https://'+link).then(()=>{const btn=document.querySelector('.invite-copy');btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy link',2000)})}
function downloadReport(id){window.open('report.html?rid='+id,'_blank')}
async function savePDF(resultId){
  var btn=document.getElementById('pdf-btn-'+resultId);if(!btn)return;
  var orig=btn.innerHTML;btn.innerHTML='Generating...';btn.disabled=true;
  var overlay=document.createElement('div');
  overlay.className='pdf-overlay';
  var cbarHtml=(typeof raLoadCbarHTML==='function')
    ? raLoadCbarHTML()
    : '<div class="pdf-cbar" role="img" aria-label="Loading"><div class="pdf-cbar__row is-active"></div><div class="pdf-cbar__row"></div><div class="pdf-cbar__row"></div><div class="pdf-cbar__row"></div><div class="pdf-cbar__row"></div><div class="pdf-cbar__row"></div><div class="pdf-cbar__row"></div></div>';
  overlay.innerHTML='<div class="pdf-overlay__visual" aria-hidden="true">'+cbarHtml+'</div>'+
    '<div class="pdf-overlay__copy"><div class="pdf-overlay__title">Generating your report</div>'+
    '<div class="pdf-overlay__status" id="pdf-status-msg">Preparing report…</div></div>';
  document.body.appendChild(overlay);
  var stopCbarLoop=(typeof raLoadCbarBreath==='function')
    ? raLoadCbarBreath(overlay)
    : function(){};
  var messages=[{t:0,msg:'Preparing report…'},{t:5000,msg:'Loading governance data…'},{t:12000,msg:'Rendering layout…'},{t:22000,msg:'Mapping obligations…'},{t:34000,msg:'Writing PDF…'},{t:48000,msg:'Finalising…'}];
  var timers=messages.map(function(m){return setTimeout(function(){var el=document.getElementById('pdf-status-msg');if(el)el.textContent=m.msg;},m.t);});
  try{
    var sd=await sb.auth.getSession();var session=sd.data.session;if(!session)throw new Error('Not authenticated');
    var res=await fetch(SUPABASE_URL+'/functions/v1/generate-report',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_KEY},body:JSON.stringify({response_id:resultId})});
    if(!res.ok)throw new Error('Server error: '+res.status);
    var data=await res.json();if(!data||!data.download_url)throw new Error('No URL');
    timers.forEach(function(t){clearTimeout(t);});
    stopCbarLoop();
    var msg=document.getElementById('pdf-status-msg');
    if(msg)msg.textContent='Report ready';
    setTimeout(function(){window.open(data.download_url,'_blank');if(document.body.contains(overlay))document.body.removeChild(overlay);},800);
  }catch(err){
    timers.forEach(function(t){clearTimeout(t);});
    stopCbarLoop();
    if(document.body.contains(overlay))document.body.removeChild(overlay);
    alert('PDF generation failed: '+err.message);
  }finally{btn.innerHTML=orig;btn.disabled=false;}
}
 

topbarTitles['policy-detail']={label:'Policy Detail',icon:'<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/>'};
