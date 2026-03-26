// ═══ PHASE 3: POLICIES ════════════════════════════════════════
const POLICY_CATS={ai_governance:'AI Governance',data_protection:'Data Protection',acceptable_use:'Acceptable Use',risk_management:'Risk Management',security:'Security',ethics:'Ethics',other:'Other'};
const POLICY_CAT_COLORS={ai_governance:'#60a5fa',data_protection:'#c4b5fd',acceptable_use:'#4ade80',risk_management:'#fbbf24',security:'#f87171',ethics:'#93c5fd',other:'var(--muted)'};
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
  // Update sidebar badge
  var pending=getPendingPolicies();
  if(pending.length){
    document.getElementById('policy-count-badge').textContent=pending.length;
    document.getElementById('policy-count-badge').style.display='inline-flex';
  }else{
    document.getElementById('policy-count-badge').style.display='none';
  }
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
  // Stats
  document.getElementById('pol-stat-total').textContent=published.length||'0';
  document.getElementById('pol-stat-acked').textContent=acked;
  document.getElementById('pol-stat-pending').textContent=pending.length;
  document.getElementById('pol-list-count').textContent=published.length+' polic'+(published.length!==1?'ies':'y');
  // Policy list
  var el=document.getElementById('pol-list-body');
  if(!published.length){
    el.innerHTML='<div class="empty-state"><h4>No policies published yet</h4><p>Adopt a template below to create your first governance policy.</p></div>';
  }else{
    el.innerHTML=published.map(function(p){
      var cat=POLICY_CATS[p.category]||p.category;
      var catCol=POLICY_CAT_COLORS[p.category]||'var(--muted)';
      var userAcked=allAcknowledgments.find(function(a){return a.policy_id===p.id&&a.version_acknowledged===p.version});
      var needsAck=p.requires_acknowledgment&&!userAcked;
      return '<div style="display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.03);cursor:pointer;transition:background .1s;" onclick="openPolicyDetail(\''+p.id+'\')" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'none\'">' +
        '<div style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="'+catCol+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/></svg></div>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:.82rem;font-weight:600;color:var(--main);margin-bottom:2px;">'+esc(p.title)+'</div><div style="font-size:.7rem;color:var(--muted);display:flex;gap:8px;align-items:center;"><span style="color:'+catCol+';">'+esc(cat)+'</span><span>v'+esc(p.version)+'</span></div></div>' +
        (needsAck?'<span style="font-size:.62rem;font-weight:700;padding:3px 9px;border-radius:100px;color:#fbbf24;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.18);">Pending</span>':'<span style="font-size:.62rem;font-weight:700;padding:3px 9px;border-radius:100px;color:#4ade80;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.18);">Acknowledged</span>') +
      '</div>';
    }).join('');
  }
  // Templates
  var tplEl=document.getElementById('pol-templates-body');
  // Filter out templates already adopted
  var adoptedTitles={};
  allPolicies.forEach(function(p){adoptedTitles[p.title]=true});
  var available=allPolicyTemplates.filter(function(t){return !adoptedTitles[t.title]});
  if(!available.length){
    tplEl.innerHTML='<div style="padding:20px;text-align:center;font-size:.78rem;color:var(--muted);">All available templates have been adopted.</div>';
  }else{
    tplEl.innerHTML=available.map(function(t){
      var cat=POLICY_CATS[t.category]||t.category;
      var catCol=POLICY_CAT_COLORS[t.category]||'var(--muted)';
      return '<div style="display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.03);">' +
        '<div style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="'+catCol+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/></svg></div>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:.82rem;font-weight:600;color:var(--main);margin-bottom:2px;">'+esc(t.title)+'</div><div style="font-size:.7rem;color:var(--muted);">'+esc(t.description||'')+'</div></div>' +
        '<button class="btn-topbar btn-topbar-ghost" style="padding:5px 12px;font-size:.72rem;flex-shrink:0;" onclick="adoptTemplate(\''+t.id+'\')">Adopt</button>' +
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
  // Link to control if template has one
  if(tpl.linked_control_number&&allControls.length){
    var ctrl=allControls.find(function(c){return c.control_number===tpl.linked_control_number});
    if(ctrl&&result.data){
      await sb.from('policy_documents').update({linked_control_id:ctrl.id}).eq('id',result.data.id);
    }
  }
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'policy_adopted',entity_type:'policy',entity_id:result.data?result.data.id:null,changes:{_actor_name:actorName(),policy:tpl.title}});
  await loadPolicies();
}
 
function renderMarkdown(md){
  if(!md)return '<span style="color:var(--muted);">No content.</span>';
  var html=esc(md);
  // Headers
  html=html.replace(/^### (.+)$/gm,'<h4 style="font-size:.85rem;font-weight:600;color:var(--main);margin:16px 0 6px;">$1</h4>');
  html=html.replace(/^## (.+)$/gm,'<h3 style="font-size:.95rem;font-weight:600;color:var(--main);margin:20px 0 8px;">$1</h3>');
  html=html.replace(/^# (.+)$/gm,'<h2 style="font-family:\'Instrument Serif\',serif;font-size:1.15rem;font-weight:400;color:var(--main);margin:24px 0 10px;">$1</h2>');
  // Bold
  html=html.replace(/\*\*(.+?)\*\*/g,'<strong style="color:var(--main);font-weight:600;">$1</strong>');
  // Italic
  html=html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,'<em style="color:var(--muted2);">$1</em>');
  // List items
  html=html.replace(/^- (.+)$/gm,'<div style="display:flex;gap:8px;padding:3px 0;"><span style="color:var(--sky);flex-shrink:0;">•</span><span>$1</span></div>');
  // Underscores for version lines
  html=html.replace(/^_(.+)_$/gm,'<div style="font-style:italic;color:var(--muted);margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">$1</div>');
  // Paragraphs
  html=html.replace(/\n\n/g,'</p><p style="margin:10px 0;">');
  html='<p style="margin:10px 0;">'+html+'</p>';
  return html;
}
 
async function openPolicyDetail(policyId){
  currentPolicyId=policyId;
  var pol=allPolicies.find(function(p){return p.id===policyId});
  if(!pol)return;
  var cat=POLICY_CATS[pol.category]||pol.category;
  var catCol=POLICY_CAT_COLORS[pol.category]||'var(--muted)';
  var userAcked=allAcknowledgments.find(function(a){return a.policy_id===pol.id&&a.version_acknowledged===pol.version});
  // Header badges
  document.getElementById('pd-category-badge').textContent=cat;
  document.getElementById('pd-category-badge').style.cssText='font-size:.6rem;font-weight:700;padding:3px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:.08em;color:'+catCol+';background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)';
  document.getElementById('pd-version-badge').textContent='v'+pol.version;
  if(userAcked){
    document.getElementById('pd-ack-status-badge').textContent='Acknowledged';
    document.getElementById('pd-ack-status-badge').style.cssText='font-size:.65rem;font-weight:700;padding:3px 10px;border-radius:100px;color:#4ade80;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.18)';
  }else if(pol.requires_acknowledgment){
    document.getElementById('pd-ack-status-badge').textContent='Pending Acknowledgment';
    document.getElementById('pd-ack-status-badge').style.cssText='font-size:.65rem;font-weight:700;padding:3px 10px;border-radius:100px;color:#fbbf24;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.18)';
  }else{
    document.getElementById('pd-ack-status-badge').textContent='';
  }
  document.getElementById('pd-title').textContent=pol.title;
  document.getElementById('pd-desc').textContent=pol.description||'';
  document.getElementById('pd-updated').textContent='Updated '+fmtDate(pol.updated_at);
  // Content
  var contentEl=document.getElementById('pd-content');
  if(pol.content){
    contentEl.innerHTML=renderMarkdown(pol.content);
  }else if(pol.document_url){
    var signResult=await sb.storage.from('governance-reports').createSignedUrl(pol.document_url,3600);
    var url=(signResult.data&&signResult.data.signedUrl)?signResult.data.signedUrl:'#';
    contentEl.innerHTML='<div style="text-align:center;padding:20px;"><a href="'+url+'" target="_blank" class="btn-dl" style="display:inline-flex;text-decoration:none;"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>View Document — '+esc(pol.document_file_name||'Download')+'</a></div>';
  }else{
    contentEl.innerHTML='<div style="font-size:.78rem;color:var(--muted);">No content available.</div>';
  }
  // Acknowledgment section
  var ackSection=document.getElementById('pd-ack-section');
  if(!pol.requires_acknowledgment||userAcked){
    if(userAcked){
      ackSection.innerHTML='<div style="background:rgba(34,197,94,0.04);border:1px solid rgba(34,197,94,0.12);border-radius:12px;padding:18px 22px;margin-bottom:16px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3 3 7-7"/></svg><span style="font-size:.82rem;font-weight:600;color:#4ade80;">You acknowledged this policy</span></div><div style="font-size:.75rem;color:var(--muted);line-height:1.6;">Acknowledged on '+fmtDateLong(userAcked.acknowledged_at)+' · Version '+esc(userAcked.version_acknowledged)+' · Method: '+(userAcked.acknowledgment_method==='e_signature'?'E-Signature':'Click')+'</div></div>';
    }else{
      ackSection.innerHTML='';
    }
  }else{
    ackSection.innerHTML='<div style="background:rgba(251,191,36,0.04);border:1px solid rgba(251,191,36,0.15);border-radius:12px;padding:18px 22px;margin-bottom:16px;"><div style="font-size:.85rem;font-weight:600;color:var(--main);margin-bottom:8px;">Acknowledgment Required</div><div style="font-size:.78rem;color:var(--muted);line-height:1.6;margin-bottom:14px;">You are required to read and acknowledge this policy. This creates an auditable record of your acceptance.</div><div style="display:flex;gap:10px;"><button class="btn-topbar btn-topbar-primary" onclick="acknowledgePolicyClick()">I have read and accept this policy</button><button class="btn-topbar btn-topbar-ghost" onclick="openESignModal()">Sign with E-Signature</button></div></div>';
  }
  // Acknowledgment history
  var histResult=await sb.from('policy_acknowledgments').select('*').eq('policy_id',policyId).eq('org_id',currentOrg.id).order('acknowledged_at',{ascending:false});
  var acks=histResult.data||[];
  document.getElementById('pd-ack-count').textContent=acks.length+' acknowledgment'+(acks.length!==1?'s':'');
  var histEl=document.getElementById('pd-ack-history');
  if(!acks.length){
    histEl.innerHTML='<div style="font-size:.78rem;color:var(--muted);">No acknowledgments yet.</div>';
  }else{
    var nm=await loadNames(acks.map(function(a){return a.user_id}));
    histEl.innerHTML=acks.map(function(a){
      var method=a.acknowledgment_method==='e_signature'?'E-Signature':'Click';
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);"><div style="width:28px;height:28px;border-radius:7px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3 3 7-7"/></svg></div><div style="flex:1;"><div style="font-size:.78rem;font-weight:600;color:var(--main);">'+esc(nm[a.user_id]||'Unknown')+'</div><div style="font-size:.68rem;color:var(--muted);">v'+esc(a.version_acknowledged)+' · '+method+' · '+fmtDateLong(a.acknowledged_at)+'</div></div></div>';
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
 
function openESignModal(){
  if(!currentPolicyId)return;
  var pol=allPolicies.find(function(p){return p.id===currentPolicyId});
  if(!pol)return;
  document.getElementById('esign-policy-info').innerHTML='<strong>Policy:</strong> '+esc(pol.title)+'<br><strong>Version:</strong> '+esc(pol.version)+'<br><strong>Category:</strong> '+esc(POLICY_CATS[pol.category]||pol.category);
  document.getElementById('esign-declaration').textContent='I, the undersigned, confirm that I have read, understood, and agree to comply with the policy "'+pol.title+'" (version '+pol.version+') as published by '+currentOrg.name+'. I understand that this electronic signature constitutes a legally binding acknowledgment.';
  document.getElementById('esign-name').value='';
  document.getElementById('esign-email').value=currentUser.email;
  document.getElementById('esign-error').style.display='none';
  document.getElementById('esign-modal').classList.add('open');
}
 
function closeESignModal(){
  document.getElementById('esign-modal').classList.remove('open');
}
 
async function submitESignature(){
  if(!currentPolicyId||!currentOrg)return;
  var pol=allPolicies.find(function(p){return p.id===currentPolicyId});
  if(!pol)return;
  var name=document.getElementById('esign-name').value.trim();
  var errEl=document.getElementById('esign-error');
  if(!name||name.length<3){errEl.textContent='Please enter your full legal name (minimum 3 characters).';errEl.style.display='block';return}
  errEl.style.display='none';
  var btn=document.getElementById('esign-submit-btn');
  btn.textContent='Signing…';btn.disabled=true;
  var declaration=document.getElementById('esign-declaration').textContent;
  // Hash policy content for integrity
  var contentToHash=pol.content||pol.title+pol.version;
  var contentHash='';
  try{
    var encoder=new TextEncoder();
    var data=encoder.encode(contentToHash);
    var hashBuffer=await crypto.subtle.digest('SHA-256',data);
    var hashArray=Array.from(new Uint8Array(hashBuffer));
    contentHash=hashArray.map(function(b){return b.toString(16).padStart(2,'0')}).join('');
  }catch(e){contentHash='hash_unavailable'}
  // Insert e-signature record
  var sigResult=await sb.from('e_signatures').insert({
    org_id:currentOrg.id,
    user_id:currentUser.id,
    document_type:'policy',
    document_id:currentPolicyId,
    signatory_name:name,
    signatory_email:currentUser.email,
    declaration_text:declaration,
    ip_address:null,
    user_agent:navigator.userAgent,
    content_hash:contentHash
  }).select().single();
  if(sigResult.error){errEl.textContent='Error: '+sigResult.error.message;errEl.style.display='block';btn.textContent='Sign & Acknowledge';btn.disabled=false;return}
  // Insert policy acknowledgment linked to signature
  var ackResult=await sb.from('policy_acknowledgments').insert({
    policy_id:currentPolicyId,
    user_id:currentUser.id,
    org_id:currentOrg.id,
    version_acknowledged:pol.version,
    ip_address:null,
    user_agent:navigator.userAgent,
    acknowledgment_method:'e_signature',
    signature_id:sigResult.data?sigResult.data.id:null
  }).select().single();
  if(ackResult.error&&ackResult.error.code!=='23505'){errEl.textContent='Error: '+ackResult.error.message;errEl.style.display='block';btn.textContent='Sign & Acknowledge';btn.disabled=false;return}
  await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'policy_esigned',entity_type:'policy',entity_id:currentPolicyId,changes:{_actor_name:actorName(),policy:pol.title,version:pol.version,method:'e_signature',signatory_name:name}});
  closeESignModal();
  btn.textContent='Sign & Acknowledge';btn.disabled=false;
  await loadPolicies();
  openPolicyDetail(currentPolicyId);
}
 
