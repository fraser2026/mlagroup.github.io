const SUPABASE_URL='https://hueftewwenjaiagdoqmb.supabase.co';
const SUPABASE_KEY='sb_publishable_Am0Ot4bWLoMb5pIhN50byQ_n3QIujY5';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const BAND_LABELS={low:'Low Risk',lowmod:'Low-Moderate',moderate:'Moderate',high:'High Risk',critical:'Critical'};
const TIER_LABELS={unacceptable:'Unacceptable',high:'High Risk',limited:'Limited',minimal:'Minimal'};
const STATUS_LABELS={planned:'Planned',development:'Development',pilot:'Pilot',production:'Production',decommissioned:'Decommissioned'};
const PLAN_LABELS={essentials:'Essentials',professional:'Professional',enterprise:'Enterprise'};
const TYPE_LABELS={third_party:'Third Party',in_house:'In-House',hybrid:'Hybrid'};
const PURPOSE_TIER_MAP={biometric_identification:'high',critical_infrastructure:'high',education_access:'high',employment_management:'high',essential_services_access:'high',law_enforcement:'high',migration_border:'high',justice_administration:'high',customer_chatbot:'limited',content_generation:'limited',emotion_recognition:'limited',internal_automation:'minimal',data_analytics:'minimal'};
let currentUser=null,currentProfile=null,currentResults=[],isPaid=false;
let currentOrg=null,allSystems=[],currentSystemId=null,regFilter='all';
let profilesCache={};
 
function fmtDate(iso){return iso?new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):''}
function fmtDateLong(iso){return iso?new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
async function signOut(){await sb.auth.signOut();window.location.href='login.html'}
function actorName(){return currentProfile?.full_name||currentUser?.email?.split('@')[0]||'Unknown'} function isPaidTier(){return currentOrg&&(currentOrg.plan==='essentials'||currentOrg.plan==='professional')&&currentOrg.subscription_status==='active'}
 
// ═══ AUDIT FORMATTING ═════════════════════════════════════════
function fmtAudit(entry,namesMap){
  const c=entry.changes||{};const who=(namesMap||{})[entry.user_id]||c._actor_name||'System';
  let text='';
  switch(entry.action){
    case 'system_created':text=`Registered new AI system: <strong>${esc(c.name||'')}</strong>`;break;
    case 'system_updated':text='Updated system details';break;
    case 'risk_tier_set':text=`Classified as <strong>${TIER_LABELS[c.risk_tier?.new]||c.risk_tier?.new||''}</strong> under EU AI Act`;break;
    case 'risk_tier_changed':text=`Reclassified from ${TIER_LABELS[c.risk_tier?.old]||'Unclassified'} to <strong>${TIER_LABELS[c.risk_tier?.new]||''}</strong>`;break;
    case 'compliance_status_updated':text=`Updated compliance status across ${c.obligation_count||c.updated_count||'multiple'} obligations`;break;
    case 'assessment_submitted':text='Submitted an assessment for review by MLA Group';break;
    case 'control_updated':text='Updated progress on <strong>'+esc(c.control||'')+'</strong>';break;
    case 'control_implemented':text='Marked <strong>'+esc(c.control||'')+'</strong> as implemented';break;
    case 'mla_review_updated':text='MLA Group updated assessment status to <strong>'+(c.status==='controls_issued'?'Controls Issued':c.status==='in_review'?'Under Review':c.status||'')+'</strong>';break;
    case 'control_assigned':text='Assigned <strong>'+esc(c.control||'')+'</strong> to <strong>'+esc(c.assigned_to_name||'a team member')+'</strong>'+(c.due_date?' — due '+c.due_date:'');break;     case 'policy_adopted':text='Adopted policy <strong>'+esc(c.policy||'')+'</strong>';break;     case 'policy_acknowledged':text='Acknowledged policy <strong>'+esc(c.policy||'')+'</strong> (v'+esc(c.version||'')+')';break;     case 'policy_esigned':text='E-signed policy <strong>'+esc(c.policy||'')+'</strong> (v'+esc(c.version||'')+')';break;     case 'support_requested':text='Requested MLA expert help on <strong>'+esc(c.control||'')+'</strong>';break;
    case 'support_responded':text='MLA Group responded to support request on <strong>'+esc(c.control||'')+'</strong>';break;
    default:text=entry.action.replace(/_/g,' ');
  }
  // Override actor name for MLA actions
  if(c._is_mla)return{who:'MLA Group',text,time:fmtDateLong(entry.created_at)};
  return {who,text,time:fmtDateLong(entry.created_at)};
}
async function loadNames(userIds){
  const missing=[...new Set(userIds)].filter(id=>id&&!profilesCache[id]);
  if(missing.length){const{data}=await sb.from('profiles').select('id,full_name,email').in('id',missing);(data||[]).forEach(p=>{profilesCache[p.id]=p.full_name||p.email||'Unknown'})}
  const map={};userIds.forEach(id=>{if(id)map[id]=profilesCache[id]||'Unknown'});return map;
}
 
// ═══ NAVIGATION ═══════════════════════════════════════════════
const topbarTitles={dashboard:{label:'Dashboard',icon:'<rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/>'},reports:{label:'Reports',icon:'<path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/><path d="M5 7h6M5 10h4"/>'},settings:{label:'Settings',icon:'<circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42"/>'},referral:{label:'Referral',icon:'<circle cx="5" cy="6" r="2"/><circle cx="11" cy="4" r="2"/><path d="M1 14c0-2.2 1.8-4 4-4s4 1.8 4 4"/><path d="M11 8c1.7 0 3 1.3 3 3v3"/>'},analytics:{label:'Analytics',icon:'<path d="M1 12l4-4 3 3 4-5 3 3"/>'},registry:{label:'AI Systems Registry',icon:'<rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="7" width="14" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/>'},'registry-detail':{label:'System Detail',icon:'<rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="7" width="14" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/>'},org:{label:'Organisation',icon:'<path d="M2 3h12v10H2z"/><path d="M5 3V1h6v2"/><path d="M2 7h12"/>'},controls:{label:'Governance Controls',icon:'<path d="M8 1.5l5.5 3v5c0 3.5-3 5.5-5.5 7-2.5-1.5-5.5-3.5-5.5-7v-5z"/>'},'control-detail':{label:'Control Detail',icon:'<path d="M8 1.5l5.5 3v5c0 3.5-3 5.5-5.5 7-2.5-1.5-5.5-3.5-5.5-7v-5z"/>'},'alerts':{label:'Alerts',icon:'<path d="M8 1a5 5 0 015 5v3l1.5 2H1.5L3 9V6a5 5 0 015-5z"/><path d="M6.5 13a1.5 1.5 0 003 0"/>'}};
 
let navHistory=[];
function navigate(viewId,navEl,skipHistory){
  if(navEl&&navEl.classList.contains('locked'))return;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));if(navEl)navEl.classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById('view-'+viewId).classList.add('active');
  const t=topbarTitles[viewId];if(t)document.getElementById('topbar-title').innerHTML=`<svg viewBox="0 0 16 16" style="width:15px;height:15px;stroke:var(--sky);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;">${t.icon}</svg>${t.label}`;
  const tr=document.getElementById('topbar-right');
  if(viewId==='registry')tr.innerHTML='<button class="btn-topbar btn-topbar-primary" onclick="openAddSystem()"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Add AI System</button><button class="btn-topbar btn-topbar-ghost" onclick="signOut()">Sign out</button>';
  else if(viewId==='registry-detail'||viewId==='org'||viewId==='controls'||viewId==='control-detail')tr.innerHTML='<button class="btn-topbar btn-topbar-ghost" onclick="signOut()">Sign out</button>';
  else tr.innerHTML='<button onclick="openAddSystem()" class="btn-topbar btn-topbar-primary"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Add AI System</button><button class="btn-topbar btn-topbar-ghost" onclick="signOut()">Sign out</button>';
  closeSidebar();
  window.scrollTo(0,0);
  // Browser history
  if(!skipHistory){history.pushState({view:viewId},'','#'+viewId);navHistory.push(viewId)}
}
window.addEventListener('popstate',function(e){
  if(e.state&&e.state.view){
    const viewId=e.state.view;
    const navMap={dashboard:'.nav-item:first-child',reports:'[onclick*="reports"]',registry:'#nav-registry',org:'#nav-org',controls:'#nav-controls',settings:'[onclick*="settings"]',referral:'[onclick*="referral"]'};
    const navEl=navMap[viewId]?document.querySelector(navMap[viewId]):null;
    navigate(viewId,navEl,true);
  }
});
async function navigateRegistry(navEl){navigate('registry',navEl);if(!currentOrg)await ensureOrg();if(!allSystems.length)await loadSystems();if(!allControls.length)await loadControls()}
async function navigateOrg(navEl){navigate('org',navEl);if(!currentOrg)await ensureOrg();await renderOrgPage()}
function openSidebar(){document.getElementById('sidebar').classList.add('open');document.getElementById('overlay').classList.add('show')}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').classList.remove('show')}
 
// ═══ INIT ═════════════════════════════════════════════════════
async function init(){
  const{data:{session}}=await sb.auth.getSession();if(!session){window.location.href='login.html';return}
  currentUser=session.user;
  const[{data:profile},{data:entitlements}]=await Promise.all([sb.from('profiles').select('full_name,organisation,paid,org_id').eq('id',currentUser.id).single(),sb.from('entitlements').select('id,diagnostic_id,status').eq('user_id',currentUser.id).eq('status','active')]);
  currentProfile=profile;isPaid=(entitlements&&entitlements.length>0)||profile?.paid===true;
  const paidIds=new Set((entitlements||[]).map(e=>e.diagnostic_id).filter(Boolean));
  const fullName=profile?.full_name||currentUser.email.split('@')[0];const firstName=fullName.split(' ')[0];
  const initials=fullName.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  profilesCache[currentUser.id]=fullName;
  document.getElementById('sidebar-name').textContent=fullName;document.getElementById('sidebar-avatar').textContent=initials;
  document.getElementById('dash-avatar').textContent=initials;document.getElementById('dash-name').textContent=', '+firstName;
  if(profile?.organisation)document.getElementById('dash-subtext').textContent=profile.organisation+' · AI Governance Portal';
  if(profile?.full_name){const p=profile.full_name.split(' ');document.getElementById('set-first').value=p[0]||'';document.getElementById('set-last').value=p.slice(1).join(' ')||''}
  document.getElementById('set-org').value=profile?.organisation||'';document.getElementById('set-email').value=currentUser.email;
  document.getElementById('referral-link').textContent='mlagroup.co.uk/ref/'+currentUser.id.substring(0,8);
  const{data:results}=await sb.from('diagnostic_results').select('*').eq('user_id',currentUser.id).order('created_at',{ascending:false});
  currentResults=results||[];
  if(currentResults.length>0){const b=document.getElementById('report-count-badge');b.textContent=currentResults.length;b.style.display='inline-flex'}
  document.getElementById('paywall-banner').style.display=(isPaid||isPaidTier())?'none':'flex'; document.getElementById('tier-banner').style.display=isPaidTier()?'none':'flex'; document.getElementById('controls-tier-banner').style.display=isPaidTier()?'none':'flex';
  renderReports(paidIds);
  history.replaceState({view:'dashboard'},'','#dashboard');
  if(profile?.org_id)ensureOrg().then(()=>Promise.all([loadSystems(),loadControls()])).then(()=>{renderDashboard(paidIds);loadScoreHistory();loadAssessmentReports();handleDeepLink();loadAlerts();setTimeout(()=>{checkAndCreateAlerts();loadAndRunComplianceEngine()},3000)}).catch(()=>renderDashboard(paidIds));
  else renderDashboard(paidIds);
}
function handleDeepLink(){
  var urlParams=new URLSearchParams(window.location.search);
  var goto=urlParams.get('goto');
  if(goto==='plans'){
    history.replaceState(null,'',window.location.pathname+'#plans');
    navigate('plans',document.getElementById('nav-plans'));updatePortalPricing();
    return;
  }
  if(goto&&goto.startsWith('system-controls-')){
    var scId=goto.replace('system-controls-','');
    if(scId){
      history.replaceState(null,'',window.location.pathname);
      openSystemDetail(scId).then(function(){
        switchDetailTab('sys-controls',document.querySelectorAll('#view-registry-detail .tab-btn')[2]);
      });
      return;
    }
  }
  if(urlParams.get('subscription')==='success'){history.replaceState(null,'',window.location.pathname+'#dashboard');setTimeout(function(){var sb2=document.getElementById('cert-card-panel');if(sb2)sb2.scrollIntoView({behavior:'smooth'})},2000)}
  var h=window.location.hash;
  if(h==='#controls'){navigateControls(document.getElementById('nav-controls'));window.location.hash='';return}
  if(h==='#policies'){navigatePolicies(document.getElementById('nav-policies'));window.location.hash='';return}
  if(h==='#registry'){navigateRegistry(document.getElementById('nav-registry'));window.location.hash='';return}
  if(h.startsWith('#registry-detail-')){var sysId=h.replace('#registry-detail-','');if(sysId)openSystemDetail(sysId);window.location.hash=''}
}
 
// ═══ AUTO-PROVISIONING ════════════════════════════════════════
async function ensureOrg(){
  if(currentOrg)return currentOrg;
  if(currentProfile?.org_id){const{data}=await sb.from('organisations').select('*').eq('id',currentProfile.org_id).single();if(data){currentOrg=data;return data}}
  const{data:existing}=await sb.from('organisations').select('*').eq('created_by',currentUser.id).limit(1).single();
  if(existing){currentOrg=existing;if(!currentProfile.org_id){await sb.from('profiles').update({org_id:existing.id}).eq('id',currentUser.id);currentProfile.org_id=existing.id}return existing}
  let orgName=currentProfile?.organisation||'My Organisation';
  // Pull sector/size from most recent diagnostic
  let orgSector=null,orgSize=null;
  if(currentResults.length){orgSector=currentResults[0].sector||null;orgSize=currentResults[0].org_size||null}
  else{const{data:dr}=await sb.from('diagnostic_results').select('sector,org_size,organisation').eq('user_id',currentUser.id).order('created_at',{ascending:false}).limit(1).single();if(dr){orgSector=dr.sector;orgSize=dr.org_size;if(dr.organisation)orgName=dr.organisation}}
  const{data:newOrg,error}=await sb.from('organisations').insert({name:orgName,created_by:currentUser.id,sector:orgSector,org_size:orgSize}).select().single();
  if(error){console.error('Org creation error:',error);return null}
  await sb.from('org_members').insert({org_id:newOrg.id,user_id:currentUser.id,role:'owner',accepted_at:new Date().toISOString()});
  await sb.from('profiles').update({org_id:newOrg.id}).eq('id',currentUser.id);currentProfile.org_id=newOrg.id;currentOrg=newOrg;return newOrg;
}
 

// ═══ ORGANISATION PAGE ════════════════════════════════════════
async function renderOrgPage(){
  if(!currentOrg)return;
  const plan=PLAN_LABELS[currentOrg.plan]||currentOrg.plan||'Essentials';
  const subSt=currentOrg.subscription_status==='active'?'Active':currentOrg.subscription_status==='trialing'?'Trial':currentOrg.subscription_status==='none'?'Not subscribed':currentOrg.subscription_status||'—';
  document.getElementById('org-profile-grid').innerHTML='<div class="meta-item"><label>Organisation Name</label><span>'+esc(currentOrg.name)+'</span></div><div class="meta-item"><label>Sector</label><span>'+esc(currentOrg.sector||'—')+'</span></div><div class="meta-item"><label>Organisation Size</label><span>'+esc(currentOrg.org_size||'—')+'</span></div><div class="meta-item"><label>Organisation ID</label><span class="meta-id">'+esc(currentOrg.id)+'</span></div>';
  document.getElementById('org-sub-grid').innerHTML='<div class="meta-item"><label>Registry Phase</label><span>Phase 1</span></div><div class="meta-item"><label>Membership Tier</label><span>'+esc(plan)+'</span></div><div class="meta-item"><label>Subscription Status</label><span>'+esc(subSt)+'</span></div><div class="meta-item"><label>AI Systems Registered</label><span>'+allSystems.length+'</span></div>';
  const{data:members}=await sb.from('org_members').select('*').eq('org_id',currentOrg.id).order('created_at',{ascending:true});
  if(!members||!members.length){document.getElementById('org-members-wrap').innerHTML='<div class="empty-state" style="padding:24px 0;"><p>No members found.</p></div>';return}
  document.getElementById('org-member-count').textContent=members.length+' member'+(members.length!==1?'s':'');
  const{data:memberProfiles}=await sb.from('profiles').select('id,full_name,email').in('id',members.map(m=>m.user_id));
  const profMap={};(memberProfiles||[]).forEach(p=>{profMap[p.id]=p});
  const sysByUser={};allSystems.forEach(s=>{sysByUser[s.created_by]=(sysByUser[s.created_by]||0)+1});
  document.getElementById('org-members-wrap').innerHTML=members.map(m=>{const p=profMap[m.user_id]||{};const name=p.full_name||'Unknown';const email=p.email||'—';const init=name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();const sc=sysByUser[m.user_id]||0;
    return '<div class="member-row"><div class="member-avatar">'+esc(init)+'</div><div class="member-info"><div class="member-name">'+esc(name)+'</div><div class="member-email">'+esc(email)+'</div></div><div style="font-size:.72rem;color:var(--muted);text-align:right;min-width:70px;">'+sc+' system'+(sc!==1?'s':'')+'</div><span class="role-chip role-'+(m.role||'viewer')+'">'+(m.role||'viewer')+'</span></div>'}).join('');
}
 
// ═══ DASHBOARD ════════════════════════════════════════════════
async function renderDashboard(paidIds){
  document.getElementById('dash-count').textContent=currentResults.length||'0';
  document.getElementById('dash-score').textContent=currentResults.length>0?(currentResults[0].adjusted_score||0)+'%':'—';
  document.getElementById('dash-sys-count').textContent=allSystems.length||'0';
  if(allControls.length){const g=getGovScore();document.getElementById('dash-compliance').textContent=g.score+'%';document.getElementById('dash-compliance').style.color=g.score>=70?'#4ade80':g.score>=40?'#fbbf24':'#f87171';document.getElementById('dash-gov-maturity').textContent=getMaturity(g.score)}
  else{document.getElementById('dash-compliance').textContent='—'}
  var tierEl=document.getElementById('dash-tier-badge');
  if(tierEl){var orgPlan=currentOrg?currentOrg.plan:'free';var planLabel='Free Plan';var planBg='rgba(148,163,184,0.15)';var planColor='#94a3b8';if(orgPlan==='essentials'){planLabel='Essentials';planBg='rgba(56,189,248,0.15)';planColor='#38bdf8'}else if(orgPlan==='professional'){planLabel='Professional';planBg='rgba(56,189,248,0.25)';planColor='#38bdf8'}tierEl.innerHTML='<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:20px;font-size:0.8rem;font-weight:600;font-family:DM Sans,sans-serif;background:'+planBg+';color:'+planColor+';">'+planLabel+'</span>'+(orgPlan!=='professional'?'<span onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing();" style="margin-left:8px;color:#64748b;font-size:0.75rem;cursor:pointer;text-decoration:underline;">Upgrade</span>':'')}
  const feed=[];const bandColors={low:'#4ade80',lowmod:'#86efac',moderate:'#fde047',high:'#fca5a5',critical:'#f87171'};
  currentResults.forEach(r=>{const band=r.risk_band||'moderate';feed.push({time:new Date(r.created_at),color:bandColors[band]||'#60a5fa',html:'Diagnostic completed — <strong>'+esc(r.organisation||'Assessment')+'</strong><br>'+(BAND_LABELS[band]||band)+' · '+(r.adjusted_score||0)+'%',date:fmtDate(r.created_at),click:"navigate('reports',document.querySelectorAll('.nav-item')[1])"})});
  if(currentOrg){const{data:auditEntries}=await sb.from('registry_audit_log').select('*').eq('org_id',currentOrg.id).order('created_at',{ascending:false}).limit(20);
    if(auditEntries&&auditEntries.length){const nm=await loadNames(auditEntries.map(e=>e.user_id));
      auditEntries.forEach(entry=>{const a=fmtAudit(entry,nm);var clickAction=getActivityClick(entry);feed.push({time:new Date(entry.created_at),color:'#60a5fa',html:a.text+'<br><span style="font-size:.68rem;color:var(--muted);">'+esc(a.who)+'</span>',date:fmtDate(entry.created_at),click:clickAction})})}}
  feed.sort((a,b)=>b.time-a.time);
  const actEl=document.getElementById('dash-activity');
  if(!feed.length)actEl.innerHTML='<div style="font-size:.78rem;color:var(--muted);padding:8px 0;">No activity yet. Run your first diagnostic to get started.</div>';
  else actEl.innerHTML=feed.slice(0,8).map(f=>'<div class="activity-item" style="'+(f.click?'cursor:pointer;':'')+'border-radius:8px;padding:10px 8px;margin:0 -8px;transition:background .1s;" '+(f.click?'onclick="'+f.click+'" onmouseover="this.style.background=\'rgba(255,255,255,0.03)\'" onmouseout="this.style.background=\'none\'"':'')+'><div class="activity-dot" style="background:'+f.color+';"></div><div class="activity-body">'+f.html+'</div><div class="activity-time">'+f.date+'</div></div>').join('');
  renderMyTasks();
  renderNextSteps();
  renderCertificateCard();
}
 
// ═══ REPORTS ══════════════════════════════════════════════════
function renderReports(paidIds){
  // Diagnostic reports
  const dc=document.getElementById('reports-diagnostic');
  if(!currentResults.length){dc.innerHTML='<div style="text-align:center;padding:20px 0;"><div style="font-size:.82rem;color:var(--muted);margin-bottom:12px;">No diagnostic reports yet.</div><a href="diagnostic.html" class="btn-dl" style="display:inline-flex;text-decoration:none;">Run Diagnostic</a></div>'}
  else{dc.innerHTML='<div class="result-list">'+currentResults.map(r=>{const band=r.risk_band||'moderate';const paid=isPaid||isPaidTier()||paidIds.has(r.id);const btn=paid?'<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn-dl" onclick="downloadReport(\''+r.id+'\')"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>View</button><button class="btn-pdf" id="pdf-btn-'+r.id+'" onclick="savePDF(\''+r.id+'\')"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>Download PDF</button></div>':'<a href="pricing.html" class="btn-unlock">Unlock — £295</a>';return '<div class="result-card"><div><div class="result-org">'+esc(r.organisation||'Diagnostic')+'</div><div class="result-meta"><span>'+fmtDate(r.created_at)+'</span>'+(r.sector?'<span>'+esc(r.sector)+'</span>':'')+'</div></div><div class="result-right"><div class="score-badge"><div class="score-num score-'+band+'">'+(r.adjusted_score||0)+'%</div><div class="score-lbl">Exposure</div></div><div class="band-pill band-'+band+'">'+(BAND_LABELS[band]||band)+'</div>'+btn+'</div></div>'}).join('')+'</div>'}
}
async function loadAssessmentReports(){
  if(!currentOrg)return;
  const{data:assessments}=await sb.from('registry_assessments').select('*').eq('org_id',currentOrg.id).order('requested_at',{ascending:false});
  const ac=document.getElementById('reports-assessments');
  if(!assessments||!assessments.length){ac.innerHTML='<div style="text-align:center;padding:20px 0;font-size:.82rem;color:var(--muted);">No system assessments yet. Run an assessment from the Registry.</div>';return}
  const sysNames={};allSystems.forEach(s=>{sysNames[s.id]=s.name});
  const BAND_R={high:'High Risk',medium:'Medium Risk',low:'Low Risk'};const BAND_CR={high:'#f87171',medium:'#fbbf24',low:'#4ade80'};
  ac.innerHTML='<div class="result-list">'+assessments.map(a=>{
    const band=a.risk_band||'medium';const sn=sysNames[a.system_id]||'AI System';
    var reportBtn=isPaidTier()?'<a href="system-report.html?aid='+a.id+'" target="_blank" class="btn-dl" style="text-decoration:none;"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>View</a>':'<button onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing()" class="btn-unlock" style="border:none;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Upgrade to View</button>';return '<div class="result-card"><div><div class="result-org">'+esc(sn)+'</div><div class="result-meta"><span>'+fmtDate(a.requested_at)+'</span>'+(a.sector?'<span>'+esc(a.sector)+'</span>':'')+'<span>v'+(a.questionnaire_version||'1.0.0')+'</span></div></div><div class="result-right"><div class="score-badge"><div class="score-num" style="color:'+(BAND_CR[band]||'var(--muted)')+';">'+(a.overall_score!==null?a.overall_score+'%':'—')+'</div><div class="score-lbl">Governance</div></div><div class="band-pill band-'+band+'">'+(BAND_R[band]||band)+'</div>'+reportBtn+'</div></div>';
  }).join('')+'</div>';
}
 
// ═══ SETTINGS ═════════════════════════════════════════════════
async function saveProfile(){const first=document.getElementById('set-first').value.trim();const last=document.getElementById('set-last').value.trim();const org=document.getElementById('set-org').value.trim();const full=(first+' '+last).trim();const{error}=await sb.from('profiles').upsert({id:currentUser.id,full_name:full,organisation:org},{onConflict:'id'});if(!error){document.getElementById('sidebar-name').textContent=full||currentUser.email.split('@')[0];const ini=full.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();document.getElementById('sidebar-avatar').textContent=ini;document.getElementById('dash-avatar').textContent=ini;alert('Profile saved.')}else alert('Error saving.')}
async function changePassword(){const pw=document.getElementById('set-pw').value;const pw2=document.getElementById('set-pw2').value;const msg=document.getElementById('set-pw-msg');msg.style.display='block';if(pw.length<8){msg.style.color='var(--red)';msg.textContent='Min. 8 characters.';return}if(pw!==pw2){msg.style.color='var(--red)';msg.textContent='Passwords do not match.';return}const{error}=await sb.auth.updateUser({password:pw});if(error){msg.style.color='var(--red)';msg.textContent=error.message}else{msg.style.color='#4ade80';msg.textContent='Password updated.';document.getElementById('set-pw').value='';document.getElementById('set-pw2').value=''}}
function copyReferral(){const link=document.getElementById('referral-link').textContent;navigator.clipboard.writeText('https://'+link).then(()=>{const btn=document.querySelector('.invite-copy');btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy link',2000)})}
function downloadReport(id){window.open('report.html?rid='+id,'_blank')}
async function savePDF(resultId){
  var btn=document.getElementById('pdf-btn-'+resultId);if(!btn)return;
  var orig=btn.innerHTML;btn.innerHTML='Generating...';btn.disabled=true;
  var overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,0.92);backdrop-filter:blur(12px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;';
  overlay.innerHTML='<div style="width:56px;height:56px;border-radius:50%;border:2px solid rgba(37,99,235,0.15);border-top-color:#60a5fa;animation:spin .8s linear infinite;"></div>'+
    '<div style="text-align:center;"><div style="font-family:\'Instrument Serif\',serif;font-size:1.4rem;font-weight:400;color:#f1f5f9;margin-bottom:8px;">Generating your report</div>'+
    '<div style="font-size:.82rem;color:#475569;max-width:320px;line-height:1.7;" id="pdf-status-msg">Connecting to report server...</div></div>'+
    '<div style="width:280px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;"><div id="pdf-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#2563eb,#60a5fa);border-radius:2px;transition:width 1s ease;"></div></div>'+
    '<div style="font-size:.72rem;color:#334155;text-align:center;line-height:1.7;">This can take up to 60 seconds on first generation.<br>Please keep this tab open.</div>';
  document.body.appendChild(overlay);
  var messages=[{t:0,msg:'Connecting to report server...',pct:5},{t:4000,msg:'Loading your governance data...',pct:20},{t:10000,msg:'Rendering report layout...',pct:38},{t:18000,msg:'Applying regulatory mappings...',pct:52},{t:26000,msg:'Compiling risk findings...',pct:65},{t:36000,msg:'Generating PDF document...',pct:78},{t:48000,msg:'Almost there, finalising...',pct:90}];
  var timers=messages.map(function(m){return setTimeout(function(){var el=document.getElementById('pdf-status-msg');var bar=document.getElementById('pdf-progress-bar');if(el)el.textContent=m.msg;if(bar)bar.style.width=m.pct+'%';},m.t);});
  try{
    var sd=await sb.auth.getSession();var session=sd.data.session;if(!session)throw new Error('Not authenticated');
    var res=await fetch(SUPABASE_URL+'/functions/v1/generate-report',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_KEY},body:JSON.stringify({response_id:resultId})});
    if(!res.ok)throw new Error('Server error: '+res.status);
    var data=await res.json();if(!data||!data.download_url)throw new Error('No URL');
    timers.forEach(function(t){clearTimeout(t);});
    var bar=document.getElementById('pdf-progress-bar');var msg=document.getElementById('pdf-status-msg');
    if(bar)bar.style.width='100%';if(msg)msg.textContent='Report ready - opening in new tab...';
    setTimeout(function(){window.open(data.download_url,'_blank');if(document.body.contains(overlay))document.body.removeChild(overlay);},800);
  }catch(err){
    timers.forEach(function(t){clearTimeout(t);});
    if(document.body.contains(overlay))document.body.removeChild(overlay);
    alert('PDF generation failed: '+err.message);
  }finally{btn.innerHTML=orig;btn.disabled=false;}
}
 

topbarTitles['policy-detail']={label:'Policy Detail',icon:'<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/>'};
