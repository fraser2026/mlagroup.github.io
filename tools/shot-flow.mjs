/* Multi-step diagnostic screenshots (landing -> prescreen -> s1). */
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

const ROOT = process.cwd();
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json'
};

const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, rel || 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({
  args: ['--no-sandbox'],
  ...(executablePath ? { executablePath } : {})
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

await page.setRequestInterception(true);
page.on('request', r => {
  if (/supabase|stripe|emailjs/i.test(r.url())) return r.abort();
  r.continue();
});

const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(`http://localhost:${port}/diagnostic.html`, { waitUntil: 'networkidle2' });
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 400));

await page.screenshot({ path: 'tools/_shot-diag-landing.png' });
console.log('wrote tools/_shot-diag-landing.png');

await page.click('#screen-landing button.btn-primary');
await page.waitForFunction(() => document.getElementById('screen-prescreen')?.classList.contains('active'));
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'tools/_shot-diag-prescreen.png' });
console.log('wrote tools/_shot-diag-prescreen.png');

// goTo(s1) hits a SECTION_SCREENS TDZ via syncRail in this page; activate S1 via DOM.
await page.evaluate(() => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-s1').classList.add('active');
  window.scrollTo(0, 0);
  document.querySelector('.page')?.classList.add('in-quiz');
  document.getElementById('progressWrap')?.classList.add('visible');
  document.getElementById('siteChrome')?.classList.add('has-steps');
  const label = document.getElementById('progressLabel');
  if (label) label.textContent = 'Section 1 of 7';
  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = '25%';
  const count = document.getElementById('progressCount');
  if (count) count.textContent = 'Step 2 of 8';
  document.querySelectorAll('.q-rail-item').forEach((item, i) => {
    item.classList.toggle('active', i === 0);
    item.classList.toggle('done', false);
  });
});
await page.waitForFunction(() => document.getElementById('screen-s1')?.classList.contains('active'));
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'tools/_shot-diag-s1.png' });
console.log('wrote tools/_shot-diag-s1.png');

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await new Promise(r => setTimeout(r, 200));
await page.screenshot({ path: 'tools/_shot-diag-s1-mobile.png' });
console.log('wrote tools/_shot-diag-s1-mobile.png');

if (errors.length) {
  console.log('page errors:');
  [...new Set(errors)].forEach(e => console.log('  ' + e.split('\n')[0]));
}

await browser.close();
server.close();
console.log('done');
