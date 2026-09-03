// ═══ REGISTRY: LOAD ═══════════════════════════════════════════
var providerCatalog=[];

async function loadProviderCatalog(){
  try{
    var res=await sb.from('provider_catalog').select('slug,name,logo_path,auth_method,connector_available,docs_url').eq('is_active',true).order('display_order');
    providerCatalog=res.error?[]:(res.data||[]);
  }catch(e){providerCatalog=[]}
}

function providerCatalogRow(slug){
  if(!slug)return null;
  return providerCatalog.find(function(p){return p.slug===slug})||null;
}

function providerConnectorAvailable(slug){
  var row=providerCatalogRow(slug);
  return !!(row&&row.connector_available);
}

function providerCatalogName(slug){
  if(!slug)return '';
  var row=providerCatalog.find(function(p){return p.slug===slug});
  return row?row.name:slug;
}

function populateProviderSelect(selected){
  var sel=document.getElementById('sysmod-platform');
  if(!sel)return;
  var html='<option value="">Select provider</option>';
  providerCatalog.forEach(function(p){
    html+='<option value="'+esc(p.slug)+'"'+(selected===p.slug?' selected':'')+'>'+esc(p.name)+'</option>';
  });
  sel.innerHTML=html;
}

function populateModelSelect(platformSlug,selected){
  var sel=document.getElementById('sysmod-model');
  if(!sel)return;
  var html='<option value="">Select model</option>';
  var models=(window.RA_ASSET_TECH&&RA_ASSET_TECH.modelsForPlatform)?RA_ASSET_TECH.modelsForPlatform(platformSlug):[];
  models.forEach(function(m){
    html+='<option value="'+esc(m.id)+'"'+(selected===m.id?' selected':'')+'>'+esc(m.label)+'</option>';
  });
  sel.innerHTML=html;
  sel.disabled=!platformSlug;
}

function onAssetPlatformChange(){
  var platform=document.getElementById('sysmod-platform').value;
  populateModelSelect(platform,'');
  updateAssetNotesRequirement();
}

function assetNotesRequired(){
  var platform=document.getElementById('sysmod-platform').value;
  var model=document.getElementById('sysmod-model').value;
  if(window.RA_ASSET_TECH&&RA_ASSET_TECH.notesRequired)return RA_ASSET_TECH.notesRequired(platform,model);
  return platform==='other'||model==='other';
}

function updateAssetNotesRequirement(){
  var req=document.getElementById('sysmod-notes-req');
  if(!req)return;
  req.style.display=assetNotesRequired()?'inline':'none';
}

function modelDisplayName(platformSlug,modelId){
  if(!modelId)return '';
  if(window.RA_ASSET_TECH&&RA_ASSET_TECH.modelLabel)return RA_ASSET_TECH.modelLabel(platformSlug,modelId);
  return modelId;
}

function deriveAssetSystemType(platformSlug,vendor){
  if(window.RA_ASSET_TECH&&RA_ASSET_TECH.deriveSystemType)return RA_ASSET_TECH.deriveSystemType(platformSlug,vendor);
  if(platformSlug==='in_house')return 'in_house';
  if(vendor)return 'third_party';
  return 'in_house';
}

function registrySystemsBaseList(){
  var list=allSystems;
  if(regFilter!=='all'){
    list=list.filter(function(s){return s.deployment_status===regFilter});
  }
  return list;
}

async function loadSystems(){
  if(!currentOrg)return;
  var results=await Promise.all([
    sb.from('ai_systems').select('*,system_compliance(id,status)').eq('org_id',currentOrg.id).is('deleted_at',null).order('updated_at',{ascending:false}),
    /* Latest assessment first — requested_at is the user-facing timeline;
       created_at is a fallback when requested_at is null. */
    sb.from('registry_assessments').select('system_id,overall_score,requested_at,created_at')
      .eq('org_id',currentOrg.id)
      .order('requested_at',{ascending:false})
      .order('created_at',{ascending:false}),
    sb.from('control_assignments').select('system_id,status').eq('org_id',currentOrg.id)
  ]);
  allSystems=results[0].error?[]:(results[0].data||[]);
  var assessments=results[1].data||[];
  if(results[1].error)assessments=[];
  assessments.sort(function(a,b){
    var ta=new Date(a.requested_at||a.created_at||0).getTime();
    var tb=new Date(b.requested_at||b.created_at||0).getTime();
    return tb-ta;
  });
  var assignments=results[2].data||[];
  if(results[2].error)assignments=[];
  var assessBySystem={};
  for(var a=0;a<assessments.length;a++){
    var as=assessments[a];
    if(!as.system_id)continue;
    /* First row per system is latest after sort. Keep first wins. */
    if(Object.prototype.hasOwnProperty.call(assessBySystem,as.system_id))continue;
    var raw=as.overall_score;
    assessBySystem[as.system_id]=(raw===null||raw===undefined||raw==='')?null:Number(raw);
  }
  var assignBySystem={};
  for(var c=0;c<assignments.length;c++){
    var ca=assignments[c];
    if(!ca.system_id)continue;
    if(!assignBySystem[ca.system_id])assignBySystem[ca.system_id]={total:0,done:0};
    assignBySystem[ca.system_id].total++;
    if(ca.status==='implemented'||ca.status==='verified')assignBySystem[ca.system_id].done++;
  }
  for(var s=0;s<allSystems.length;s++){
    var sid=allSystems[s].id;
    allSystems[s]._assessScore=Object.prototype.hasOwnProperty.call(assessBySystem,sid)?assessBySystem[sid]:null;
    var ca2=assignBySystem[sid];
    allSystems[s]._ctrlPct=(ca2&&ca2.total>0)?Math.round(ca2.done/ca2.total*100):null;
  }
  renderRegistryStats();
  renderSystemTable();
  var dashCount=document.getElementById('dash-sys-count');
  if(dashCount)dashCount.textContent=allSystems.length||'0';
}

/* Maturity column = latest assessment score (RGA-002 L1–L7 ladder).
   Do not blend with controls/policies here — incomplete weights were
   silently half-scoring assessed systems (e.g. 84 → 42) whenever
   policies had not loaded, and re-ordering load timing flipped the
   ladder on refresh. Control coverage lives only on the top-line stat. */
function systemMaturityScore(sys){
  if(!sys)return null;
  var a=sys._assessScore;
  if(a===null||a===undefined||a==='')return null;
  var n=Number(a);
  return isNaN(n)?null:n;
}

/* Optional blended posture for other surfaces. Renormalises weights
   so missing signals never zero-out the ones present. */
function getCP(sys){
  var aScore=systemMaturityScore(sys);
  var cPct=(sys._ctrlPct!==null&&sys._ctrlPct!==undefined)?sys._ctrlPct:null;
  var pPct=null;
  if(allPolicies.length){
    var pubPols=allPolicies.filter(function(p){return p.requires_acknowledgment&&p.published_at});
    if(pubPols.length){
      var acked=pubPols.filter(function(p){
        return allAcknowledgments.find(function(a){return a.policy_id===p.id&&a.version_acknowledged===p.version});
      }).length;
      pPct=Math.round(acked/pubPols.length*100);
    }
  }
  if(aScore===null&&cPct===null&&pPct===null){
    var sc=sys.system_compliance||[];
    if(sc.length)return Math.round(sc.filter(function(c){return c.status==='compliant'||c.status==='not_applicable'}).length/sc.length*100);
    return null;
  }
  var parts=[];
  if(aScore!==null)parts.push({v:aScore,w:0.5});
  if(cPct!==null)parts.push({v:cPct,w:0.35});
  if(pPct!==null)parts.push({v:pPct,w:0.15});
  var wSum=0;
  for(var i=0;i<parts.length;i++)wSum+=parts[i].w;
  if(wSum<=0)return null;
  var blended=0;
  for(var j=0;j<parts.length;j++)blended+=parts[j].v*(parts[j].w/wSum);
  return Math.round(blended);
}

function renderRegistryStats(){
  var totalEl=document.getElementById('reg-total');
  if(!totalEl)return;
  var total=allSystems.length;
  totalEl.textContent=total;

  /* ── Total Systems: +N this month (centered next to the number) ── */
  var now=new Date();
  var thisMonthCount=allSystems.filter(function(s){
    if(!s.created_at)return false;
    var d=new Date(s.created_at);
    return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();
  }).length;
  var agentCount=allSystems.filter(function(s){return(s.asset_kind||'system')==='agent'}).length;
  var totalMeta=document.getElementById('reg-total-meta');
  if(totalMeta){
    if(agentCount>0)totalMeta.textContent=agentCount+' agent'+(agentCount!==1?'s':'');
    else totalMeta.textContent=thisMonthCount>0?('+'+thisMonthCount+' this month'):'';
  }

  /* ── High Risk ── */
  var highCount=allSystems.filter(function(s){return s.risk_tier==='high'||s.risk_tier==='unacceptable';}).length;
  document.getElementById('reg-high').textContent=highCount;

  /* ── In Production ── */
  var prodCount=allSystems.filter(function(s){return s.deployment_status==='production';}).length;
  document.getElementById('reg-prod').textContent=prodCount;

  /* ── Maturity: same type stack as the other three ── */
  var covEl=document.getElementById('reg-compliance');
  var covSub=document.getElementById('reg-compliance-sub');
  if(covEl&&allControls.length&&typeof getGovScore==='function'){
    var g=getGovScore();
    var score=Math.max(0,Math.min(100,Number(g.score)||0));
    covEl.textContent=score+'%';
    if(covSub){
      var lvl=typeof raLevel==='function'?raLevel(score):null;
      covSub.textContent=lvl?lvl.code+' '+lvl.label:'Control coverage';
    }
  }else if(covEl){
    covEl.textContent='—';
    if(covSub)covSub.textContent='Control coverage';
  }
}
function visibleRegistrySystems(){
  var list=registrySystemsBaseList();
  var q=(regSearchQuery||'').trim().toLowerCase();
  if(!q)return list;
  return list.filter(function(s){
    var name=(s.name||'').toLowerCase();
    var tier=(TIER_LABELS[s.risk_tier]||'Unclassified').toLowerCase();
    var status=(STATUS_LABELS[s.deployment_status]||s.deployment_status||'').toLowerCase();
    var kind=(ASSET_KIND_LABELS[s.asset_kind||'system']||'').toLowerCase();
    return name.indexOf(q)!==-1||tier.indexOf(q)!==-1||status.indexOf(q)!==-1||kind.indexOf(q)!==-1;
  });
}
function pruneRegSelected(){
  var live={};
  allSystems.forEach(function(s){if(regSelected[s.id])live[s.id]=true});
  regSelected=live;
}
function selectedRegistrySystems(){
  return allSystems.filter(function(s){return regSelected[s.id]});
}
function syncRegBulkChrome(){
  var n=selectedRegistrySystems().length;
  var btn=document.getElementById('reg-bulk-btn');
  var meta=document.getElementById('reg-bulk-meta');
  var menu=document.getElementById('reg-bulk-menu');
  var label=document.getElementById('reg-bulk-label');
  if(label)label.textContent=n?'Bulk actions ('+n+')':'Bulk actions';
  if(meta)meta.textContent=n?(n+' selected'):'Select systems in the table';
  if(menu){
    menu.querySelectorAll('[data-bulk]').forEach(function(el){
      el.classList.toggle('is-disabled',!n);
    });
    // Update retire panel text if it's currently visible
    var retirePanel=menu.querySelector('[data-panel="retire"]:not([hidden])');
    if(retirePanel){
      var copy=retirePanel.querySelector('.reg-retire-copy');
      if(copy){
        if(n===1)copy.textContent='Decommission 1 system? This sets its deployment status to Decommissioned.';
        else copy.textContent='Decommission '+n+' systems? This sets their deployment status to Decommissioned.';
      }
    }
  }
  var all=document.getElementById('reg-select-all');
  if(all){
    var vis=visibleRegistrySystems();
    var visSel=vis.filter(function(s){return regSelected[s.id]}).length;
    all.checked=vis.length>0&&visSel===vis.length;
    all.indeterminate=visSel>0&&visSel<vis.length;
  }
}
function setRegSearch(q){
  regSearchQuery=q||'';
  applyRegistrySearch();
  syncRegBulkChrome();
}
function systemSearchHaystack(sys){
  return ((sys.name||'')+' '+(ASSET_KIND_LABELS[sys.asset_kind||'system']||'')+' '+(TIER_LABELS[sys.risk_tier]||'Unclassified')+' '+(STATUS_LABELS[sys.deployment_status]||sys.deployment_status||'')).toLowerCase();
}
function applyRegistrySearch(){
  var wrap=document.getElementById('reg-table-wrap');
  if(!wrap)return;
  var rows=wrap.querySelectorAll('tbody tr');
  if(!rows.length)return;
  var q=(regSearchQuery||'').trim().toLowerCase();
  var shown=0;
  rows.forEach(function(tr){
    var hit=!q||(tr.getAttribute('data-haystack')||'').indexOf(q)!==-1;
    tr.hidden=!hit;
    if(hit)shown++;
  });
  var scroll=wrap.querySelector('.table-scroll');
  var empty=document.getElementById('reg-search-empty');
  if(scroll)scroll.hidden=!!q&&shown===0;
  if(empty)empty.hidden=!(q&&shown===0);
}
function onRegCheckCell(ev,id){
  ev.stopPropagation();
  var input=ev.currentTarget.querySelector('.sys-check');
  if(!input)return;
  input.checked=!input.checked;
  toggleRegSelect(id,input.checked);
}
function toggleRegSelect(id,on){
  if(on)regSelected[id]=true;else delete regSelected[id];
  syncRegBulkChrome();
}
function onRegRowClick(ev,id){
  if(ev.target.closest('.reg-row-more,.col-more,#reg-row-menu'))return;
  if(regSelectMode){
    ev.preventDefault();
    ev.stopPropagation();
    var row=ev.currentTarget;
    var input=row&&row.querySelector('.sys-check');
    if(!input)return;
    input.checked=!input.checked;
    toggleRegSelect(id,input.checked);
    return;
  }
  openSystemDetail(id);
}
function toggleRegSelectAll(on){
  visibleRegistrySystems().forEach(function(s){
    if(on)regSelected[s.id]=true;else delete regSelected[s.id];
  });
  document.querySelectorAll('#reg-table-wrap tbody tr:not([hidden]) .sys-check').forEach(function(el){el.checked=!!on});
  syncRegBulkChrome();
}
function onRegCheckAll(ev){
  ev.stopPropagation();
  var input=document.getElementById('reg-select-all');
  if(!input)return;
  input.checked=!input.checked;
  toggleRegSelectAll(input.checked);
}
function closeRegBulk(){
  var menu=document.getElementById('reg-bulk-menu');
  var btn=document.getElementById('reg-bulk-btn');
  if(menu)menu.hidden=true;
  if(btn)btn.setAttribute('aria-expanded','false');
}
function openRegBulkMenu(){
  closeRegRowMenu();
  var menu=document.getElementById('reg-bulk-menu');
  var btn=document.getElementById('reg-bulk-btn');
  if(menu){
    resetRegMenuPanel(menu);
    menu.hidden=false;
  }
  if(btn)btn.setAttribute('aria-expanded','true');
  syncRegBulkChrome();
}
function setRegSelectMode(on){
  regSelectMode=!!on;
  if(!regSelectMode){
    regSelected={};
    closeRegBulk();
    document.querySelectorAll('#reg-table-wrap .sys-check, #reg-select-all').forEach(function(el){
      el.checked=false;
      el.indeterminate=false;
    });
  }
  var table=document.querySelector('#reg-table-wrap .sys-table');
  if(table)table.classList.toggle('is-selecting',regSelectMode);
  var btn=document.getElementById('reg-bulk-btn');
  if(btn)btn.setAttribute('aria-pressed',regSelectMode?'true':'false');
  syncRegBulkChrome();
}
function toggleRegBulk(ev){
  if(ev)ev.stopPropagation();
  if(!regSelectMode){
    setRegSelectMode(true);
    openRegBulkMenu();
    return;
  }
  setRegSelectMode(false);
}
function csvCell(v){
  if(v===null||v===undefined)return '';
  var s=String(v);
  if(/[",\n\r]/.test(s))return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
function csvPurpose(p){
  return p?String(p).replace(/_/g,' '):'';
}
function csvSectionScores(ss){
  if(!ss||typeof ss!=='object')return '';
  return Object.keys(ss).map(function(k){
    var v=ss[k];
    if(v&&typeof v==='object')return (v.title||k)+': '+(v.score==null?'':v.score);
    return k+': '+(v==null?'':v);
  }).join('; ');
}
function csvCtrlStatus(st){
  var map=(typeof CTRL_STATUS_L==='object'&&CTRL_STATUS_L)||{not_started:'Not Started',in_progress:'In Progress',implemented:'Implemented',verified:'Verified'};
  return map[st]||st||'';
}
function downloadCsv(filename,lines){
  var blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportFilename(rows){
  if(rows.length===1){
    var slug=String(rows[0].name||'system').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
    return 'reganchor-'+(slug||'system')+'.csv';
  }
  return 'reganchor-register.csv';
}

/* Register extract. Columns are derived from whatever is on the
   system row and related records, so new registry-detail fields
   (integrations, API keys, …) appear without rewriting this list.

   To attach another related table later, push onto REG_EXPORT_RELATIONS. */
var REG_EXPORT_SKIP={
  org_id:true,created_by:true,risk_tier_set_by:true,system_compliance:true,
  _assessScore:true,_ctrlPct:true
};
var REG_EXPORT_SYS_ORDER=['id','name','asset_kind','provider_slug','model_name','description','vendor','system_type','department','system_owner','notes','purpose_category','risk_tier','risk_tier_rationale','deployment_status','created_at','updated_at'];
var REG_EXPORT_ASSESS_SKIP={id:true,org_id:true,system_id:true,answers:true};
var REG_EXPORT_LABELS={
  id:'System ID',name:'System name',asset_kind:'Asset type',provider_slug:'Provider',model_name:'Model',description:'Description',vendor:'Vendor',
  system_type:'System type',department:'Department',system_owner:'System owner',
  notes:'Notes',purpose_category:'Purpose category',risk_tier:'Risk class',
  risk_tier_rationale:'Classification rationale',deployment_status:'Deployment status',
  created_at:'Registered',updated_at:'Last updated',
  status:'Assessment status',risk_band:'Assessment band',requested_at:'Assessment date',
  sector:'Assessment sector',questionnaire_version:'Questionnaire version',
  client_notes:'Assessment notes',mla_notes:'Review notes',completed_at:'Review completed',
  section_scores:'Domain scores',tier_validation:'Tier validation'
};
var REG_EXPORT_RELATIONS=[
  {table:'system_integrations',fk:'system_id',label:'Integrations',mode:'list'},
  {table:'system_api_keys',fk:'system_id',label:'API keys',mode:'list'}
];
function exportLabel(key,prefix){
  var base=REG_EXPORT_LABELS[key]||String(key).replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase()});
  return prefix?prefix+base:base;
}
function exportOrderedKeys(keys,preferred){
  var out=[],seen={};
  (preferred||[]).forEach(function(k){if(keys.indexOf(k)!==-1){out.push(k);seen[k]=true}});
  keys.forEach(function(k){if(!seen[k])out.push(k)});
  return out;
}
function exportCollectKeys(records,skip){
  var keys=[],seen={};
  (records||[]).forEach(function(r){
    if(!r)return;
    Object.keys(r).forEach(function(k){
      if(skip[k]||k.charAt(0)==='_'||seen[k])return;
      seen[k]=true;
      keys.push(k);
    });
  });
  return keys;
}
function exportFormatValue(key,val){
  if(val===null||val===undefined||val==='')return '';
  if(key==='risk_tier')return TIER_LABELS[val]||val;
  if(key==='deployment_status')return STATUS_LABELS[val]||val;
  if(key==='system_type')return TYPE_LABELS[val]||val;
  if(key==='asset_kind')return ASSET_KIND_LABELS[val]||val;
  if(key==='provider_slug')return providerCatalogName(val)||val;
  if(key==='model_name')return val||'';
  if(key==='purpose_category')return csvPurpose(val);
  if(key==='status'&&ASSESS_STATUS_LABELS[val])return ASSESS_STATUS_LABELS[val];
  if(key==='risk_band')return ({high:'High Risk',medium:'Medium Risk',low:'Low Risk'})[val]||val;
  if(key==='section_scores')return csvSectionScores(val);
  if(key==='tier_validation')return val&&val.mismatch?(val.message||'Risk tier mismatch'):'';
  if(/_at$/.test(key)||key==='created_at'||key==='updated_at')return key==='requested_at'||key==='completed_at'?fmtDateLong(val):fmtDate(val);
  if(typeof val==='object'){
    try{return JSON.stringify(val)}catch(e){return ''}
  }
  return val;
}
function exportSummariseRows(list){
  return (list||[]).map(function(r){
    var name=r.name||r.title||r.provider||r.key_name||r.label||r.id;
    var extra=r.status||r.env||r.environment||'';
    return extra?name+' ('+extra+')':String(name);
  }).join('; ');
}
async function exportFetchRelation(rel,ids){
  try{
    var res=await sb.from(rel.table).select('*').in(rel.fk,ids);
    if(res.error)return {};
    var by={};
    (res.data||[]).forEach(function(row){
      var sid=row[rel.fk];
      if(!sid)return;
      if(!by[sid])by[sid]=[];
      by[sid].push(row);
    });
    return by;
  }catch(e){return {}}
}
async function exportRegistrySystems(rows){
  if(!rows||!rows.length)return;
  if(typeof loadControls==='function'&&!allControls.length)await loadControls();
  var ids=rows.map(function(s){return s.id});
  var liveRows=rows;
  var assessBySystem={};
  var assignRows=[];
  var extraByTable={};
  try{
    var packed=await Promise.all([
      sb.from('ai_systems').select('*').in('id',ids),
      sb.from('registry_assessments').select('*').eq('org_id',currentOrg.id).in('system_id',ids).order('requested_at',{ascending:false}),
      sb.from('control_assignments').select('*').eq('org_id',currentOrg.id)
    ].concat(REG_EXPORT_RELATIONS.map(function(rel){return exportFetchRelation(rel,ids)})));
    if(packed[0].data&&packed[0].data.length){
      var liveMap={};
      packed[0].data.forEach(function(r){liveMap[r.id]=r});
      liveRows=ids.map(function(id){
        var cached=rows.find(function(s){return s.id===id})||{};
        var merged=Object.assign({},cached,liveMap[id]||{});
        merged._assessScore=cached._assessScore;
        merged._ctrlPct=cached._ctrlPct;
        return merged;
      });
    }
    (packed[1].data||[]).forEach(function(a){
      if(!a.system_id||assessBySystem[a.system_id])return;
      assessBySystem[a.system_id]=a;
    });
    assignRows=packed[2].data||[];
    REG_EXPORT_RELATIONS.forEach(function(rel,i){extraByTable[rel.table]=packed[3+i]||{}});
  }catch(err){}

  var sysKeys=exportOrderedKeys(exportCollectKeys(liveRows,REG_EXPORT_SKIP),REG_EXPORT_SYS_ORDER);
  var assessKeys=exportOrderedKeys(exportCollectKeys(Object.keys(assessBySystem).map(function(id){return assessBySystem[id]}),REG_EXPORT_ASSESS_SKIP),['status','risk_band','requested_at','sector','questionnaire_version','client_notes','mla_notes','completed_at','section_scores','tier_validation']);
  var headers=sysKeys.map(function(k){return exportLabel(k)}).concat(
    ['Maturity score','Maturity level']
  ).concat(assessKeys.map(function(k){return exportLabel(k)})).concat(
    ['Controls assigned','Controls implemented','Control coverage','Controls']
  ).concat(REG_EXPORT_RELATIONS.map(function(rel){return rel.label}));

  var lines=[headers.map(csvCell).join(',')];
  liveRows.forEach(function(sys){
    var score=systemMaturityScore(sys);
    var lvl=typeof raLevel==='function'?raLevel(score):null;
    var latest=assessBySystem[sys.id]||null;
    var sysAssign=assignRows.filter(function(a){return a.system_id===sys.id});
    if(latest){
      assignRows.forEach(function(a){if(!a.system_id)sysAssign.push(a)});
    }
    var done=sysAssign.filter(function(a){return a.status==='implemented'||a.status==='verified'}).length;
    var total=sysAssign.length;
    var ctrlList=sysAssign.map(function(a){
      var c=(typeof allControls!=='undefined'?allControls:[]).find(function(x){return x.id===a.control_id});
      var num=c&&c.control_number!=null?'C'+c.control_number+' ':'';
      var title=c?c.title:(a.control_id||'Control');
      return num+title+' ('+csvCtrlStatus(a.status)+')';
    }).join('; ');
    var cells=sysKeys.map(function(k){return csvCell(exportFormatValue(k,sys[k]))});
    cells.push(csvCell(lvl?Math.round(Number(score)):''),csvCell(lvl?lvl.code+' '+lvl.label:'Not assessed'));
    assessKeys.forEach(function(k){cells.push(csvCell(latest?exportFormatValue(k,latest[k]):''))});
    cells.push(csvCell(total),csvCell(done),csvCell(total?Math.round(done/total*100)+'%':''),csvCell(ctrlList));
    REG_EXPORT_RELATIONS.forEach(function(rel){
      var by=extraByTable[rel.table]||{};
      cells.push(csvCell(exportSummariseRows(by[sys.id]||[])));
    });
    lines.push(cells.join(','));
  });
  downloadCsv(exportFilename(rows),lines);
}
async function exportSelectedSystems(){
  await exportRegistrySystems(selectedRegistrySystems());
  closeRegBulk();
}
function closeRegRowMenu(){
  var menu=document.getElementById('reg-row-menu');
  if(menu)menu.hidden=true;
  document.querySelectorAll('.reg-row-more[aria-expanded="true"]').forEach(function(b){
    b.setAttribute('aria-expanded','false');
  });
  regRowMenuId=null;
}
function positionRegRowMenu(btn){
  var menu=document.getElementById('reg-row-menu');
  if(!menu||!btn)return;
  menu.hidden=false;
  var r=btn.getBoundingClientRect();
  var margin=12;
  var mw=Math.min(menu.offsetWidth||220,window.innerWidth-margin*2);
  var mh=menu.offsetHeight;
  var top=r.bottom+4;
  if(top+mh>window.innerHeight-margin)top=Math.max(margin,r.top-mh-4);
  var left=r.right-mw;
  if(left+mw>window.innerWidth-margin)left=window.innerWidth-margin-mw;
  if(left<margin)left=margin;
  menu.style.top=top+'px';
  menu.style.left=left+'px';
  menu.style.right='auto';
  menu.style.maxWidth=(window.innerWidth-margin*2)+'px';
}
function toggleRegRowMenu(ev,id){
  if(ev)ev.stopPropagation();
  var btn=ev&&ev.currentTarget;
  if(regRowMenuId===id){
    closeRegRowMenu();
    return;
  }
  closeRegRowMenu();
  closeRegBulk();
  regRowMenuId=id;
  if(btn)btn.setAttribute('aria-expanded','true');
  var menu=document.getElementById('reg-row-menu');
  if(menu){
    resetRegMenuPanel(menu);
    var deleteBtn=menu.querySelector('[data-row-action="delete"]');
    if(deleteBtn)deleteBtn.hidden=!(typeof canDeleteRegistry==='function'&&canDeleteRegistry());
  }
  positionRegRowMenu(btn);
}
function requestSystemAssessment(sysId){
  var sys=allSystems.find(function(s){return s.id===sysId});
  requestRegistryAssessments(sys?[sys]:[]);
}
function openQueuedAssessment(sysId){
  if(!sysId)return;
  if(typeof rememberPortalReturn==='function')rememberPortalReturn();
  currentSystemId=sysId;
  window.location.href='assessment.html?system_id='+encodeURIComponent(sysId);
}
async function requestRegistryAssessments(systems){
  if(!systems||!systems.length||!currentOrg||!currentUser)return;
  var existing=await sb.from('registry_audit_log').select('action,entity_id,created_at').eq('org_id',currentOrg.id).in('action',['assessment_requested','assessment_submitted']).in('entity_id',systems.map(function(s){return s.id})).order('created_at',{ascending:false}).limit(200);
  var latest={};
  (existing.data||[]).forEach(function(entry){
    if(!entry.entity_id||latest[entry.entity_id])return;
    latest[entry.entity_id]=entry.action;
  });
  var rows=systems.filter(function(s){return latest[s.id]!=='assessment_requested'}).map(function(s){
    return {
      org_id:currentOrg.id,
      user_id:currentUser.id,
      action:'assessment_requested',
      entity_type:'ai_system',
      entity_id:s.id,
      changes:{_actor_name:actorName(),_system_name:s.name}
    };
  });
  if(rows.length){
    var ins=await sb.from('registry_audit_log').insert(rows);
    if(ins.error){
      finishRegAction();
      return;
    }
  }
  finishRegAction();
  if(typeof renderMyTasks==='function')renderMyTasks();
  showAssessQueuedCard(systems, rows.length);
}
function showAssessQueuedCard(systems, added){
  var modal=document.getElementById('assess-queued-modal');
  var title=document.getElementById('assess-queued-title');
  var copy=document.getElementById('assess-queued-copy');
  if(!modal||!title||!copy)return;
  var n=systems.length;
  var name=n===1&&systems[0]?systems[0].name:'';
  if(added){
    title.textContent='Added to My Tasks';
    copy.textContent=n===1
      ? 'Assessment for '+name+' is on your dashboard under My Tasks.'
      : n+' assessment requests were added to My Tasks.';
  }else{
    title.textContent='Already in My Tasks';
    copy.textContent=n===1
      ? 'Assessment for '+name+' is already on your dashboard under My Tasks.'
      : 'These assessment requests are already in My Tasks.';
  }
  modal.classList.add('open');
}
function closeAssessQueuedCard(){
  var modal=document.getElementById('assess-queued-modal');
  if(modal)modal.classList.remove('open');
}
function openMyTasksFromQueue(){
  closeAssessQueuedCard();
  var nav=document.getElementById('nav-dashboard');
  if(typeof navigate==='function')navigate('dashboard', nav);
  setTimeout(function(){
    var panel=document.getElementById('my-tasks-panel');
    if(panel)panel.scrollIntoView({behavior:'smooth',block:'start'});
  }, 80);
}
function actionTargets(){
  if(regRowMenuId){
    var row=allSystems.find(function(s){return s.id===regRowMenuId});
    return row?[row]:[];
  }
  return selectedRegistrySystems();
}
function visibleRegMenu(){
  var row=document.getElementById('reg-row-menu');
  if(row&&!row.hidden)return row;
  var bulk=document.getElementById('reg-bulk-menu');
  if(bulk&&!bulk.hidden)return bulk;
  return null;
}
function resetRegMenuPanel(menu){
  if(!menu)return;
  menu.querySelectorAll('.reg-menu-panel').forEach(function(p){
    p.hidden=p.getAttribute('data-panel')!=='root';
  });
}
function showRegMenuPanel(name){
  var menu=visibleRegMenu();
  if(!menu)return;
  menu.querySelectorAll('.reg-menu-panel').forEach(function(p){
    p.hidden=p.getAttribute('data-panel')!==name;
  });
  var targets=actionTargets();
  if(name==='owner'){
    var input=menu.querySelector('.reg-owner-input');
    if(input){
      input.value=(targets[0]&&targets[0].system_owner)||'';
      setTimeout(function(){input.focus();input.select()},0);
    }
  }
  if(name==='retire'){
    var copy=menu.querySelector('.reg-retire-copy');
    if(copy){
      if(targets.length===1)copy.textContent='Decommission '+targets[0].name+'? This sets deployment status to Decommissioned.';
      else copy.textContent='Decommission '+targets.length+' systems? This sets their deployment status to Decommissioned.';
    }
  }
  if(name==='delete'){
    prepareRegDeletePanel(menu,targets).then(function(){
      if(menu.id==='reg-row-menu'){
        var more=document.querySelector('.reg-row-more[aria-expanded="true"]');
        if(more)positionRegRowMenu(more);
      }
    });
  }
  if(menu.id==='reg-row-menu'&&name!=='delete'){
    var more=document.querySelector('.reg-row-more[aria-expanded="true"]');
    if(more)positionRegRowMenu(more);
  }
}
function finishRegAction(){
  closeRegBulk();
  closeRegRowMenu();
}
async function applyRegSystemPatch(targets,patch){
  if(!targets.length||!currentOrg)return false;
  var ids=targets.map(function(s){return s.id});
  var result=await sb.from('ai_systems').update(patch).in('id',ids).eq('org_id',currentOrg.id);
  if(result.error)return false;
  var now=new Date().toISOString();
  var logs=targets.map(function(s){
    var changes={_actor_name:actorName(),_system_name:s.name};
    Object.keys(patch).forEach(function(k){
      changes[k]={old:s[k]==null?'':s[k],new:patch[k]};
    });
    return {org_id:currentOrg.id,user_id:currentUser.id,action:'system_updated',entity_type:'ai_system',entity_id:s.id,changes:changes};
  });
  await sb.from('registry_audit_log').insert(logs);
  allSystems.forEach(function(s){
    if(ids.indexOf(s.id)===-1)return;
    Object.assign(s,patch);
    s.updated_at=now;
  });
  renderRegistryStats();
  var dashCount=document.getElementById('dash-sys-count');
  if(dashCount)dashCount.textContent=allSystems.length||'0';
  renderSystemTable({quiet:true});
  var det=document.getElementById('view-registry-detail');
  if(det&&det.classList.contains('active')&&currentSystemId&&ids.indexOf(currentSystemId)!==-1){
    openSystemDetail(currentSystemId);
  }
  return true;
}
async function applyRegStatus(status){
  var targets=actionTargets().filter(function(s){return s.deployment_status!==status});
  finishRegAction();
  if(!targets.length)return;
  await applyRegSystemPatch(targets,{deployment_status:status});
}
async function applyRegOwner(){
  var menu=visibleRegMenu();
  var input=menu&&menu.querySelector('.reg-owner-input');
  var owner=input?input.value.trim():'';
  if(!owner){
    if(input)input.focus();
    return;
  }
  var targets=actionTargets();
  finishRegAction();
  if(!targets.length)return;
  await applyRegSystemPatch(targets,{system_owner:owner});
}
async function applyRegRetire(){
  var targets=actionTargets().filter(function(s){return s.deployment_status!=='decommissioned'});
  finishRegAction();
  if(!targets.length)return;
  await applyRegSystemPatch(targets,{deployment_status:'decommissioned'});
}

var regDeletePreview=null;

function activeRegistrySystemCount(){
  return allSystems.filter(function(s){return !s.deleted_at}).length;
}

async function fetchRegDeletePreview(systemId){
  var result=await sb.rpc('get_registry_asset_delete_preview',{p_system_id:systemId});
  if(result.error)throw new Error(result.error.message);
  return result.data||{};
}

async function prepareRegDeletePanel(menu,targets){
  var copy=menu&&menu.querySelector('.reg-delete-copy');
  var confirmWrap=menu&&menu.querySelector('.reg-delete-confirm-wrap');
  var reasonInput=menu&&menu.querySelector('.reg-delete-reason');
  var nameInput=menu&&menu.querySelector('.reg-delete-name');
  var errEl=menu&&menu.querySelector('.reg-delete-error');
  if(errEl)errEl.textContent='';
  if(reasonInput)reasonInput.value='';
  if(nameInput)nameInput.value='';
  regDeletePreview=null;
  if(!targets||targets.length!==1){
    if(copy)copy.textContent='Delete one asset at a time from the row menu.';
    if(confirmWrap)confirmWrap.style.display='none';
    return;
  }
  try{
    var preview=await fetchRegDeletePreview(targets[0].id);
    if(!preview.ok)throw new Error(preview.error||'Unable to load delete preview.');
    regDeletePreview=preview;
    if(copy){
      if(preview.pending_request){
        copy.textContent='A deletion request for '+preview.system_name+' is already pending RegAnchor review.';
      }else if(preview.requires_review){
        copy.textContent='This asset has governance history. Deletion of '+preview.system_name+' will be submitted to RegAnchor for review.';
      }else{
        copy.textContent='Permanently remove '+preview.system_name+' from your registry. A recoverable archive is kept for 30 days.';
      }
    }
    if(confirmWrap)confirmWrap.style.display=preview.pending_request?'none':'block';
    if(nameInput){
      var nameGroup=nameInput.closest('.field-group');
      if(nameGroup)nameGroup.style.display=preview.requires_review?'none':'block';
      nameInput.placeholder=preview.system_name||'Exact asset name';
    }
  }catch(err){
    if(copy)copy.textContent=err.message||'Unable to load delete preview.';
    if(confirmWrap)confirmWrap.style.display='none';
  }
}

async function applyRegDelete(){
  var targets=actionTargets();
  var menu=visibleRegMenu();
  var errEl=menu&&menu.querySelector('.reg-delete-error');
  if(errEl){errEl.textContent='';errEl.style.display='none';}
  if(!targets.length||targets.length!==1){
    if(errEl){errEl.textContent='Delete one asset at a time.';errEl.style.display='block';}
    return;
  }
  if(typeof canDeleteRegistry==='function'&&!canDeleteRegistry()){
    if(errEl){errEl.textContent='Only organisation owners and admins can delete assets.';errEl.style.display='block';}
    return;
  }
  var reasonInput=menu&&menu.querySelector('.reg-delete-reason');
  var nameInput=menu&&menu.querySelector('.reg-delete-name');
  var reason=reasonInput?reasonInput.value.trim():'';
  var confirmName=nameInput?nameInput.value.trim():'';
  if(!reason){
    if(errEl){errEl.textContent='A reason is required.';errEl.style.display='block';}
    if(reasonInput)reasonInput.focus();
    return;
  }
  var btn=menu&&menu.querySelector('.reg-delete-submit');
  var orig=btn?btn.textContent:'';
  if(btn){btn.textContent='Working…';btn.disabled=true;}
  try{
    var result=await sb.rpc('delete_registry_asset',{
      p_system_id:targets[0].id,
      p_reason:reason,
      p_confirm_name:confirmName||null
    });
    if(result.error)throw new Error(result.error.message);
    var data=result.data||{};
    if(!data.ok)throw new Error(data.error||'Delete failed.');
    finishRegAction();
    if(data.mode==='review_requested'){
      alert('Deletion request submitted. RegAnchor will review before this asset is removed.');
      return;
    }
    await loadSystems();
    if(currentSystemId===targets[0].id){
      currentSystemId=null;
      navigate('registry',document.getElementById('nav-registry'));
    }
  }catch(err){
    if(errEl){errEl.textContent=err.message||'Delete failed.';errEl.style.display='block';}
  }finally{
    if(btn){btn.textContent=orig||'Confirm deletion';btn.disabled=false;}
  }
}

async function restoreDeletedAsset(archiveId){
  if(typeof canDeleteRegistry==='function'&&!canDeleteRegistry())return;
  if(!archiveId)return;
  if(!confirm('Restore this asset to your active registry?'))return;
  var result=await sb.rpc('restore_registry_deleted_asset',{p_archive_id:archiveId});
  if(result.error){alert('Restore failed: '+result.error.message);return;}
  var data=result.data||{};
  if(!data.ok){alert(data.error||'Restore failed.');return;}
  await loadSystems();
  if(data.system_id)openSystemDetail(data.system_id);
}

var sysmodDeletePreview=null;

function resetSysmodRemove(hideZone){
  var zone=document.getElementById('sysmod-remove-zone');
  var panel=document.getElementById('sysmod-remove-panel');
  var toggle=document.getElementById('sysmod-remove-toggle');
  if(zone&&hideZone)zone.hidden=true;
  if(panel)panel.hidden=true;
  if(toggle){toggle.textContent='Remove from registry';toggle.hidden=false;}
  var reason=document.getElementById('sysmod-remove-reason');
  var name=document.getElementById('sysmod-remove-name');
  var err=document.getElementById('sysmod-remove-error');
  if(reason)reason.value='';
  if(name)name.value='';
  if(err){err.textContent='';err.style.display='none';}
  sysmodDeletePreview=null;
}

function showSysmodRemoveZone(show){
  var zone=document.getElementById('sysmod-remove-zone');
  if(zone)zone.hidden=!show;
  resetSysmodRemove(false);
}

function toggleSysmodRemove(){
  var panel=document.getElementById('sysmod-remove-panel');
  var toggle=document.getElementById('sysmod-remove-toggle');
  if(!panel||!toggle)return;
  var open=panel.hidden;
  panel.hidden=!open;
  toggle.textContent=open?'Cancel':'Remove from registry';
  if(open){
    var name=document.getElementById('sysmod-remove-name');
    if(name&&sysmodDeletePreview&&sysmodDeletePreview.system_name)name.placeholder=sysmodDeletePreview.system_name;
  }
}

async function prepareSysmodRemove(systemId){
  var copy=document.getElementById('sysmod-remove-copy');
  var nameWrap=document.getElementById('sysmod-remove-name-wrap');
  var submit=document.getElementById('sysmod-remove-submit');
  var toggle=document.getElementById('sysmod-remove-toggle');
  sysmodDeletePreview=null;
  try{
    var preview=await fetchRegDeletePreview(systemId);
    if(!preview.ok)throw new Error(preview.error||'Unable to load delete preview.');
    sysmodDeletePreview=preview;
    if(copy){
      if(preview.pending_request)copy.textContent='A deletion request is already pending RegAnchor review.';
      else if(preview.requires_review)copy.textContent='This asset has governance history. Deletion will be submitted to RegAnchor for review. A recoverable archive is kept for 30 days after approval.';
      else copy.textContent='Permanently remove this asset from your active registry. A recoverable archive is kept for 30 days.';
    }
    if(nameWrap)nameWrap.style.display=preview.requires_review||preview.pending_request?'none':'block';
    if(submit)submit.disabled=!!preview.pending_request;
    if(toggle)toggle.disabled=!!preview.pending_request;
  }catch(err){
    if(copy)copy.textContent=err.message||'Unable to load remove options.';
    if(submit)submit.disabled=true;
    if(toggle)toggle.disabled=true;
  }
}

async function applySysmodDelete(){
  var systemId=document.getElementById('sysmod-id').value;
  var reasonEl=document.getElementById('sysmod-remove-reason');
  var nameEl=document.getElementById('sysmod-remove-name');
  var errEl=document.getElementById('sysmod-remove-error');
  var btn=document.getElementById('sysmod-remove-submit');
  var reason=reasonEl?reasonEl.value:'';
  var confirmName=nameEl?nameEl.value.trim():'';
  if(errEl){errEl.textContent='';errEl.style.display='none';}
  if(!reason){
    if(errEl){errEl.textContent='Select a reason.';errEl.style.display='block';}
    if(reasonEl)reasonEl.focus();
    return;
  }
  var orig=btn?btn.textContent:'';
  if(btn){btn.textContent='Working…';btn.disabled=true;}
  try{
    var result=await sb.rpc('delete_registry_asset',{
      p_system_id:systemId,
      p_reason:reason,
      p_confirm_name:confirmName||null
    });
    if(result.error)throw new Error(result.error.message);
    var data=result.data||{};
    if(!data.ok)throw new Error(data.error||'Delete failed.');
    closeSystemModal();
    if(data.mode==='review_requested'){
      alert('Deletion request submitted. RegAnchor will review before this asset is removed.');
      if(currentSystemId===systemId)await openSystemDetail(systemId);
      return;
    }
    currentSystemId=null;
    await loadSystems();
    navigate('registry',document.getElementById('nav-registry'));
  }catch(err){
    if(errEl){errEl.textContent=err.message||'Delete failed.';errEl.style.display='block';}
  }finally{
    if(btn){btn.textContent=orig||'Confirm deletion';btn.disabled=false;}
  }
}
function runRegRowAction(action){
  var sys=allSystems.find(function(s){return s.id===regRowMenuId});
  if(!sys){closeRegRowMenu();return}
  if(action==='export'){closeRegRowMenu();exportRegistrySystems([sys]);return}
  if(action==='delete'&&typeof canDeleteRegistry==='function'&&!canDeleteRegistry()){closeRegRowMenu();return}
  if(typeof canWriteRegistry==='function'&&!canWriteRegistry()&&action!=='delete'){closeRegRowMenu();return}
  if(action==='assess'){closeRegRowMenu();requestRegistryAssessments([sys]);return}
  if(action==='status'||action==='owner'||action==='retire'||action==='delete'){showRegMenuPanel(action);return}
}
function runRegBulk(action){
  var selected=selectedRegistrySystems();
  if(!selected.length)return;
  if(action!=='export'&&typeof canWriteRegistry==='function'&&!canWriteRegistry())return;
  if(action==='export'){exportSelectedSystems();return}
  if(action==='assess'){
    requestRegistryAssessments(selected);
    return;
  }
  if(action==='status'||action==='owner'||action==='retire'){showRegMenuPanel(action);return}
  closeRegBulk();
}
function renderSystemTable(opts){
  pruneRegSelected();
  closeRegRowMenu();
  var filtered=registrySystemsBaseList();
  if(!filtered.length){
    var none=allSystems.length===0;
    document.getElementById('reg-table-wrap').innerHTML='<div class="empty-state"><h4>'+(none?'No assets registered yet':'No assets match this filter')+'</h4><p>'+(none?'Register your first AI asset.':'Try a different filter.')+'</p>'+(none?'<button class="btn-dl" onclick="openAddSystem()"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Register first asset</button>':'')+'</div>';
    syncRegBulkChrome();
    return;
  }
  var allOn=filtered.length&&filtered.every(function(s){return regSelected[s.id]});
  document.getElementById('reg-table-wrap').innerHTML='<div class="table-scroll"><table class="sys-table'+(regSelectMode?' is-selecting':'')+'"><thead><tr><th class="col-check" onclick="onRegCheckAll(event)"><input type="checkbox" id="reg-select-all" aria-label="Select all assets"'+(allOn?' checked':'')+' onchange="toggleRegSelectAll(this.checked)"></th><th>Asset</th><th>Kind</th><th>Risk class</th><th>Status</th><th class="col-maturity">Maturity</th><th>Updated</th><th class="col-more" aria-label="Actions"></th></tr></thead><tbody>'+filtered.map(function(sys){
    var tier=sys.risk_tier||'none';
    var kind=sys.asset_kind||'system';
    var score=systemMaturityScore(sys);
    var on=!!regSelected[sys.id];
    return '<tr data-haystack="'+esc(systemSearchHaystack(sys))+'" onclick="onRegRowClick(event,\''+sys.id+'\')">'+
      '<td class="col-check" onclick="onRegCheckCell(event,\''+sys.id+'\')"><input class="sys-check" type="checkbox" aria-label="Select '+esc(sys.name)+'"'+(on?' checked':'')+' onchange="toggleRegSelect(\''+sys.id+'\',this.checked)"></td>'+
      '<td><div class="sys-name">'+esc(sys.name)+'</div><div class="sys-desc">'+esc(sys.description||'')+'</div></td>'+
      '<td><span class="kind-pill kind-'+kind+'">'+(ASSET_KIND_LABELS[kind]||kind)+'</span></td>'+
      '<td><span class="tier-pill tier-'+tier+'">'+(TIER_LABELS[tier]||'Unclassified')+'</span></td>'+
      '<td><span class="status-pill status-'+sys.deployment_status+'">'+(STATUS_LABELS[sys.deployment_status]||sys.deployment_status)+'</span></td>'+
      '<td class="col-maturity">'+regMaturityCell(score,!(opts&&opts.quiet))+'</td>'+
      '<td class="col-date">'+fmtDate(sys.updated_at)+'</td>'+
      '<td class="col-more" onclick="event.stopPropagation()"><button type="button" class="reg-row-more" aria-label="Actions for '+esc(sys.name)+'" aria-haspopup="menu" aria-expanded="false" onclick="toggleRegRowMenu(event,\''+sys.id+'\')"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3.5" r="1.35"/><circle cx="8" cy="8" r="1.35"/><circle cx="8" cy="12.5" r="1.35"/></svg></button></td>'+
    '</tr>';
  }).join('')+'</tbody></table></div><div class="empty-state" id="reg-search-empty" hidden><h4>No assets match this search</h4><p>Try a different name, kind, risk class, or status.</p></div>';
  applyRegistrySearch();
  syncRegBulkChrome();
  if(!(opts&&opts.quiet))requestAnimationFrame(function(){animateMaturity(document.getElementById('reg-table-wrap'))});
}

/* The registry's signature column. A row of these read down the page
   is the whole point — the eye compares bar heights before it reads a
   single number, which is what makes an outlier system findable in a
   registry of forty. Rule 04 still applies, so the level travels with
   the bar rather than the bar standing alone. */
function regMaturityCell(score,animate){
  var lvl=raLevel(score);
  var doAnim=animate!==false;
  if(!lvl)return raComplianceBar(null,{mini:true,animate:doAnim})+'<span class="reg-maturity__none">Not assessed</span>';
  var n=Math.round(Number(score));
  return '<div class="reg-maturity">'+
    raComplianceBar(score,{mini:true,animate:doAnim})+
    '<div><div class="reg-maturity__score ra-num"'+(doAnim?' data-count-to="'+n+'"':'')+'>'+n+'</div>'+
    '<div class="reg-maturity__level">'+lvl.code+' '+lvl.label+'</div></div>'+
  '</div>';
}
function setRegFilter(s,btn){regFilter=s;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderSystemTable()}
 
// ═══ SYSTEM DETAIL ════════════════════════════════════════════
const ASSESS_STATUS_LABELS={submitted:'Awaiting RegAnchor Review',in_review:'Under Review',controls_issued:'Controls Issued'};
const ASSESS_STATUS_COLORS={submitted:'var(--ra-text-3)',in_review:'var(--ra-text-2)',controls_issued:'var(--ra-ok)'};
const Q_LABELS={yes:'Yes',no:'No',unsure:'Unsure'};
const PROVIDER_CONN_STATUS_LABELS={pending:'Not connected',connected:'Connected',error:'Connection error',revoked:'Revoked'};

async function invokeProviderFn(name,body){
  var sd=await sb.auth.getSession();
  var session=sd.data.session;
  if(!session)throw new Error('Sign in required.');
  var res=await fetch(SUPABASE_URL+'/functions/v1/'+name,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':SUPABASE_KEY},
    body:JSON.stringify(body||{})
  });
  var data=await res.json().catch(function(){return {}});
  if(!res.ok){
    var err=new Error(data.error||'Request failed.');
    err.status=res.status;
    throw err;
  }
  return data;
}

function setProviderConnectionError(msg){
  var el=document.getElementById('provider-connection-error');
  if(!el)return;
  if(msg){el.textContent=msg;el.classList.add('is-visible')}
  else{el.textContent='';el.classList.remove('is-visible')}
}

const PROVIDER_GOV_TIER_LABELS={none:'Not connected',verification:'Connected for verification only',full:'Full governance'};
const PROVIDER_ADMIN_DOCS_URL='https://platform.claude.com/docs/en/api/administration-api';

function providerSecretFieldHtml(id,label,placeholder){
  return '<div class="field-group"><label for="'+id+'">'+esc(label)+'</label><div class="field-secret-wrap"><input type="password" id="'+id+'" class="field-input field-secret-input" autocomplete="off" placeholder="'+esc(placeholder)+'"><button type="button" class="field-secret-toggle" aria-label="Show API key" aria-pressed="false" onclick="toggleProviderSecretVisibility(\''+id+'\',this)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 1.7 5.4 1 8c.7 2.6 3.5 5 7 5s6.3-2.4 7-5c-.7-2.6-3.5-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg></button></div></div>';
}

function toggleProviderSecretVisibility(inputId,btn){
  var input=document.getElementById(inputId);
  if(!input||!btn)return;
  var show=input.type==='password';
  input.type=show?'text':'password';
  btn.setAttribute('aria-label',show?'Hide API key':'Show API key');
  btn.setAttribute('aria-pressed',show?'true':'false');
  btn.innerHTML=show
    ?'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2l12 12M6.7 6.8A2 2 0 0 0 8 11a2 2 0 0 0 1.9-1.4M4.2 4.5C2.8 5.4 1.6 6.6 1 8c.7 2.6 3.5 5 7 5 1.2 0 2.3-.3 3.3-.8M11.4 11.1c1.3-.9 2.3-2.1 2.9-3.1-.7-2.6-3.5-5-7-5-.8 0-1.5.1-2.2.3"/></svg>'
    :'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 1.7 5.4 1 8c.7 2.6 3.5 5 7 5s6.3-2.4 7-5c-.7-2.6-3.5-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
}

function fmtProviderTokens(n){
  n=Number(n)||0;
  if(n>=1000000)return (n/1000000).toFixed(1).replace(/\.0$/,'')+'M';
  if(n>=1000)return (n/1000).toFixed(1).replace(/\.0$/,'')+'k';
  return n.toLocaleString('en-GB');
}

function fmtProviderUsd(s){
  var n=parseFloat(s);
  if(!Number.isFinite(n))n=0;
  return '$'+n.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function providerCapabilityDesc(item,profile){
  if(item.key==='model_visibility'){
    var n=profile&&profile.models_count;
    if(item.available&&typeof n==='number'&&n>0){
      return n+' model'+(n===1?'':'s')+' accessible to the runtime API key (from last live check).';
    }
    if(item.available){
      return 'Runtime API key can access the model catalogue (from last live check).';
    }
    return 'Could not list models for the runtime API key on the last live check.';
  }
  return item.description;
}

function renderProviderInsightsLedger(title,note,rows){
  if(!rows||!rows.length)return '';
  var html='<div class="provider-insights-ledger"><div class="provider-insight-label">'+esc(title)+'</div>';
  if(note)html+='<p class="provider-insights-note">'+esc(note)+'</p>';
  html+='<ul>';
  rows.forEach(function(row){
    html+='<li><span>'+esc(row.label)+'</span><span>'+esc(row.value)+'</span></li>';
  });
  html+='</ul></div>';
  return html;
}

function renderProviderTokenMix(usage){
  if(!usage||!(usage.total_tokens||0))return '';
  var rows=[
    {label:'Input (uncached)',value:fmtProviderTokens(usage.uncached_input_tokens)},
    {label:'Cache read',value:fmtProviderTokens(usage.cache_read_input_tokens)},
    {label:'Cache creation',value:fmtProviderTokens(usage.cache_creation_tokens)},
    {label:'Output',value:fmtProviderTokens(usage.output_tokens)}
  ];
  var inputTotal=(Number(usage.uncached_input_tokens)||0)+(Number(usage.cache_read_input_tokens)||0)+(Number(usage.cache_creation_tokens)||0);
  rows.push({label:'Input total',value:fmtProviderTokens(inputTotal)});
  return renderProviderInsightsLedger('Token mix','How this asset\'s usage splits by token type.',rows);
}

function renderProviderWorkspaceCost(cost){
  if(!cost||!cost.by_workspace||!cost.by_workspace.length)return '';
  var rows=cost.by_workspace.slice(0,6).map(function(row){
    var label=row.workspace_id?row.workspace_id:'Default workspace';
    return {label:label,value:fmtProviderUsd(row.amount_usd)};
  });
  return renderProviderInsightsLedger('Cost by workspace','Spend in USD for this window.',rows);
}

function renderProviderInsightsPanel(connection,canManage){
  if(!connection||!connection.admin_credential_secret_id)return '';
  var insights=connection.metadata&&connection.metadata.insights;
  var html='<div class="provider-insights"><div class="provider-insights-head"><div class="stat-label">Governance insights</div>';
  if(canManage){
    html+='<div class="provider-insights-actions"><select id="provider-insights-window" class="field-input provider-insights-window" aria-label="Insights window">';
    [7,30,90].forEach(function(d){
      var sel=insights&&insights.window_days===d?' selected':'';
      if(!insights&&d===30)sel=' selected';
      html+='<option value="'+d+'"'+sel+'>'+d+' days</option>';
    });
    html+='</select>'+btnAsyncHtml('Refresh insights',{id:'provider-insights-btn',onclick:'refreshProviderInsights()'})+'</div>';
  }
  html+='</div>';
  if(!insights){
    html+='<p class="provider-insights-lead">No snapshot yet. Refresh insights to pull usage and cost from the Admin API.</p></div>';
    return html;
  }
  var windowDays=insights.window_days||30;
  var scoped=insights.scope==='asset';
  html+='<p class="provider-insights-meta">Last refreshed '+esc(fmtDateLong(insights.refreshed_at))+' · '+windowDays+'-day window · '+(scoped?'this asset':'organisation')+'</p>';
  html+='<div class="provider-insights-grid">';
  html+='<div class="provider-insight-stat"><div class="provider-insight-label">Tokens</div><div class="provider-insight-value ra-num">'+esc(fmtProviderTokens(insights.usage&&insights.usage.total_tokens))+'</div></div>';
  html+='<div class="provider-insight-stat"><div class="provider-insight-label">Cost (USD)</div><div class="provider-insight-value ra-num">'+esc(fmtProviderUsd(insights.cost&&insights.cost.total_usd))+'</div></div>';
  html+='</div>';
  html+=renderProviderTokenMix(insights.usage);
  html+=renderProviderWorkspaceCost(insights.cost);
  if(insights.usage&&insights.usage.by_model&&insights.usage.by_model.length){
    html+='<div class="provider-insights-models"><div class="provider-insight-label">Models with usage</div>';
    html+='<p class="provider-insights-note">Token usage by model in the last '+windowDays+' days.</p><ul>';
    insights.usage.by_model.slice(0,5).forEach(function(row){
      html+='<li><span>'+esc(row.model)+'</span><span>'+esc(fmtProviderTokens(row.total_tokens))+'</span></li>';
    });
    html+='</ul></div>';
  }else if(insights.usage&&(insights.usage.total_tokens||0)>0){
    html+='<p class="provider-insights-note">Usage was recorded, but no model breakdown is available for this window yet.</p>';
  }else{
    html+='<p class="provider-insights-note">'+(scoped?'No usage for this asset\'s runtime key in this window yet. After API calls with that key, wait a few minutes and refresh.':'No organisation usage in this window yet. After API calls, wait a few minutes and refresh.')+'</p>';
  }
  if(!scoped){
    html+='<p class="provider-insights-note">Figures are for the Anthropic organisation until this asset\'s runtime key is matched. Connect both keys and run a live check, then refresh.</p>';
  }
  if(insights.cost&&Number(insights.cost.total_usd||0)===0&&(insights.usage&&insights.usage.total_tokens||0)>0){
    html+='<p class="provider-insights-note">Cost may stay at $0.00 on credits or until Anthropic publishes cost rows — usage can appear first.</p>';
  }
  if(insights.errors&&insights.errors.length){
    html+='<div class="provider-connection-notes">'+insights.errors.map(function(note){return '<p>'+esc(note)+'</p>'}).join('')+'</div>';
  }
  html+='</div>';
  return html;
}

function renderProviderCapabilityList(connection){
  var profile=connection&&connection.metadata&&connection.metadata.capabilities;
  var items=(profile&&profile.capabilities)||[];
  if(!items.length){
    return '<p class="provider-cap-lead"><span class="provider-cap-lead-label">Governance capabilities:</span> Connect keys to see what RegAnchor can monitor</p>';
  }
  return '<div class="provider-cap-list">'+items.map(function(item){
    var cls=item.available?'is-on':'is-off';
    var mark=item.available?'✓':'×';
    return '<div class="provider-cap-row '+cls+'"><span class="provider-cap-mark" aria-hidden="true">'+mark+'</span><div class="provider-cap-copy"><span class="provider-cap-label">'+esc(item.label)+'</span><span class="provider-cap-desc">'+esc(providerCapabilityDesc(item,profile))+'</span></div></div>';
  }).join('')+'</div>';
}

function providerOverviewValue(sys,providerLabel){
  if(!sys||!providerConnectorAvailable(sys.provider_slug))return esc(providerLabel);
  return '<span class="meta-item-with-action"><span>'+esc(providerLabel)+'</span><button type="button" class="btn-inline" onclick="switchDetailTabById(\'connection\')">Connection</button></span>';
}

function renderAssetOverview(sys,tier){
  var assetKind=sys.asset_kind||'system';
  var providerLabel=providerCatalogName(sys.provider_slug)||'Not set';
  var modelLabel=modelDisplayName(sys.provider_slug,sys.model_name)||'Not set';
  return '<div class="detail-desc"><div class="stat-label">Description</div><p>'+esc(sys.description||'No description provided.')+'</p></div><div class="meta-grid"><div class="meta-item"><label>Asset ID</label><span class="meta-id">'+esc(sys.id)+'</span></div><div class="meta-item"><label>Type</label><span><span class="kind-pill kind-'+assetKind+'">'+(ASSET_KIND_LABELS[assetKind]||assetKind)+'</span></span></div><div class="meta-item"><label>Provider</label><span>'+providerOverviewValue(sys,providerLabel)+'</span></div><div class="meta-item"><label>Model</label><span>'+esc(modelLabel)+'</span></div><div class="meta-item"><label>Vendor</label><span>'+esc(sys.vendor||'In-house')+'</span></div><div class="meta-item"><label>Department</label><span>'+esc(sys.department||'Not set')+'</span></div><div class="meta-item"><label>Owner</label><span>'+esc(sys.system_owner||'Not set')+'</span></div><div class="meta-item"><label>Deployment</label><span><span class="status-pill status-'+sys.deployment_status+'">'+(STATUS_LABELS[sys.deployment_status]||'Not set')+'</span></span></div><div class="meta-item"><label>Purpose category</label><span>'+esc(sys.purpose_category?sys.purpose_category.replace(/_/g,' '):'Not set')+'</span></div><div class="meta-item"><label>Risk tier</label><span><span class="tier-pill tier-'+tier+'">'+(TIER_LABELS[tier]||'Unclassified')+'</span></span></div>'+(sys.risk_tier_rationale?'<div class="meta-item" style="grid-column:1/-1;"><label>Classification rationale</label><span>'+esc(sys.risk_tier_rationale)+'</span></div>':'')+'<div class="meta-item"><label>Registered</label><span>'+fmtDate(sys.created_at)+'</span></div><div class="meta-item"><label>Last updated</label><span>'+fmtDate(sys.updated_at)+'</span></div></div>';
}

function renderProviderConnectionTab(sys,connection){
  if(!sys)return '';
  if(!providerConnectorAvailable(sys.provider_slug)){
    var providerName=providerCatalogName(sys.provider_slug)||sys.provider_slug||'this provider';
    return '<div class="empty-state" style="padding:28px 0;"><h4>No connector yet</h4><p style="max-width:42ch;margin:0 auto;">Live provider connections are not available for '+esc(providerName)+'. Registry metadata is still recorded on Overview.</p></div>';
  }
  return renderProviderConnectionPanel(sys,connection);
}

function renderProviderConnectionPanel(sys,connection){
  if(!sys||!providerConnectorAvailable(sys.provider_slug))return '';
  var provider=providerCatalogRow(sys.provider_slug);
  var canManage=typeof canDeleteRegistry==='function'&&canDeleteRegistry();
  var hasApi=!!(connection&&connection.credential_secret_id);
  var hasAdmin=!!(connection&&connection.admin_credential_secret_id);
  var profile=connection&&connection.metadata&&connection.metadata.capabilities;
  var tier=(profile&&profile.governance_tier)||(hasApi&&!hasAdmin?'verification':hasApi&&hasAdmin?'full':hasAdmin?'verification':'none');
  var tierLabel=PROVIDER_GOV_TIER_LABELS[tier]||tier;
  var tierCls=tier==='full'?'is-full':(tier==='verification'?'is-partial':'');
  var docs=provider&&provider.docs_url?'<a href="'+esc(provider.docs_url)+'" target="_blank" rel="noopener">Runtime API docs</a>':'';
  var adminDocs='<a href="'+esc(PROVIDER_ADMIN_DOCS_URL)+'" target="_blank" rel="noopener">Admin API docs</a>';
  var html='<div class="provider-connection-panel"><div class="provider-connection-head"><div class="stat-label">Provider connection</div><span class="conn-gov-tier '+tierCls+'">'+esc(tierLabel)+'</span></div>'+
    '<p class="provider-connection-copy">Connect a runtime API key to verify this asset, then add a Governance Admin key to unlock usage, cost, and workspace monitoring. Credentials are encrypted in Vault and never shown again.</p>'+
    renderProviderCapabilityList(connection)+
    (profile&&profile.encouragement?'<p class="provider-connection-encourage">'+esc(profile.encouragement)+'</p>':'')+
    (profile&&profile.limitations&&profile.limitations.length?'<div class="provider-connection-notes">'+profile.limitations.map(function(note){return '<p>'+esc(note)+'</p>'}).join('')+'</div>':'')+
    (hasAdmin?renderProviderInsightsPanel(connection,canManage):'');
  if(canManage){
    html+='<div class="provider-slot"><div class="provider-slot-head"><span class="provider-slot-title">Runtime API key</span>'+(hasApi?'<span class="provider-slot-state is-on">Connected</span>':'<span class="provider-slot-state">Not connected</span>')+'</div>'+
      '<p class="provider-slot-copy">Verifies this asset can authenticate to '+esc(providerCatalogName(sys.provider_slug))+'. Required for live API checks.'+(docs?' '+docs:'')+'</p>';
    if(!hasApi){
      html+=providerSecretFieldHtml('provider-api-key','API key (sk-ant-api…)','Paste runtime API key')+
        '<button type="button" class="btn-dl" id="provider-connect-api-btn" onclick="connectProvider(\'api\')"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Connect runtime key</button>';
    }else{
      html+='<div class="provider-connection-actions"><button type="button" class="btn-topbar btn-topbar-ghost" onclick="revokeProviderConnection(\'api\')">Revoke runtime key</button></div>';
    }
    html+='</div><div class="provider-slot provider-slot--admin"><div class="provider-slot-head"><span class="provider-slot-title">Governance admin key</span>'+(hasAdmin?'<span class="provider-slot-state is-on">Connected</span>':'<span class="provider-slot-state is-rec">Recommended</span>')+'</div>'+
      '<p class="provider-slot-copy">Unlocks usage monitoring, cost reporting, and workspace visibility.</p><p class="provider-slot-copy provider-slot-docs">'+adminDocs+'</p>';
    if(!hasAdmin){
      html+=providerSecretFieldHtml('provider-admin-key','Admin API key (sk-ant-admin…)','Paste governance admin key')+
        '<button type="button" class="btn-dl" id="provider-connect-admin-btn" onclick="connectProvider(\'admin\')"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Connect admin key</button>';
    }else{
      html+='<div class="provider-connection-actions"><button type="button" class="btn-topbar btn-topbar-ghost" onclick="revokeProviderConnection(\'admin\')">Revoke admin key</button></div>';
    }
    html+='</div>';
    if(hasApi||hasAdmin){
      html+='<div class="provider-connection-actions provider-connection-actions--foot">'+btnAsyncHtml('Run live check',{id:'provider-test-btn',onclick:'testProviderConnection()'})+'</div>';
    }
  }else if(!hasApi&&!hasAdmin){
    html+='<p class="provider-connection-copy">Only organisation owners and admins can manage provider connections.</p>';
  }
  html+='<div id="provider-connection-error" class="provider-connection-error" role="alert"></div></div>';
  return html;
}

async function connectProvider(slot){
  if(!currentSystemId)return;
  var sys=allSystems.find(function(s){return s.id===currentSystemId});
  if(!sys)return;
  setProviderConnectionError('');
  var keyId=slot==='admin'?'provider-admin-key':'provider-api-key';
  var btnId=slot==='admin'?'provider-connect-admin-btn':'provider-connect-api-btn';
  var keyEl=document.getElementById(keyId);
  var apiKey=keyEl?keyEl.value.trim():'';
  if(!apiKey){setProviderConnectionError('API key is required.');return}
  var btn=document.getElementById(btnId);
  if(btn){btn.disabled=true;btn.textContent='Verifying with Anthropic…'}
  try{
    await invokeProviderFn('provider-connect',{asset_id:sys.id,provider_slug:sys.provider_slug,api_key:apiKey,credential_slot:slot});
    if(keyEl)keyEl.value='';
    await openSystemDetail(sys.id,{tab:'connection'});
  }catch(e){
    setProviderConnectionError(e.message||'Could not connect.');
    if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Connect '+(slot==='admin'?'admin':'runtime')+' key'}
  }
}

async function testProviderConnection(){
  if(!currentSystemId)return;
  var sys=allSystems.find(function(s){return s.id===currentSystemId});
  if(!sys)return;
  setProviderConnectionError('');
  var btn=document.getElementById('provider-test-btn');
  try{
    await runAsyncBtn(btn,function(){
      return invokeProviderFn('provider-test',{asset_id:sys.id,provider_slug:sys.provider_slug,probe_all:true});
    },{busyLabel:'Running live check',successMs:1500,errorMs:2200});
    await openSystemDetail(sys.id,{tab:'connection'});
  }catch(e){
    setProviderConnectionError(e.message||'Connection test failed.');
  }
}

async function refreshProviderInsights(){
  if(!currentSystemId)return;
  var sys=allSystems.find(function(s){return s.id===currentSystemId});
  if(!sys)return;
  setProviderConnectionError('');
  var windowEl=document.getElementById('provider-insights-window');
  var windowDays=windowEl?Number(windowEl.value):30;
  if(!Number.isFinite(windowDays)||windowDays<1)windowDays=30;
  var btn=document.getElementById('provider-insights-btn');
  try{
    await runAsyncBtn(btn,function(){
      return invokeProviderFn('provider-insights',{asset_id:sys.id,provider_slug:sys.provider_slug,window_days:windowDays});
    },{busyLabel:'Refreshing insights',lock:'#provider-insights-window',successMs:1500,errorMs:2200});
    await openSystemDetail(sys.id,{tab:'connection'});
  }catch(e){
    setProviderConnectionError(e.message||'Could not refresh insights.');
  }
}

async function revokeProviderConnection(slot){
  if(!currentSystemId)return;
  var sys=allSystems.find(function(s){return s.id===currentSystemId});
  if(!sys)return;
  var label=slot==='admin'?'governance admin key':'runtime API key';
  if(!confirm('Revoke the '+label+' for '+sys.name+'? The stored credential will be deleted.'))return;
  setProviderConnectionError('');
  try{
    await invokeProviderFn('provider-revoke',{asset_id:sys.id,provider_slug:sys.provider_slug,credential_slot:slot});
    await openSystemDetail(sys.id,{tab:'connection'});
  }catch(e){
    setProviderConnectionError(e.message||'Could not revoke connection.');
  }
}
 
async function openSystemDetail(sysId,opts){
  opts=opts||{};
  var priorTab=null;
  if(currentSystemId===sysId&&!opts.tab){
    var activeBtn=document.querySelector('#view-registry-detail .tab-btn.active');
    if(activeBtn)priorTab=activeBtn.getAttribute('data-tab');
  }
  currentSystemId=sysId;const sys=allSystems.find(s=>s.id===sysId);if(!sys)return;
  if(!providerCatalog.length)await loadProviderCatalog();
  const[{data:assessments},{data:auditLog},{data:providerConn}]=await Promise.all([
    sb.from('registry_assessments').select('*').eq('system_id',sysId).order('requested_at',{ascending:false}),
    sb.from('registry_audit_log').select('*').eq('entity_id',sysId).order('created_at',{ascending:false}),
    providerConnectorAvailable(sys.provider_slug)
      ? sb.from('provider_connections').select('id,status,provider_slug,connected_at,last_verified_at,last_error,credential_secret_id,admin_credential_secret_id,admin_connected_at,admin_last_verified_at,admin_last_error,metadata').eq('asset_id',sysId).eq('provider_slug',sys.provider_slug).neq('status','revoked').maybeSingle()
      : Promise.resolve({data:null})
  ]);
  const tier=sys.risk_tier||'none';
  document.getElementById('det-name').textContent=sys.name;
  document.getElementById('det-tier-badge').innerHTML='<span class="tier-pill tier-'+tier+'">'+esc(TIER_LABELS[tier]||'Unclassified')+'</span>';
  var metaParts=[];
  if(sys.department)metaParts.push('<span><label>Department</label>'+esc(sys.department)+'</span>');
  if(sys.system_owner)metaParts.push('<span><label>Owner</label>'+esc(sys.system_owner)+'</span>');
  metaParts.push('<span><label>Added</label>'+fmtDate(sys.created_at)+'</span>');
  var subEl=document.getElementById('det-subtitle');
  subEl.className='det-subtitle';
  subEl.removeAttribute('style');
  subEl.innerHTML=metaParts.join('');
  // Header tag strip (deployment / type / purpose / latest assess status).
  // Same facts remain on Overview tab; strip is UI-only and is off for now.
  // Re-enable: set SHOW_DET_HEADER_TAGS true (CSS .det-tags also un-hides when [hidden] is cleared).
  var SHOW_DET_HEADER_TAGS=false;
  var tagParts=[];
  if(sys.deployment_status)tagParts.push(STATUS_LABELS[sys.deployment_status]||sys.deployment_status);
  if(sys.system_type)tagParts.push(TYPE_LABELS[sys.system_type]||sys.system_type);
  if(sys.purpose_category)tagParts.push(sys.purpose_category.replace(/_/g,' '));
  var latestA=(assessments&&assessments.length)?assessments[0]:null;
  if(latestA)tagParts.push(ASSESS_STATUS_LABELS[latestA.status]||latestA.status);
  var tagsEl=document.getElementById('det-tags');
  if(tagsEl){
    if(SHOW_DET_HEADER_TAGS){
      tagsEl.hidden=false;
      tagsEl.innerHTML=tagParts.map(function(t){return '<span class="tag">'+esc(t)+'</span>'}).join('');
    }else{
      tagsEl.hidden=true;
      tagsEl.innerHTML='';
    }
  }
  // Overview
  document.getElementById('tab-overview').innerHTML=renderAssetOverview(sys,tier);
  document.getElementById('tab-connection').innerHTML=renderProviderConnectionTab(sys,providerConn);
  // Assessment tab
  renderAssessmentTab(assessments||[]);
  // System controls tab
  await renderSystemControlsTab(sysId);
  // Audit with names
  const logs=auditLog||[];
  if(!logs.length)document.getElementById('tab-audit').innerHTML='<div class="empty-state" style="padding:28px 0;"><h4>No audit entries</h4><p>Entries are created automatically on system changes.</p></div>';
    else{const nm=await loadNames(logs.map(e=>e.user_id));document.getElementById('tab-audit').innerHTML='<div class="audit-timeline">'+logs.map((entry,i)=>{const a=fmtAudit(entry,nm,{omitSystemName:true});return '<div class="audit-item"><div class="audit-line"><div class="audit-node"></div>'+(i<logs.length-1?'<div class="audit-connector"></div>':'')+'</div><div class="audit-content"><div class="audit-action">'+a.text+'</div><div class="audit-meta">'+esc(a.who)+' · '+a.time+'</div></div></div>'}).join('')+'</div>'}
  // Activate tab (preserve current tab on refresh; explicit opts.tab wins)
  switchDetailTabById(opts.tab||priorTab||'overview');
  navigate('registry-detail',null);
}
 
// System-level controls tab
async function renderSystemControlsTab(sysId){
  const el=document.getElementById('tab-sys-controls');
 
  if(!allControls.length)await loadControls();
  // Get assignments for this specific system
  const{data:sysAssignments}=await sb.from('control_assignments').select('*').eq('system_id',sysId).eq('org_id',currentOrg.id);
  var allSysCtrl=sysAssignments||[];
  // Only include org-level controls if this system has been assessed
  const{data:sysAssessCheck}=await sb.from('registry_assessments').select('id').eq('system_id',sysId).limit(1);
  if(sysAssessCheck&&sysAssessCheck.length){
    const{data:orgAssignments}=await sb.from('control_assignments').select('*').eq('org_id',currentOrg.id).is('system_id',null);
    allSysCtrl=allSysCtrl.concat(orgAssignments||[]);
  }
  
  if(!allSysCtrl.length){
    el.innerHTML='<div class="empty-state" style="padding:36px 0;"><h4>No controls triggered yet</h4><p style="max-width:380px;margin:0 auto 20px;">Run an assessment on this AI system. Controls will be automatically triggered based on governance gaps identified.</p><button class="btn-dl" onclick="openAssessmentModal()" style="display:inline-flex;"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Run Assessment</button></div>';
    return;
  }
  
  const done=allSysCtrl.filter(a=>a.status==='implemented'||a.status==='verified').length;
  const total=allSysCtrl.length;
  const pct=total>0?Math.round(done/total*100):0;

  let html='<div class="ctrl-summary"><div class="ctrl-summary__head"><span class="ctrl-summary__pct ra-num">'+pct+'%</span><span class="ctrl-summary__note">'+done+' of '+total+' controls implemented</span></div><div class="cprogress-bar"><div class="cprogress-fill" style="width:'+pct+'%;"></div></div></div>';
  
  // Group by type
  const groups={organisation:[],system:[],assurance:[]};
  allSysCtrl.forEach(a=>{
    const ctrl=allControls.find(c=>c.id===a.control_id);
    if(ctrl)groups[ctrl.control_type].push({assign:a,ctrl});
  });
  
  const typeLabels={organisation:'Organisation Controls',system:'System Controls',assurance:'Assurance Controls'};
  ['organisation','system','assurance'].forEach(t=>{
    const items=groups[t];if(!items.length)return;
    html+='<div class="framework-section"><div class="framework-label">'+typeLabels[t]+'</div>';
    items.forEach(({assign:a,ctrl:c})=>{
      const st=a.status||'not_started';
      html+='<div class="row-item" onclick="openControlDetail(\''+c.id+'\',\''+a.id+'\')">'+
        '<div class="row-marker">'+c.control_number+'</div>'+
        '<div class="row-main"><div class="row-title">'+esc(c.title)+'</div></div>'+
        '<span class="state-label" style="color:'+CTRL_STATUS_C[st]+';">'+CTRL_STATUS_L[st]+'</span>'+
      '</div>';
    });
    html+='</div>';
  });
  
  el.innerHTML=html;
}
 
// Assessment modal → now redirects to assessment.html
function openAssessmentModal(){
  if(!currentSystemId)return;
  if(typeof rememberPortalReturn==='function')rememberPortalReturn();
  window.location.href='assessment.html?system_id='+currentSystemId;
}
function closeAssessmentModal(){}
 
var _domAnimGen=0;

function animateDomainBars(root){
  if(!root)return;
  var rows=root.querySelectorAll('.dom-row[data-pct]');
  if(!rows.length)return;
  var gen=++_domAnimGen;
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var duration=1400;
  var ease=function(t){return 1-Math.pow(1-t,3)};

  rows.forEach(function(row,i){
    var target=parseFloat(row.getAttribute('data-pct'))||0;
    var fill=row.querySelector('.dom-row__fill');
    var pctEl=row.querySelector('.dom-row__pct');
    if(!fill||!pctEl)return;

    fill.style.transition='none';
    fill.style.width='0%';
    pctEl.textContent='0%';

    if(reduce){
      fill.style.width=target+'%';
      pctEl.textContent=Math.round(target)+'%';
      return;
    }

    var delay=i*90;
    setTimeout(function(){
      if(gen!==_domAnimGen)return;
      // Force layout so the 0% width registers before transitioning.
      void fill.offsetWidth;
      fill.style.transition='width '+duration+'ms cubic-bezier(0.22, 1, 0.36, 1)';
      fill.style.width=target+'%';
      var start=performance.now();
      function tick(now){
        if(gen!==_domAnimGen)return;
        var t=Math.min(1,(now-start)/duration);
        pctEl.textContent=Math.round(target*ease(t))+'%';
        if(t<1)requestAnimationFrame(tick);
        else pctEl.textContent=Math.round(target)+'%';
      }
      requestAnimationFrame(tick);
    },delay);
  });
}

function domainRiskLabel(pct){
  if(pct<40)return{lbl:'High',cls:'is-risk'};
  if(pct<70)return{lbl:'Medium',cls:'is-warn'};
  return{lbl:'Low',cls:'is-ok'};
}

async function renderAssessmentTab(assessments){
  const el=document.getElementById('tab-assessment');
  if(!assessments.length){
    el.innerHTML='<div class="empty-state" style="padding:36px 0;"><h4>No assessments yet</h4><p style="max-width:360px;margin:0 auto 20px;">Run an assessment to evaluate this AI system\u2019s governance maturity across 7 domains and receive a risk score.</p><button class="btn-dl" onclick="openAssessmentModal()" style="display:inline-flex;"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Run Assessment</button></div>';
    return;
  }
  const BAND_L={high:'High Risk',medium:'Medium Risk',low:'Low Risk'};
  const nm=await loadNames(assessments.map(a=>a.requested_by).concat(assessments.map(a=>a.completed_by).filter(Boolean)));
  el.innerHTML=assessments.map((a,i)=>{
    const band=a.risk_band||'medium';
    const score=a.overall_score;
    const stLabel=ASSESS_STATUS_LABELS[a.status]||a.status;
    const stCol=ASSESS_STATUS_COLORS[a.status]||'var(--ra-text-3)';
    const isLatest=i===0;
    const ss=a.section_scores||{};
    const tv=a.tier_validation;
    const secBars=Object.entries(ss).map(([k,v])=>{
      const pct=Math.max(0,Math.min(100,Number(v.score)||0));
      const risk=domainRiskLabel(pct);
      return '<div class="dom-row" data-pct="'+pct+'"><span class="dom-row__label">'+esc(v.title||k)+'</span>'+
        '<div class="dom-row__track"><div class="dom-row__fill"></div></div>'+
        '<span class="dom-row__pct ra-num">0%</span>'+
        '<span class="dom-row__risk '+risk.cls+'">'+risk.lbl+'</span></div>';
    }).join('');
    return '<div class="assess-card">'+
      '<div class="assess-card__head">'+
        '<div class="assess-card__reading">'+
          (score!==null&&score!==undefined?raMaturityBlock(score,{mini:true,animate:true}):'<div class="ra-maturity ra-maturity--mini"><div class="ra-maturity__text"><div class="ra-maturity__tier">Not assessed</div></div></div>')+
          '<span class="band-pill band-'+band+'">'+(BAND_L[band]||band)+'</span>'+
          (isLatest?'<span class="state-label" style="color:var(--ra-text);">Latest</span>':'')+
        '</div>'+
        '<div class="assess-card__status">'+
          '<span class="state-label" style="color:'+stCol+';">'+esc(stLabel)+'</span>'+
          '<span class="assess-card__date">'+fmtDateLong(a.requested_at)+'</span>'+
        '</div>'+
      '</div>'+
      (Object.keys(ss).length?'<div class="dom-list">'+secBars+'</div>':'')+
      '<div class="assess-card__meta">'+
        '<div class="assess-card__meta-cell"><span class="assess-card__meta-lbl">Submitted by</span><span class="assess-card__meta-val">'+esc(nm[a.requested_by]||'Unknown')+'</span></div>'+
        '<div class="assess-card__meta-cell"><span class="assess-card__meta-lbl">Sector</span><span class="assess-card__meta-val">'+esc(a.sector||'Not set')+'</span></div>'+
        '<div class="assess-card__meta-cell"><span class="assess-card__meta-lbl">Review state</span><span class="assess-card__meta-val" style="color:'+stCol+'">'+esc(stLabel)+'</span></div>'+
      '</div>'+
      (tv&&tv.mismatch?'<div class="notice notice--warn">'+esc(tv.message||'Risk tier mismatch detected. RegAnchor recommends reviewing the classification.')+'</div>':'')+
      (a.client_notes?'<div class="notice notice--quiet">'+esc(a.client_notes)+'</div>':'')+
      (a.status==='controls_issued'?'<div class="notice"><div class="notice__label">RegAnchor Controls Issued</div>'+(a.mla_notes?'<div class="notice__body">'+esc(a.mla_notes)+'</div>':'')+'<div class="notice__meta">Completed by '+(nm[a.completed_by]||'RegAnchor')+', '+fmtDateLong(a.completed_at)+'</div></div>':'')+
      (a.status==='submitted'?'<div class="notice"><div class="notice__body">Your assessment has been submitted. RegAnchor will review this AI system and provide tailored compliance controls. You will be notified when results are ready.</div></div>':'')+
      '<div class="assess-card__actions">'+(isPaidTier()?'<a href="system-report.html?aid='+a.id+'" class="btn-topbar btn-topbar-primary" target="_blank"><svg viewBox="0 0 12 12"><path d="M6 1v7M3 5l3 3 3-3M1 10h10"/></svg>View Report</a>':'<button type="button" class="btn-topbar btn-topbar-ghost" onclick="navigate(\'plans\',document.getElementById(\'nav-plans\'));updatePortalPricing()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/></svg>Upgrade to View Report</button>')+'</div>'+
    '</div>'}).join('');

  requestAnimationFrame(function(){
    animateDomainBars(el);
    animateMaturity(el);
  });
}

function switchDetailTabById(id){
  var btn=document.querySelector('#view-registry-detail .tab-btn[data-tab="'+id+'"]');
  switchDetailTab(id,btn||document.querySelector('#view-registry-detail .tab-btn'));
}

function switchDetailTab(id,btn){
  if(!btn)return;
  document.querySelectorAll('#view-registry-detail .tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#view-registry-detail .tab-panel').forEach(p=>p.classList.remove('active'));
  var panel=document.getElementById('tab-'+id);
  if(panel)panel.classList.add('active');
  if(id==='assessment'){
    animateDomainBars(panel);
    animateMaturity(panel);
  }
  if(id==='connection'){
    requestAnimationFrame(function(){initAsyncBtns(panel);});
  }
}
 
// ═══ ADD/EDIT SYSTEM ══════════════════════════════════════════
function openAddSystem(){if(typeof canWriteRegistry==='function'&&!canWriteRegistry())return;var orgPlan=currentOrg?currentOrg.plan:'free';var sysLimit=(orgPlan==='professional')?999:1;if(activeRegistrySystemCount()>=sysLimit){var sysMsg='';if(orgPlan==='essentials')sysMsg='You have reached your Essentials plan limit of 1 AI asset. Upgrade for unlimited assets, multi-user access, and more.';else if(orgPlan==='professional')sysMsg='Need more from your governance platform? Enterprise includes unlimited users, dedicated advisory, and more.';else sysMsg='You have reached your free plan limit of 1 AI asset. Subscribe to unlock more assets, governance certification, and more.';openUpgradeModal(sysMsg);return}document.getElementById('sysmod-id').value='';document.getElementById('sysmod-title').textContent='Add AI asset';document.getElementById('sysmod-sub').textContent='Register a governed system or agent in your inventory';document.getElementById('sysmod-submit').innerHTML='<svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg> Register asset';clearSystemForm();populateProviderSelect('');populateModelSelect('','');updateAssetNotesRequirement();showSysmodRemoveZone(false);document.getElementById('system-modal').classList.add('open')}
function openEditSystem(){const sys=allSystems.find(s=>s.id===currentSystemId);if(!sys)return;document.getElementById('sysmod-id').value=sys.id;document.getElementById('sysmod-title').textContent='Edit asset';document.getElementById('sysmod-sub').textContent=sys.name;document.getElementById('sysmod-submit').innerHTML='Save Changes';document.getElementById('sysmod-name').value=sys.name||'';document.getElementById('sysmod-desc').value=sys.description||'';document.getElementById('sysmod-kind').value=sys.asset_kind||'system';document.getElementById('sysmod-vendor').value=sys.vendor||'';document.getElementById('sysmod-purpose').value=sys.purpose_category||'';document.getElementById('sysmod-tier').value=sys.risk_tier||'';document.getElementById('sysmod-status').value=sys.deployment_status||'planned';document.getElementById('sysmod-rationale').value=sys.risk_tier_rationale||'';document.getElementById('sysmod-owner').value=sys.system_owner||'';document.getElementById('sysmod-dept').value=sys.department||'';document.getElementById('sysmod-notes').value=sys.notes||'';populateProviderSelect(sys.provider_slug||'');populateModelSelect(sys.provider_slug||'',sys.model_name||'');onPurposeChange();updateAssetNotesRequirement();showSysmodRemoveZone(typeof canDeleteRegistry==='function'&&canDeleteRegistry());if(typeof canDeleteRegistry==='function'&&canDeleteRegistry())prepareSysmodRemove(sys.id);document.getElementById('system-modal').classList.add('open')}
function clearSystemForm(){['sysmod-name','sysmod-desc','sysmod-vendor','sysmod-rationale','sysmod-owner','sysmod-dept','sysmod-notes'].forEach(id=>document.getElementById(id).value='');document.getElementById('sysmod-kind').value='system';document.getElementById('sysmod-purpose').value='';document.getElementById('sysmod-tier').value='';document.getElementById('sysmod-status').value='planned';document.getElementById('sysmod-tier-hint').style.display='none';document.getElementById('sysmod-rationale-wrap').style.display='none';document.getElementById('sysmod-error').style.display='none';updateAssetNotesRequirement();resetSysmodRemove(false)}
function closeSystemModal(){document.getElementById('system-modal').classList.remove('open')}
function onPurposeChange(){const purpose=document.getElementById('sysmod-purpose').value;const suggested=PURPOSE_TIER_MAP[purpose];const hint=document.getElementById('sysmod-tier-hint');const tierSel=document.getElementById('sysmod-tier');const rw=document.getElementById('sysmod-rationale-wrap');
  if(suggested){hint.innerHTML='Suggested tier: <strong>'+(TIER_LABELS[suggested])+'</strong>, based on EU AI Act Annex III.';hint.style.display='block';tierSel.value=suggested}else if(purpose==='other'){hint.innerHTML='Please classify manually.';hint.style.display='block'}else hint.style.display='none';
  rw.style.display=(tierSel.value&&tierSel.value!==suggested)?'block':'none';tierSel.onchange=()=>{rw.style.display=(tierSel.value&&tierSel.value!==suggested)?'block':'none'}}
async function submitSystem(){
  const name=document.getElementById('sysmod-name').value.trim();const owner=document.getElementById('sysmod-owner').value.trim();const errEl=document.getElementById('sysmod-error');
  var platform=document.getElementById('sysmod-platform').value;
  var model=document.getElementById('sysmod-model').value;
  var notesVal=document.getElementById('sysmod-notes').value.trim();
  if(!name||!owner){errEl.textContent='Name and owner are required.';errEl.style.display='block';return}
  if(!platform||!model){errEl.textContent='Provider and model are required.';errEl.style.display='block';return}
  if(assetNotesRequired()&&!notesVal){errEl.textContent='Please specify the provider or model in Notes when selecting Other.';errEl.style.display='block';return}
  errEl.style.display='none';
  const btn=document.getElementById('sysmod-submit');const origH=btn.innerHTML;btn.textContent='Saving…';btn.disabled=true;if(!currentOrg)await ensureOrg();
  var vendorVal=document.getElementById('sysmod-vendor').value.trim()||null;
  const payload={org_id:currentOrg.id,name,asset_kind:document.getElementById('sysmod-kind').value||'system',provider_slug:platform,model_name:model,description:document.getElementById('sysmod-desc').value.trim()||null,vendor:vendorVal,system_type:deriveAssetSystemType(platform,vendorVal),purpose_category:document.getElementById('sysmod-purpose').value||null,risk_tier:document.getElementById('sysmod-tier').value||null,risk_tier_rationale:document.getElementById('sysmod-rationale').value.trim()||null,risk_tier_set_by:document.getElementById('sysmod-tier').value?currentUser.id:null,deployment_status:document.getElementById('sysmod-status').value,system_owner:owner,department:document.getElementById('sysmod-dept').value.trim()||null,notes:notesVal||null};
  const editId=document.getElementById('sysmod-id').value;
  if(!editId){var sysLimit=1;var orgPlan=currentOrg?currentOrg.plan:'free';if(orgPlan==='professional')sysLimit=999;if(activeRegistrySystemCount()>=sysLimit){errEl.textContent='Your '+(orgPlan||'free')+' plan allows '+(sysLimit>=999?'unlimited':sysLimit)+' AI system'+(sysLimit!==1?'s':'')+'. Upgrade to Professional for unlimited systems.';errEl.style.display='block';btn.innerHTML=origH;btn.disabled=false;return}}
  try{if(editId){const{error}=await sb.from('ai_systems').update(payload).eq('id',editId);if(error)throw error;
      var prev=allSystems.find(function(s){return s.id===editId})||{};
      var changes={_actor_name:actorName(),_system_name:payload.name||prev.name};
      Object.keys(payload).forEach(function(k){
        if(k==='org_id'||k==='created_by'||k==='risk_tier_set_by')return;
        var oldVal=prev[k]==null?'':prev[k];
        var newVal=payload[k]==null?'':payload[k];
        if(String(oldVal)!==String(newVal))changes[k]={old:oldVal,new:newVal};
      });
      await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'system_updated',entity_type:'ai_system',entity_id:editId,changes:changes})}
    else{payload.created_by=currentUser.id;const{error}=await sb.from('ai_systems').insert(payload);if(error)throw error}
    closeSystemModal();await loadSystems();if(editId)openSystemDetail(editId);
  }catch(err){errEl.textContent='Error: '+err.message;errEl.style.display='block'}finally{btn.innerHTML=origH;btn.disabled=false}}

document.addEventListener('click',function(e){
  var onBulk=e.target.closest('.reg-bulk');
  var onCheck=e.target.closest('.sys-table .col-check');
  var onRowMenu=e.target.closest('#reg-row-menu');
  var onMore=e.target.closest('.reg-row-more');
  var onTable=e.target.closest('#reg-table-wrap,.sys-table');
  if(regSelectMode&&!onBulk&&!onCheck&&!onTable&&!onRowMenu&&!onMore)setRegSelectMode(false);
  if(!onRowMenu&&!onMore)closeRegRowMenu();
},true);
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  var menu=visibleRegMenu();
  if(menu){
    var sub=menu.querySelector('.reg-menu-panel:not([hidden])');
    if(sub&&sub.getAttribute('data-panel')!=='root'){
      showRegMenuPanel('root');
      return;
    }
  }
  closeRegRowMenu();
  if(regSelectMode)setRegSelectMode(false);
});
document.addEventListener('scroll',function(){closeRegRowMenu()},true);
 
