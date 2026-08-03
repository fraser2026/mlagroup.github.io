/**
 * RegAnchor — AI Governance Diagnostic Report Generator
 * 
 * Server-side PDF generation via Puppeteer.
 * Fetches data snapshot from Supabase, renders HTML template,
 * produces a versioned, reproducible board-grade PDF.
 *
 * Usage:
 *   node generate-report.js --id <response_id>     Generate from Supabase record
 *   node generate-report.js --preview               Generate from mock data
 *   node generate-report.js --json <path>            Generate from JSON file
 *
 * Environment:
 *   SUPABASE_URL          Supabase project URL
 *   SUPABASE_SERVICE_KEY   Supabase service role key (server-side only)
 */

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  templatePath: join(__dirname, 'report-template.html'),
  outputDir: join(__dirname, 'output'),
  // Printed into the PDF footer. No request origin exists here, so it must be absolute.
  siteDomain: process.env.SITE_DOMAIN || 'mlagroup.co.uk',
  pdf: {
    format: 'A4',
    marginTop: '28mm',      // space for running header
    marginBottom: '18mm',    // space for running footer
    marginLeft: '18mm',
    marginRight: '18mm',
    printBackground: true,
    preferCSSPageSize: false,
    displayHeaderFooter: true,
  }
};

// ============================================================
// SUPABASE CLIENT
// ============================================================

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables required');
  }
  return createClient(url, key);
}

// ============================================================
// DATA SNAPSHOT & INTEGRITY
// ============================================================

function createDataSnapshot(data) {
  const reportId = uuidv4();
  const generatedAt = new Date().toISOString();
  const snapshotJson = JSON.stringify(data, null, 0);
  const snapshotHash = createHash('sha256').update(snapshotJson).digest('hex').slice(0, 16);

  return {
    ...data,
    _report: {
      id: reportId,
      generated_at: generatedAt,
      snapshot_hash: snapshotHash,
      framework_version: data.framework_version || '2.0.0',
      generator_version: '1.0.0',
      data_source: data.created_at || generatedAt,
    }
  };
}

// ============================================================
// FETCH FROM SUPABASE
// ============================================================

async function fetchResponseData(responseId) {
  const supabase = getSupabaseClient();

  // Fetch the diagnostic response
  const { data: response, error } = await supabase
    .from('diagnostic_responses')
    .select('*')
    .eq('id', responseId)
    .single();

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  if (!response) throw new Error(`No response found with id: ${responseId}`);

  return response;
}

// ============================================================
// PUPPETEER HEADER & FOOTER TEMPLATES
// ============================================================

function buildHeaderTemplate(orgName) {
  // Puppeteer header/footer templates must be self-contained HTML with inline styles.
  // Special classes: pageNumber, totalPages, date, title, url
  // Ink on paper, no fill — matches report-template.html's running section header.
  return `
    <div style="
      width: 100%;
      height: 28mm;
      padding: 0 18mm;
      background: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
      box-sizing: border-box;
      border-bottom: 1px solid #E4E7EC;
    ">
      <span style="
        color: #0A0E14;
        font-size: 7pt;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.14em;
      ">RegAnchor</span>
      <span style="
        color: #6B7280;
        font-size: 7pt;
        font-weight: 400;
      ">AI Governance Diagnostic — ${orgName}</span>
      <span style="
        color: #6B7280;
        font-size: 7pt;
        font-weight: 500;
      "><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
  `;
}

function buildFooterTemplate(orgName, dateStr) {
  return `
    <div style="
      width: 100%;
      height: 18mm;
      padding: 0 18mm;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
      box-sizing: border-box;
      border-top: 1px solid #E4E7EC;
    ">
      <span style="color: #6B7280; font-size: 6pt; letter-spacing: 0.04em;">
        Confidential — ${orgName} — ${dateStr}
      </span>
      <span style="color: #6B7280; font-size: 6pt; letter-spacing: 0.04em;">
        ${CONFIG.siteDomain}
      </span>
    </div>
  `;
}

// ============================================================
// GENERATE PDF
// ============================================================

async function generatePdf(data) {
  // Create versioned snapshot
  const snapshot = createDataSnapshot(data);
  const dateStr = new Date(snapshot.created_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  // Read template
  const templateHtml = readFileSync(CONFIG.templatePath, 'utf-8');

  // Inject data into template
  const renderedHtml = templateHtml.replace(
    '/*__REPORT_DATA__*/',
    `const REPORT_DATA = ${JSON.stringify(snapshot)};`
  );

  console.log(`[RegAnchor Report] Generating report ${snapshot._report.id}`);
  console.log(`[RegAnchor Report] Organisation: ${snapshot.organisation}`);
  console.log(`[RegAnchor Report] Snapshot hash: ${snapshot._report.snapshot_hash}`);

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ]
  });

  const page = await browser.newPage();

  // Load rendered HTML
  await page.setContent(renderedHtml, {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  // Wait for fonts to load
  await page.evaluateHandle('document.fonts.ready');

  // Generate PDF
  const pdfBuffer = await page.pdf({
    format: CONFIG.pdf.format,
    margin: {
      top: CONFIG.pdf.marginTop,
      bottom: CONFIG.pdf.marginBottom,
      left: CONFIG.pdf.marginLeft,
      right: CONFIG.pdf.marginRight,
    },
    printBackground: CONFIG.pdf.printBackground,
    preferCSSPageSize: CONFIG.pdf.preferCSSPageSize,
    displayHeaderFooter: CONFIG.pdf.displayHeaderFooter,
    headerTemplate: buildHeaderTemplate(snapshot.organisation),
    footerTemplate: buildFooterTemplate(snapshot.organisation, dateStr),
  });

  await browser.close();

  // Build filename
  const orgSlug = snapshot.organisation
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const dateSlug = snapshot.created_at.slice(0, 10);
  const filename = `RegAnchor-Governance-Report_${orgSlug}_${dateSlug}_${snapshot._report.snapshot_hash}.pdf`;

  console.log(`[RegAnchor Report] Generated: ${filename} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);

  return {
    buffer: pdfBuffer,
    filename,
    reportId: snapshot._report.id,
    snapshotHash: snapshot._report.snapshot_hash,
    metadata: snapshot._report,
  };
}

// ============================================================
// OPTIONAL: STORE BACK TO SUPABASE
// ============================================================

async function storeReport(responseId, reportResult) {
  const supabase = getSupabaseClient();

  // Upload PDF to Supabase Storage
  const storagePath = `reports/${reportResult.filename}`;
  const { error: uploadError } = await supabase
    .storage
    .from('governance-reports')
    .upload(storagePath, reportResult.buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    console.error(`[RegAnchor Report] Storage upload failed: ${uploadError.message}`);
  }

  // Update the response record with report metadata
  const { error: updateError } = await supabase
    .from('diagnostic_responses')
    .update({
      report_id: reportResult.reportId,
      report_generated_at: reportResult.metadata.generated_at,
      report_snapshot_hash: reportResult.metadata.snapshot_hash,
      report_storage_path: storagePath,
    })
    .eq('id', responseId);

  if (updateError) {
    console.error(`[RegAnchor Report] Record update failed: ${updateError.message}`);
  }

  console.log(`[RegAnchor Report] Stored to Supabase: ${storagePath}`);
  return storagePath;
}

// ============================================================
// MOCK DATA (for --preview)
// ============================================================

const MOCK_DATA = {
  organisation:"Kristopher Smith LLP",sector:"Legal & Professional Services",org_size:"51–200",
  respondent_name:"Fraser McDonald",respondent_role:"Head of Operations",
  adjusted_score:41,risk_band:"high",band_label:"High Risk",
  band_heading:"Significant Exposure — Intervention Required",
  band_summary:"Significant and widespread governance deficiencies have been identified across multiple domains. The organisation's current AI governance posture presents material regulatory exposure that cannot be excluded without prompt, structured remediation. Multiple critical controls are absent, undocumented, or unverifiable. Board-level intervention is required to establish foundational governance infrastructure within the immediate term.",
  framework_version:"2.0.0",created_at:"2026-02-28T14:30:00.000Z",
  section_scores:{s1:38,s2:22,s3:45,s4:28,s5:40,s6:55,s7:62},
  priority_flags:[
    {id:"pf_governance",label:"No named individual holds documented accountability for AI governance",severity:"critical",section:"Governance & Accountability",basis:"FCA SM&CR, EU AI Act Art. 27",impact:"Without a named governance owner, no individual carries regulatory accountability for AI-related decisions. Under FCA SM&CR, this represents a binary compliance failure — the regime requires named Senior Manager accountability. Supervisory review will identify this absence immediately. Under the EU AI Act, provider obligations under Art. 16 require a documented governance structure attributable to identified individuals.",rec:"Appoint a named AI Governance Lead with documented terms of reference, reporting line to the board, and explicit accountability scope covering all AI systems in deployment or development. This appointment should be formalised in writing and reflected in the governance structure visible to regulators."},
    {id:"pf_oversight",label:"Automated decisions affecting individuals operate without documented human override protocols",severity:"critical",section:"Human Oversight & Controls",basis:"UK GDPR Art. 22, EU AI Act Art. 14",impact:"AI systems that produce decisions affecting individuals — whether in service delivery, risk assessment, or internal operations — require documented human oversight mechanisms. UK GDPR Art. 22 provides data subjects with rights regarding automated decisions with legal or significant effects. The absence of documented override protocols means the organisation cannot demonstrate compliance with these requirements.",rec:"Document human override protocols for all AI-assisted decision-making processes. Establish escalation pathways, define override authority, and implement logging mechanisms that record when human review occurs. Prioritise systems that produce decisions with legal or similarly significant effects on individuals."},
    {id:"pf_dpia",label:"No Data Protection Impact Assessment completed for AI systems processing personal data",severity:"critical",section:"Compliance & Legal Alignment",basis:"UK GDPR Art. 35, ICO Guidance",impact:"UK GDPR Art. 35 requires a DPIA where processing is likely to result in a high risk to individuals' rights and freedoms. AI systems that process personal data at scale, use profiling, or make automated decisions with significant effects will almost certainly meet this threshold. The absence of any DPIA for AI systems represents a clear compliance gap that the ICO would identify in any audit or investigation.",rec:"Conduct Data Protection Impact Assessments for all AI systems processing personal data, prioritising those that involve automated decision-making, profiling, or processing at scale. Each DPIA should document the processing purpose, necessity, proportionality assessment, risk identification, and mitigating measures."}
  ],
  domain_concepts:{
    s1:{concept:"The Invisible Fleet",assessment:"The organisation has limited visibility of its AI systems portfolio. No centralised inventory exists to document which AI tools are in use, their purpose, risk classification, or the data they process. Without this foundational register, governance controls cannot be applied systematically, and the organisation cannot respond to regulatory requests for disclosure of AI deployment scope. Shadow AI adoption — where individual teams deploy AI tools without central knowledge — presents an unquantified risk surface."},
    s2:{concept:"The Governance Vacuum",assessment:"No named individual holds documented accountability for AI governance decisions. There is no AI governance policy, committee structure, or board-level reporting mechanism. Governance decisions regarding AI adoption, risk acceptance, and control implementation are informal, undocumented, or delegated without clear accountability lines. This represents the most consequential gap identified. Regulatory frameworks universally begin their examination with governance structures."},
    s3:{concept:"The Untraceable Decision",assessment:"Data quality controls and lineage documentation for AI systems are partially established. The organisation maintains some records of data sources used by AI systems but cannot consistently trace the provenance of training data, validate data quality against defined standards, or demonstrate that data used in AI-driven decisions meets regulatory requirements for accuracy and currency."},
    s4:{concept:"The Absent Brake",assessment:"Human oversight mechanisms for AI-assisted decisions are either absent or undocumented. Where AI systems produce outputs that inform decisions affecting individuals — whether clients, employees, or third parties — no documented process exists to ensure meaningful human review occurs before decisions take effect. This is a binary compliance position — either the protocols exist and are documented, or they do not."},
    s5:{concept:"The Black Box Problem",assessment:"The organisation has limited ability to explain how its AI systems reach their outputs. No transparency framework exists to ensure that individuals affected by AI-driven decisions receive adequate information about the logic, significance, and consequences of automated processing. This creates compliance exposure under UK GDPR Arts. 13 and 14 and the EU AI Act's transparency requirements."},
    s6:{concept:"The Obligations Gap",assessment:"Compliance mapping is partially in place, with some regulatory awareness evident in operational practices. However, formal compliance documentation — including DPIAs, lawful basis assessments for AI processing, and systematic regulatory horizon scanning — is incomplete or absent. The most significant gap is the absence of Data Protection Impact Assessments for AI systems processing personal data at scale."},
    s7:{concept:"The Silent Failure Risk",assessment:"Operational controls for AI systems are the strongest area of the assessment, though gaps remain. Some monitoring and incident response capabilities exist, but they are not specifically adapted for AI failure modes. AI-specific controls — including documented rollback procedures, AI incident classification, and continuity arrangements for AI-dependent processes — require development."}
  },
  roadmap:{
    p1:{window:"Days 0–30",name:"Phase 1: Defensive Shielding",badge:"Immediate Priority",rationale:"Prioritised by risk contribution score and regulatory enforcement probability. These actions address the governance gaps most likely to attract supervisory attention and most fundamental to establishing a defensible position.",color:"#1d4ed8",
      actions:[{text:"Appoint named AI Governance Lead with documented terms of reference",owner:"Board / CEO"},{text:"Establish board-level AI governance reporting line and calendar",owner:"Board / CEO"},{text:"Initiate emergency AI systems inventory across all departments",owner:"AI Governance Lead"},{text:"Commission DPIA for highest-risk AI system processing personal data",owner:"DPO / Legal"},{text:"Document human override protocol for top-priority AI decision system",owner:"AI Governance Lead"}],
      deliverables:["AI Governance Lead Appointment Letter","Board Reporting Schedule","Preliminary AI Systems Register","DPIA — Priority System","Human Override Protocol v1"]},
    p2:{window:"Days 31–60",name:"Phase 2: Structural Build",badge:"High Priority",rationale:"With foundational governance infrastructure established in Phase 1, these actions build the systematic frameworks required for sustainable compliance.",color:"#b45309",
      actions:[{text:"Complete comprehensive AI systems inventory with risk classification",owner:"AI Governance Lead"},{text:"Draft and approve organisation-wide AI governance policy",owner:"AI Governance Lead / Legal"},{text:"Complete DPIAs for all AI systems processing personal data",owner:"DPO / Legal"},{text:"Implement transparency notices for AI-assisted customer-facing processes",owner:"Operations / Legal"},{text:"Establish AI incident reporting and escalation procedure",owner:"AI Governance Lead / IT"}],
      deliverables:["Complete AI Systems Register","AI Governance Policy v1","DPIA Portfolio","Transparency Notice Templates","AI Incident Response Procedure"]},
    p3:{window:"Days 61–90+",name:"Phase 3: Operational Excellence",badge:"Ongoing",rationale:"Phase 3 transitions from governance establishment to governance operation. Controls are tested, refined, and embedded into continuous improvement cycles.",color:"#15803d",
      actions:[{text:"Conduct first internal AI governance audit against established framework",owner:"AI Governance Lead"},{text:"Implement staff AI literacy and governance awareness programme",owner:"HR / AI Governance Lead"},{text:"Establish regulatory horizon scanning process for AI-related developments",owner:"Legal / Compliance"},{text:"Develop AI vendor and third-party governance assessment framework",owner:"Procurement / AI Governance Lead"},{text:"Prepare EU AI Act conformity assessment documentation for high-risk systems",owner:"AI Governance Lead / Legal"}],
      deliverables:["Internal Audit Report","AI Literacy Programme Materials","Regulatory Horizon Scanning Calendar","Third-Party AI Governance Framework","EU AI Act Conformity Documentation"]}
  }
};

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  let data;

  if (args.includes('--preview')) {
    console.log('[RegAnchor Report] Using preview mock data');
    data = MOCK_DATA;
  } else if (args.includes('--id')) {
    const id = args[args.indexOf('--id') + 1];
    if (!id) throw new Error('--id requires a response ID');
    console.log(`[RegAnchor Report] Fetching response ${id} from Supabase`);
    data = await fetchResponseData(id);
  } else if (args.includes('--json')) {
    const path = args[args.indexOf('--json') + 1];
    if (!path) throw new Error('--json requires a file path');
    console.log(`[RegAnchor Report] Reading data from ${path}`);
    data = JSON.parse(readFileSync(path, 'utf-8'));
  } else {
    console.log('Usage:');
    console.log('  node generate-report.js --preview');
    console.log('  node generate-report.js --id <response_id>');
    console.log('  node generate-report.js --json <path_to_json>');
    process.exit(0);
  }

  const result = await generatePdf(data);

  // Write to disk
  const { mkdirSync } = await import('fs');
  mkdirSync(CONFIG.outputDir, { recursive: true });
  const outputPath = join(CONFIG.outputDir, result.filename);
  writeFileSync(outputPath, result.buffer);
  console.log(`[RegAnchor Report] Written to: ${outputPath}`);

  // Optionally store to Supabase
  if (args.includes('--store') && args.includes('--id')) {
    const id = args[args.indexOf('--id') + 1];
    await storeReport(id, result);
  }

  return result;
}

// Export for use as module
export { generatePdf, createDataSnapshot, fetchResponseData, storeReport };

// Run CLI
main().catch(err => {
  console.error(`[RegAnchor Report] Error: ${err.message}`);
  process.exit(1);
});
