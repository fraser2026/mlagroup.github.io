/* Screenshot results.html (or assessment.html) with mock diagnostic
   data, for actually eyeballing the design instead of guessing.

   Two things make this different from tools/shot.mjs:
   - It seeds sessionStorage then does a real page.reload(), rather
     than re-evaluating init() via CDP — re-invoking a classic
     <script>'s top-level functions in the same realm throws
     "Cannot access X before initialization" on their top-level
     consts (BANDS etc). A reload re-runs the script fresh.
   - Request interception only blocks the real backends (Supabase's
     project URL, Stripe's API, EmailJS's API), never the SDK library
     files themselves — blocking supabase-js's own script tag leaves
     `window.supabase` undefined and throws before init() ever runs,
     which silently renders the page blank.

   Usage:
     node tools/shot-results.mjs out.png
     node tools/shot-results.mjs out.png --band=critical --score=22
*/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const LOCAL_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const executablePath = LOCAL_BROWSERS.find(p => existsSync(p));

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const flag = name => { const hit = args.find(a => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : undefined; };

const ROOT = process.cwd();
const outFile = positional[0] ?? '_shot-results.png';
const band = flag('band') ?? 'moderate';
const score = Number(flag('score') ?? 58);

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, rel || 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({ args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
await page.setRequestInterception(true);
page.on('request', r => {
  const u = r.url();
  if (/\.supabase\.co\//i.test(u) || /api\.stripe\.com/i.test(u) || /api\.emailjs\.com/i.test(u)) return r.abort();
  r.continue();
});

const MOCK = {
  id: 'preview-0000', risk_band: band, adjusted_score: score,
  organisation: 'Acme Financial Ltd', sector: 'Financial Services',
  section_scores: { s1: 33, s2: 76, s3: 67, s4: 58, s5: 81, s6: 42, s7: 89 },
  priority_flags: [{ label: 'No documented AI inventory', basis: 'EU AI Act Art.16 \u2014 record-keeping obligation', severity: 'high' }],
  regime_flags: [
    { label: 'DPIA not completed for customer scoring model', basis: 'UK GDPR Art.35', severity: 'moderate' },
    { label: 'No named AI governance owner', basis: 'FCA SM&CR accountability principle', severity: 'moderate' }
  ]
};

await page.goto(`http://localhost:${port}/results.html`, { waitUntil: 'domcontentloaded' });
await page.evaluate((mock) => sessionStorage.setItem('mla_diagnostic_result', JSON.stringify(mock)), MOCK);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.bringToFront();
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 1200));

// Headless tabs throttle CSS animations, so the report-preview fade-in
// never settles even after a long wait. Force its resting state —
// screenshot-only workaround, not a page change.
await page.evaluate(() => {
  const f = document.querySelector('.rp-face');
  if (f) { f.style.animation = 'none'; f.style.opacity = '1'; }
});

await page.screenshot({ path: outFile, fullPage: true });
console.log('wrote ' + outFile);

async function clipShot(selector, file, pad = 0) {
  const box = await page.evaluate((sel, p) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - p), y: Math.max(0, r.y - p), width: r.width + p * 2, height: r.height + p * 2 };
  }, selector, pad);
  if (!box || box.width <= 0 || box.height <= 0) return;
  await page.screenshot({ path: file, clip: box });
  console.log('wrote ' + file);
}
const base = outFile.replace(/\.png$/, '');
await clipShot('.hero-sec', `${base}-hero.png`, 8);
await clipShot('.paywall-sec', `${base}-paywall.png`, 8);

await browser.close();
server.close();
