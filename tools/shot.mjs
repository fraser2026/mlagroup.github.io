/* Screenshot a page from this repo, for eyeballing the rebrand.

   The portal needs a signed-in Supabase session to populate itself,
   which a screenshot cannot have. So the third-party SDKs are
   blocked at the network layer and the page renders its static
   shell: chrome, typography, spacing, rules, empty states. That is
   exactly the layer the redesign changes, so it is the layer worth
   looking at.

   Usage:
     node tools/shot.mjs portal.html out.png
     node tools/shot.mjs portal.html out.png 1440 900
*/

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

/* Puppeteer's bundled Chromium is a large download and npm's
   allow-scripts policy blocks its postinstall anyway. Any locally
   installed Chromium renders this identically, so prefer one. */
const LOCAL_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const executablePath = LOCAL_BROWSERS.find(p => existsSync(p));

const ROOT = process.cwd();
const [, , pagePath = 'portal.html', outFile = 'shot.png', w = '1440', h = '900', clip] = process.argv;

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
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 2 });

// Block the SDKs that need credentials. Fonts must still load or the
// whole point of the exercise is lost.
await page.setRequestInterception(true);
page.on('request', r => {
  const u = r.url();
  if (/supabase|stripe|emailjs/i.test(u)) return r.abort();
  r.continue();
});

const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(`http://localhost:${port}/${pagePath}`, { waitUntil: 'networkidle2' });
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 400));
// Optional 6th arg "x,y,w,h" crops the shot, for inspecting a rule or
// a single component at a legible scale.
const clipRect = clip
  ? (([x, y, cw, ch]) => ({ x, y, width: cw, height: ch }))(clip.split(',').map(Number))
  : undefined;

await page.screenshot({ path: outFile, fullPage: false, ...(clipRect ? { clip: clipRect } : {}) });

if (errors.length) {
  console.log('page errors (expected where auth was blocked):');
  [...new Set(errors)].forEach(e => console.log('  ' + e.split('\n')[0]));
}
console.log('wrote ' + outFile);

await browser.close();
server.close();
