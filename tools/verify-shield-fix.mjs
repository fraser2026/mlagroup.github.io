import puppeteer from 'puppeteer';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = readFileSync(join(root, 'js/ra-svg-sharp.js'), 'utf8');
const bg = '#0A0E14';

const html = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="../css/reganchor.css">
<style>body{margin:0;background:${bg};padding:32px;display:flex;gap:48px;align-items:flex-end}
.col h3{margin:0 0 12px;font:12px Inter,sans-serif;color:rgba(255,255,255,.5)}
.broken img{display:block;height:32px}
</style></head><body>
<div class="col"><h3>broken img</h3><div class="broken"><img src="../brand/mark-shield.svg" height="32" alt=""></div></div>
<div class="col"><h3>ra-svg-sharp</h3>
<div class="ra-svg-sharp ra-svg-sharp--on-dark" data-ra-svg-sharp="../brand/mark-shield.svg" style="--ra-svg-w:66;--ra-svg-h:32" role="img"></div>
</div>
<script>${js}</script>
</body></html>`;

writeFileSync(join(root, 'tools/shield-compare-temp.html'), html);

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')].find(existsSync);
const browser = await puppeteer.launch({ headless: 'new', ...(exe ? { executablePath: exe } : {}) });
const page = await browser.newPage();
await page.setViewport({ width: 500, height: 200, deviceScaleFactor: 2 });
await page.goto('file:///' + join(root, 'tools/shield-compare-temp.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));
writeFileSync(join(root, 'tools/render-tests/16-production-fix.png'), await page.screenshot({ type: 'png' }));
await browser.close();
console.log('Wrote 16-production-fix.png');
