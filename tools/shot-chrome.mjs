import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const LOCAL = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
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
  if (/\.supabase\.co\//i.test(u) || /api\.stripe\.com/i.test(u)) return r.abort();
  r.continue();
});
const MOCK = {
  id: 'preview', risk_band: 'moderate', adjusted_score: 58,
  organisation: 'Acme Financial Ltd', sector: 'Financial Services',
  section_scores: { s1: 33, s2: 76, s3: 67, s4: 58, s5: 81, s6: 42, s7: 89 },
  priority_flags: [{ label: 'No documented AI inventory', basis: 'EU AI Act Art.16', severity: 'high' }],
  regime_flags: [{ label: 'DPIA not completed', basis: 'UK GDPR Art.35', severity: 'moderate' }]
};
await page.goto(`http://localhost:${port}/results.html`, { waitUntil: 'domcontentloaded' });
await page.evaluate(m => sessionStorage.setItem('mla_diagnostic_result', JSON.stringify(m)), MOCK);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '_shot-results-chrome-top.png', clip: { x: 0, y: 0, width: 1440, height: 140 } });
await page.evaluate(() => window.scrollTo(0, 1100));
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '_shot-results-chrome-scrolled.png', clip: { x: 0, y: 0, width: 1440, height: 220 } });
const state = await page.evaluate(() => ({
  scrolled: document.getElementById('siteChrome')?.classList.contains('is-scrolled'),
  transform: document.getElementById('scrollProgress')?.style.transform
}));
console.log(JSON.stringify(state));
await browser.close();
server.close();
