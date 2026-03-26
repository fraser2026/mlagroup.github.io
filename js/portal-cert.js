// ═══ GOVERNANCE CERTIFICATES ══════════════════════════════════
var allCertificates=[];
 
async function loadCertificates(){
  if(!currentOrg)return;
  var cr=await sb.from('governance_certificates').select('*').eq('org_id',currentOrg.id).order('issued_at',{ascending:false});
  allCertificates=cr.data||[];
}
 

async function activateCertificate(){
  if(!currentOrg)return;
  var plan=currentOrg.plan||'free';
  var hasPlan=plan==='essentials'||plan==='professional';
  if(!hasPlan){navigate('plans',document.getElementById('nav-plans'));updatePortalPricing();return}
  var gov=allControls.length?getGovScore():{score:0};
  var missing=[];
  if(gov.score<70)missing.push('Governance score must reach 70% (currently '+gov.score+'%)');
  if(allSystems.length<1)missing.push('At least 1 AI system required');
  var assessResult2=await sb.from('registry_assessments').select('id').eq('org_id',currentOrg.id).limit(1);
  if(!assessResult2.data||!assessResult2.data.length)missing.push('At least 1 completed assessment required');
  var polLoad2=await sb.from('policy_documents').select('id,requires_acknowledgment,published_at,version').eq('org_id',currentOrg.id).eq('is_active',true);
  var ackLoad2=await sb.from('policy_acknowledgments').select('policy_id,version_acknowledged').eq('org_id',currentOrg.id).eq('user_id',currentUser.id);
  var pols2=polLoad2.data||[];var acks2=ackLoad2.data||[];
  var pendCount=0;pols2.forEach(function(p){if(!p.requires_acknowledgment||!p.published_at)return;var a=acks2.find(function(ak){return ak.policy_id===p.id&&ak.version_acknowledged===p.version});if(!a)pendCount++});
  if(pendCount>0)missing.push(pendCount+' polic'+(pendCount!==1?'ies':'y')+' pending acknowledgment');
  if(missing.length){alert('Cannot activate certificate: '+missing.join(' | '));return}
  var score=gov.score;
  var level=score>=85?'advanced':score>=70?'structured':'emerging';
  var systemsCovered=allSystems.map(function(s){return{id:s.id,name:s.name}});
  var expiresAt=currentOrg.subscription_period_end||new Date(Date.now()+365*24*60*60*1000).toISOString();
  var result=await sb.from('governance_certificates').insert({
    org_id:currentOrg.id,certification_level:level,governance_score:score,
    subscription_tier:plan,systems_covered:systemsCovered,
    policies_acknowledged:allPolicies.filter(function(p){return p.published_at&&p.requires_acknowledgment}).length,
    assessments_completed:allSystems.length,
    expires_at:expiresAt,issued_by:currentUser.id
  }).select().single();
  if(result.error){alert('Error: '+result.error.message);return}
  await sb.from('registry_audit_log').insert({
    org_id:currentOrg.id,user_id:currentUser.id,action:'certificate_activated',
    entity_type:'certificate',entity_id:result.data.id,
    changes:{_actor_name:actorName(),certificate_id:result.data.certificate_id,level:level,score:score}
  });
  allCertificates=[result.data].concat(allCertificates);
  await renderCertificateCard();
}
 
function downloadCertificatePDF(){
  if(!isPaidTier()){navigate('plans',document.getElementById('nav-plans'));updatePortalPricing();return}
  var activeCert=allCertificates.find(function(c){return c.status==='active'});
  if(!activeCert){alert('No active certificate found.');return}
  if(activeCert.pdf_path){
    sb.storage.from('governance-reports').createSignedUrl(activeCert.pdf_path,3600).then(function(r){
      if(r.data&&r.data.signedUrl)window.open(r.data.signedUrl,'_blank');
      else alert('Could not generate download link.');
    });
    return;
  }
  var overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,0.92);backdrop-filter:blur(12px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;';
  overlay.innerHTML='<div style="width:56px;height:56px;border-radius:50%;border:2px solid rgba(37,99,235,0.15);border-top-color:#60a5fa;animation:spin .8s linear infinite;"></div><div style="text-align:center;"><div style="font-family:\'Instrument Serif\',serif;font-size:1.4rem;font-weight:400;color:#f1f5f9;margin-bottom:8px;">Generating your certificate</div><div style="font-size:.82rem;color:#475569;max-width:320px;line-height:1.7;" id="cert-status-msg">Connecting to certificate server...</div></div><div style="width:280px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;"><div id="cert-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#2563eb,#60a5fa);border-radius:2px;transition:width 1s ease;"></div></div><div style="font-size:.72rem;color:#334155;text-align:center;line-height:1.7;">This can take up to 30 seconds on first load.<br>Please keep this tab open.</div>';
  document.body.appendChild(overlay);
  var certMsgs=[{t:0,msg:'Connecting to certificate server...',pct:5},{t:3000,msg:'Loading certificate data...',pct:20},{t:8000,msg:'Rendering certificate layout...',pct:45},{t:15000,msg:'Generating PDF document...',pct:70},{t:22000,msg:'Almost there, finalising...',pct:88}];
  var certTimers=certMsgs.map(function(m){return setTimeout(function(){var el=document.getElementById('cert-status-msg');var bar=document.getElementById('cert-progress-bar');if(el)el.textContent=m.msg;if(bar)bar.style.width=m.pct+'%';},m.t);});
  var certPayload={certificate_id:activeCert.certificate_id,organisation:currentOrg.name,governance_score:activeCert.governance_score,certification_level:activeCert.certification_level,issued_at:activeCert.issued_at,expires_at:activeCert.expires_at};
  fetch('https://mla-pdf-service.onrender.com/render-certificate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(certPayload)}).then(function(res){if(!res.ok)throw new Error('Server error: '+res.status);return res.blob()}).then(function(blob){
    var storagePath='certificates/'+currentOrg.id+'/'+activeCert.certificate_id+'.pdf';
    return sb.storage.from('governance-reports').upload(storagePath,blob,{contentType:'application/pdf',upsert:true}).then(function(upResult){
      if(upResult.error)throw new Error('Upload failed: '+upResult.error.message);
      return sb.from('governance_certificates').update({pdf_path:storagePath}).eq('id',activeCert.id).then(function(){
        activeCert.pdf_path=storagePath;
        return sb.storage.from('governance-reports').createSignedUrl(storagePath,3600);
      });
    });
  }).then(function(signResult){
    certTimers.forEach(function(t){clearTimeout(t);});
    var bar=document.getElementById('cert-progress-bar');var msg=document.getElementById('cert-status-msg');
    if(bar)bar.style.width='100%';if(msg)msg.textContent='Certificate ready - opening...';
    setTimeout(function(){if(document.body.contains(overlay))document.body.removeChild(overlay);if(signResult.data&&signResult.data.signedUrl)window.open(signResult.data.signedUrl,'_blank');else alert('Certificate generated but could not create download link. Try again.');},800);
  }).catch(function(err){
    certTimers.forEach(function(t){clearTimeout(t);});
    if(document.body.contains(overlay))document.body.removeChild(overlay);
    alert('Certificate PDF generation failed: '+err.message);
  });
}
 
async function renderCertificateCard(){
  var panel=document.getElementById('cert-card-panel');
  if(!panel||!currentOrg)return;
  // Load certs
  var cr=await sb.from('governance_certificates').select('*').eq('org_id',currentOrg.id).order('issued_at',{ascending:false});
  allCertificates=cr.data||[];
  var activeCert=allCertificates.find(function(c){return c.status==='active'});
  var plan=currentOrg.plan||'free';
  var isFree=plan!=='essentials'&&plan!=='professional';
  var isPro=plan==='professional';
  var gov=allControls.length?getGovScore():{score:0};
  var score=gov.score;
  var levelLabel=score>=85?'Advanced':score>=70?'Structured':'Emerging';
  var orgName=esc(currentOrg.name||'Your Organisation');
  var today=new Date();
  var futureFmt=fmtDate(new Date(today.getTime()+365*24*60*60*1000).toISOString());
  // Check assessment count
  var assessResult=await sb.from('registry_assessments').select('id').eq('org_id',currentOrg.id).limit(1);
  var hasAssessment=assessResult.data&&assessResult.data.length>0;
  // Check pending policies — always reload fresh data
  var pendingPols=0;
  var polLoad=await sb.from('policy_documents').select('*').eq('org_id',currentOrg.id).eq('is_active',true);
  allPolicies=polLoad.data||[];
  var ackLoad=await sb.from('policy_acknowledgments').select('*').eq('org_id',currentOrg.id).eq('user_id',currentUser.id);
  allAcknowledgments=ackLoad.data||[];
  allPolicies.forEach(function(p){
    if(!p.requires_acknowledgment||!p.published_at)return;
    var acked=allAcknowledgments.find(function(a){return a.policy_id===p.id&&a.version_acknowledged===p.version});
    if(!acked)pendingPols++;
  });
  var systemCount=allSystems.length;
  var qualifies=!isFree&&score>=70&&systemCount>=1&&hasAssessment&&pendingPols===0;
  var html='';
 
  // ─── STATE: ACTIVE CERTIFICATE ───
  if(activeCert&&!isFree){
    var cLevel=activeCert.certification_level;
    var cLevelLabel=cLevel==='advanced'?'Advanced':cLevel==='structured'?'Structured':'Emerging';
    var cScore=activeCert.governance_score;
    var cExpiry=fmtDate(activeCert.expires_at);
    var cId=activeCert.certificate_id;
    var cSys=activeCert.systems_covered||[];
    html='<div style="background:var(--surface);border:1px solid rgba(34,197,94,0.2);border-radius:14px;overflow:hidden;position:relative;margin-bottom:16px;">'+
      '<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent 10%,#22c55e 50%,transparent 90%);"></div>'+
      '<div style="padding:22px 24px 20px;">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;">'+
        '<span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;padding:3px 10px;border-radius:100px;color:#4ade80;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);">'+esc(isPro?'Professional':'Essentials')+'</span>'+
        '<span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:3px 10px;border-radius:100px;color:#4ade80;background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.15);">Certified</span>'+
        '<span style="font-size:.6rem;font-weight:700;padding:3px 10px;border-radius:100px;color:#ba9b5f;background:rgba(186,155,95,0.06);border:1px solid rgba(186,155,95,0.15);">'+esc(cId)+'</span>'+
      '</div>'+
      '<div style="background:#fefdfb;border:1px solid rgba(26,39,64,0.08);border-radius:6px;padding:20px 24px;text-align:center;position:relative;margin-bottom:16px;">'+
        '<div style="position:absolute;inset:4px;border:0.5px solid rgba(26,39,64,0.06);pointer-events:none;border-radius:4px;"></div>'+
        '<div style="font-size:7px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:#9ca3af;margin-bottom:6px;">MLA Group Ltd</div>'+
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:16px;font-weight:500;font-style:italic;color:#1a2740;line-height:1.2;margin-bottom:4px;">Certificate of AI Governance Compliance</div>'+
        '<div style="width:40px;height:1px;background:rgba(186,155,95,0.4);margin:8px auto;"></div>'+
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:18px;font-weight:600;color:#1a2740;margin:8px 0 4px;">'+orgName+'</div>'+
        '<div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-top:8px;">'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Score</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#ba9b5f;margin-top:2px;">'+cScore+'%</div></div>'+
          '<div style="width:1px;height:24px;background:rgba(26,39,64,0.08);"></div>'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Level</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#1a2740;margin-top:2px;">'+esc(cLevelLabel)+'</div></div>'+
          '<div style="width:1px;height:24px;background:rgba(26,39,64,0.08);"></div>'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Valid Until</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#1a2740;margin-top:2px;">'+cExpiry+'</div></div>'+
        '</div>'+
      '</div>'+
      (cSys.length>1?'<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">'+cSys.map(function(s){return '<span style="font-size:.68rem;font-weight:500;padding:4px 10px;border-radius:6px;border:1px solid rgba(34,197,94,0.2);color:#4ade80;">&#10003; '+esc(s.name||'System')+'</span>'}).join('')+'</div>':'')+
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">'+
        '<div style="width:56px;height:56px;border-radius:50%;background:rgba(34,197,94,0.06);border:2px solid rgba(34,197,94,0.25);display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#4ade80;flex-shrink:0;">'+cScore+'%</div>'+
        '<div style="flex:1;"><div style="font-size:.85rem;font-weight:600;color:var(--main);margin-bottom:3px;">Organisation-wide AI governance certified</div><div style="font-size:.75rem;color:var(--muted);line-height:1.5;">'+cSys.length+' system'+(cSys.length!==1?'s':'')+' covered &middot; Level: '+esc(cLevelLabel)+' &middot; Renews '+cExpiry+'</div></div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
        '<button onclick="downloadCertificatePDF()" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;border:none;background:rgba(34,197,94,0.1);color:#4ade80;border:1px solid rgba(34,197,94,0.2);font-family:\'DM Sans\',sans-serif;">Download Certificate</button>'+
        '<a href="verify.html?id='+esc(cId)+'" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;text-decoration:none;background:transparent;color:var(--muted);border:1px solid var(--border);font-family:\'DM Sans\',sans-serif;">Verify Online</a>'+
      '</div>'+
      '<div style="font-size:.68rem;color:var(--muted2);line-height:1.5;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">Certificate ID: '+esc(cId)+' &middot; Publicly verifiable at mlagroup.co.uk/verify/'+esc(cId)+'</div>'+
      '</div></div>';
  }
 
  // ─── STATE: QUALIFIED (paid, meets criteria, no cert yet) ───
  else if(!isFree&&qualifies){
    html='<div style="background:var(--surface);border:1px solid rgba(186,155,95,0.2);border-radius:14px;overflow:hidden;position:relative;margin-bottom:16px;">'+
      '<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent 10%,#ba9b5f 50%,transparent 90%);"></div>'+
      '<div style="padding:22px 24px 20px;">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">'+
        '<span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;padding:3px 10px;border-radius:100px;color:#ba9b5f;background:rgba(186,155,95,0.08);border:1px solid rgba(186,155,95,0.2);">'+esc(isPro?'Professional':'Essentials')+'</span>'+
        '<span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:3px 10px;border-radius:100px;color:#ba9b5f;background:rgba(186,155,95,0.06);border:1px solid rgba(186,155,95,0.15);">Qualified for Certification</span>'+
      '</div>'+
      '<div style="background:#fefdfb;border:1px solid rgba(26,39,64,0.08);border-radius:6px;padding:20px 24px;text-align:center;position:relative;margin-bottom:16px;">'+
        '<div style="position:absolute;inset:4px;border:0.5px solid rgba(26,39,64,0.06);pointer-events:none;border-radius:4px;"></div>'+
        '<div style="font-size:7px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:#9ca3af;margin-bottom:6px;">MLA Group Ltd</div>'+
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:16px;font-weight:500;font-style:italic;color:#1a2740;line-height:1.2;margin-bottom:4px;">Certificate of AI Governance Compliance</div>'+
        '<div style="width:40px;height:1px;background:rgba(186,155,95,0.4);margin:8px auto;"></div>'+
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:18px;font-weight:600;color:#1a2740;margin:8px 0 4px;">'+orgName+'</div>'+
        '<div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-top:8px;">'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Score</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#ba9b5f;margin-top:2px;">'+score+'%</div></div>'+
          '<div style="width:1px;height:24px;background:rgba(26,39,64,0.08);"></div>'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Level</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#1a2740;margin-top:2px;">'+esc(levelLabel)+'</div></div>'+
          '<div style="width:1px;height:24px;background:rgba(26,39,64,0.08);"></div>'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Valid Until</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#1a2740;margin-top:2px;">'+futureFmt+'</div></div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">'+
        '<div style="width:56px;height:56px;border-radius:50%;background:rgba(186,155,95,0.06);border:2px solid rgba(186,155,95,0.25);display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:#ba9b5f;flex-shrink:0;">'+score+'%</div>'+
        '<div style="flex:1;"><div style="font-size:.85rem;font-weight:600;color:var(--main);margin-bottom:3px;">Your organisation qualifies for certification</div><div style="font-size:.75rem;color:var(--muted);line-height:1.5;">'+systemCount+' system'+(systemCount!==1?'s':'')+' &middot; Score: '+score+'% &middot; Level: '+esc(levelLabel)+'</div></div>'+
      '</div>'+
      '<div style="margin-bottom:16px;"><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:.72rem;color:var(--muted);">Certification progress</span><span style="font-size:.72rem;font-weight:600;color:#ba9b5f;">Qualified &#10003;</span></div><div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;"><div style="height:100%;width:100%;background:#ba9b5f;border-radius:2px;"></div></div></div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
        '<button onclick="activateCertificate()" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;border:none;background:rgba(186,155,95,0.12);color:#ba9b5f;border:1px solid rgba(186,155,95,0.25);font-family:\'DM Sans\',sans-serif;">Activate Certification</button>'+
        '<button onclick="navigateControls(document.getElementById(\'nav-controls\'))" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;background:transparent;color:var(--muted);border:1px solid var(--border);font-family:\'DM Sans\',sans-serif;">View Controls</button>'+
      '</div>'+
      '<div style="font-size:.68rem;color:var(--muted2);line-height:1.5;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">Activate to enable PDF download and public verification at mlagroup.co.uk/verify.</div>'+
      '</div></div>';
  }
 
  // ─── STATE: FREE / NOT YET QUALIFIED (locked) ───
  else{
    var pctRemain=score>=70?0:70-score;
    var progressText=score>=70?'Score achieved &#10003;':score+'% &mdash; '+pctRemain+'% to qualification';
    var progressCol=score>=70?'#4ade80':'var(--muted)';
    var progressWidth=Math.min(Math.round(score/70*100),100);
    var missingHtml='';
    if(isFree)missingHtml+='<div style="font-size:.75rem;color:var(--muted);padding:4px 0;">&middot; Paid subscription required</div>';
    if(score<70)missingHtml+='<div style="font-size:.75rem;color:var(--muted);padding:4px 0;">&middot; Governance score must reach 70% (currently '+score+'%)</div>';
    if(systemCount<1)missingHtml+='<div style="font-size:.75rem;color:var(--muted);padding:4px 0;">&middot; At least 1 AI system required</div>';
    if(!hasAssessment)missingHtml+='<div style="font-size:.75rem;color:var(--muted);padding:4px 0;">&middot; At least 1 completed assessment required</div>';
    if(pendingPols>0)missingHtml+='<div style="font-size:.75rem;color:var(--muted);padding:4px 0;">&middot; '+pendingPols+' polic'+(pendingPols!==1?'ies':'y')+' pending acknowledgment</div>';
    html='<div style="background:var(--surface);border:1px solid rgba(255,255,255,0.04);border-radius:14px;overflow:hidden;position:relative;margin-bottom:16px;">'+
      (isFree?'<div style="position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;z-index:2;"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/></svg></div>':'')+
      '<div style="padding:22px 24px 20px;">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">'+
        '<span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;padding:3px 10px;border-radius:100px;color:var(--muted);background:rgba(255,255,255,0.04);border:1px solid var(--border);">'+(isFree?'Free Tier':esc(isPro?'Professional':'Essentials'))+'</span>'+
        '<span style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:3px 10px;border-radius:100px;color:var(--muted);background:rgba(255,255,255,0.04);border:1px solid var(--border);">'+(isFree?'Certification Locked':'Not Yet Qualified')+'</span>'+
      '</div>'+
      '<div style="background:#fefdfb;border:1px solid rgba(26,39,64,0.08);border-radius:6px;padding:20px 24px;text-align:center;position:relative;margin-bottom:16px;'+(isFree?'opacity:.35;filter:grayscale(0.6);':'')+'">'+
        '<div style="position:absolute;inset:4px;border:0.5px solid rgba(26,39,64,0.06);pointer-events:none;border-radius:4px;"></div>'+
        '<div style="font-size:7px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:#9ca3af;margin-bottom:6px;">MLA Group Ltd</div>'+
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:16px;font-weight:500;font-style:italic;color:#1a2740;line-height:1.2;margin-bottom:4px;">Certificate of AI Governance Compliance</div>'+
        '<div style="width:40px;height:1px;background:rgba(186,155,95,0.2);margin:8px auto;"></div>'+
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:18px;font-weight:600;color:#1a2740;margin:8px 0 4px;">'+orgName+'</div>'+
        '<div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-top:8px;">'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Score</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#ba9b5f;margin-top:2px;">'+score+'%</div></div>'+
          '<div style="width:1px;height:24px;background:rgba(26,39,64,0.08);"></div>'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Level</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#1a2740;margin-top:2px;">'+esc(levelLabel)+'</div></div>'+
          '<div style="width:1px;height:24px;background:rgba(26,39,64,0.08);"></div>'+
          '<div style="font-size:9px;color:#6b7280;text-align:center;"><div>Status</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:600;color:#9ca3af;margin-top:2px;">'+(isFree?'Locked':'In Progress')+'</div></div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">'+
        '<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,0.03);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:var(--muted);flex-shrink:0;">'+score+'%</div>'+
        '<div style="flex:1;"><div style="font-size:.85rem;font-weight:600;color:var(--main);margin-bottom:3px;">'+(isFree?'You have built your governance baseline':'Working towards certification')+'</div><div style="font-size:.75rem;color:var(--muted);line-height:1.5;">'+(isFree?'Certification unlocks when you upgrade to Essentials. Reach 70% to qualify.':'Complete the requirements below to qualify for certification.')+'</div></div>'+
      '</div>'+
      (missingHtml?'<div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;">'+missingHtml+'</div>':'')+
      '<div style="margin-bottom:16px;"><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:.72rem;color:var(--muted);">Certification progress</span><span style="font-size:.72rem;font-weight:600;color:'+progressCol+';">'+progressText+'</span></div><div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;"><div style="height:100%;width:'+progressWidth+'%;background:'+progressCol+';border-radius:2px;"></div></div></div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
        (isFree?'<button onclick="openUpgradeModal(\'Subscribe to activate your governance certificate, access PDF reports, public verification, and more.\')" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;border:none;background:var(--accent);color:white;font-family:\'DM Sans\',sans-serif;">Upgrade</button>':'')+
        '<button onclick="navigateControls(document.getElementById(\'nav-controls\'))" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;background:transparent;color:var(--muted);border:1px solid var(--border);font-family:\'DM Sans\',sans-serif;">View Controls</button>'+
      '</div>'+
      '<div style="font-size:.68rem;color:var(--muted2);line-height:1.5;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">Your governance data and progress are preserved. '+(isFree?'Upgrade anytime to unlock certification and public verification.':'Complete all requirements to activate your certificate.')+'</div>'+
      '</div></div>';
  }
  panel.innerHTML=html;
  panel.style.display='block';
}
 
