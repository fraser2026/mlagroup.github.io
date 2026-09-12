// ═══ PHASE 3: POLICIES ════════════════════════════════════════
const POLICY_CATS={ai_governance:'AI Governance',data_protection:'Data Protection',acceptable_use:'Acceptable Use',risk_management:'Risk Management',security:'Security',ethics:'Ethics',other:'Other'};
let allPolicies=[],allAcknowledgments=[],allPolicyTemplates=[],currentPolicyId=null;
 
async function navigatePolicies(navEl){navigate('policies',navEl);if(!currentOrg)await ensureOrg();await loadPolicies()}
 
async function loadPolicies(){
  if(!currentOrg)return;
  var results=await Promise.all([
    sb.from('policy_documents').select('*').eq('org_id',currentOrg.id).eq('is_active',true).order('created_at',{ascending:true}),
    sb.from('policy_acknowledgments').select('*').eq('org_id',currentOrg.id).eq('user_id',currentUser.id),
    sb.from('policy_templates').select('*').eq('is_active',true).order('display_order')
  ]);
  allPolicies=results[0].data||[];
  allAcknowledgments=results[1].data||[];
  allPolicyTemplates=results[2].data||[];
  renderPoliciesList();
}
 
function getPendingPolicies(){
  return allPolicies.filter(function(p){
    if(!p.requires_acknowledgment||!p.published_at)return false;
    var acked=allAcknowledgments.find(function(a){return a.policy_id===p.id&&a.version_acknowledged===p.version});
    return !acked;
  });
}
 
function renderPoliciesList(){
  var published=allPolicies.filter(function(p){return p.published_at});
  var pending=getPendingPolicies();
  var acked=published.length-pending.length;
  document.getElementById('pol-stat-total').textContent=published.length||'0';
  document.getElementById('pol-stat-acked').textContent=acked;
  document.getElementById('pol-stat-pending').textContent=pending.length;
  document.getElementById('pol-list-count').textContent=published.length+' polic'+(published.length!==1?'ies':'y');
  var el=document.getElementById('pol-list-body');
  if(!published.length){
    el.innerHTML='<div class="empty-state"><h4>No policies published yet</h4><p>Adopt a template below to create your first governance policy.</p></div>';
  }else{
    el.innerHTML=published.map(function(p){
      var cat=POLICY_CATS[p.category]||p.category;
      var userAcked=allAcknowledgments.find(function(a){return a.policy_id===p.id&&a.version_acknowledged===p.version});
      var needsAck=p.requires_acknowledgment&&!userAcked;
      return '<div class="row-item row-item--padded" onclick="openPolicyDetail(\''+p.id+'\')">'+
        '<div class="row-marker row-marker--icon" aria-hidden="true"><svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/><path d="M6 8h4M6 11h3"/></svg></div>'+
        '<div class="row-main"><div class="row-title">'+esc(p.title)+'</div><div class="row-desc"><span class="tag">'+esc(cat)+'</span> v'+esc(p.version)+'</div></div>'+
        (needsAck
          ?'<span class="state-label" style="color:var(--ra-warn);">Pending</span>'
          :'<span class="state-label" style="color:var(--ra-ok);">Acknowledged</span>')+
      '</div>';
    }).join('');
  }
  var tplEl=document.getElementById('pol-templates-body');
  var adoptedTitles={};
  allPolicies.forEach(function(p){adoptedTitles[p.title]=true});
  var available=allPolicyTemplates.filter(function(t){return !adoptedTitles[t.title]});
  if(!available.length){
    tplEl.innerHTML='<div class="empty-inline" style="padding:20px;text-align:center;">All available templates have been adopted.</div>';
  }else{
    tplEl.innerHTML=available.map(function(t){
      return '<div class="row-item row-item--padded">'+
        '<div class="row-marker row-marker--icon" aria-hidden="true"><svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h5l3 3v8a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/><path d="M3 5v9a1 1 0 001 1h7"/></svg></div>'+
        '<div class="row-main"><div class="row-title">'+esc(t.title)+'</div><div class="row-desc">'+esc(t.description||'')+'</div></div>'+
        '<button class="btn-topbar btn-topbar-ghost btn-sm" onclick="adoptTemplate(\''+t.id+'\')">Adopt</button>'+
      '</div>';
    }).join('');
  }
}
 
async function adoptTemplate(templateId){
  if(!currentOrg)return;
  var tpl=allPolicyTemplates.find(function(t){return t.id===templateId});
  if(!tpl)return;
  var orgName=currentOrg.name||'Our Organisation';
  var content=(tpl.content_template||'').replace(/\{\{org_name\}\}/g,orgName);
  var result=await sb.from('policy_documents').insert({
    org_id:currentOrg.id,
    title:tpl.title,
    description:tpl.description,
    content:content,
    version:'1.0',
    category:tpl.category,
    requires_acknowledgment:true,
    acknowledgment_frequency:'on_update',
    linked_control_id:null,
    published_at:new Date().toISOString(),
    created_by:currentUser.id
  }).select().single();
  if(result.error){alert('Error adopting template: '+result.error.message);return}
  if(tpl.linked_control_number&&allControls.length){
    var ctrl=allControls.find(function(c){return c.control_number===tpl.linked_control_number});
    if(ctrl&&result.data){
      await sb.from('policy_documents').update({linked_control_id:ctrl.id}).eq('id',result.data.id);
    }
  }
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'policy_adopted',entity_type:'policy',entity_id:result.data?result.data.id:null,changes:{_actor_name:actorName(),policy:tpl.title}});
  await loadPolicies();
}
 
function renderMarkdown(md,opts){
  opts=opts||{};
  if(!md)return '<div class="empty-inline">No content available.</div>';
  var text=String(md).replace(/\r\n/g,'\n').trim();
  // Page header already shows the title — drop a leading duplicate H1.
  if(opts.title){
    var titleRe=new RegExp('^#\\s+'+String(opts.title).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*(?:\\n+|$)','i');
    text=text.replace(titleRe,'');
  }else{
    text=text.replace(/^#\s+[^\n]+\n+/,'');
  }
  text=text.trim();
  if(!text)return '<div class="empty-inline">No content available.</div>';

  function inlineFmt(s){
    var h=esc(s);
    h=h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    h=h.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
    return h;
  }

  var lines=text.split('\n');
  var out=[];
  var listBuf=[];
  var paraBuf=[];

  function flushList(){
    if(!listBuf.length)return;
    out.push('<ul class="md-list">'+listBuf.join('')+'</ul>');
    listBuf=[];
  }
  function flushPara(){
    if(!paraBuf.length)return;
    var p=paraBuf.join(' ').trim();
    if(p)out.push('<p class="md-p">'+inlineFmt(p)+'</p>');
    paraBuf=[];
  }

  for(var i=0;i<lines.length;i++){
    var trimmed=lines[i].trim();
    if(!trimmed){flushList();flushPara();continue}
    var m;
    if((m=trimmed.match(/^###\s+(.+)$/))){flushList();flushPara();out.push('<h4 class="md-h4">'+inlineFmt(m[1])+'</h4>');continue}
    if((m=trimmed.match(/^##\s+(.+)$/))){flushList();flushPara();out.push('<h3 class="md-h3">'+inlineFmt(m[1])+'</h3>');continue}
    if((m=trimmed.match(/^#\s+(.+)$/))){flushList();flushPara();out.push('<h2 class="md-h2">'+inlineFmt(m[1])+'</h2>');continue}
    // Bold-only lines: numbered sections as H3, role/label lines as H4.
    if((m=trimmed.match(/^\*\*(\d+\.\s+[^*]+)\*\*$/))){flushList();flushPara();out.push('<h3 class="md-h3">'+esc(m[1])+'</h3>');continue}
    if((m=trimmed.match(/^\*\*([^*]+)\*\*$/))){flushList();flushPara();out.push('<h4 class="md-h4">'+esc(m[1])+'</h4>');continue}
    if((m=trimmed.match(/^_(.+)_$/))){flushList();flushPara();out.push('<div class="md-foot">'+inlineFmt(m[1])+'</div>');continue}
    if((m=trimmed.match(/^[-*]\s+(.+)$/))){
      flushPara();
      listBuf.push('<li class="md-li"><span class="md-li__bullet" aria-hidden="true"></span><span class="md-li__text">'+inlineFmt(m[1])+'</span></li>');
      continue;
    }
    flushList();
    paraBuf.push(trimmed);
  }
  flushList();
  flushPara();
  return '<div class="policy-doc">'+out.join('')+'</div>';
}
 
async function openPolicyDetail(policyId){
  currentPolicyId=policyId;
  var pol=allPolicies.find(function(p){return p.id===policyId});
  if(!pol)return;
  var cat=POLICY_CATS[pol.category]||pol.category;
  var userAcked=allAcknowledgments.find(function(a){return a.policy_id===pol.id&&a.version_acknowledged===pol.version});
  var catBadge=document.getElementById('pd-category-badge');
  catBadge.textContent=cat;
  catBadge.removeAttribute('style');catBadge.className='tag';
  var verBadge=document.getElementById('pd-version-badge');
  verBadge.textContent='v'+pol.version;
  verBadge.removeAttribute('style');verBadge.className='tag';
  var ackBadge=document.getElementById('pd-ack-status-badge');
  ackBadge.removeAttribute('style');ackBadge.className='state-label';
  if(userAcked){
    ackBadge.textContent='Acknowledged';
    ackBadge.style.color='var(--ra-ok)';
  }else if(pol.requires_acknowledgment){
    ackBadge.textContent='Pending acknowledgment';
    ackBadge.style.color='var(--ra-warn)';
  }else{
    ackBadge.textContent='';
  }
  document.getElementById('pd-title').textContent=pol.title;
  var descEl=document.getElementById('pd-desc');
  descEl.textContent=pol.description||'';
  descEl.hidden=!pol.description;
  document.getElementById('pd-updated').textContent='Updated '+fmtDate(pol.updated_at);

  // Acknowledgment first — then the document — so the action is never buried.
  var ackSection=document.getElementById('pd-ack-section');
  if(!pol.requires_acknowledgment||userAcked){
    if(userAcked){
      ackSection.innerHTML='<div class="notice"><div class="notice__label">Acknowledged</div><div class="notice__body">You acknowledged this policy on '+fmtDateLong(userAcked.acknowledged_at)+'. Version '+esc(userAcked.version_acknowledged)+', method: '+(userAcked.acknowledgment_method==='e_signature'?'E-signature':'Click')+'.</div></div>';
    }else{
      ackSection.innerHTML='';
    }
  }else{
    ackSection.innerHTML='<div class="callout callout--accent"><div class="callout__body"><div class="callout__title">Acknowledgment required</div><div class="callout__desc">Read this policy, then acknowledge it to create an auditable record of acceptance.</div></div><div class="callout__actions"><button class="btn-topbar btn-topbar-primary btn-sm" onclick="acknowledgePolicyClick()">I have read and accept</button><button class="btn-topbar btn-topbar-ghost btn-sm" onclick="openESignModal()">Sign with e-signature</button></div></div>';
  }

  var contentEl=document.getElementById('pd-content');
  if(pol.content){
    contentEl.innerHTML=renderMarkdown(pol.content,{title:pol.title});
  }else if(pol.document_url){
    var signResult=await sb.storage.from('governance-reports').createSignedUrl(pol.document_url,3600);
    var url=(signResult.data&&signResult.data.signedUrl)?signResult.data.signedUrl:'#';
    contentEl.innerHTML='<div class="policy-doc-file"><a href="'+url+'" target="_blank" class="btn-topbar btn-topbar-primary btn-sm"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>View document</a><p class="policy-doc-file__name">'+esc(pol.document_file_name||'Attached policy document')+'</p></div>';
  }else{
    contentEl.innerHTML='<div class="empty-inline">No content available.</div>';
  }
  var histResult=await sb.from('policy_acknowledgments').select('*').eq('policy_id',policyId).eq('org_id',currentOrg.id).order('acknowledged_at',{ascending:false});
  var acks=histResult.data||[];
  document.getElementById('pd-ack-count').textContent=acks.length+' acknowledgment'+(acks.length!==1?'s':'');
  var histEl=document.getElementById('pd-ack-history');
  if(!acks.length){
    histEl.innerHTML='<div class="empty-inline">No acknowledgments yet.</div>';
  }else{
    var nm=await loadNames(acks.map(function(a){return a.user_id}));
    histEl.innerHTML=acks.map(function(a){
      var method=a.acknowledgment_method==='e_signature'?'E-Signature':'Click';
      return '<div class="row-item"><div class="row-marker">✓</div><div class="row-main"><div class="row-title">'+esc(nm[a.user_id]||'Unknown')+'</div><div class="row-desc">v'+esc(a.version_acknowledged)+', '+method+', '+fmtDateLong(a.acknowledged_at)+'</div></div></div>';
    }).join('');
  }
  navigate('policy-detail',null);
  document.getElementById('nav-policies').classList.add('active');
}
 
async function acknowledgePolicyClick(){
  if(!currentPolicyId||!currentOrg)return;
  var pol=allPolicies.find(function(p){return p.id===currentPolicyId});
  if(!pol)return;
  var result=await sb.from('policy_acknowledgments').insert({
    policy_id:currentPolicyId,
    user_id:currentUser.id,
    org_id:currentOrg.id,
    version_acknowledged:pol.version,
    ip_address:null,
    user_agent:navigator.userAgent,
    acknowledgment_method:'click'
  }).select().single();
  if(result.error){
    if(result.error.code==='23505'){alert('You have already acknowledged this version.');return}
    alert('Error: '+result.error.message);return;
  }
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'policy_acknowledged',entity_type:'policy',entity_id:currentPolicyId,changes:{_actor_name:actorName(),policy:pol.title,version:pol.version,method:'click'}});
  await loadPolicies();
  openPolicyDetail(currentPolicyId);
  await snapshotGovernanceScore('policy_acknowledged',currentPolicyId);
}
