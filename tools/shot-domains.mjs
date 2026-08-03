import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const LOCAL = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const executablePath = LOCAL.find(p => existsSync(p));
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, rel || 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const browser = await puppeteer.launch({ args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.setRequestInterception(true);
page.on('request', r => {
  const u = r.url();
  if (u.includes('supabase.co') || u.includes('api.stripe.com')) return r.abort();
  r.continue();
});
const MOCK = {
  id: 'preview', risk_band: 'moderate', adjusted_score: 58,
  organisation: 'Acme Financial Ltd', sector: 'Financial Services',
  section_scores: { s1: 44, s2: 61, s3: 33, s4: 33, s5: 60, s6: 47, s7: 53 },
  priority_flags: [{ label: 'No documented AI inventory', basis: 'EU AI Act Art.16, record-keeping obligation', severity: 'high' }],
  regime_flags: [{ label: 'DPIA not completed', basis: 'UK GDPR Art.35', severity: 'moderate' }]
};
await page.goto(`http://localhost:${port}/results.html`, { waitUntil: 'domcontentloaded' });
await page.evaluate(m => sessionStorage.setItem('mla_diagnostic_result', JSON.stringify(m)), MOCK);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 1200));

const cols = await page.evaluate(() => {
  return [...document.querySelectorAll('.domain-item')].map(row => {
    const pct = row.querySelector('.domain-pct').getBoundingClientRect();
    const badge = row.querySelector('.risk-pill').getBoundingClientRect();
    const track = row.querySelector('.domain-track').getBoundingClientRect();
    const cs = getComputedStyle(row);
    return {
      cols: cs.gridTemplateColumns,
      pctX: Math.round(pct.x),
      badgeX: Math.round(badge.x),
      trackX: Math.round(track.x),
      trackW: Math.round(track.width)
    };
  });
});
console.log(JSON.stringify(cols, null, 2));
const aligned = cols.every(c => c.pctX === cols[0].pctX && c.badgeX === cols[0].badgeX && c.trackX === cols[0].trackX);
console.log('aligned:', aligned);

await page.$eval('#domains', el => el.scrollIntoView());
await new Promise(r => setTimeout(r, 200));
const box = await page.$('#domains');
await box.screenshot({ path: '_shot-domains-align.png' });
console.log('wrote _shot-domains-align.png');
await browser.close();
server.close();
