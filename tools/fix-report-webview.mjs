import fs from 'fs';

const path = 'report.html';
let html = fs.readFileSync(path, 'utf8');

const css = `<style>
/* RegAnchor diagnostic report — board / portal ledger (webview) */
:root {
  --bg: #FFFFFF;
  --surface-1: #F6F9FC;
  --border: #E6EBF1;
  --text-1: #0A0E14;
  --text-2: #425466;
  --text-3: #697386;
  --navy: #0A2540;
  --blue: #533AFD;
  --critical: #CD3D64;
  --high: #C45C26;
  --moderate: #92400e;
  --lowmod: #533AFD;
  --low: #24B47E;
  --nav-h: 56px;
  --r: 4px;
  --font-brand: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  font-family:var(--font-body);
  background:var(--bg);
  color:var(--text-2);
  -webkit-font-smoothing:antialiased;
  line-height:1.65;
  text-transform:none;
}
.ra-report h1,.ra-report h2,.ra-report h3,.ra-report h4{
  font-family:var(--font-brand)!important;
  font-weight:500!important;
  color:var(--text-1);
  letter-spacing:-.02em;
  line-height:1.2;
  text-transform:none!important;
}
.ra-report h2{font-size:1.35rem!important}

#ls{position:fixed;inset:0;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1000;transition:opacity .4s ease}
#ls.out{opacity:0;pointer-events:none}
.ls-logo{font-family:var(--font-brand);font-size:1.1rem;font-weight:500;letter-spacing:-.025em;color:var(--text-1);margin-bottom:28px}
.ls-track{width:200px;height:2px;background:var(--border);overflow:hidden}
.ls-fill{height:100%;width:0;background:var(--blue);animation:lp 2s ease forwards}
@keyframes lp{to{width:88%}}
.ls-msg{font-size:.75rem;color:var(--text-3);margin-top:14px;min-height:18px}

#es{display:none;position:fixed;inset:0;background:var(--bg);flex-direction:column;align-items:center;justify-content:center;gap:12px}
#es.show{display:flex}
.es-ico{font-size:1.5rem;opacity:.35;margin-bottom:4px}
.es-title{font-family:var(--font-brand);font-size:1.1rem;font-weight:500;color:var(--text-1)}
.es-msg{font-size:.88rem;color:var(--text-2);max-width:360px;text-align:center;line-height:1.6}
.es-btn{margin-top:12px;padding:10px 20px;background:var(--blue);color:#fff;border:1px solid var(--blue);border-radius:var(--r);font-family:var(--font-body);font-size:.85rem;font-weight:500;cursor:pointer;text-decoration:none;display:inline-block}

#rpt{display:none}
#rpt.show{display:block}

.rnav{position:sticky;top:0;height:var(--nav-h);background:var(--bg);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 28px;z-index:100}
.rnav-logo{font-family:var(--font-brand);font-size:.95rem;font-weight:500;letter-spacing:-.025em;color:var(--text-1);text-decoration:none}
.rnav-links{display:flex;list-style:none;gap:2px}
.rnav-links a{font-size:.78rem;font-weight:400;color:var(--text-3);text-decoration:none;padding:6px 10px;border-radius:var(--r)}
.rnav-links a:hover{color:var(--text-1);background:rgba(6,27,49,.04)}
.rnav-links a.act{color:var(--text-1);font-weight:500;box-shadow:inset 0 -1px 0 var(--text-1)}
.rnav-r{display:flex;align-items:center;gap:10px}
.conf-badge{font-size:.72rem;color:var(--text-3);border:1px solid var(--border);padding:4px 10px;border-radius:var(--r)}
.pdf-btn{padding:8px 14px;background:var(--blue);color:#fff;border:1px solid var(--blue);border-radius:var(--r);font-family:var(--font-body);font-size:.78rem;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px}
.pdf-btn:hover{filter:brightness(.95)}
.pdf-btn svg{width:13px;height:13px}

.hero{padding:40px 0 36px;border-bottom:1px solid var(--border)}
.hero-bg,.hero-grid,.hero-scroll{display:none!important}
.hero-inner{max-width:920px;margin:0 auto;padding:0 28px;width:100%;display:grid;grid-template-columns:1fr 200px;gap:40px;align-items:center}
.hero-eyebrow{font-family:var(--font-brand);font-size:.72rem;font-weight:500;color:var(--text-3);margin-bottom:12px}
.hero-org{font-family:var(--font-brand);font-size:clamp(1.7rem,3vw,2.25rem)!important;font-weight:500;letter-spacing:-.03em;color:var(--text-1);margin-bottom:12px}
.hero-sub{font-size:.92rem;color:var(--text-2);line-height:1.7;margin-bottom:24px;max-width:520px}
.hero-meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--border)}
.hero-meta-item{padding:12px 14px;border-right:1px solid var(--border)}
.hero-meta-item:last-child{border-right:none}
.hm-label{font-size:.68rem;color:var(--text-3);margin-bottom:3px;font-weight:500}
.hm-val{font-size:.84rem;font-weight:500;color:var(--text-1)}
.hero-right{display:flex;flex-direction:column;align-items:center}
.score-wrap{position:relative;width:168px;height:168px}
.score-svg{width:100%;height:100%;transform:rotate(-90deg)}
.sc-track{fill:none;stroke:var(--border);stroke-width:8}
.sc-arc{fill:none;stroke:var(--blue);stroke-width:8;stroke-linecap:round;stroke-dasharray:565.5;stroke-dashoffset:565.5;transition:stroke-dashoffset 1.6s ease}
.sc-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.sc-pct{font-family:var(--font-brand);font-size:2.4rem;font-weight:500;line-height:1;letter-spacing:-.03em;color:var(--text-1);font-feature-settings:'tnum'}
.sc-lbl{font-size:.72rem;color:var(--text-3);margin-top:4px}
.band-pill{margin-top:14px;display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg);color:var(--text-1)!important}
.band-dot{width:6px;height:6px;border-radius:50%;background:var(--blue)}
.band-lbl{font-size:.8rem;font-weight:600;color:var(--text-1)}
.band-head{font-size:.72rem;color:var(--text-3);margin-top:6px;text-align:center;max-width:200px;line-height:1.4}

.rsec{max-width:920px;margin:0 auto;padding:44px 28px;border-bottom:1px solid var(--border)}
.sec-hdr{margin-bottom:24px}
.sec-num,.rsec-eyebrow{font-family:var(--font-brand);font-size:.72rem;font-weight:500;color:var(--text-3);margin-bottom:8px}
.sec-title,.rsec-title{font-family:var(--font-brand)!important;font-size:1.35rem!important;font-weight:500!important;letter-spacing:-.02em;color:var(--text-1);margin-bottom:10px}
.sec-intro,.rsec-intro{font-size:.9rem;color:var(--text-2);line-height:1.7;max-width:62ch}

.verdict-box,.brief-verdict,.acc-gap,.tech-note,.mla-note,.sect-notice,.bench-box{
  border:1px solid var(--border);border-left:2px solid var(--text-1);
  padding:16px 18px;margin:16px 0;background:var(--bg);color:var(--text-2)!important
}
.bv-eyebrow,.sn-lbl,.acc-lbl,.tn-lbl,.mn-lbl,.dr-lbl,.bench-lbl{
  font-family:var(--font-brand);font-size:.72rem;font-weight:500;color:var(--text-3)!important;margin-bottom:6px
}
.bv-text,.sn-txt,.acc-txt,.tn-txt,.mn-txt,.dr-txt,.bench-txt{font-size:.88rem;color:var(--text-2)!important;line-height:1.7}

table{width:100%;border-collapse:collapse;font-size:.85rem;margin:16px 0}
th{text-align:left;font-family:var(--font-brand);font-weight:500;font-size:.72rem;color:var(--text-3);padding:10px 12px;border-bottom:1px solid var(--text-1)}
td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top;color:var(--text-2);line-height:1.5}
.obl-reg,.rn{display:block;font-weight:500;color:var(--text-1);font-size:.84rem}
.obl-art,.ra,.dw{display:block;font-size:.72rem;color:var(--text-3);margin-top:2px}
.dn{font-weight:500;color:var(--text-1);font-size:.84rem}
.s-alert{color:var(--critical);font-weight:600;font-size:.78rem}
.s-warn{color:var(--high);font-weight:500;font-size:.78rem}
.s-ok{color:var(--low);font-weight:500;font-size:.78rem}
.dl-now{color:var(--critical);font-weight:600;font-size:.78rem}
.dl-aug{color:var(--high);font-weight:500;font-size:.78rem}
.t-mand{font-weight:500;color:var(--text-1);font-size:.78rem}
.t-adv{color:var(--text-3);font-size:.78rem}
.rc-penalty{font-size:.8rem}
.rbadge{font-size:.72rem;font-weight:600;color:var(--text-3)!important;background:transparent!important;padding:0!important;border:none!important}
.rbadge.is-risk{color:var(--critical)!important}
.rbadge.is-warn{color:var(--high)!important}
.rbadge.is-ok{color:var(--low)!important}
.mbar-t{width:88px;height:4px;background:var(--border);overflow:hidden;border-radius:1px}
.mbar-f{height:100%;background:var(--blue)!important;border-radius:1px}

.board-items{display:flex;flex-direction:column;gap:0;border:1px solid var(--border)}
.bi{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border-bottom:1px solid var(--border);background:var(--bg)!important;border-radius:0!important;box-shadow:none!important;border-left:none!important;border-right:none!important;border-top:none!important}
.bi:last-child{border-bottom:none}
.bi-num{font-family:var(--font-brand);font-size:.84rem;font-weight:500;color:var(--text-3);min-width:20px;font-feature-settings:'tnum'}
.bi-txt{font-size:.9rem;color:var(--text-1);line-height:1.55;font-weight:500}

.dash-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:28px;align-items:start;margin-bottom:8px}
.radar-card{border:1px solid var(--border);padding:16px}
.radar-lbl{font-family:var(--font-brand);font-size:.72rem;font-weight:500;color:var(--text-3);margin-bottom:8px}
#radar-svg{width:100%;height:auto;display:block}

.find-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.ft{padding:7px 12px;border:1px solid var(--border);background:var(--bg);border-radius:var(--r);font-family:var(--font-body);font-size:.78rem;font-weight:500;color:var(--text-3);cursor:pointer}
.ft.act,.ft.active{color:var(--text-1);border-color:var(--text-1);background:var(--surface-1)}
.fpanel{display:none}.fpanel.act,.fpanel.active,.fpanel.show{display:block}

.pf-card{
  position:relative;padding:20px 20px 20px 22px;margin-bottom:0;
  background:var(--bg)!important;border:1px solid var(--border)!important;border-left:2px solid var(--text-1)!important;
  border-radius:0!important;box-shadow:none!important
}
.pf-card + .pf-card{border-top:none!important}
.pf-ghost{display:none}
.pf-meta{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.pf-id{font-family:var(--font-brand);font-size:.72rem;font-weight:500;color:var(--text-3)}
.pf-sev{font-size:.72rem;font-weight:600;text-transform:none!important}
.pf-sect{font-size:.72rem;color:var(--text-3)}
.pf-label{font-family:var(--font-brand);font-size:1.05rem;font-weight:500;color:var(--text-1);letter-spacing:-.015em;margin-bottom:8px;line-height:1.35}
.pf-basis{font-size:.84rem;color:var(--text-3);margin-bottom:14px;line-height:1.55}
.pf-impact-blk,.pf-rec{margin-top:14px}
.pf-impact-lbl,.pf-rec-lbl{font-size:.72rem;font-weight:500;color:var(--text-3);margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--border)}
.pf-impact,.pf-rec-txt{font-size:.88rem;color:var(--text-2);line-height:1.7}

.dom-card{background:var(--bg)!important;border:1px solid var(--border)!important;border-radius:0!important;box-shadow:none!important;overflow:hidden}
.dom-band{padding:20px 20px 18px;border-bottom:1px solid var(--border);background:var(--surface-1);color:inherit!important}
.dom-band-inner{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end}
.dom-concept-tag{font-size:.72rem;font-weight:500;color:var(--text-3);margin-bottom:8px}
.dom-concept-name{font-family:var(--font-brand);font-size:1.35rem;font-weight:500;color:var(--text-1);letter-spacing:-.02em;line-height:1.25;margin-bottom:0}
.dom-name{display:none}
.dom-score-wrap{text-align:right;min-width:140px}
.dom-score{display:block;font-family:var(--font-brand);font-size:2rem;font-weight:500;color:var(--text-1);letter-spacing:-.03em;font-feature-settings:'tnum';line-height:1}
.dom-score-meta{font-size:.68rem;color:var(--text-3);margin:6px 0 8px}
.dom-meter{width:140px;height:4px;background:var(--border);border-radius:1px;overflow:hidden;margin-left:auto;margin-bottom:8px}
.dom-meter > span{display:block;height:100%;background:var(--blue);border-radius:1px}
.dom-status-pill{font-size:.78rem;font-weight:600;color:var(--text-3)}
.dom-status-pill.is-risk{color:var(--critical)}
.dom-status-pill.is-warn{color:var(--high)}
.dom-status-pill.is-ok{color:var(--low)}
.dom-body{padding:8px 20px 20px}
.db-blk{padding:16px 0;border-bottom:1px solid var(--border)}
.db-blk:last-child{border-bottom:none}
.db-lbl{font-size:.72rem;font-weight:500;color:var(--text-3);margin-bottom:6px}
.db-txt{font-size:.9rem;color:var(--text-2);line-height:1.7}
.dom-rec{margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}

.rm-phases{display:flex;flex-direction:column;gap:28px}
.rm-phase{display:block;padding:0;border:none}
.rm-side{margin-bottom:12px}
.rm-marker{display:none!important}
.rm-win{display:inline-block;font-size:.72rem;font-weight:500;color:var(--text-3)!important;border:1px solid var(--border)!important;background:var(--surface-1)!important;padding:4px 10px;border-radius:var(--r);margin-bottom:10px}
.rm-name{font-family:var(--font-brand)!important;font-size:1.15rem!important;font-weight:500!important;color:var(--text-1);margin:0 0 6px;letter-spacing:-.015em}
.rm-badge{display:inline-block;font-size:.72rem;font-weight:500;color:var(--text-3)!important;background:transparent!important;border:none!important;padding:0!important;margin-bottom:8px}
.rm-rationale{font-size:.88rem;color:var(--text-2);line-height:1.65;margin-bottom:14px;padding:0!important;border:none!important;background:transparent!important}
.rm-actions{border:1px solid var(--border)}
.rm-action{
  display:grid!important;grid-template-columns:36px 1fr auto;gap:12px;align-items:start;
  padding:12px 14px!important;margin:0!important;
  background:var(--bg)!important;border:none!important;border-bottom:1px solid var(--border)!important;
  border-radius:0!important;box-shadow:none!important
}
.rm-action:last-child{border-bottom:none!important}
.act-n{
  width:28px!important;height:28px!important;min-width:28px;max-width:28px;
  display:flex;align-items:center;justify-content:center;
  font-family:var(--font-brand);font-size:.84rem;font-weight:500;font-feature-settings:'tnum';
  background:var(--surface-1)!important;color:var(--text-1)!important;border:1px solid var(--border);
  border-radius:var(--r)!important;line-height:1;flex-shrink:0
}
.act-txt{font-size:.9rem;color:var(--text-1);line-height:1.5;font-weight:500;padding-top:4px}
.act-own{font-size:.72rem;font-weight:500;color:var(--text-3)!important;border:none!important;padding:4px 0 0!important;background:transparent!important;white-space:nowrap}
.rm-del{margin-top:12px;font-size:.78rem;color:var(--text-3)!important;line-height:1.5}

.fwd-paras{display:flex;flex-direction:column;gap:16px}
.fwd-p{font-size:.9rem;color:var(--text-2);line-height:1.75}

.rfooter{max-width:920px;margin:0 auto;padding:28px;display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-top:1px solid var(--text-1)}
.rf-logo{font-family:var(--font-brand);font-weight:500;color:var(--text-1);text-decoration:none}
.rf-notice{font-size:.75rem;color:var(--text-3);line-height:1.6;max-width:520px}
.rf-ver{font-size:.72rem;color:var(--text-3);text-align:right}

@media(max-width:900px){
  .hero-inner,.dash-grid,.dom-band-inner{grid-template-columns:1fr;gap:20px}
  .dom-score-wrap{text-align:left}
  .dom-meter{margin-left:0}
  .rnav-links{display:none}
  .rsec{padding:36px 16px}
  .rnav{padding:0 16px}
  .hero-meta{grid-template-columns:1fr 1fr}
  .hero-meta-item:nth-child(2n){border-right:none}
  .rm-action{grid-template-columns:28px 1fr}
  .act-own{grid-column:2;padding-top:0!important}
  .rfooter{flex-direction:column}
}
@media print{
  .rnav,.pdf-btn,.find-tabs{display:none!important}
  body{background:#fff}
}
</style>`;

const start = html.indexOf('<style>');
const end = html.indexOf('</style>') + 8;
if (start < 0 || end < 8) throw new Error('style block not found');
html = html.slice(0, start) + css + html.slice(end);
fs.writeFileSync(path, html);
console.log('CSS replaced OK');
