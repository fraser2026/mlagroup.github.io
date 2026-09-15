/**
 * Local smoke: render dossier-template.html with PREVIEW payload via Puppeteer.
 * Usage: node tools/smoke-dossier-pdf.mjs
 */
import puppeteer from 'puppeteer'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const template = readFileSync(join(root, 'dossier-template.html'), 'utf8')

// Use file:// preview path (no DOSSIER_DATA injection) so PREVIEW_DOSSIER loads
const htmlPath = join(root, 'dossier-template.html')
const outPath = join(root, 'tools', '_dossier-smoke.pdf')

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), {
  waitUntil: 'networkidle0',
  timeout: 60000,
})
await page.evaluateHandle('document.fonts.ready')
await page.waitForFunction(
  () => {
    const el = document.getElementById('dossier')
    return el && el.children.length > 0
  },
  { timeout: 15000 },
)

const sectionCount = await page.$$eval('#dossier > .section, #dossier > .cover', (els) => els.length)
const pdf = await page.pdf({
  format: 'A4',
  margin: { top: '24mm', bottom: '16mm', left: '18mm', right: '18mm' },
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="width:100%;padding:0 18mm;font-family:Inter,Helvetica,Arial,sans-serif;font-size:7.5pt;color:#6B7280;display:flex;justify-content:space-between;"><span>REGANCHOR</span><span>AI Governance Dossier · smoke</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  footerTemplate: `<div style="width:100%;padding:0 18mm;font-family:Inter,Helvetica,Arial,sans-serif;font-size:7pt;color:#6B7280;">Confidential · local smoke</div>`,
})
writeFileSync(outPath, pdf)
await browser.close()
console.log(JSON.stringify({ ok: true, sections: sectionCount, bytes: pdf.length, out: outPath }))
