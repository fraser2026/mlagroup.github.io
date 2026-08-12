// ═══ REGISTRY: LOAD ═══════════════════════════════════════════
async function loadSystems(){
  if(!currentOrg)return;
  var results=await Promise.all([
    sb.from('ai_systems').select('*,system_compliance(id,status)').eq('org_id',currentOrg.id).order('updated_at',{ascending:false}),
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
  var totalMeta=document.getElementById('reg-total-meta');
  if(totalMeta){
    totalMeta.textContent=thisMonthCount>0?('+'+thisMonthCount+' this month'):'';
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
  var list=regFilter==='all'?allSystems:allSystems.filter(function(s){return s.deployment_status===regFilter});
  var q=(regSearchQuery||'').trim().toLowerCase();
  if(!q)return list;
  return list.filter(function(s){
    var name=(s.name||'').toLowerCase();
    var tier=(TIER_LABELS[s.risk_tier]||'Unclassified').toLowerCase();
    var status=(STATUS_LABELS[s.deployment_status]||s.deployment_status||'').toLowerCase();
    return name.indexOf(q)!==-1||tier.indexOf(q)!==-1||status.indexOf(q)!==-1;
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
  return ((sys.name||'')+' '+(TIER_LABELS[sys.risk_tier]||'Unclassified')+' '+(STATUS_LABELS[sys.deployment_status]||sys.deployment_status||'')).toLowerCase();
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
function toggleRegSelect(id,on){
  if(on)regSelected[id]=true;else delete regSelected[id];
  syncRegBulkChrome();
}
function onRegCheckCell(ev,id){
  ev.stopPropagation();
  var input=ev.currentTarget.querySelector('.sys-check');
  if(!input)return;
  input.checked=!input.checked;
  toggleRegSelect(id,input.checked);
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
var REG_EXPORT_SYS_ORDER=['id','name','description','vendor','system_type','department','system_owner','notes','purpose_category','risk_tier','risk_tier_rationale','deployment_status','created_at','updated_at'];
var REG_EXPORT_ASSESS_SKIP={id:true,org_id:true,system_id:true,answers:true};
var REG_EXPORT_LABELS={
  id:'System ID',name:'System name',description:'Description',vendor:'Vendor',
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
  var mw=menu.offsetWidth||220;
  var mh=menu.offsetHeight;
  var top=r.bottom+4;
  if(top+mh>window.innerHeight-8)top=Math.max(8,r.top-mh-4);
  var left=r.right-mw;
  if(left<8)left=8;
  menu.style.top=top+'px';
  menu.style.left=left+'px';
  menu.style.right='auto';
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
  if(menu)resetRegMenuPanel(menu);
  positionRegRowMenu(btn);
}
function requestSystemAssessment(sysId){
  if(!sysId)return;
  currentSystemId=sysId;
  window.location.href='assessment.html?system_id='+encodeURIComponent(sysId);
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
  if(menu.id==='reg-row-menu'){
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
  var logs=ids.map(function(id){
    return {org_id:currentOrg.id,user_id:currentUser.id,action:'system_updated',entity_type:'ai_system',entity_id:id,changes:{_actor_name:actorName()}};
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
function runRegRowAction(action){
  var sys=allSystems.find(function(s){return s.id===regRowMenuId});
  if(!sys){closeRegRowMenu();return}
  if(action==='export'){closeRegRowMenu();exportRegistrySystems([sys]);return}
  if(action==='assess'){closeRegRowMenu();requestSystemAssessment(sys.id);return}
  if(action==='status'||action==='owner'||action==='retire'){showRegMenuPanel(action);return}
}
function runRegBulk(action){
  var selected=selectedRegistrySystems();
  if(!selected.length)return;
  if(action==='export'){exportSelectedSystems();return}
  if(action==='assess'){
    if(selected.length===1){requestSystemAssessment(selected[0].id);return}
    closeRegBulk();
    return;
  }
  if(action==='status'||action==='owner'||action==='retire'){showRegMenuPanel(action);return}
  closeRegBulk();
}
function renderSystemTable(opts){
  pruneRegSelected();
  closeRegRowMenu();
  var filtered=regFilter==='all'?allSystems:allSystems.filter(function(s){return s.deployment_status===regFilter});
  if(!filtered.length){
    var none=allSystems.length===0;
    document.getElementById('reg-table-wrap').innerHTML='<div class="empty-state"><h4>'+(none?'No systems registered yet':'No systems match this filter')+'</h4><p>'+(none?'Register your first AI system.':'Try a different filter.')+'</p>'+(none?'<button class="btn-dl" onclick="openAddSystem()"><svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg>Register First System</button>':'')+'</div>';
    syncRegBulkChrome();
    return;
  }
  var allOn=filtered.length&&filtered.every(function(s){return regSelected[s.id]});
  document.getElementById('reg-table-wrap').innerHTML='<div class="table-scroll"><table class="sys-table'+(regSelectMode?' is-selecting':'')+'"><thead><tr><th class="col-check" onclick="onRegCheckAll(event)"><input type="checkbox" id="reg-select-all" aria-label="Select all systems"'+(allOn?' checked':'')+' onchange="toggleRegSelectAll(this.checked)"></th><th>System</th><th>Risk class</th><th>Status</th><th class="col-maturity">Maturity</th><th>Updated</th><th class="col-more" aria-label="Actions"></th></tr></thead><tbody>'+filtered.map(function(sys){
    var tier=sys.risk_tier||'none';
    var score=systemMaturityScore(sys);
    var on=!!regSelected[sys.id];
    return '<tr data-haystack="'+esc(systemSearchHaystack(sys))+'" onclick="openSystemDetail(\''+sys.id+'\')">'+
      '<td class="col-check" onclick="onRegCheckCell(event,\''+sys.id+'\')"><input class="sys-check" type="checkbox" aria-label="Select '+esc(sys.name)+'"'+(on?' checked':'')+' onchange="toggleRegSelect(\''+sys.id+'\',this.checked)"></td>'+
      '<td><div class="sys-name">'+esc(sys.name)+'</div><div class="sys-desc">'+esc(sys.description||'')+'</div></td>'+
      '<td><span class="tier-pill tier-'+tier+'">'+(TIER_LABELS[tier]||'Unclassified')+'</span></td>'+
      '<td><span class="status-pill status-'+sys.deployment_status+'">'+(STATUS_LABELS[sys.deployment_status]||sys.deployment_status)+'</span></td>'+
      '<td class="col-maturity">'+regMaturityCell(score,!(opts&&opts.quiet))+'</td>'+
      '<td class="col-date">'+fmtDate(sys.updated_at)+'</td>'+
      '<td class="col-more" onclick="event.stopPropagation()"><button type="button" class="reg-row-more" aria-label="Actions for '+esc(sys.name)+'" aria-haspopup="menu" aria-expanded="false" onclick="toggleRegRowMenu(event,\''+sys.id+'\')"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3.5" r="1.35"/><circle cx="8" cy="8" r="1.35"/><circle cx="8" cy="12.5" r="1.35"/></svg></button></td>'+
    '</tr>';
  }).join('')+'</tbody></table></div><div class="empty-state" id="reg-search-empty" hidden><h4>No systems match this search</h4><p>Try a different name, risk class, or status.</p></div>';
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
 
async function openSystemDetail(sysId){
  currentSystemId=sysId;const sys=allSystems.find(s=>s.id===sysId);if(!sys)return;
  const[{data:assessments},{data:auditLog}]=await Promise.all([sb.from('registry_assessments').select('*').eq('system_id',sysId).order('requested_at',{ascending:false}),sb.from('registry_audit_log').select('*').eq('entity_id',sysId).order('created_at',{ascending:false})]);
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
  document.getElementById('tab-overview').innerHTML='<div class="detail-desc"><div class="stat-label">Description</div><p>'+esc(sys.description||'No description provided.')+'</p></div><div class="meta-grid"><div class="meta-item"><label>System ID</label><span class="meta-id">'+esc(sys.id)+'</span></div><div class="meta-item"><label>System Type</label><span>'+esc(TYPE_LABELS[sys.system_type]||'Not set')+'</span></div><div class="meta-item"><label>Vendor</label><span>'+esc(sys.vendor||'Not set')+'</span></div><div class="meta-item"><label>Department</label><span>'+esc(sys.department||'Not set')+'</span></div><div class="meta-item"><label>System Owner</label><span>'+esc(sys.system_owner||'Not set')+'</span></div><div class="meta-item"><label>Deployment</label><span><span class="status-pill status-'+sys.deployment_status+'">'+(STATUS_LABELS[sys.deployment_status]||'Not set')+'</span></span></div><div class="meta-item"><label>Purpose Category</label><span>'+esc(sys.purpose_category?sys.purpose_category.replace(/_/g,' '):'Not set')+'</span></div><div class="meta-item"><label>Risk Tier</label><span><span class="tier-pill tier-'+tier+'">'+(TIER_LABELS[tier]||'Unclassified')+'</span></span></div>'+(sys.risk_tier_rationale?'<div class="meta-item" style="grid-column:1/-1;"><label>Classification Rationale</label><span>'+esc(sys.risk_tier_rationale)+'</span></div>':'')+'<div class="meta-item"><label>Registered</label><span>'+fmtDate(sys.created_at)+'</span></div><div class="meta-item"><label>Last Updated</label><span>'+fmtDate(sys.updated_at)+'</span></div></div>';
  // Assessment tab
  renderAssessmentTab(assessments||[]);
  // System controls tab
  await renderSystemControlsTab(sysId);
  // Audit with names
  const logs=auditLog||[];
  if(!logs.length)document.getElementById('tab-audit').innerHTML='<div class="empty-state" style="padding:28px 0;"><h4>No audit entries</h4><p>Entries are created automatically on system changes.</p></div>';
  else{const nm=await loadNames(logs.map(e=>e.user_id));document.getElementById('tab-audit').innerHTML='<div class="audit-timeline">'+logs.map((entry,i)=>{const a=fmtAudit(entry,nm);return '<div class="audit-item"><div class="audit-line"><div class="audit-node"></div>'+(i<logs.length-1?'<div class="audit-connector"></div>':'')+'</div><div class="audit-content"><div class="audit-action">'+a.text+'</div><div class="audit-meta">'+esc(a.who)+' · '+a.time+'</div></div></div>'}).join('')+'</div>'}
  // Reset tabs
  document.querySelectorAll('#view-registry-detail .tab-btn').forEach(b=>b.classList.remove('active'));document.querySelectorAll('#view-registry-detail .tab-btn')[0].classList.add('active');
  document.querySelectorAll('#view-registry-detail .tab-panel').forEach(p=>p.classList.remove('active'));document.getElementById('tab-overview').classList.add('active');
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

function switchDetailTab(id,btn){
  document.querySelectorAll('#view-registry-detail .tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#view-registry-detail .tab-panel').forEach(p=>p.classList.remove('active'));
  var panel=document.getElementById('tab-'+id);
  if(panel)panel.classList.add('active');
  if(id==='assessment'){
    animateDomainBars(panel);
    animateMaturity(panel);
  }
}
 
// ═══ ADD/EDIT SYSTEM ══════════════════════════════════════════
function openAddSystem(){var orgPlan=currentOrg?currentOrg.plan:'free';var sysLimit=(orgPlan==='professional')?999:1;if(allSystems.length>=sysLimit){var sysMsg='';if(orgPlan==='essentials')sysMsg='You have reached your Essentials plan limit of 1 AI system. Upgrade for unlimited systems, multi-user access, and more.';else if(orgPlan==='professional')sysMsg='Need more from your governance platform? Enterprise includes unlimited users, dedicated advisory, and more.';else sysMsg='You have reached your free plan limit of 1 AI system. Subscribe to unlock more systems, governance certification, and more.';openUpgradeModal(sysMsg);return}document.getElementById('sysmod-id').value='';document.getElementById('sysmod-title').textContent='Register AI System';document.getElementById('sysmod-sub').textContent='Add a new system to the governance registry';document.getElementById('sysmod-submit').innerHTML='<svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10"/></svg> Register System';clearSystemForm();document.getElementById('system-modal').classList.add('open')}
function openEditSystem(){const sys=allSystems.find(s=>s.id===currentSystemId);if(!sys)return;document.getElementById('sysmod-id').value=sys.id;document.getElementById('sysmod-title').textContent='Edit System';document.getElementById('sysmod-sub').textContent=sys.name;document.getElementById('sysmod-submit').innerHTML='Save Changes';document.getElementById('sysmod-name').value=sys.name||'';document.getElementById('sysmod-desc').value=sys.description||'';document.getElementById('sysmod-vendor').value=sys.vendor||'';document.getElementById('sysmod-type').value=sys.system_type||'';document.getElementById('sysmod-purpose').value=sys.purpose_category||'';document.getElementById('sysmod-tier').value=sys.risk_tier||'';document.getElementById('sysmod-status').value=sys.deployment_status||'planned';document.getElementById('sysmod-rationale').value=sys.risk_tier_rationale||'';document.getElementById('sysmod-owner').value=sys.system_owner||'';document.getElementById('sysmod-dept').value=sys.department||'';document.getElementById('sysmod-notes').value=sys.notes||'';onPurposeChange();document.getElementById('system-modal').classList.add('open')}
function clearSystemForm(){['sysmod-name','sysmod-desc','sysmod-vendor','sysmod-rationale','sysmod-owner','sysmod-dept','sysmod-notes'].forEach(id=>document.getElementById(id).value='');document.getElementById('sysmod-type').value='';document.getElementById('sysmod-purpose').value='';document.getElementById('sysmod-tier').value='';document.getElementById('sysmod-status').value='planned';document.getElementById('sysmod-tier-hint').style.display='none';document.getElementById('sysmod-rationale-wrap').style.display='none';document.getElementById('sysmod-error').style.display='none'}
function closeSystemModal(){document.getElementById('system-modal').classList.remove('open')}
function onPurposeChange(){const purpose=document.getElementById('sysmod-purpose').value;const suggested=PURPOSE_TIER_MAP[purpose];const hint=document.getElementById('sysmod-tier-hint');const tierSel=document.getElementById('sysmod-tier');const rw=document.getElementById('sysmod-rationale-wrap');
  if(suggested){hint.innerHTML='Suggested tier: <strong>'+(TIER_LABELS[suggested])+'</strong>, based on EU AI Act Annex III.';hint.style.display='block';tierSel.value=suggested}else if(purpose==='other'){hint.innerHTML='Please classify manually.';hint.style.display='block'}else hint.style.display='none';
  rw.style.display=(tierSel.value&&tierSel.value!==suggested)?'block':'none';tierSel.onchange=()=>{rw.style.display=(tierSel.value&&tierSel.value!==suggested)?'block':'none'}}
async function submitSystem(){
  const name=document.getElementById('sysmod-name').value.trim();const owner=document.getElementById('sysmod-owner').value.trim();const errEl=document.getElementById('sysmod-error');
  if(!name||!owner){errEl.textContent='System name and owner are required.';errEl.style.display='block';return}errEl.style.display='none';
  const btn=document.getElementById('sysmod-submit');const origH=btn.innerHTML;btn.textContent='Saving…';btn.disabled=true;if(!currentOrg)await ensureOrg();
  const payload={org_id:currentOrg.id,name,description:document.getElementById('sysmod-desc').value.trim()||null,vendor:document.getElementById('sysmod-vendor').value.trim()||null,system_type:document.getElementById('sysmod-type').value||null,purpose_category:document.getElementById('sysmod-purpose').value||null,risk_tier:document.getElementById('sysmod-tier').value||null,risk_tier_rationale:document.getElementById('sysmod-rationale').value.trim()||null,risk_tier_set_by:document.getElementById('sysmod-tier').value?currentUser.id:null,deployment_status:document.getElementById('sysmod-status').value,system_owner:owner,department:document.getElementById('sysmod-dept').value.trim()||null,notes:document.getElementById('sysmod-notes').value.trim()||null};
  const editId=document.getElementById('sysmod-id').value;
  if(!editId){var sysLimit=1;var orgPlan=currentOrg?currentOrg.plan:'free';if(orgPlan==='professional')sysLimit=999;if(allSystems.length>=sysLimit){errEl.textContent='Your '+(orgPlan||'free')+' plan allows '+(sysLimit>=999?'unlimited':sysLimit)+' AI system'+(sysLimit!==1?'s':'')+'. Upgrade to Professional for unlimited systems.';errEl.style.display='block';btn.innerHTML=origH;btn.disabled=false;return}}
  try{if(editId){const{error}=await sb.from('ai_systems').update(payload).eq('id',editId);if(error)throw error;await sb.from('registry_audit_log').insert({org_id:currentOrg.id,user_id:currentUser.id,action:'system_updated',entity_type:'ai_system',entity_id:editId,changes:{_actor_name:actorName()}})}
    else{payload.created_by=currentUser.id;const{error}=await sb.from('ai_systems').insert(payload);if(error)throw error}
    closeSystemModal();await loadSystems();if(editId)openSystemDetail(editId);
  }catch(err){errEl.textContent='Error: '+err.message;errEl.style.display='block'}finally{btn.innerHTML=origH;btn.disabled=false}}

document.addEventListener('click',function(e){
  var onBulk=e.target.closest('.reg-bulk');
  var onCheck=e.target.closest('.sys-table .col-check');
  var onRowMenu=e.target.closest('#reg-row-menu');
  var onMore=e.target.closest('.reg-row-more');
  if(regSelectMode&&!onBulk&&!onCheck&&!onRowMenu&&!onMore)setRegSelectMode(false);
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
 
