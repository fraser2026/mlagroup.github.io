// ═══ SUBSCRIPTION PLANS ═══════════════════════════════════════
/* Pricing surface — RGA-002. Paper cards, hairline borders, ink
   CTAs. No gold Professional accent, no blue Recommended pill, no
   gradient card tops. Stripe checkout behaviour is unchanged. */
topbarTitles['policies']={label:'Policies',icon:'<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/>'};
topbarTitles['plans']={label:'Subscription Plans',icon:'<path d="M2 4h12M2 8h8M2 12h10"/><circle cx="14" cy="8" r="1.5"/>'};

var portalAnnual=false;
var portalStripe=null;
var portalCheckoutInstance=null;
function portalPriceId(plan){
  if(window.RA_STRIPE)return window.RA_STRIPE.priceId(plan,portalAnnual?'annual':'monthly');
  return null;
}
function portalStripePk(){
  return window.RA_STRIPE?window.RA_STRIPE.publishableKey():'';
}

function togglePortalPeriod(){portalAnnual=!portalAnnual;closePortalCheckout();updatePortalPricing()}
function setPortalPeriod(p){portalAnnual=(p==='annual');updatePortalPricing()}

function closePortalCheckout(){
  var c=document.getElementById('portal-checkout-container');
  var l=document.getElementById('portal-checkout-loading');
  if(portalCheckoutInstance){portalCheckoutInstance.destroy();portalCheckoutInstance=null}
  if(c)c.style.display='none';
  if(l)l.style.display='none';
}

function updatePortalPricing(){
  var lm=document.getElementById('portal-lbl-m');
  var la=document.getElementById('portal-lbl-a');
  var tog=document.getElementById('portal-tog');
  if(lm){lm.classList.toggle('is-active',!portalAnnual)}
  if(la){la.classList.toggle('is-active',portalAnnual)}
  if(tog){tog.classList.toggle('is-annual',portalAnnual)}
  renderPortalPricingCards();
}

function planFeature(text, strong){
  return '<div class="plan-feat'+(strong?' plan-feat--strong':'')+'"><span class="plan-feat__mark">✓</span>'+text+'</div>';
}

function planCta(planKey, label, current){
  if(current)return '<div class="plan-card__current">Current plan</div>';
  return '<button class="btn-topbar btn-topbar-primary plan-card__cta" onclick="portalSubscribe(\''+planKey+'\')">'+label+'</button>';
}

function renderPortalPricingCards(){
  var el=document.getElementById('portal-pricing-cards');
  if(!el)return;
  var plan=currentOrg?currentOrg.plan:'free';
  var isActive=currentOrg&&currentOrg.subscription_status==='active';
  var ePrice=portalAnnual?'1,290':'129';
  var pPrice=portalAnnual?'2,490':'249';
  var per=portalAnnual?'/year':'/month';
  var eSave=portalAnnual?'<div class="plan-card__save">Save £258/yr</div>':'';
  var pSave=portalAnnual?'<div class="plan-card__save">Save £498/yr</div>':'';
  var essCurrent=plan==='essentials'&&isActive;
  var proCurrent=plan==='professional'&&isActive;

  el.innerHTML='<div class="plan-grid">'+
    '<div class="plan-card'+(essCurrent?' plan-card--current':'')+'">'+
      (essCurrent?'':'<div class="plan-card__flag">Recommended</div>')+
      '<div class="plan-card__tier">Essentials</div>'+
      '<div class="plan-card__name">Governance</div>'+
      '<div class="plan-card__desc">Certified governance maturity with a publicly verifiable certificate.</div>'+
      '<div class="plan-card__price"><span class="plan-card__currency">£</span><span class="plan-card__num ra-num">'+ePrice+'</span><span class="plan-card__per">'+per+'</span></div>'+
      eSave+
      '<div class="plan-card__rule"></div>'+
      '<div class="plan-card__feats">'+
        planFeature('Governance Certificate',true)+
        planFeature('Public verification page',true)+
        planFeature('Assessment reports',true)+
        planFeature('Full governance framework',true)+
        planFeature('Email support',true)+
      '</div>'+
      planCta('essentials','Get started',essCurrent)+
    '</div>'+

    '<div class="plan-card'+(proCurrent?' plan-card--current':'')+'">'+
      '<div class="plan-card__tier">Professional</div>'+
      '<div class="plan-card__name">Compliance</div>'+
      '<div class="plan-card__desc">Operational governance across every system. Audit-ready at scale.</div>'+
      '<div class="plan-card__price"><span class="plan-card__currency">£</span><span class="plan-card__num ra-num">'+pPrice+'</span><span class="plan-card__per">'+per+'</span></div>'+
      pSave+
      '<div class="plan-card__rule"></div>'+
      '<div class="plan-card__feats">'+
        planFeature('Unlimited AI systems',true)+
        planFeature('Multi-user access (5 seats)',true)+
        planFeature('Organisation-wide certification',true)+
        planFeature('Compliance automation',true)+
        planFeature('Priority support',true)+
      '</div>'+
      planCta('professional','Upgrade to Professional',proCurrent)+
    '</div>'+

    '<div class="plan-card">'+
      '<div class="plan-card__tier">Enterprise</div>'+
      '<div class="plan-card__name">Governance OS</div>'+
      '<div class="plan-card__desc">Bespoke governance infrastructure for multi-jurisdiction obligations.</div>'+
      '<div class="plan-card__price"><span class="plan-card__num ra-num" style="font-size:28px;">Bespoke</span></div>'+
      '<div class="plan-card__save">Tailored to your organisation</div>'+
      '<div class="plan-card__rule"></div>'+
      '<div class="plan-card__feats">'+
        planFeature('Everything in Professional',true)+
        planFeature('Unlimited users',true)+
        planFeature('Dedicated advisory lead',true)+
        planFeature('On-site sessions &amp; benchmarking',true)+
        planFeature('Custom SLA',true)+
      '</div>'+
      '<a href="#" class="btn-topbar btn-topbar-ink plan-card__cta" onclick="openEnterpriseModal();return false;" style="text-decoration:none;text-align:center;">Talk to advisory</a>'+
    '</div>'+
  '</div>'+

  '<div class="plan-compare-wrap">'+
    '<button class="btn-topbar btn-topbar-ghost" onclick="togglePortalCompare()" id="portal-comp-btn">Compare all features</button>'+
  '</div>'+
  '<div id="portal-comp-table" class="plan-compare" hidden>'+
    '<div class="table-scroll"><table class="sys-table plan-table">'+
      '<thead><tr><th>Feature</th><th>Free</th><th>Essentials</th><th>Professional</th><th>Enterprise</th></tr></thead><tbody>'+
      portalCompRow('Diagnostics &amp; Assessment')+
      portalCompData('Governance diagnostic','y','y','y','y')+
      portalCompData('Maturity score &amp; risk band','y','y','y','y')+
      portalCompData('7-domain system assessment','y','y','y','y')+
      portalCompData('Assessment reports','n','y','y','y')+
      portalCompRow('Registry &amp; Systems')+
      portalCompData('AI systems in registry','1','1','Unlimited','Unlimited')+
      portalCompData('EU AI Act risk classification','y','y','y','y')+
      portalCompData('Compliance framework tracking','y','y','y','y')+
      portalCompRow('Governance Controls')+
      portalCompData('12 governance controls','y','y','y','y')+
      portalCompData('Task management &amp; evidence','y','y','y','y')+
      portalCompData('RegAnchor expert support','y','y','Priority','Dedicated')+
      portalCompData('Compliance automation engine','n','n','y','y')+
      portalCompRow('Certification')+
      portalCompData('Governance certificate','n','y','y','y')+
      portalCompData('Certificate PDF download','n','y','y','y')+
      portalCompData('Public verification page','n','y','y','y')+
      portalCompData('Governance dossier export','n','n','y','y')+
      portalCompRow('Team &amp; Organisation')+
      portalCompData('Users','1','1','Up to 5','Unlimited')+
      portalCompData('Policy management','y','y','y','y')+
      portalCompData('E-signatures','y','y','y','y')+
      portalCompData('Audit trail','y','y','Advanced','Advanced')+
      portalCompRow('Support')+
      portalCompData('Support channel','In-portal','Email','Priority','Dedicated lead')+
      portalCompData('On-site sessions','n','n','n','y')+
      portalCompData('Quarterly benchmarking','n','n','n','y')+
      '</tbody></table></div>'+
  '</div>';
}

function togglePortalCompare(){
  var el=document.getElementById('portal-comp-table');
  if(!el)return;
  el.hidden=!el.hidden;
}

function portalCompRow(label){
  return '<tr class="plan-table__section"><td colspan="5">'+label+'</td></tr>';
}

function portalCompData(feat,f,e,p,en){
  function cell(v){
    if(v==='y')return '<td class="plan-table__y">✓</td>';
    if(v==='n')return '<td class="plan-table__n">—</td>';
    return '<td>'+v+'</td>';
  }
  return '<tr><td>'+feat+'</td>'+cell(f)+cell(e)+cell(p)+cell(en)+'</tr>';
}

function openUpgradeModal(contextMsg){
  var plan=currentOrg?currentOrg.plan:'free';
  var isActive=currentOrg&&currentOrg.subscription_status==='active';
  var heading,subtext,cardsHtml,cols=3,maxW='720px';

  function miniCard(tier,name,desc,price,feats,btnHtml){
    return '<div class="plan-card plan-card--modal">'+
      '<div class="plan-card__tier">'+tier+'</div>'+
      '<div class="plan-card__name">'+name+'</div>'+
      '<div class="plan-card__desc">'+desc+'</div>'+
      '<div class="plan-card__price"><span class="plan-card__currency">£</span><span class="plan-card__num ra-num">'+price+'</span><span class="plan-card__per">/mo</span></div>'+
      '<div class="plan-card__feats">'+feats.map(function(f){return planFeature(f,true)}).join('')+'</div>'+
      btnHtml+
    '</div>';
  }

  var essCard=miniCard('Essentials','Governance','Certified governance maturity with a publicly verifiable certificate.','129',
    ['Governance Certificate','Assessment reports','1 AI system'],
    '<button class="btn-topbar btn-topbar-primary plan-card__cta" onclick="closeUpgradeModal();portalAnnual=false;navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing();setTimeout(function(){portalSubscribe(\'essentials\')},300)">Get started</button>');

  var proCard=miniCard('Professional','Compliance','Unlimited systems, multi-user access, and audit-ready coverage.','249',
    ['Unlimited AI systems','Multi-user (5 seats)','Organisation-wide certification'],
    '<button class="btn-topbar btn-topbar-primary plan-card__cta" onclick="closeUpgradeModal();portalAnnual=false;navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing();setTimeout(function(){portalSubscribe(\'professional\')},300)">Upgrade to Professional</button>');

  var entCard='<div class="plan-card plan-card--modal">'+
    '<div class="plan-card__tier">Enterprise</div>'+
    '<div class="plan-card__name">Governance OS</div>'+
    '<div class="plan-card__desc">Bespoke governance infrastructure for multi-jurisdiction obligations.</div>'+
    '<div class="plan-card__price"><span class="plan-card__num ra-num" style="font-size:22px;">Bespoke</span></div>'+
    '<div class="plan-card__feats">'+
      planFeature('Everything in Professional',true)+
      planFeature('Unlimited users',true)+
      planFeature('Dedicated advisory lead',true)+
    '</div>'+
    '<button class="btn-topbar btn-topbar-ink plan-card__cta" onclick="closeUpgradeModal();openEnterpriseModal()">Contact us</button>'+
  '</div>';

  if(plan==='professional'&&isActive){
    heading='Scale your governance infrastructure';
    subtext=contextMsg||'Enterprise includes unlimited users, dedicated advisory, on-site sessions, custom SLA, and more.';
    cardsHtml=entCard;cols=1;maxW='360px';
  }else if(plan==='essentials'&&isActive){
    heading='Expand your governance coverage';
    subtext=contextMsg||'Unlock unlimited AI systems, multi-user access, compliance automation, and more.';
    cardsHtml=proCard+entCard;cols=2;maxW='520px';
  }else{
    heading='Unlock your full governance capability';
    subtext=contextMsg||'Upgrade to access governance certification, PDF reports, unlimited AI systems, and more.';
    cardsHtml=essCard+proCard+entCard;cols=3;maxW='720px';
  }

  document.getElementById('upgrade-modal-title').textContent=heading;
  document.getElementById('upgrade-modal-msg').textContent=subtext;
  document.getElementById('upgrade-modal-cards').innerHTML='<div class="plan-grid plan-grid--'+cols+'">'+cardsHtml+'</div>';
  document.getElementById('upgrade-modal-inner').style.maxWidth=maxW;
  document.getElementById('upgrade-modal').classList.add('open');
}

function closeUpgradeModal(){document.getElementById('upgrade-modal').classList.remove('open')}

function openEnterpriseModal(){
  if(currentProfile){
    document.getElementById('ent-name').value=currentProfile.full_name||'';
    document.getElementById('ent-email').value=currentUser.email||'';
    document.getElementById('ent-org').value=currentOrg?currentOrg.name||'':'';
  }
  document.getElementById('ent-role').value='';
  document.getElementById('ent-systems').value='';
  document.getElementById('ent-message').value='';
  document.querySelectorAll('#ent-reqs input[type=checkbox]').forEach(function(c){c.checked=false});
  document.getElementById('ent-error').style.display='none';
  document.getElementById('ent-submit-btn').textContent='Submit Inquiry';
  document.getElementById('ent-submit-btn').disabled=false;
  document.getElementById('enterprise-modal').classList.add('open');
}
function closeEnterpriseModal(){document.getElementById('enterprise-modal').classList.remove('open')}

async function submitEnterpriseInquiry(){
  var name=document.getElementById('ent-name').value.trim();
  var role=document.getElementById('ent-role').value.trim();
  var systems=document.getElementById('ent-systems').value;
  var message=document.getElementById('ent-message').value.trim();
  var errEl=document.getElementById('ent-error');
  var btn=document.getElementById('ent-submit-btn');
  if(!name){errEl.textContent='Please enter your name.';errEl.style.display='block';return}
  errEl.style.display='none';
  btn.textContent='Submitting...';btn.disabled=true;
  var reqs=[];document.querySelectorAll('#ent-reqs input[type=checkbox]:checked').forEach(function(c){reqs.push(c.value)});
  var email=currentUser?currentUser.email:'';
  var orgName=currentOrg?currentOrg.name:'';
  try{
    await sb.from('enterprise_inquiries').insert({org_id:currentOrg?currentOrg.id:null,user_id:currentUser?currentUser.id:null,full_name:name,email:email,organisation:orgName,role_title:role||null,system_count:systems||null,requirements:reqs.length?reqs:null,message:message||null});
    try{
      if(typeof emailjs!=='undefined'){
        var C=window.RA_CONTACT||{};
        var ej=C.emailjs||{};
        emailjs.init(ej.publicKey||'vxitc5LFJHMfNcmUL');
        await emailjs.send(ej.opsService||'service_umdte26',ej.opsTemplate||'template_o6h9et7',{
          to_name:'RegAnchor',
          to_email:C.ops||'info@reganchor.com',
          alert_title:'Enterprise inquiry: '+name,
          alert_body:'Name: '+name+' | Role: '+(role||'Not specified')+' | Email: '+email+' | Organisation: '+orgName+' | AI Systems: '+(systems||'Not specified')+' | Requirements: '+(reqs.length?reqs.join(', '):'None selected')+' | Message: '+(message||'No message')
        });
      }
    }catch(eml){console.log('Email notification skipped')}
    if(currentOrg){await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'enterprise_inquiry',entity_type:'organisation',entity_id:currentOrg.id,changes:{_actor_name:actorName(),requirements:reqs}})}
    btn.textContent='Inquiry Submitted';
    document.querySelector('#enterprise-modal .modal-header').innerHTML='<div></div><button class="modal-close" onclick="closeEnterpriseModal()">✕</button>';
    document.querySelector('#enterprise-modal .modal-body').innerHTML='<div class="empty-state" style="padding:40px 0 20px;"><h4>Inquiry received</h4><p>Thank you, '+esc(name.split(' ')[0])+'. A RegAnchor governance specialist will be in touch within 24 hours.</p></div>';
    document.querySelector('#enterprise-modal .modal-footer').innerHTML='<button class="btn-topbar btn-topbar-primary" onclick="closeEnterpriseModal()">Close</button>';
  }catch(err){
    errEl.textContent='Error: '+err.message;errEl.style.display='block';
    btn.textContent='Submit Inquiry';btn.disabled=false;
  }
}

function portalSubscribe(plan){
  var priceId=portalPriceId(plan);
  if(!priceId)return;
  var pk=portalStripePk();
  if(!pk){alert('Stripe key missing. Check js/stripe-config.js');return}
  var loadEl=document.getElementById('portal-checkout-loading');
  var contEl=document.getElementById('portal-checkout-container');
  if(contEl.style.display==='block'){contEl.scrollIntoView({behavior:'smooth'});return}
  loadEl.style.display='block';
  if(!portalStripe)portalStripe=Stripe(pk);
  Promise.resolve(typeof ensureOrg==='function'?ensureOrg():currentOrg).then(function(org){
    if(!org){loadEl.style.display='none';alert('Could not set up your organisation. Please refresh and try again.');return null}
    return sb.auth.getSession().then(function(sd){
      var session=sd.data.session;
      if(!session){loadEl.style.display='none';alert('Please sign in first.');return null}
      return fetch(SUPABASE_URL+'/functions/v1/create-subscription-session',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_KEY},
        body:JSON.stringify({price_id:priceId,org_id:org.id,embedded:true})
      }).then(function(res){return res.json()});
    });
  }).then(function(data){
    if(!data)return;
    if(data.error){loadEl.style.display='none';if(data.existing){alert('Your organisation already has an active subscription.')}else{alert(data.error)}return}
    if(!data.clientSecret){loadEl.style.display='none';alert('Could not load checkout.');return}
    if(portalCheckoutInstance)portalCheckoutInstance.destroy();
    return portalStripe.initEmbeddedCheckout({clientSecret:data.clientSecret}).then(function(checkout){
      portalCheckoutInstance=checkout;
      loadEl.style.display='none';
      contEl.innerHTML='<div class="plan-checkout__head"><span>Complete your subscription</span><button class="btn-topbar btn-topbar-ghost btn-sm" onclick="closePortalCheckout()">Cancel</button></div><div id="portal-checkout-mount"></div>';
      contEl.style.display='block';
      checkout.mount('#portal-checkout-mount');
      setTimeout(function(){contEl.scrollIntoView({behavior:'smooth',block:'start'})},100);
    });
  }).catch(function(err){
    loadEl.style.display='none';
    console.error('Checkout error:',err);
    alert('Could not load checkout. Please try again.');
  });
}

async function startSubscription(priceId){
  if(!priceId&&arguments.length)priceId=arguments[0];
  // Legacy helper — prefer portalSubscribe(planKey)
  try{
    var org=typeof ensureOrg==='function'?await ensureOrg():currentOrg;
    if(!org){alert('Could not set up your organisation. Please refresh and try again.');return}
    var sd=await sb.auth.getSession();var session=sd.data.session;
    if(!session){alert('Please sign in first.');return}
    var res=await fetch(SUPABASE_URL+'/functions/v1/create-subscription-session',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_KEY},
      body:JSON.stringify({price_id:priceId,org_id:org.id})
    });
    var data=await res.json();
    if(data.url){window.location.href=data.url}
    else if(data.existing){alert('You already have an active subscription.')}
    else{alert(data.error||'Could not start checkout.')}
  }catch(err){alert('Subscription error: '+err.message)}
}
