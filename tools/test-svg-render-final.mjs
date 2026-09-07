import puppeteer from 'puppeteer';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tools/render-tests');
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(join(root, 'brand/mark-shield-new.svg'), 'utf8');
const bg = '#0A0E14';
const h = 32;
const w = Math.round(h * (310.56 / 151.62));

function prep(viewW, blurPx = 0) {
  let s = raw
    .replace(/width="[^"]*"/, '')
    .replace(/height="[^"]*"/, '')
    .replace('viewBox="0 0 310.56 151.62"', `viewBox="0 0 ${viewW} 151.62"`);
  if (blurPx > 0) {
    s = s.replace(
      '<defs>',
      `<defs><filter id="b" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${blurPx}" /></filter>`
    ).replaceAll('<path ', '<path filter="url(#b)" ');
  }
  return s;
}

function wrap(svg, scale = 4, opacity = 1) {
  const inner = svg.replace(
    '<svg',
    `<svg style="display:block;width:${w * scale}px;height:${h * scale}px;transform:scale(${1 / scale});transform-origin:0 0;opacity:${opacity}" shape-rendering="geometricPrecision"`
  );
  return `<div style="width:${w}px;height:${h}px;overflow:hidden">${inner}</div>`;
}

const techniques = {
  '11-clip299-4x': wrap(prep(299), 4),
  '12-clip295-4x': wrap(prep(295), 4),
  '13-clip299-4x-blur02': wrap(prep(299, 0.2), 4),
  '14-clip299-4x-op084': wrap(prep(299), 4, 0.84),
  '15-clip299-4x-blur-css': `<div style="width:${w}px;height:${h}px;overflow:hidden;filter:blur(0.3px)">${wrap(prep(299), 4).replace('filter:blur(0.3px)', '')}</div>`.replace(`<div style="width:${w}px;height:${h}px;overflow:hidden">`, `<div style="width:${w}px;height:${h}px;overflow:hidden;filter:blur(0.35px)">`),
};

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')].find(existsSync);
const browser = await puppeteer.launch({ headless: 'new', ...(exe ? { executablePath: exe } : {}) });
try {
  for (const [name, body] of Object.entries(techniques)) {
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 200, deviceScaleFactor: 2 });
    await page.setContent(`<!DOCTYPE html><style>body{margin:0;background:${bg};padding:40px}.l{color:rgba(255,255,255,.5);font:12px sans-serif;margin-bottom:8px}</style><div class="l">${name}</div>${body}`, { waitUntil: 'load' });
    writeFileSync(join(outDir, `${name}.png`), await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 400, height: 120 } }));
    console.log('Wrote', name);
    await page.close();
  }
} finally {
  await browser.close();
}
