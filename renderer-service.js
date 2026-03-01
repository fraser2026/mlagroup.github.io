/**
 * MLA Group — Puppeteer Renderer Service
 * 
 * Lightweight Express server that accepts report data via POST
 * and returns a rendered PDF. Deploy on Render, Railway, Fly.io,
 * or any Node.js host with headless Chrome support.
 * 
 * POST /render
 * Body: Report data JSON (same structure as diagnostic response)
 * Returns: application/pdf
 * 
 * Health check: GET /health
 */

import express from 'express';
import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3001;
const TEMPLATE_PATH = join(__dirname, 'report-template.html');

// Pre-load template
const TEMPLATE_HTML = readFileSync(TEMPLATE_PATH, 'utf-8');

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mla-report-renderer', version: '1.0.0' });
});

// ── Render endpoint ──
app.post('/render', async (req, res) => {
  const startTime = Date.now();
  let browser;

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

    // Launch Puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });

    const page = await browser.newPage();

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
      <div style="width:100%;padding:0 18mm;background:#0f1f38;display:flex;align-items:center;justify-content:space-between;height:28mm;box-sizing:border-box;font-family:sans-serif;">
        <span style="color:#c9a465;font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;">MLA GROUP</span>
        <span style="color:rgba(255,255,255,0.6);font-size:7pt;">AI Governance Diagnostic — ${orgName}</span>
        <span style="color:rgba(255,255,255,0.4);font-size:7pt;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`;

    const footerTemplate = `
      <div style="width:100%;padding:0 18mm;display:flex;align-items:center;justify-content:space-between;height:18mm;box-sizing:border-box;border-top:1px solid #e2e8f0;font-family:sans-serif;">
        <span style="color:#94a3b8;font-size:6pt;">Confidential — ${orgName} — ${dateStr}</span>
        <span style="color:#94a3b8;font-size:6pt;">mlagroup.co.uk</span>
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

    await browser.close();
    browser = null;

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
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Renderer] MLA Report Renderer listening on port ${PORT}`);
});
