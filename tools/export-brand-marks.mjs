/**
 * Rasterise brand SVG marks to high-res PNGs via Puppeteer.
 * Usage: node tools/export-brand-marks.mjs
 */
import puppeteer from 'puppeteer';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const size = 2048;

const jobs = [
  // White field so decks/partners get a readable light mark (SVG stays transparent).
  { svg: 'brand/mark-light.svg', out: 'brand/ra-mark-light.png', bg: '#FFFFFF', omitBg: false },
  { svg: 'brand/mark-dark.svg', out: 'brand/ra-mark-dark.png', bg: null, omitBg: false },
];

const winCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
];

const exe =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (process.platform === 'win32' ? winCandidates.find((p) => p && existsSync(p)) : undefined);

const browser = await puppeteer.launch({
  headless: 'new',
  ...(exe ? { executablePath: exe } : {}),
});

try {
  for (const job of jobs) {
    const svg = readFileSync(join(root, job.svg), 'utf8');
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const bgCss = job.bg ? `background:${job.bg};` : '';
    await page.setContent(
      `<!DOCTYPE html><html><head><style>
        html,body{margin:0;padding:0;width:${size}px;height:${size}px;${bgCss}}
        svg{display:block;width:100%;height:100%}
      </style></head><body>${svg}</body></html>`,
      { waitUntil: 'load' }
    );
    const buf = await page.screenshot({
      type: 'png',
      omitBackground: Boolean(job.omitBg),
      clip: { x: 0, y: 0, width: size, height: size },
    });
    writeFileSync(join(root, job.out), buf);
    console.log('Wrote', job.out, `(${buf.length} bytes)`);
    await page.close();
  }
} finally {
  await browser.close();
}
