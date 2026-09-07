/**
 * Compare SVG rendering techniques at small size on dark bg.
 * Usage: node tools/test-svg-render.mjs
 */
import puppeteer from 'puppeteer';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tools/render-tests');
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(join(root, 'brand/mark-shield-new.svg'), 'utf8');
const bg = '#0A0E14';
const h = 32;
const w = Math.round(h * (310.56 / 151.62));

const techniques = {
  '01-img-1x': `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${w}" height="${h}" alt="">`,
  '02-img-2x-scale': `<div style="width:${w}px;height:${h}px;overflow:hidden"><img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${w * 2}" height="${h * 2}" style="transform:scale(0.5);transform-origin:0 0" alt=""></div>`,
  '03-inline-1x': svg.replace('<svg', `<svg style="display:block;width:${w}px;height:${h}px" shape-rendering="geometricPrecision"`),
  '04-inline-2x-scale': `<div style="width:${w}px;height:${h}px;overflow:hidden">${svg.replace('<svg', `<svg style="display:block;width:${w * 2}px;height:${h * 2}px;transform:scale(0.5);transform-origin:0 0" shape-rendering="geometricPrecision"`)}</div>`,
  '05-inline-4x-scale': `<div style="width:${w}px;height:${h}px;overflow:hidden">${svg.replace('<svg', `<svg style="display:block;width:${w * 4}px;height:${h * 4}px;transform:scale(0.25);transform-origin:0 0" shape-rendering="geometricPrecision"`)}</div>`,
  '06-canvas-2x': `<canvas id="c" width="${w * 2}" height="${h * 2}" style="width:${w}px;height:${h}px"></canvas>
    <script>
    const img = new Image();
    img.onload = () => {
      const c = document.getElementById('c');
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
    };
    img.src = 'data:image/svg+xml,${encodeURIComponent(svg)}';
    </script>`,
};

const winCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
];
const exe = winCandidates.find((p) => p && existsSync(p));

const browser = await puppeteer.launch({
  headless: 'new',
  ...(exe ? { executablePath: exe } : {}),
});

try {
  for (const [name, body] of Object.entries(techniques)) {
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 200, deviceScaleFactor: 1 });
    await page.setContent(
      `<!DOCTYPE html><html><head><style>
        body{margin:0;background:${bg};padding:40px}
        .label{color:rgba(255,255,255,.5);font:12px Inter,sans-serif;margin-bottom:8px}
      </style></head><body>
        <div class="label">${name}</div>
        ${body}
      </body></html>`,
      { waitUntil: 'networkidle0' }
    );
    await new Promise((r) => setTimeout(r, name.includes('canvas') ? 300 : 50));
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 400, height: 120 } });
    writeFileSync(join(outDir, `${name}.png`), buf);
    console.log('Wrote', name);
    await page.close();
  }
} finally {
  await browser.close();
}
