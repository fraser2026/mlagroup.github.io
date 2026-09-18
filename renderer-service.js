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
 * POST /render-dossier
 * Body: Org governance dossier snapshot JSON
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
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '12mb' }));  app.use((req, res, next) => {   res.header('Access-Control-Allow-Origin', '*');   res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');   res.header('Access-Control-Allow-Headers', 'Content-Type');   if (req.method === 'OPTIONS') return res.sendStatus(204);   next(); });

const PORT = process.env.PORT || 3001;
const TEMPLATE_PATH = join(__dirname, 'report-template.html');

// PDFs render off-site, so there is no request origin to derive the public domain from.
// Override via env at the reganchor.com cutover rather than editing this file.
const SITE_DOMAIN = process.env.SITE_DOMAIN || 'reganchor.com';

// Pre-load templates
const TEMPLATE_HTML = readFileSync(TEMPLATE_PATH, 'utf-8');
const CERT_TEMPLATE_PATH = join(__dirname, 'certificate-template.html');
const CERT_TEMPLATE_HTML = readFileSync(CERT_TEMPLATE_PATH, 'utf-8');
const DOSSIER_TEMPLATE_PATH = join(__dirname, 'dossier-template.html');
const DOSSIER_TEMPLATE_HTML = readFileSync(DOSSIER_TEMPLATE_PATH, 'utf-8');

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

// ── Governance dossier render endpoint ──
app.post('/render-dossier', async (req, res) => {
  const startTime = Date.now();
  let page;

  try {
    const dossierData = req.body;
    if (!dossierData || !dossierData.organisation) {
      return res.status(400).json({ error: 'Invalid dossier data' });
    }

    const orgName = String(dossierData.organisation.name || dossierData.organisation || 'Organisation');
    const dossierId = String(dossierData.meta?.dossier_id || 'RAD-————');
    console.log(`[Renderer] Generating dossier for: ${orgName}`);

    // Always read from disk so a Render deploy of dossier-template.html is visible immediately.
    let dossierHtml = readFileSync(DOSSIER_TEMPLATE_PATH, 'utf-8');
    try {
      const swooshPath = join(__dirname, 'brand', 'dossier-swoosh.svg');
      const swooshSvg = readFileSync(swooshPath, 'utf-8');
      const swooshData = `data:image/svg+xml;base64,${Buffer.from(swooshSvg).toString('base64')}`;
      dossierHtml = dossierHtml.replace(/src="brand\/dossier-swoosh\.svg"/g, `src="${swooshData}"`);
    } catch (swooshErr) {
      console.warn(`[Renderer] Dossier swoosh inline skipped: ${swooshErr.message}`);
    }

    const renderedHtml = dossierHtml.replace(
      '/*__DOSSIER_DATA__*/',
      `const DOSSIER_DATA = ${JSON.stringify(dossierData)};`,
    );

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setContent(renderedHtml, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    try {
      await page.evaluateHandle('document.fonts.ready');
    } catch (_) { /* fonts optional */ }
    await page.waitForFunction(
      () => {
        const el = document.getElementById('dossier');
        return el && el.children.length > 0;
      },
      { timeout: 30000 },
    );

    const safeId = dossierId
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Locked chrome on every body page (not in-flow — scales with multi-page tables).
    // Template height must fit inside Puppeteer top/bottom margin or Chromium overlaps body.
    const headerTemplate = `
      <div style="width:100%;height:14mm;padding:0 24mm 3mm;box-sizing:border-box;font-family:Inter,Helvetica,Arial,sans-serif;font-size:7.5pt;font-weight:500;color:#6B7280;display:flex;justify-content:space-between;align-items:flex-end;">
        <span>Confidential</span>
        <span style="font-variant-numeric:tabular-nums;">${safeId}</span>
      </div>`;

    const footerTemplate = `
      <div style="width:100%;height:14mm;padding:3mm 24mm 0;box-sizing:border-box;font-family:Inter,Helvetica,Arial,sans-serif;font-size:7.5pt;font-weight:500;color:#6B7280;display:flex;justify-content:space-between;align-items:flex-start;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 389 84" width="78" height="17" role="img" aria-label="RegAnchor">
          <g fill="#0A0E14">
            <path d="M360.9,35.77c0,12.67-10.37,22.68-24.34,22.68s-24.27-10.01-24.27-22.68,10.37-22.68,24.27-22.68,24.34,10.01,24.34,22.68ZM324.75,35.77c0,6.98,5.04,12.46,11.81,12.46s11.88-5.54,11.88-12.46-5.04-12.46-11.88-12.46-11.81,5.54-11.81,12.46Z"/>
            <path d="M376,56h-12V15h11v8.55c1.52-3.17,12.03-8.55,12.03-8.55h1.97v12.86c-.51-.21-1.62-.36-2.35-.36-6.46,0-10.65,4.33-10.65,7.39v21.1Z"/>
            <path d="M13.14,39h-.14v17H0V2h15.19c12.2,0,23.81,3.98,23.81,18.31,0,7.96-5.33,13.25-12.12,16l14.31,19.69h-15.94l-12.11-17ZM13,14v15h3.32c5.7,0,9.66-2.88,9.66-7.93,0-4.69-3.39-7.07-9.81-7.07h-3.17Z"/>
            <path d="M64.77,57.51c-15.7,0-25.13-9.58-25.13-22.68s9.43-22.68,22.97-22.68c12.75,0,22.39,9.58,22.39,22.75v3.1h-32.69c1.01,6.48,5.33,9.94,12.6,9.94,5.9,0,9.94-2.02,13.1-4.82l6.7,7.13c-4.54,4.1-10.87,7.27-19.95,7.27ZM52.09,30h19.59c-1.3-5.11-4.68-8.14-9.79-8.14s-8.5,3.02-9.79,8.14Z"/>
            <path d="M109.75,72.73c-4.97.11-10.07-.19-15.75-1.35v-10.24c5.25,1.12,9.03,1.47,12.96,1.47,7.14,0,12.04-2.59,12.04-11.55v-2.81s-7.8,5.9-12.84,5.9c-10.22,0-19.59-8.21-19.59-20.45s9.29-20.74,19.59-20.74c5.26,0,10.3,2.59,13.84,6.55v-4.52h12v34.79c0,12.4-9.85,22.66-22.25,22.94ZM119.34,34.26c0-5.76-4.61-10.44-10.3-10.44s-10.88,5.2-10.33,11.38c.42,4.7,4.18,8.54,8.85,9.18,6.34.88,11.77-4.03,11.77-10.12Z"/>
            <path d="M168.47,2h-12.74l-20.92,54h13.46l13.83-13.15,13.41,13.15h13.88L168.47,2ZM153.93,40.39c3.24-8.89,6.81-18.71,8.03-22.05,1.17,3.25,4.71,13.09,7.92,22.01-4.68-3.6-11.27-3.58-15.95.04Z"/>
            <path d="M203,56h-12V15h11v5c2.49-3,7.11-6.07,13.36-6.07,8.39,0,14.64,5.79,14.64,15.21v26.86h-11v-23.47c0-6.12-3.49-8.42-7.85-8.42-3.78,0-8.15,2.88-8.15,7.71v24.19Z"/>
            <path d="M267,55.73c-2.03,1.38-6.67,1.89-9.79,1.89-14.21,0-24.87-9.14-24.87-22.12s10.66-22.12,24.87-22.12c3.12,0,7.69.51,9.79,1.89v10.73h-.36c-2.25-1.96-5.87-2.47-9.14-2.47-7.25,0-12.62,5.08-12.62,11.97s5.37,11.97,12.62,11.97c3.26,0,6.89-.58,9.14-2.47h.36v10.73Z"/>
            <path d="M282,56h-11V0h11v20.1c2.42-3.02,7.03-6.32,13.36-6.32,8.39,0,14.64,5.82,14.64,15.22v26.99h-12v-23.4c0-6.19-3.49-8.42-7.85-8.42-3.78,0-8.15,2.81-8.15,7.7v24.12Z"/>
          </g>
        </svg>
        <span style="font-variant-numeric:tabular-nums;">Page <span class="pageNumber"></span> out of <span class="totalPages"></span></span>
      </div>`;

    // Pass 1 — cover only, full-bleed, no chrome (keeps swoosh flush).
    await page.evaluate(() => {
      document.body.classList.add('dossier-cover-only');
      document.body.classList.remove('dossier-body-only');
      document.getElementById('dossier-cover-page-style')?.remove();
      const style = document.createElement('style');
      style.id = 'dossier-cover-page-style';
      style.textContent = '@page { size: A4; margin: 0 !important; }';
      document.head.appendChild(style);
    });
    const coverPdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      pageRanges: '1',
    });

    // Pass 2 — body sections with locked header/footer on every page.
    // Invisible offset page so Puppeteer pageNumbers start at 2 (cover = page 1).
    await page.evaluate(() => {
      // Critical: drop cover's @page { margin:0 !important } or body chrome overlaps text.
      document.getElementById('dossier-cover-page-style')?.remove();
      document.body.classList.remove('dossier-cover-only');
      document.body.classList.add('dossier-body-only');
      const root = document.getElementById('dossier');
      if (!root || root.querySelector('.dossier-page-offset')) return;
      const offset = document.createElement('section');
      offset.className = 'section dossier-page-offset';
      offset.setAttribute('aria-hidden', 'true');
      offset.style.cssText = 'page-break-after:always;break-after:page;height:0;min-height:0;margin:0;padding:0;overflow:hidden;border:0;';
      root.insertBefore(offset, root.firstChild);
    });
    const bodyPdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      // Must be >= header/footer template height or chrome paints over body.
      margin: { top: '18mm', right: '24mm', bottom: '18mm', left: '24mm' },
    });

    const coverDoc = await PDFDocument.load(coverPdf);
    const bodyDoc = await PDFDocument.load(bodyPdf);
    const outDoc = await PDFDocument.create();
    const coverPages = await outDoc.copyPages(coverDoc, coverDoc.getPageIndices());
    coverPages.forEach((p) => outDoc.addPage(p));
    // Drop the offset page (index 0); remaining pages already say 2…N of N.
    const bodyIndices = bodyDoc.getPageIndices().slice(1);
    if (bodyIndices.length) {
      const bodyPages = await outDoc.copyPages(bodyDoc, bodyIndices);
      bodyPages.forEach((p) => outDoc.addPage(p));
    }
    const pdfBuffer = Buffer.from(await outDoc.save());

    const elapsed = Date.now() - startTime;
    console.log(`[Renderer] Dossier complete: ${(pdfBuffer.length / 1024).toFixed(0)} KB in ${elapsed}ms (${outDoc.getPageCount()} pages)`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'no-store',
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`[Renderer] Dossier error: ${err.message}`);
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
