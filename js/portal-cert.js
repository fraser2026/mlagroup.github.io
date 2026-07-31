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

// ═══ CERTIFICATE PREVIEW HELPERS ══════════════════════════════
function certThumbnailHTML(orgName, scoreVal, levelText, validText, isBlurred) {
  var blur = isBlurred ? 'filter:blur(3px);opacity:0.5;' : '';
  return '<div style="background:#fefdfb;border:1px solid rgba(26,39,64,0.1);border-radius:8px;padding:28px 32px 24px;text-align:center;position:relative;' + blur + '">' +
    '<div style="position:absolute;inset:5px;border:0.5px solid rgba(26,39,64,0.06);pointer-events:none;border-radius:6px;"></div>' +
    '<div style="font-family:\'DM Sans\',sans-serif;font-size:8px;font-weight:700;letter-spacing:.35em;text-transform:uppercase;color:#1a2740;margin-bottom:12px;">MLA Group Ltd</div>' +
    '<div style="font-family:\'Cormorant Garamond\',serif;font-size:22px;font-weight:600;font-style:italic;color:#1a2740;line-height:1.15;margin-bottom:3px;">Certificate of AI Governance</div>' +
    '<div style="font-family:\'Cormorant Garamond\',serif;font-size:12px;font-weight:400;font-style:italic;color:#8b7d6b;margin-bottom:14px;">Verified by MLA Group</div>' +
    '<div style="width:50px;height:1.5px;background:linear-gradient(90deg,transparent,#ba9b5f,transparent);margin:0 auto 14px;"></div>' +
    '<div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;font-weight:400;font-style:italic;color:#9ca3af;margin-bottom:3px;">This certifies that</div>' +
    '<div style="font-family:\'Cormorant Garamond\',serif;font-size:26px;font-weight:600;color:#0f172a;margin-bottom:16px;line-height:1.15;">' + orgName + '</div>' +
    '<div style="display:flex;align-items:center;justify-content:center;gap:0;border-top:1px solid rgba(26,39,64,0.1);border-bottom:1px solid rgba(26,39,64,0.1);">' +
      '<div style="flex:1;padding:12px 8px;text-align:center;border-right:1px solid rgba(26,39,64,0.08);">' +
        '<div style="font-family:\'DM Sans\',sans-serif;font-size:8px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#8b7d6b;margin-bottom:4px;">Score</div>' +
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:18px;font-weight:700;color:#ba9b5f;">' + scoreVal + '</div>' +
      '</div>' +
      '<div style="flex:1;padding:12px 8px;text-align:center;border-right:1px solid rgba(26,39,64,0.08);">' +
        '<div style="font-family:\'DM Sans\',sans-serif;font-size:8px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#8b7d6b;margin-bottom:4px;">Level</div>' +
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:17px;font-weight:600;font-style:italic;color:#1a2740;">' + levelText + '</div>' +
      '</div>' +
      '<div style="flex:1;padding:12px 8px;text-align:center;">' +
        '<div style="font-family:\'DM Sans\',sans-serif;font-size:8px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#8b7d6b;margin-bottom:4px;">Valid Until</div>' +
        '<div style="font-family:\'DM Sans\',sans-serif;font-size:14px;font-weight:600;color:#1a2740;">' + validText + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function certStatCard(value, label, detail, color) {
  var valCol = color || '#f1f5f9';
  return '<div style="flex:1;background:rgba(15,23,42,0.4);border:1px solid rgba(148,163,184,0.06);border-radius:10px;padding:14px 16px;">' +
    '<div style="font-size:1.2rem;font-weight:700;color:' + valCol + ';margin-bottom:2px;font-family:\'DM Sans\',sans-serif;">' + value + '</div>' +
    '<div style="font-size:0.7rem;color:#94a3b8;font-weight:500;font-family:\'DM Sans\',sans-serif;">' + label + '</div>' +
    (detail ? '<div style="font-size:0.62rem;color:#475569;margin-top:3px;font-family:\'DM Sans\',sans-serif;">' + detail + '</div>' : '') +
  '</div>';
}

function certActionBtn(text, onclick, isPrimary, isDisabled) {
  var bg = isPrimary ? 'rgba(56,189,248,0.1)' : 'rgba(15,23,42,0.4)';
  var border = isPrimary ? 'rgba(56,189,248,0.2)' : 'rgba(148,163,184,0.08)';
  var col = isPrimary ? '#38bdf8' : '#cbd5e1';
  var opacity = isDisabled ? 'opacity:0.3;pointer-events:none;' : '';
  var clickAttr = onclick ? ' onclick="' + onclick + '"' : '';
  return '<button' + clickAttr + ' style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 16px;border-radius:9px;font-size:.78rem;font-weight:600;cursor:pointer;border:1px solid ' + border + ';background:' + bg + ';color:' + col + ';font-family:\'DM Sans\',sans-serif;' + opacity + '">' + text + '</button>';
}

// ═══ RENDER CERTIFICATE CARD ══════════════════════════════════
async function renderCertificateCard(){
  var panel=document.getElementById('cert-card-panel');
  if(!panel||!currentOrg)return;
  var cr=await sb.from('governance_certificates').select('*').eq('org_id',currentOrg.id).order('issued_at',{ascending:false});
  allCertificates=cr.data||[];
  var activeCert=allCertificates.find(function(c){return c.status==='active'});
  var plan=currentOrg.plan||'free';
  var isFree=plan!=='essentials'&&plan!=='professional';
  var gov=allControls.length?getGovScore():{score:0};
  var score=gov.score;
  var levelLabel=score>=85?'Advanced':score>=70?'Structured':'Emerging';
  var orgName=esc(currentOrg.name||'Your Organisation');
  var today=new Date();
  var futureFmt=fmtDate(new Date(today.getTime()+365*24*60*60*1000).toISOString());
  var assessResult=await sb.from('registry_assessments').select('id').eq('org_id',currentOrg.id).limit(1);
  var hasAssessment=assessResult.data&&assessResult.data.length>0;
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
  var totalPols=allPolicies.filter(function(p){return p.requires_acknowledgment&&p.published_at}).length;
  var signedPols=totalPols-pendingPols;
  var html='';

  // ─── STATE: ACTIVE CERTIFICATE ───
  if(activeCert&&!isFree){
    var cLevel=activeCert.certification_level;
    var cLevelLabel=cLevel==='advanced'?'Advanced':cLevel==='structured'?'Structured':'Emerging';
    var cScore=activeCert.governance_score;
    var cExpiry=fmtDate(activeCert.expires_at);
    var cId=activeCert.certificate_id;
    var cSys=activeCert.systems_covered||[];
    var controlsDone=allControls.filter(function(c){return c.status==='completed'}).length;
    var controlsTotal=allControls.length;

    html='<div style="background:var(--surface);border:1px solid rgba(148,163,184,0.08);border-radius:14px;overflow:hidden;position:relative;margin-bottom:16px;">' +
      '<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent 10%,#22c55e 50%,transparent 90%);"></div>' +
      '<div style="padding:24px 24px 22px;">' +

      // Header
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">' +
        '<div>' +
          '<div style="font-size:1rem;font-weight:600;color:#f1f5f9;margin-bottom:4px;font-family:\'DM Sans\',sans-serif;">Your AI Governance Certificate</div>' +
          '<div style="font-size:.75rem;color:#64748b;font-family:\'DM Sans\',sans-serif;">Organisation-wide certification &middot; Expires ' + cExpiry + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:.72rem;font-weight:600;background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.15);white-space:nowrap;">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span> Active' +
        '</div>' +
      '</div>' +

      // Certificate thumbnail
      certThumbnailHTML(orgName, cScore + '%', cLevelLabel, cExpiry, false) +

      // Stats row
      '<div style="display:flex;gap:10px;margin-top:18px;margin-bottom:18px;">' +
        certStatCard(cSys.length, 'AI System' + (cSys.length !== 1 ? 's' : '') + ' Covered', '', '#f1f5f9') +
        certStatCard(controlsDone + ' / ' + controlsTotal, 'Controls Complete', Math.round(controlsTotal ? controlsDone / controlsTotal * 100 : 0) + '% completion', '#f1f5f9') +
        certStatCard(signedPols + ' / ' + totalPols, 'Policies Signed', totalPols === signedPols ? 'All acknowledged' : '', '#f1f5f9') +
      '</div>' +

      // Actions
      '<div style="display:flex;gap:10px;margin-bottom:14px;">' +
        certActionBtn('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;"><path d="M8 10V2M5 7l3 3 3-3M3 12h10"/></svg> Download', 'downloadCertificatePDF()', true, false) +
        certActionBtn('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;"><circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.5"/></svg> View Certificate', 'downloadCertificatePDF()', false, false) +
        '<a href="verify.html?id=' + esc(cId) + '" target="_blank" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 16px;border-radius:9px;font-size:.78rem;font-weight:600;cursor:pointer;border:1px solid rgba(148,163,184,0.08);background:rgba(15,23,42,0.4);color:#cbd5e1;font-family:\'DM Sans\',sans-serif;text-decoration:none;"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;"><path d="M13.5 6.5v-4h-4M13.5 2.5L9 7M7 3H4a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V9"/></svg> Verify Online</a>' +
      '</div>' +

      // Footer
      '<div style="font-size:.68rem;color:#475569;line-height:1.5;padding-top:12px;border-top:1px solid rgba(148,163,184,0.06);font-family:\'DM Sans\',sans-serif;">Certificate ID: ' + esc(cId) + ' &middot; Publicly verifiable at ' + location.host + '/verify/' + esc(cId) + '</div>' +

      '</div></div>';
  }

  // ─── STATE: QUALIFIED (paid, meets criteria, no cert yet) ───
  else if(!isFree&&qualifies){
    var controlsDoneQ=allControls.filter(function(c){return c.status==='completed'}).length;
    var controlsTotalQ=allControls.length;

    html='<div style="background:var(--surface);border:1px solid rgba(148,163,184,0.08);border-radius:14px;overflow:hidden;position:relative;margin-bottom:16px;">' +
      '<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent 10%,#ba9b5f 50%,transparent 90%);"></div>' +
      '<div style="padding:24px 24px 22px;">' +

      // Header
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">' +
        '<div>' +
          '<div style="font-size:1rem;font-weight:600;color:#f1f5f9;margin-bottom:4px;font-family:\'DM Sans\',sans-serif;">Your AI Governance Certificate</div>' +
          '<div style="font-size:.75rem;color:#64748b;font-family:\'DM Sans\',sans-serif;">All requirements met &middot; Ready to activate</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:.72rem;font-weight:600;background:rgba(186,155,95,0.1);color:#ba9b5f;border:1px solid rgba(186,155,95,0.15);white-space:nowrap;">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5l3.5 3.5L13 4"/></svg> Qualified' +
        '</div>' +
      '</div>' +

      // Certificate thumbnail
      certThumbnailHTML(orgName, score + '%', levelLabel, futureFmt, false) +

      // Stats row
      '<div style="display:flex;gap:10px;margin-top:18px;margin-bottom:18px;">' +
        certStatCard(systemCount, 'AI System' + (systemCount !== 1 ? 's' : ''), '', '#f1f5f9') +
        certStatCard(controlsDoneQ + ' / ' + controlsTotalQ, 'Controls', '', '#f1f5f9') +
        certStatCard(signedPols + ' / ' + totalPols, 'Policies', 'All acknowledged', '#22c55e') +
      '</div>' +

      // Activate CTA
      '<div style="display:flex;gap:10px;margin-bottom:14px;">' +
        '<button onclick="activateCertificate()" style="flex:2;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 20px;border-radius:9px;font-size:.85rem;font-weight:600;cursor:pointer;border:1px solid rgba(186,155,95,0.3);background:rgba(186,155,95,0.12);color:#ba9b5f;font-family:\'DM Sans\',sans-serif;"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8.5l4.5 4.5L14 3"/></svg> Activate Certificate</button>' +
        certActionBtn('View Controls', 'navigateControls(document.getElementById(\'nav-controls\'))', false, false) +
      '</div>' +

      // Footer
      '<div style="font-size:.68rem;color:#475569;line-height:1.5;padding-top:12px;border-top:1px solid rgba(148,163,184,0.06);font-family:\'DM Sans\',sans-serif;">Activate to enable PDF download and public verification at ' + location.host + '/verify</div>' +

      '</div></div>';
  }

  // ─── STATE: FREE / NOT YET QUALIFIED (locked) ───
  else{
    var controlsDoneL=allControls.filter(function(c){return c.status==='completed'}).length;
    var controlsTotalL=allControls.length;
    var scoreOk=score>=70;
    var sysOk=systemCount>=1;

    // Build requirements checklist
    var reqItems='';
    if(isFree){
      reqItems+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,0.06);">' +
        '<div style="width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#ef4444" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg></div>' +
        '<div style="flex:1;"><div style="font-size:.78rem;font-weight:500;color:#f1f5f9;font-family:\'DM Sans\',sans-serif;">Paid subscription required</div><div style="font-size:.68rem;color:#64748b;font-family:\'DM Sans\',sans-serif;">Upgrade to Essentials or Professional</div></div>' +
      '</div>';
    }
    reqItems+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,0.06);">' +
      '<div style="width:22px;height:22px;border-radius:50%;background:' + (scoreOk ? 'rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2)' : 'rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.2)') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        (scoreOk ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#22c55e" stroke-width="2"><path d="M3 8.5l3.5 3.5L13 4"/></svg>' : '<span style="font-size:10px;color:#fbbf24;font-weight:700;">!</span>') +
      '</div>' +
      '<div style="flex:1;"><div style="font-size:.78rem;font-weight:500;color:#f1f5f9;font-family:\'DM Sans\',sans-serif;">Governance score 70%+</div><div style="font-size:.68rem;color:' + (scoreOk ? '#22c55e' : '#64748b') + ';font-family:\'DM Sans\',sans-serif;">' + (scoreOk ? score + '% &#10003;' : 'Currently ' + score + '%') + '</div></div>' +
    '</div>';
    reqItems+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,0.06);">' +
      '<div style="width:22px;height:22px;border-radius:50%;background:' + (sysOk ? 'rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2)' : 'rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.2)') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        (sysOk ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#22c55e" stroke-width="2"><path d="M3 8.5l3.5 3.5L13 4"/></svg>' : '<span style="font-size:10px;color:#fbbf24;font-weight:700;">!</span>') +
      '</div>' +
      '<div style="flex:1;"><div style="font-size:.78rem;font-weight:500;color:#f1f5f9;font-family:\'DM Sans\',sans-serif;">AI systems registered</div><div style="font-size:.68rem;color:' + (sysOk ? '#22c55e' : '#64748b') + ';font-family:\'DM Sans\',sans-serif;">' + (sysOk ? systemCount + ' system' + (systemCount !== 1 ? 's' : '') + ' &#10003;' : 'No systems registered') + '</div></div>' +
    '</div>';
    reqItems+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,0.06);">' +
      '<div style="width:22px;height:22px;border-radius:50%;background:' + (hasAssessment ? 'rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2)' : 'rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.2)') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        (hasAssessment ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#22c55e" stroke-width="2"><path d="M3 8.5l3.5 3.5L13 4"/></svg>' : '<span style="font-size:10px;color:#fbbf24;font-weight:700;">!</span>') +
      '</div>' +
      '<div style="flex:1;"><div style="font-size:.78rem;font-weight:500;color:#f1f5f9;font-family:\'DM Sans\',sans-serif;">Completed assessment</div><div style="font-size:.68rem;color:' + (hasAssessment ? '#22c55e' : '#64748b') + ';font-family:\'DM Sans\',sans-serif;">' + (hasAssessment ? 'Assessment complete &#10003;' : 'Run an assessment first') + '</div></div>' +
    '</div>';
    reqItems+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;">' +
      '<div style="width:22px;height:22px;border-radius:50%;background:' + (pendingPols === 0 && totalPols > 0 ? 'rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2)' : 'rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.2)') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        (pendingPols === 0 && totalPols > 0 ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#22c55e" stroke-width="2"><path d="M3 8.5l3.5 3.5L13 4"/></svg>' : '<span style="font-size:10px;color:#fbbf24;font-weight:700;">!</span>') +
      '</div>' +
      '<div style="flex:1;"><div style="font-size:.78rem;font-weight:500;color:#f1f5f9;font-family:\'DM Sans\',sans-serif;">Policies acknowledged</div><div style="font-size:.68rem;color:' + (pendingPols === 0 && totalPols > 0 ? '#22c55e' : '#64748b') + ';font-family:\'DM Sans\',sans-serif;">' + (pendingPols === 0 && totalPols > 0 ? 'All signed &#10003;' : pendingPols + ' pending acknowledgment') + '</div></div>' +
    '</div>';

    html='<div style="background:var(--surface);border:1px solid rgba(148,163,184,0.06);border-radius:14px;overflow:hidden;position:relative;margin-bottom:16px;">' +
      '<div style="padding:24px 24px 22px;">' +

      // Header
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">' +
        '<div>' +
          '<div style="font-size:1rem;font-weight:600;color:#f1f5f9;margin-bottom:4px;font-family:\'DM Sans\',sans-serif;">Your AI Governance Certificate</div>' +
          '<div style="font-size:.75rem;color:#64748b;font-family:\'DM Sans\',sans-serif;">' + (isFree ? 'Upgrade to unlock certification' : 'Complete the remaining steps to qualify') + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:.72rem;font-weight:600;background:rgba(148,163,184,0.08);color:#94a3b8;border:1px solid rgba(148,163,184,0.1);white-space:nowrap;">' +
          (isFree ? '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/></svg> Locked' : 'In Progress') +
        '</div>' +
      '</div>' +

      // Certificate thumbnail with partial blur
      '<div style="position:relative;border-radius:8px;overflow:hidden;margin-bottom:18px;">' +
        certThumbnailHTML(orgName, (isFree ? '&mdash;' : score + '%'), (isFree ? '&mdash;' : levelLabel), '&mdash;', isFree) +
        (isFree ? '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,23,42,0) 20%,rgba(15,23,42,0.85) 70%);display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:28px;">' +
          '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:10px;opacity:0.6;"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>' +
          '<div style="font-size:.95rem;font-weight:600;color:#f1f5f9;margin-bottom:4px;font-family:\'DM Sans\',sans-serif;">Unlock Your Certification</div>' +
          '<div style="font-size:.75rem;color:#94a3b8;font-family:\'DM Sans\',sans-serif;">Subscribe to activate governance certification</div>' +
        '</div>' : '') +
      '</div>' +

      // Requirements checklist
      '<div style="background:rgba(15,23,42,0.3);border:1px solid rgba(148,163,184,0.06);border-radius:10px;padding:16px 18px;margin-bottom:18px;">' +
        '<div style="font-size:.78rem;font-weight:600;color:#cbd5e1;margin-bottom:8px;font-family:\'DM Sans\',sans-serif;">Certification Requirements</div>' +
        reqItems +
      '</div>' +

      // Actions
      '<div style="display:flex;gap:10px;">' +
        (isFree ? '<button onclick="openUpgradeModal(\'Subscribe to activate your governance certificate, access PDF reports, public verification, and more.\')" style="flex:2;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 20px;border-radius:9px;font-size:.85rem;font-weight:600;cursor:pointer;border:none;background:#38bdf8;color:#0f172a;font-family:\'DM Sans\',sans-serif;">Upgrade Plan</button>' : '') +
        certActionBtn('View Controls', 'navigateControls(document.getElementById(\'nav-controls\'))', !isFree, false) +
      '</div>' +

      '</div></div>';
  }
  panel.innerHTML=html;
  panel.style.display='block';
}