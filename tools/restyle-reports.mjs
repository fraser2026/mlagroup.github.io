/**
 * One-shot: replace dark inline <style> in report.html / system-report.html
 * with light board-ready CSS that keeps existing class names for JS/HTML.
 */
import { readFileSync, writeFileSync } from 'fs';

const lightReportCss = `
:root {
  --bg: #FFFFFF;
  --surface-0: #FFFFFF;
  --surface-1: #F6F9FC;
  --surface-2: #F6F9FC;
  --surface-3: #EEF2F7;
  --border: #E6EBF1;
  --border-md: #D6DEE8;
  --border-lg: #0A2540;
  --text-1: #0A0E14;
  --text-2: #425466;
  --text-3: #697386;
  --blue: #533AFD;
  --blue-lt: #533AFD;
  --blue-glow: rgba(83,58,253,0.08);
  --critical: #CD3D64;
  --high: #C45C26;
  --moderate: #92400e;
  --lowmod: #533AFD;
  --low: #24B47E;
  --gold: #0A2540;
  --gold-bg: #F6F9FC;
  --nav-h: 56px;
  --pad: 48px;
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
  line-height:1.6;
  text-transform:none;
}

#ls{position:fixed;inset:0;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1000;transition:opacity .4s ease}
#ls.out{opacity:0;pointer-events:none}
.ls-logo{font-family:var(--font-brand);font-size:1.1rem;font-weight:500;letter-spacing:-.025em;color:var(--text-1);margin-bottom:28px}
.ls-logo em{font-style:normal;font-weight:400;color:var(--text-3)}
.ls-track{width:200px;height:2px;background:var(--border);overflow:hidden}
.ls-fill{height:100%;width:0;background:var(--blue);animation:lp 2s ease forwards}
@keyframes lp{to{width:88%}}
.ls-msg{font-size:.75rem;color:var(--text-3);margin-top:14px;min-height:18px}

#es{display:none;position:fixed;inset:0;background:var(--bg);flex-direction:column;align-items:center;justify-content:center;gap:12px}
#es.show{display:flex}
.es-ico{font-size:1.5rem;opacity:.4;margin-bottom:4px}
.es-title{font-family:var(--font-brand);font-size:1.1rem;font-weight:500;color:var(--text-1)}
.es-msg{font-size:.88rem;color:var(--text-2);max-width:360px;text-align:center;line-height:1.6}
.es-btn{margin-top:12px;padding:10px 20px;background:var(--blue);color:#fff;border:1px solid var(--blue);border-radius:var(--r);font-family:var(--font-body);font-size:.85rem;font-weight:500;cursor:pointer;text-decoration:none;display:inline-block}

#rpt{display:none}
#rpt.show{display:block}

.rnav{position:sticky;top:0;height:var(--nav-h);background:var(--bg);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 28px;z-index:100}
.rnav-logo{font-family:var(--font-brand);font-size:.95rem;font-weight:500;letter-spacing:-.025em;color:var(--text-1);text-decoration:none}
.rnav-logo em{font-style:normal;color:var(--text-3)}
.rnav-links{display:flex;list-style:none;gap:2px}
.rnav-links a{font-size:.78rem;font-weight:400;letter-spacing:.01em;color:var(--text-3);text-decoration:none;padding:6px 10px;border-radius:var(--r);transition:color .15s,background .15s}
.rnav-links a:hover{color:var(--text-1);background:rgba(6,27,49,.04)}
.rnav-links a.act{color:var(--text-1);font-weight:500;box-shadow:inset 0 -1px 0 var(--text-1)}
.rnav-r{display:flex;align-items:center;gap:10px}
.conf-badge{font-size:.72rem;letter-spacing:.02em;color:var(--text-3);border:1px solid var(--border);padding:4px 10px;border-radius:var(--r)}
.pdf-btn{padding:8px 14px;background:var(--blue);color:#fff;border:1px solid var(--blue);border-radius:var(--r);font-family:var(--font-body);font-size:.78rem;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px}
.pdf-btn:hover{filter:brightness(.95)}
.pdf-btn svg{width:13px;height:13px}

.hero{padding:48px 0 32px;position:relative;border-bottom:1px solid var(--border)}
.hero-bg,.hero-grid{display:none!important}
.hero-inner{max-width:920px;margin:0 auto;padding:0 28px;width:100%;display:grid;grid-template-columns:1fr 220px;gap:48px;align-items:center}
.hero-eyebrow{font-family:var(--font-brand);font-size:.72rem;font-weight:500;letter-spacing:.03em;color:var(--text-3);margin-bottom:14px}
.hero-eyebrow::before{content:'';display:inline-block;width:20px;height:1px;background:var(--text-1);margin-right:10px;vertical-align:middle}
.hero-org{font-family:var(--font-brand);font-size:clamp(1.8rem,3.5vw,2.6rem);font-weight:500;line-height:1.1;letter-spacing:-.03em;color:var(--text-1);margin-bottom:14px}
.hero-sub{font-size:.92rem;color:var(--text-2);line-height:1.7;margin-bottom:28px;max-width:520px}
.hero-meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--border)}
.hero-meta-item{padding:12px 14px;border-right:1px solid var(--border)}
.hero-meta-item:last-child{border-right:none}
.hm-label{font-size:.68rem;letter-spacing:.02em;color:var(--text-3);margin-bottom:3px;font-weight:500}
.hm-val{font-size:.84rem;font-weight:500;color:var(--text-1)}

.hero-right{display:flex;flex-direction:column;align-items:center}
.score-wrap{position:relative;width:180px;height:180px}
.score-svg{width:100%;height:100%;transform:rotate(-90deg)}
.sc-track{fill:none;stroke:var(--border);stroke-width:8}
.sc-arc{fill:none;stroke:var(--blue);stroke-width:8;stroke-linecap:round;stroke-dasharray:565.5;stroke-dashoffset:565.5;transition:stroke-dashoffset 1.6s ease}
.sc-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.sc-pct{font-family:var(--font-brand);font-size:2.6rem;font-weight:500;line-height:1;letter-spacing:-.03em;color:var(--text-1);font-feature-settings:'tnum'}
.sc-of{font-size:.75rem;color:var(--text-3);margin-top:2px}
.band-pill{margin-top:14px;display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--border);border-radius:var(--r);background:var(--bg)}
.band-dot{width:6px;height:6px;border-radius:50%;background:var(--blue)}
.band-lbl{font-size:.8rem;font-weight:600;color:var(--text-1)}
.band-head{font-size:.72rem;color:var(--text-3);margin-top:6px;text-align:center;max-width:200px;line-height:1.4}

.rsec{max-width:920px;margin:0 auto;padding:48px 28px;border-bottom:1px solid var(--border)}
.rsec-eyebrow{font-family:var(--font-brand);font-size:.72rem;font-weight:500;letter-spacing:.03em;color:var(--text-3);margin-bottom:10px}
.rsec-title{font-family:var(--font-brand);font-size:1.45rem;font-weight:500;letter-spacing:-.02em;color:var(--text-1);margin-bottom:10px}
.rsec-intro{font-size:.9rem;color:var(--text-2);line-height:1.7;max-width:62ch;margin-bottom:24px}

.verdict-box,.brief-verdict,.acc-gap,.tech-note,.mla-note,.sect-notice{
  border:1px solid var(--border);border-left:2px solid var(--text-1);
  padding:16px 18px;margin:16px 0;background:var(--bg);border-radius:0
}
.bv-eyebrow,.sn-lbl,.acc-lbl,.tn-lbl,.mn-lbl,.dr-lbl{
  font-family:var(--font-brand);font-size:.72rem;font-weight:500;letter-spacing:.02em;color:var(--text-3);margin-bottom:6px
}
.bv-text,.sn-txt,.acc-txt,.tn-txt,.mn-txt,.dr-txt{font-size:.88rem;color:var(--text-2);line-height:1.7}

.card,.pf-card,.dom-card,.bi,.rm-action,.rm-rationale{
  background:var(--bg)!important;border:1px solid var(--border)!important;border-radius:var(--r)!important;
  box-shadow:none!important
}

table{width:100%;border-collapse:collapse;font-size:.85rem;margin:16px 0}
th{text-align:left;font-family:var(--font-brand);font-weight:500;font-size:.72rem;color:var(--text-3);padding:10px 12px;border-bottom:1px solid var(--text-1);letter-spacing:.02em}
td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top;color:var(--text-2);line-height:1.5}

.dom-row,.domain-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)}
.dom-fill,.domain-fill,.sc-fill{background:var(--blue)!important}
.dom-track,.domain-bar{background:var(--border)!important;height:4px!important;border-radius:1px!important;overflow:hidden}

.find-tabs,.ft{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px}
.ft{padding:7px 12px;border:1px solid var(--border);background:var(--bg);border-radius:var(--r);font-size:.78rem;font-weight:500;color:var(--text-3);cursor:pointer}
.ft.act,.ft.active{color:var(--text-1);border-color:var(--text-1)}
.fpanel{display:none}.fpanel.act,.fpanel.active,.fpanel.show{display:block}

.pill,.sev-pill,.badge-high,.badge-medium,.badge-low,.obl-reg,.report-badge{
  text-transform:none!important;letter-spacing:.02em!important;border-radius:var(--r)!important;
  background:transparent!important;border:none!important;padding:0!important;font-weight:600
}

.rfooter{max-width:920px;margin:0 auto;padding:28px;display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-top:1px solid var(--text-1)}
.rf-logo{font-family:var(--font-brand);font-weight:500;color:var(--text-1);text-decoration:none}
.rf-notice{font-size:.75rem;color:var(--text-3);line-height:1.6;max-width:520px}
.rf-ver{font-size:.72rem;color:var(--text-3);text-align:right}

.rm-phase::before{background:var(--border)!important}
.rm-marker{background:var(--blue)!important;border-radius:50%}
.rm-win,.rm-badge,.act-own{text-transform:none!important;letter-spacing:.02em!important;color:var(--text-3)!important;border:1px solid var(--border);padding:2px 8px;border-radius:var(--r);font-size:.68rem;font-weight:500}
.rm-name,.rsec-title,.hero-org{font-family:var(--font-brand)!important;font-weight:500!important}
.act-n{background:var(--surface-1);color:var(--text-1);border-radius:var(--r)!important}

@media(max-width:900px){
  .hero-inner{grid-template-columns:1fr;gap:28px}
  .rnav-links{display:none}
  .rsec{padding:36px 16px}
  .rnav{padding:0 16px}
  .hero-meta{grid-template-columns:1fr 1fr}
  .hero-meta-item:nth-child(2n){border-right:none}
  .rfooter{flex-direction:column}
}
@media print{
  .rnav,.pdf-btn,.find-tabs{display:none!important}
  body{background:#fff}
}
`.trim();

function replaceStyle(path) {
  let html = readFileSync(path, 'utf8');
  const start = html.indexOf('<style>');
  const end = html.indexOf('</style>');
  if (start < 0 || end < 0) throw new Error('No style block in ' + path);
  html = html.slice(0, start) + '<style>\n' + lightReportCss + '\n</style>' + html.slice(end + 8);

  // Fonts
  html = html.replace(
    /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+" rel="stylesheet">/,
    `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`
  );

  // Ensure report skin linked
  if (!html.includes('reganchor-report.css')) {
    html = html.replace(
      '</head>',
      '  <link rel="stylesheet" href="css/reganchor-report.css">\n</head>'
    );
  }

  // Body class
  html = html.replace(/<body([^>]*)>/, (m, attrs) => {
    if (/class=/.test(attrs)) {
      return `<body${attrs.replace(/class="([^"]*)"/, 'class="$1 ra-report"')}>`;
    }
    return `<body class="ra-report"${attrs}>`;
  });

  // color-scheme
  html = html.replace(/content="dark"/, 'content="light"');

  writeFileSync(path, html);
  console.log('Updated', path);
}

replaceStyle('report.html');
replaceStyle('system-report.html');
