/**
 * RegAnchor — Puppeteer Renderer Service
 *
 * Lightweight Express server that accepts report data via POST
 * and returns a rendered PDF. Deploy on Render, Railway, Fly.io,
 * or any Node.js host with headless Chrome support.
 *
 * POST /render
 * Body: Report data JSON (same structure as diagnostic response)
 * Returns: application/pdf
 *
 * POST /render-certificate
 * Body: Certificate data JSON
 * Returns: application/pdf
 *
 * Keep-alive: GET /healthcheck  → plain text "OK" (no Puppeteer / DB / storage)
 * Legacy:     GET /health       → JSON status
 */

import express from 'express';
import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '5mb' }));  app.use((req, res, next) => {   res.header('Access-Control-Allow-Origin', '*');   res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');   res.header('Access-Control-Allow-Headers', 'Content-Type');   if (req.method === 'OPTIONS') return res.sendStatus(204);   next(); });

const PORT = process.env.PORT || 3001;
const TEMPLATE_PATH = join(__dirname, 'report-template.html');

// PDFs render off-site, so there is no request origin to derive the public domain from.
// Override via env at the reganchor.com cutover rather than editing this file.
const SITE_DOMAIN = process.env.SITE_DOMAIN || 'reganchor.com';

// Pre-load template
const TEMPLATE_HTML = readFileSync(TEMPLATE_PATH, 'utf-8');   const CERT_TEMPLATE_PATH = join(__dirname, 'certificate-template.html'); const CERT_TEMPLATE_HTML = readFileSync(CERT_TEMPLATE_PATH, 'utf-8');

const LAUNCH_OPTS = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
  ],
};

// ── Process-wide Puppeteer browser singleton ──
// Reused across PDF requests. Pages are opened/closed per request; the browser stays open.
let browserInstance = null;
let browserLaunchPromise = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  if (!browserLaunchPromise) {
    browserLaunchPromise = (async () => {
      try {
        console.log('[Renderer] Launching Puppeteer browser…');
        const browser = await puppeteer.launch(LAUNCH_OPTS);
        browserInstance = browser;
        browser.on('disconnected', () => {
          console.warn('[Renderer] Browser disconnected; will relaunch on next PDF request');
          browserInstance = null;
          browserLaunchPromise = null;
        });
        console.log('[Renderer] Puppeteer browser ready');
        return browser;
      } catch (err) {
        browserInstance = null;
        browserLaunchPromise = null;
        throw err;
      }
    })();
  }

  const browser = await browserLaunchPromise;
  // If the process died between launch and use, clear and relaunch once.
  if (!browser.connected) {
    browserInstance = null;
    browserLaunchPromise = null;
    return getBrowser();
  }
  return browser;
}

// ── Keep-alive health check (cheap: no Puppeteer, DB, or Supabase) ──
app.get('/healthcheck', (req, res) => {
  res.status(200).type('text/plain').send('OK');
});

// ── Legacy health check ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mla-report-renderer', version: '1.0.0' });
});

// ── Render endpoint ──
app.post('/render', async (req, res) => {
  const startTime = Date.now();
  let page;

  try {
    const reportData = req.body;
    if (!reportData || !reportData.organisation) {
      return res.status(400).json({ error: 'Invalid report data' });
    }

    console.log(`[Renderer] Generating report for: ${reportData.organisation}`);

    // Inject data into template
    const renderedHtml = TEMPLATE_HTML.replace(
      '/*__REPORT_DATA__*/',
      `const REPORT_DATA = ${JSON.stringify(reportData)};`
    );

    const browser = await getBrowser();
    page = await browser.newPage();

    // Set content and wait for fonts
    await page.setContent(renderedHtml, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await page.evaluateHandle('document.fonts.ready');

    // Build header/footer templates
    const orgName = reportData.organisation.replace(/"/g, '&quot;');
    const dateStr = new Date(reportData.created_at || Date.now())
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const headerTemplate = `
      <div style="width:100%;padding:0 18mm;background:#FFFFFF;display:flex;align-items:center;justify-content:space-between;height:28mm;box-sizing:border-box;font-family:'IBM Plex Sans',sans-serif;border-bottom:1px solid #E4E7EC;">
        <span style="color:#0A0E14;font-size:7pt;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;">RegAnchor</span>
        <span style="color:#6B7280;font-size:7pt;">AI Governance Diagnostic — ${orgName}</span>
        <span style="color:#6B7280;font-size:7pt;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`;

    const footerTemplate = `
      <div style="width:100%;padding:0 18mm;display:flex;align-items:center;justify-content:space-between;height:18mm;box-sizing:border-box;border-top:1px solid #E4E7EC;font-family:'IBM Plex Sans',sans-serif;">
        <span style="color:#6B7280;font-size:6pt;">Confidential — ${orgName} — ${dateStr}</span>
        <span style="color:#6B7280;font-size:6pt;">${SITE_DOMAIN}</span>
      </div>`;

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: {
        top: '28mm',
        bottom: '18mm',
        left: '18mm',
        right: '18mm',
      },
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Renderer] Complete: ${(pdfBuffer.length / 1024).toFixed(0)} KB in ${elapsed}ms`);

    // Return PDF
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'no-store',
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error(`[Renderer] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) {
      try { await page.close(); } catch (_) { /* ignore */ }
    }
  }
});

// ── Certificate render endpoint ──
app.post('/render-certificate', async (req, res) => {
  const startTime = Date.now();
  let page;

  try {
    const certData = req.body;
    if (!certData || !certData.certificate_id) {
      return res.status(400).json({ error: 'Invalid certificate data' });
    }

    console.log(`[Renderer] Generating certificate: ${certData.certificate_id}`);

    const renderedHtml = CERT_TEMPLATE_HTML
      .replace('<html lang="en">', '<html lang="en" class="is-pdf">')
      .replace(
        '/*__CERT_DATA__*/',
        `const CERT_DATA = ${JSON.stringify(certData)};`
      )
      // Strip local-only preview chrome so it never appears in PDF pixels
      .replace(/<!-- Preview chrome[\s\S]*?-->\s*/,'')
      .replace(/<div class="preview-note"[^>]*>[\s\S]*?<\/div>\s*/,'');

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setViewport({ width: 1122, height: 794, deviceScaleFactor: 1 });

    await page.setContent(renderedHtml, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    try {
      await page.evaluateHandle('document.fonts.ready');
    } catch (_) { /* ignore font wait failures */ }
    await page.waitForSelector('#certificate', { timeout: 10000 });
    // Guarantee no preview chrome survived
    await page.evaluate(() => {
      document.querySelectorAll('.preview-note').forEach((n) => n.remove());
      document.body.classList.remove('is-preview');
      document.documentElement.classList.add('is-pdf');
    });
    await new Promise((r) => setTimeout(r, 400));

    const pdfBuffer = await page.pdf({
      width: '1122px',
      height: '794px',
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: false,
      pageRanges: '1',
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Renderer] Certificate complete: ${(pdfBuffer.length / 1024).toFixed(0)} KB in ${elapsed}ms`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'no-store',
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error(`[Renderer] Certificate error: ${err.message}`);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) {
      try { await page.close(); } catch (_) { /* ignore */ }
    }
  }
});

app.listen(PORT, () => {
  console.log(`[Renderer] MLA Report Renderer listening on port ${PORT}`);
  // Warm the browser at boot so the first PDF is not cold-start Chromium.
  getBrowser().catch((err) => {
    console.error(`[Renderer] Browser warm-up failed (will retry on next PDF): ${err.message}`);
  });
});
