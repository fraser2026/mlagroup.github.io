// ═══ BILLING ══════════════════════════════════════════════════
function canManageBilling(){
  return currentMemberRole==='owner'||currentMemberRole==='admin';
}

function billingStatusMeta(status){
  var s=String(status||'').toLowerCase();
  if(s==='active')return {label:'Active',cls:'is-ok'};
  if(s==='trialing')return {label:'Trial',cls:'is-ok'};
  if(s==='past_due'||s==='unpaid')return {label:'Past due',cls:'is-risk'};
  if(s==='incomplete'||s==='incomplete_expired')return {label:'Incomplete',cls:'is-warn'};
  if(s==='canceling'||s==='cancelling')return {label:'Cancels at period end',cls:'is-warn'};
  if(s==='canceled'||s==='cancelled')return {label:'Cancelled',cls:'is-muted'};
  if(s==='none'||!s)return {label:'Not subscribed',cls:'is-muted'};
  return {label:s.replace(/_/g,' '),cls:'is-muted'};
}

function billingIntervalLabel(interval){
  if(interval==='year'||interval==='annual')return 'Annual';
  if(interval==='month'||interval==='monthly')return 'Monthly';
  return interval||'—';
}

function billingPriceLine(amount, interval){
  if(!amount)return '—';
  if(interval==='year'||interval==='annual')return amount+' / year';
  if(interval==='month'||interval==='monthly')return amount+' / month';
  return amount;
}

function billingNextPaymentCopy(iso, status){
  var st=String(status||'').toLowerCase();
  if(!iso)return '';
  var when=new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  if(st==='canceled'||st==='cancelled')return 'This subscription ended on '+when+'.';
  if(st==='canceling'||st==='cancelling')return 'Access continues until '+when+', when the subscription ends.';
  if(st==='past_due'||st==='unpaid')return 'Payment is overdue. The current period ends on '+when+'.';
  return 'Your next payment is scheduled for '+when+'.';
}

function billingPad2(n){
  return n<10?'0'+n:String(n);
}

async function invokeBillingFn(name, body){
  var sd=await sb.auth.getSession();
  var session=sd.data.session;
  if(!session)throw new Error('signed-out');
  var res=await fetch(SUPABASE_URL+'/functions/v1/'+name,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_KEY},
    body:JSON.stringify(body||{})
  });
  var data=await res.json().catch(function(){return {}});
  if(!res.ok){
    var err=new Error(data.error||'request-failed');
    err.status=res.status;
    throw err;
  }
  return data;
}

async function openStripeBillingPortal(sourceBtn){
  var errEl=document.getElementById('billing-portal-error');
  if(errEl){errEl.hidden=true;errEl.textContent=''}
  if(!canManageBilling()){
    if(errEl){errEl.hidden=false;errEl.textContent='Only an owner or admin can manage the organisation subscription.';}
    return;
  }
  var buttons=document.querySelectorAll('[data-billing-portal]');
  buttons.forEach(function(b){b.disabled=true;b.setAttribute('data-label',b.textContent);b.textContent='Opening…'});
  try{
    var data=await invokeBillingFn('create-billing-portal-session',{});
    if(!data||!data.url)throw new Error('no-url');
    window.location.href=data.url;
  }catch(err){
    console.error('Billing portal error');
    buttons.forEach(function(b){
      b.disabled=false;
      b.textContent=b.getAttribute('data-label')||'Manage subscription';
    });
    if(errEl){
      errEl.hidden=false;
      if(err&&err.status===400)errEl.textContent='No subscription is linked yet. Choose a plan to get started.';
      else if(err&&err.status===403)errEl.textContent='Only an owner or admin can manage the organisation subscription.';
      else errEl.textContent='Billing settings could not be opened. Try again, or contact support if this continues.';
    }
  }
}

function billingManageButtons(hasCustomer){
  if(!canManageBilling()){
    return '<p class="users-copy">Only an owner or admin can change payment details or the plan.</p>';
  }
  if(!hasCustomer){
    return '<button type="button" class="btn-topbar btn-topbar-primary" onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing()">View plans</button>';
  }
  return '<button type="button" class="btn-topbar btn-topbar-primary" data-billing-portal onclick="openStripeBillingPortal(this)">Manage subscription</button>';
}

async function navigateBilling(navEl){
  navigate('billing',navEl);
  await renderBillingPage();
}

async function renderBillingPage(){
  var wrap=document.getElementById('billing-page');
  if(!wrap)return;
  wrap.innerHTML='<div class="loading-state">Loading billing…</div>';
  if(!currentOrg)await ensureOrg();
  if(!currentOrg){
    wrap.innerHTML='<div class="empty-state"><h4>Organisation not found</h4><p>Refresh the page and try again.</p></div>';
    return;
  }
  try{
    var fresh=await sb.from('organisations').select('*').eq('id',currentOrg.id).maybeSingle();
    if(fresh.data)currentOrg=fresh.data;
  }catch(e){}

  var overview=null;
  try{
    overview=await invokeBillingFn('get-billing-overview',{});
  }catch(err){
    console.error('Billing overview error');
  }

  var planKey=(overview&&overview.plan)||currentOrg.plan||'';
  var statusKey=(overview&&overview.status)||currentOrg.subscription_status||'';
  var periodEnd=(overview&&overview.periodEnd)||currentOrg.subscription_period_end||null;
  var hasCustomer=overview?!!overview.hasCustomer:!!currentOrg.stripe_customer_id;
  var hasSub=overview?!!overview.hasSubscription:!!currentOrg.stripe_subscription_id;
  var planLabel=PLAN_LABELS[planKey]||(planKey&&planKey!=='free'?planKey.charAt(0).toUpperCase()+planKey.slice(1):'');
  var st=billingStatusMeta(statusKey);
  var amountLine=overview?billingPriceLine(overview.amount,overview.interval):'—';
  var intervalLabel=overview?billingIntervalLabel(overview.interval):'—';
  var nextCopy=billingNextPaymentCopy(periodEnd,statusKey);

  if(!hasCustomer&&!hasSub){
    wrap.innerHTML=
      '<div class="panel" style="margin-bottom:16px;"><div class="panel-header"><div class="panel-title">Current plan</div></div>'+
      '<div class="panel-body">'+
        '<div class="empty-state" style="padding:28px 0 8px;">'+
          '<h4>No active subscription</h4>'+
          '<p>No Stripe customer or subscription is associated with this organisation. Choose a plan to start billing.</p>'+
          '<button type="button" class="btn-topbar btn-topbar-primary" onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing()">View plans</button>'+
        '</div>'+
      '</div></div>';
    return;
  }

  var pm=overview&&overview.paymentMethod;
  var pmHtml;
  if(pm&&pm.last4){
    var exp=(pm.expMonth&&pm.expYear)?'Expires '+billingPad2(pm.expMonth)+'/'+String(pm.expYear).slice(-2):'';
    pmHtml='<div class="meta-grid">'+
      '<div class="meta-item"><label>Payment method</label><span>'+esc(pm.brand||'Card')+' •••• '+esc(pm.last4)+'</span></div>'+
      (exp?'<div class="meta-item"><label>Expiry</label><span>'+esc(exp)+'</span></div>':'')+
      '</div>'+
      '<p class="users-copy" style="margin-top:14px;">Card details are stored by Stripe. Update them from billing settings — RegAnchor does not collect or store payment cards.</p>';
  }else{
    pmHtml='<p class="users-copy">No payment method is on file yet. Add or update one in Stripe billing settings.</p>';
  }

  var invoices=(overview&&overview.invoices)||[];
  var invBody;
  if(!invoices.length){
    invBody='<div class="empty-state" style="padding:28px 20px;"><p>No invoices yet. Full history is available in Stripe billing settings.</p></div>';
  }else{
    invBody='<div class="table-scroll"><table class="sys-table billing-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th></th></tr></thead><tbody>'+
      invoices.map(function(inv){
        var action=inv.url
          ?'<a class="btn-topbar btn-topbar-ghost btn-sm" href="'+esc(inv.url)+'" target="_blank" rel="noopener noreferrer">Invoice</a>'
          :'<span class="state-label">—</span>';
        return '<tr><td>'+esc(fmtDate(inv.date))+'</td><td>'+esc(inv.description||'RegAnchor subscription')+'</td><td>'+esc(inv.amount||'—')+'</td><td class="billing-table__act">'+action+'</td></tr>';
      }).join('')+
      '</tbody></table></div>';
  }

  var manage=billingManageButtons(hasCustomer);
  wrap.innerHTML=
    '<div class="panel" style="margin-bottom:16px;"><div class="panel-header"><div class="panel-title">Current plan</div><div class="panel-sub"><span class="state-label billing-status '+st.cls+'">'+esc(st.label)+'</span></div></div>'+
    '<div class="panel-body">'+
      '<div class="meta-grid">'+
        '<div class="meta-item"><label>Current plan</label><span>'+esc(planLabel||'Not set')+'</span></div>'+
        '<div class="meta-item"><label>Price</label><span>'+esc(amountLine)+'</span></div>'+
        '<div class="meta-item"><label>Subscription status</label><span class="state-label billing-status '+st.cls+'">'+esc(st.label)+'</span></div>'+
        '<div class="meta-item"><label>Billing interval</label><span>'+esc(intervalLabel)+'</span></div>'+
        (periodEnd?'<div class="meta-item"><label>Next payment</label><span>'+esc(fmtDate(periodEnd))+'</span></div>':'')+
      '</div>'+
      (nextCopy?'<p class="users-copy" style="margin-top:16px;">'+esc(nextCopy)+'</p>':'')+
      '<div class="billing-actions">'+manage+'</div>'+
      '<p class="field-error billing-inline-error" id="billing-portal-error" hidden></p>'+
    '</div></div>'+

    '<div class="panel" style="margin-bottom:16px;"><div class="panel-header"><div class="panel-title">Payment method</div></div>'+
    '<div class="panel-body">'+pmHtml+
      (hasCustomer&&canManageBilling()
        ?'<div class="billing-actions"><button type="button" class="btn-topbar btn-topbar-ghost" data-billing-portal onclick="openStripeBillingPortal(this)">Update payment method</button></div>'
        :'')+
    '</div></div>'+

    '<div class="panel panel--table" style="margin-bottom:16px;"><div class="panel-header"><div class="panel-title">Billing history</div><div class="panel-sub">Recent invoices</div></div>'+
    invBody+
    (hasCustomer&&canManageBilling()
      ?'<div class="panel-body" style="border-top:1px solid var(--ra-border);"><button type="button" class="btn-topbar btn-topbar-ghost" data-billing-portal onclick="openStripeBillingPortal(this)">View all invoices</button></div>'
      :'')+
    '</div>'+

    '<div class="callout"><div class="callout__body"><div class="callout__title">Need to change your plan?</div><div class="callout__desc">Upgrade, downgrade or cancel your subscription from your billing settings.</div></div><div class="callout__actions">'+
      (hasCustomer&&canManageBilling()
        ?'<button type="button" class="btn-topbar btn-topbar-ghost" data-billing-portal onclick="openStripeBillingPortal(this)">Manage subscription</button>'
        :'<button type="button" class="btn-topbar btn-topbar-ghost" onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing()">View plans</button>')+
    '</div></div>';
}
