// ═══ GOVERNANCE CERTIFICATES ══════════════════════════════════
/* Portal certificate surface — RGA-002. The dashboard card is a
   product surface: paper, hairline, Compliance Bar at the seal.
   Gold / cream / serif print styling belongs only to issued PDF
   documents (Stage 9), not here. */
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

/* Cached PDFs under governance-reports keep the layout they were
   first rendered with. Serving only pdf_path meant March 2026 cream
   MLA PDFs outlived the RegAnchor certificate-template forever.
   Always re-render from the current template with frozen cert fields
   (score, level, issue dates, ID stay attestate truth). */
function downloadCertificatePDF(){
  if(!isPaidTier()){navigate('plans',document.getElementById('nav-plans'));updatePortalPricing();return}
  var activeCert=allCertificates.find(function(c){return c.status==='active'});
  if(!activeCert){alert('No active certificate found.');return}
  var overlay=document.createElement('div');
  overlay.className='pdf-overlay';
  overlay.innerHTML='<div class="pdf-overlay__spinner"></div>'+
    '<div class="pdf-overlay__copy"><div class="pdf-overlay__title">Generating your certificate</div>'+
    '<div class="pdf-overlay__status" id="cert-status-msg">Connecting to certificate server...</div></div>'+
    '<div class="pdf-overlay__track"><div class="pdf-overlay__fill" id="cert-progress-bar"></div></div>'+
    '<div class="pdf-overlay__note">This can take up to 30 seconds.<br>Please keep this tab open.</div>';
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

/* Seal preview — RGA-002 §05. Score, tier, Compliance Bar. No gold,
   no serif, no cream. The gradient lives only inside the bar.

   animate:false is intentional. Attested numbers must paint at the
   frozen score immediately. Count-up left seals stuck at "0 / 100"
   when animateMaturity() was never called after render. */
function certSealHTML(orgName, score, isBlurred){
  var blur=isBlurred?' cert-seal--muted':'';
  var maturity=raMaturityBlock(score,{mini:false,animate:false});
  return '<div class="cert-seal'+blur+'">'+
    '<div class="cert-seal__brand ra-wordmark">RegAnchor</div>'+
    '<div class="cert-seal__label">Attested governance maturity</div>'+
    '<div class="cert-seal__org">'+orgName+'</div>'+
    maturity+
  '</div>';
}

function certStatHTML(value, label, detail){
  return '<div class="cert-stat">'+
    '<div class="cert-stat__value ra-num">'+value+'</div>'+
    '<div class="cert-stat__label">'+label+'</div>'+
    (detail?'<div class="cert-stat__detail">'+detail+'</div>':'')+
  '</div>';
}

function certReqRow(ok, title, detail){
  var mark=ok
    ?'<span class="cert-req__mark cert-req__mark--ok" aria-hidden="true">✓</span>'
    :'<span class="cert-req__mark" aria-hidden="true">—</span>';
  return '<div class="cert-req">'+mark+
    '<div class="cert-req__body">'+
      '<div class="cert-req__title">'+title+'</div>'+
      '<div class="cert-req__detail'+(ok?' cert-req__detail--ok':'')+'">'+detail+'</div>'+
    '</div></div>';
}

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
  var orgName=esc(currentOrg.name||'Your Organisation');
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
  var controlsDone=allAssignments.filter(function(a){return a.status==='implemented'||a.status==='verified'}).length;
  var controlsTotal=allAssignments.length||allControls.length;
  var html='';

  if(activeCert&&!isFree){
    var cScore=activeCert.governance_score;
    /* Prefer L1–L7 from the frozen score (product ladder). Legacy
       certification_level enum is only a fallback if score is missing. */
    var cLevelLabel=typeof raLevelText==='function'&&cScore!=null&&cScore!==''
      ?raLevelText(cScore)
      :(activeCert.certification_level==='advanced'?'Advanced':activeCert.certification_level==='structured'?'Structured':'Emerging');
    var cExpiry=fmtDate(activeCert.expires_at);
    var cId=activeCert.certificate_id;
    var cSys=activeCert.systems_covered||[];
    var issuedNote=activeCert.issued_at?'Attested '+fmtDate(activeCert.issued_at)+' · ':'';

    html='<div class="cert-shell">'+
      '<div class="cert-shell__body">'+
        '<div class="cert-shell__head">'+
          '<div>'+
            '<div class="cert-shell__title">Governance certificate</div>'+
            '<div class="cert-shell__sub">'+issuedNote+'Organisation-wide attestation · Expires '+cExpiry+'</div>'+
          '</div>'+
          '<span class="state-label" style="color:var(--ra-ok);">Active</span>'+
        '</div>'+
        certSealHTML(orgName, cScore, false)+
        '<div class="cert-stats">'+
          certStatHTML(cSys.length, 'AI system'+(cSys.length!==1?'s':'')+' covered')+
          certStatHTML(controlsDone+' / '+controlsTotal, 'Controls complete', (controlsTotal?Math.round(controlsDone/controlsTotal*100):0)+'%')+
          certStatHTML(signedPols+' / '+totalPols, 'Policies signed', totalPols===signedPols&&totalPols?'All acknowledged':'')+
        '</div>'+
        '<div class="cert-actions">'+
          '<button class="btn-topbar btn-topbar-primary" onclick="downloadCertificatePDF()">Download PDF</button>'+
          '<a class="btn-topbar btn-topbar-ghost" href="verify.html?id='+esc(cId)+'" target="_blank" style="text-decoration:none;">Verify online</a>'+
        '</div>'+
        '<div class="cert-footer">Certificate ID · '+esc(cId)+' · '+esc(cLevelLabel)+' · Publicly verifiable</div>'+
      '</div></div>';
  }
  else if(!isFree&&qualifies){
    html='<div class="cert-shell">'+
      '<div class="cert-shell__body">'+
        '<div class="cert-shell__head">'+
          '<div>'+
            '<div class="cert-shell__title">Governance certificate</div>'+
            '<div class="cert-shell__sub">All requirements met · Ready to activate</div>'+
          '</div>'+
          '<span class="state-label" style="color:var(--ra-text);">Qualified</span>'+
        '</div>'+
        certSealHTML(orgName, score, false)+
        '<div class="cert-stats">'+
          certStatHTML(systemCount, 'AI system'+(systemCount!==1?'s':''))+
          certStatHTML(controlsDone+' / '+controlsTotal, 'Controls')+
          certStatHTML(signedPols+' / '+totalPols, 'Policies', 'All acknowledged')+
        '</div>'+
        '<div class="cert-actions">'+
          '<button class="btn-topbar btn-topbar-primary" onclick="activateCertificate()">Activate certificate</button>'+
          '<button class="btn-topbar btn-topbar-ghost" onclick="navigateControls(document.getElementById(\'nav-controls\'))">View controls</button>'+
        '</div>'+
        '<div class="cert-footer">Activate to enable PDF download and public verification</div>'+
      '</div></div>';
  }
  else{
    var scoreOk=score>=70;
    var sysOk=systemCount>=1;
    var polsOk=pendingPols===0&&totalPols>0;
    var reqHtml='';
    if(isFree){
      reqHtml+=certReqRow(false,'Paid subscription required','Upgrade to Essentials or Professional');
    }
    reqHtml+=certReqRow(scoreOk,'Governance score 70%+',scoreOk?score+'%':'Currently '+score+'%');
    reqHtml+=certReqRow(sysOk,'AI systems registered',sysOk?systemCount+' system'+(systemCount!==1?'s':''):'No systems registered');
    reqHtml+=certReqRow(hasAssessment,'Completed assessment',hasAssessment?'Assessment complete':'Run an assessment first');
    reqHtml+=certReqRow(polsOk,'Policies acknowledged',polsOk?'All signed':(pendingPols+' pending acknowledgment'));

    html='<div class="cert-shell">'+
      '<div class="cert-shell__body">'+
        '<div class="cert-shell__head">'+
          '<div>'+
            '<div class="cert-shell__title">Governance certificate</div>'+
            '<div class="cert-shell__sub">'+(isFree?'Upgrade to unlock certification':'Complete the remaining steps to qualify')+'</div>'+
          '</div>'+
          '<span class="state-label">'+(isFree?'Locked':'In progress')+'</span>'+
        '</div>'+
        certSealHTML(orgName, isFree?null:score, isFree)+
        '<div class="cert-reqs">'+
          '<div class="cert-reqs__label">Certification requirements</div>'+
          reqHtml+
        '</div>'+
        '<div class="cert-actions">'+
          (isFree?'<button class="btn-topbar btn-topbar-primary" onclick="openUpgradeModal(\'Subscribe to activate your governance certificate, access PDF reports, public verification, and more.\')">Upgrade plan</button>':'')+
          '<button class="btn-topbar btn-topbar-ghost" onclick="navigateControls(document.getElementById(\'nav-controls\'))">View controls</button>'+
        '</div>'+
      '</div></div>';
  }
  panel.innerHTML=html;
  panel.style.display='block';
}
