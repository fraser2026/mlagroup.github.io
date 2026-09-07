/* RegAnchor organisation usage and provider connection monitoring. */
let analyticsRenderToken=0;

function fmtAnalyticsTokens(value){
  var n=Number(value||0);
  if(!Number.isFinite(n))n=0;
  return n.toLocaleString('en-GB');
}

function fmtAnalyticsEstimate(value){
  if(value==null||value==='')return '';
  var n=Number(value);
  if(!Number.isFinite(n))return '';
  return '$'+n.toLocaleString('en-GB',{minimumFractionDigits:n<0.01?4:2,maximumFractionDigits:n<0.01?4:2});
}

function analyticsProviderName(slug){
  return typeof providerCatalogName==='function'?providerCatalogName(slug):(slug||'Not set');
}

function analyticsConnectionState(connection,hasAdmin){
  if(!connection||!connection.credential_secret_id||connection.status==='revoked'){
    return {key:'none',label:'Not connected'};
  }
  if(connection.status==='error'){
    return {key:'error',label:'Error'};
  }
  if(!hasAdmin){
    return {key:'missing-admin',label:'Missing admin'};
  }
  if(connection.status==='connected'){
    return {key:'connected',label:'Connected'};
  }
  return {key:'pending',label:'Pending'};
}

async function renderAnalyticsPage(){
  var root=document.getElementById('analytics-page');
  if(!root)return;
  var renderToken=++analyticsRenderToken;
  root.innerHTML='<div class="loading-state">Loading usage monitoring…</div>';

  try{
    if(!currentOrg)await ensureOrg();
    if(!currentOrg)throw new Error('Organisation is not available.');

    var responses=await Promise.all([
      sb.from('asset_usage_snapshots').select('asset_id,provider_slug,window_days,scope,total_tokens,org_cost_usd,estimated_asset_usd,refreshed_at').eq('org_id',currentOrg.id).order('refreshed_at',{ascending:false}),
      sb.from('provider_connections').select('id,asset_id,provider_slug,status,credential_secret_id,admin_credential_secret_id,last_verified_at,last_error,admin_last_verified_at,admin_last_error').eq('org_id',currentOrg.id).neq('status','revoked'),
      sb.from('org_provider_credentials').select('provider_slug,status,admin_credential_secret_id,last_verified_at,last_error').eq('org_id',currentOrg.id).neq('status','revoked')
    ]);
    if(renderToken!==analyticsRenderToken)return;
    var failure=responses.find(function(result){return result.error});
    if(failure)throw new Error(failure.error.message);

    var snapshots=responses[0].data||[];
    var connections=responses[1].data||[];
    var orgCredentials=responses[2].data||[];
    var latestByAsset={};
    snapshots.forEach(function(snapshot){
      if(!latestByAsset[snapshot.asset_id])latestByAsset[snapshot.asset_id]=snapshot;
    });
    var connectionByAsset={};
    connections.forEach(function(connection){
      if(!connectionByAsset[connection.asset_id])connectionByAsset[connection.asset_id]=connection;
    });
    var orgAdminByProvider={};
    orgCredentials.forEach(function(credential){
      if(credential.admin_credential_secret_id)orgAdminByProvider[credential.provider_slug]=credential;
    });

    var connected=0,errorCount=0,missingAdmin=0;
    var rows=(allSystems||[]).map(function(asset){
      var connection=connectionByAsset[asset.id]||null;
      var hasAdmin=!!(
        (connection&&connection.admin_credential_secret_id)||
        orgAdminByProvider[asset.provider_slug]
      );
      var state=analyticsConnectionState(connection,hasAdmin);
      if(state.key==='error')errorCount++;
      else if(state.key==='missing-admin')missingAdmin++;
      else if(state.key==='connected')connected++;
      return {asset:asset,connection:connection,snapshot:latestByAsset[asset.id]||null,state:state};
    });

    var alerts=[];
    if(errorCount){
      alerts.push(errorCount+' runtime connection'+(errorCount===1?' has':'s have')+' an error. Open the affected asset and run a live check.');
    }
    if(missingAdmin){
      alerts.push(missingAdmin+' connected runtime asset'+(missingAdmin===1?' is':'s are')+' missing a Governance Admin key. Add it once under Organisation → Providers.');
    }

    var hasAnySnapshot=snapshots.length>0;
    var html='<div class="analytics-toolbar">'+
      '<p class="analytics-toolbar-copy">Admin API snapshots across your organisation. Claude Console totals can differ by screen and lag. Gateway metering stays on each asset Connection tab.</p>'+
      (typeof canDeleteRegistry==='function'&&canDeleteRegistry()
        ?btnAsyncHtml('Refresh Admin snapshots',{id:'analytics-refresh-btn',onclick:'refreshAnalyticsSnapshots()'})
        :'')+
      '</div>';

    html+='<div class="analytics-summary stats-grid">';
    html+='<div class="stat-card"><div class="stat-label">Connected</div><div class="stat-value">'+connected+'</div><div class="stat-sub">Healthy monitored assets</div></div>';
    html+='<div class="stat-card"><div class="stat-label">Errors</div><div class="stat-value">'+errorCount+'</div><div class="stat-sub">Runtime checks requiring attention</div></div>';
    html+='<div class="stat-card"><div class="stat-label">Missing admin</div><div class="stat-value">'+missingAdmin+'</div><div class="stat-sub">Connected assets without monitoring</div></div>';
    html+='</div>';

    if(alerts.length){
      html+='<div class="notice notice--warn analytics-alert"><div class="notice__label">Connection attention</div><div class="notice__body">'+
        alerts.map(function(note){return '<p>'+esc(note)+'</p>';}).join('')+
        '</div></div>';
    }else if(connected){
      html+='<div class="notice notice--quiet analytics-alert"><div class="notice__label">Connection health</div><div class="notice__body">No provider connection issues need attention.</div></div>';
    }

    if(!hasAnySnapshot){
      html+='<div class="notice notice--warn analytics-alert"><div class="notice__label">No Admin snapshots yet</div><div class="notice__body"><p>Open an Anthropic asset Connection tab and click Refresh, or use Refresh Admin snapshots above. Until then Analytics cannot show Admin token totals.</p></div></div>';
    }

    html+='<div class="panel panel--table analytics-ledger"><div class="panel-header"><div><div class="panel-title">Provider usage by asset</div><div class="panel-sub">Latest Anthropic Admin snapshot per registered asset. Organisation cost is Admin-reported, not per-asset billing. Gateway metering for a single asset is on that asset\'s Connection tab.</div></div></div>';
    if(!rows.length){
      html+='<div class="empty-state"><p>No AI assets are registered yet.</p></div>';
    }else{
      html+='<div class="table-scroll"><table class="sys-table analytics-table"><thead><tr><th>Asset</th><th>Admin tokens</th><th>Org cost</th><th>Connection</th><th>Snapshot</th></tr></thead><tbody>';
      rows.forEach(function(row){
        var asset=row.asset,connection=row.connection,snapshot=row.snapshot;
        var estimate=snapshot&&snapshot.scope==='asset'?fmtAnalyticsEstimate(snapshot.estimated_asset_usd):'';
        var orgCost=snapshot&&snapshot.org_cost_usd!=null?fmtAnalyticsEstimate(snapshot.org_cost_usd):'';
        html+='<tr>';
        html+='<td><button type="button" class="analytics-asset-link" onclick="openSystemDetail(\''+esc(asset.id)+'\')"><span>'+esc(asset.name||'Unnamed asset')+'</span><small>'+esc(analyticsProviderName(asset.provider_slug))+(snapshot?(snapshot.scope==='asset'?' (asset scope)':' (organisation scope)'):'')+'</small></button></td>';
        html+='<td><span class="analytics-token ra-num">'+(snapshot?esc(fmtAnalyticsTokens(snapshot.total_tokens)):'—')+'</span>'+(estimate?'<small class="analytics-estimate">'+esc(estimate)+' estimated asset spend</small>':'')+'</td>';
        html+='<td><span class="analytics-token ra-num">'+(orgCost?esc(orgCost):'—')+'</span>'+(orgCost?'<small class="analytics-row-note">Provider organisation</small>':'')+'</td>';
        html+='<td><span class="analytics-state analytics-state--'+row.state.key+'">'+esc(row.state.label)+'</span>'+(connection&&connection.last_error?'<small class="analytics-row-note">'+esc(connection.last_error)+'</small>':'')+'</td>';
        html+='<td class="col-date">'+(snapshot?esc(fmtDateLong(snapshot.refreshed_at))+'<small class="analytics-row-note">'+esc(String(snapshot.window_days))+' days</small>':'No snapshot')+'</td>';
        html+='</tr>';
      });
      html+='</tbody></table></div>';
    }
    html+='</div>';
    html+='<p class="analytics-footnote">Admin token totals come from the provider Admin API after Refresh on an asset Connection tab or Refresh Admin snapshots here. Organisation cost is not allocated as per-asset billing. Gateway calls for one asset are listed on that asset\'s Connection tab under Gateway usage.</p>';
    root.innerHTML=html;
    if(typeof initAsyncBtns==='function')initAsyncBtns(root);
  }catch(err){
    if(renderToken!==analyticsRenderToken)return;
    root.innerHTML='<div class="notice notice--warn"><div class="notice__label">Analytics unavailable</div><div class="notice__body">'+esc(err&&err.message?err.message:'Could not load usage monitoring.')+'</div></div>';
  }
}

async function refreshAnalyticsSnapshots(){
  if(!currentOrg)await ensureOrg();
  if(!currentOrg)return;
  var btn=document.getElementById('analytics-refresh-btn');
  try{
    if(typeof runAsyncBtn==='function'&&btn){
      await runAsyncBtn(btn,function(){
        return invokeProviderFn('provider-insights-sync',{org_id:currentOrg.id,window_days:30,batch_size:10});
      },{busyLabel:'Refreshing Admin snapshots',successMs:1500,errorMs:2200});
    }else{
      await invokeProviderFn('provider-insights-sync',{org_id:currentOrg.id,window_days:30,batch_size:10});
    }
    await renderAnalyticsPage();
  }catch(err){
    var root=document.getElementById('analytics-page');
    if(root){
      var note=document.createElement('div');
      note.className='notice notice--warn analytics-alert';
      note.innerHTML='<div class="notice__label">Refresh failed</div><div class="notice__body">'+esc(err&&err.message?err.message:'Could not refresh Admin snapshots.')+'</div>';
      root.insertBefore(note,root.firstChild);
    }
  }
}
