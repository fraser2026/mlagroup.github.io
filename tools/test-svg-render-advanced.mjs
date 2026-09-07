/**
 * Test advanced SVG fixes for tapered-tip aliasing on dark bg.
 */
import puppeteer from 'puppeteer';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tools/render-tests');
mkdirSync(outDir, { recursive: true });

let svg = readFileSync(join(root, 'brand/mark-shield-new.svg'), 'utf8');
const bg = '#0A0E14';
const h = 32;
const w = Math.round(h * (310.56 / 151.62));

const clipped = svg
  .replace('viewBox="0 0 310.56 151.62"', 'viewBox="0 0 298 151.62"')
  .replace(/width="[^"]*"/, '')
  .replace(/height="[^"]*"/, '');

const withOpacity = svg.replace('<svg', '<g opacity="0.84"><svg').replace('</svg>', '</svg></g>').replace(/<svg[^>]*>/, (m) => m.replace('<svg', '<svg style="display:block"'));

const withFilter = svg.replace(
  '<defs>',
  `<defs><filter id="soft" x="-2%" y="-2%" width="104%" height="104%"><feGaussianBlur stdDeviation="0.35" /></filter>`
).replace('<path', '<path filter="url(#soft)"');

const techniques = {
  '07-viewbox-clip': clipped.replace('<svg', `<svg style="display:block;width:${w}px;height:${h}px" shape-rendering="geometricPrecision"`),
  '08-opacity-084': svg.replace('<svg', `<svg style="display:block;width:${w}px;height:${h}px;opacity:.84" shape-rendering="geometricPrecision"`),
  '09-blur-filter': withFilter.replace('<svg', `<svg style="display:block;width:${w}px;height:${h}px" shape-rendering="geometricPrecision"`),
  '10-clip-4x': clipped.replace('<svg', `<div style="width:${w}px;height:${h}px;overflow:hidden">${'<svg style="display:block;width:' + w * 4 + 'px;height:' + h * 4 + 'px;transform:scale(0.25);transform-origin:0 0" shape-rendering="geometricPrecision"' + clipped.slice(clipped.indexOf('<svg') + 4)}</div>`),
};

const winCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
];
const exe = winCandidates.find((p) => p && existsSync(p));

const browser = await puppeteer.launch({ headless: 'new', ...(exe ? { executablePath: exe } : {}) });

try {
  for (const [name, body] of Object.entries(techniques)) {
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 200, deviceScaleFactor: 2 });
    await page.setContent(
      `<!DOCTYPE html><html><head><style>body{margin:0;background:${bg};padding:40px}.label{color:rgba(255,255,255,.5);font:12px sans-serif;margin-bottom:8px}</style></head><body><div class="label">${name} @2x dpr</div>${body}</body></html>`,
      { waitUntil: 'load' }
    );
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 400, height: 120 } });
    writeFileSync(join(outDir, `${name}.png`), buf);
    console.log('Wrote', name);
    await page.close();
  }
} finally {
  await browser.close();
}
