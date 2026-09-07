/**
 * Rasterise footer wordmark at exact display densities (Chrome render).
 * Bakes #0A0E14 background to avoid transparency fringe on dark footer.
 * Usage: node tools/export-wordmark-footer.mjs
 */
import puppeteer from 'puppeteer';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bg = '#0A0E14';
const svg = readFileSync(join(root, 'brand/wordmark-light.svg'), 'utf8');

const jobs = [
  { w: 412, h: 112, out: 'brand/wordmark-light-footer.png' },
  { w: 618, h: 168, out: 'brand/wordmark-light-footer@2x.png' },
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
    const page = await browser.newPage();
    await page.setViewport({ width: job.w, height: job.h, deviceScaleFactor: 1 });
    await page.setContent(
      `<!DOCTYPE html><html><head><style>
        html,body{margin:0;padding:0;width:${job.w}px;height:${job.h}px;background:${bg}}
        svg{display:block;width:100%;height:100%}
      </style></head><body>${svg}</body></html>`,
      { waitUntil: 'load' }
    );
    const buf = await page.screenshot({
      type: 'png',
      omitBackground: false,
      clip: { x: 0, y: 0, width: job.w, height: job.h },
    });
    writeFileSync(join(root, job.out), buf);
    console.log('Wrote', job.out, `(${buf.length} bytes, ${job.w}×${job.h})`);
    await page.close();
  }
} finally {
  await browser.close();
}
