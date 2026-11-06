#!/usr/bin/env node
// Captures verbatim clause text for registry requirements from redistributable sources
// (EU Publications Office CELLAR, legislation.gov.uk) and writes a SQL data migration.
//
//   node scripts/reg-capture-text.mjs --out supabase/migrations/<version>_reg_captured_text.sql
//
// EUR-Lex web pages answer scripts with a bot challenge, so EU text comes from CELLAR by CELEX.
// The AI Act is read from the consolidated version that includes Regulation (EU) 2026/1744.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const UA = 'RegAnchor registry capture (MLA Group Ltd)';
const AI_ACT = '02024R1689-20260727';
const EU_GDPR = '32016R0679';
const DORA = '32022R2554';
const UK_GDPR = 'https://www.legislation.gov.uk/eur/2016/679';

const eu = (celex, sel) => ({ type: 'eu', celex, sel });
const uk = (parts) => ({ type: 'uk', parts });
const ukArt = (n, date) => ({ url: `${UK_GDPR}/article/${n}${date ? `/${date}` : ''}`, id: `article-${n}` });

const SPECS = {
  'eu_ai_act:art4': eu(AI_ACT, { article: '4' }),
  'eu_ai_act:art4a': eu(AI_ACT, { article: '4a' }),
  'eu_ai_act:art5': eu(AI_ACT, { article: '5' }),
  'eu_ai_act:art6': eu(AI_ACT, { article: '6' }),
  'eu_ai_act:annex3(4)': eu(AI_ACT, { annex: 'III', point: '4' }),
  'eu_ai_act:annex3(5)(b)': eu(AI_ACT, { annex: 'III', point: '5', letter: 'b' }),
  'eu_ai_act:annex3(5)(c)': eu(AI_ACT, { annex: 'III', point: '5', letter: 'c' }),
  'eu_ai_act:art9': eu(AI_ACT, { article: '9' }),
  'eu_ai_act:art10': eu(AI_ACT, { article: '10' }),
  'eu_ai_act:art11': eu(AI_ACT, { article: '11' }),
  'eu_ai_act:art12': eu(AI_ACT, { article: '12' }),
  'eu_ai_act:art13': eu(AI_ACT, { article: '13' }),
  'eu_ai_act:art14': eu(AI_ACT, { article: '14' }),
  'eu_ai_act:art15': eu(AI_ACT, { article: '15' }),
  'eu_ai_act:art17': eu(AI_ACT, { article: '17' }),
  'eu_ai_act:art26': eu(AI_ACT, { article: '26' }),
  'eu_ai_act:art26(1)': eu(AI_ACT, { article: '26', para: 1 }),
  'eu_ai_act:art26(2)': eu(AI_ACT, { article: '26', para: 2 }),
  'eu_ai_act:art26(5)': eu(AI_ACT, { article: '26', para: 5 }),
  'eu_ai_act:art26(6)': eu(AI_ACT, { article: '26', para: 6 }),
  'eu_ai_act:art26(7)': eu(AI_ACT, { article: '26', para: 7 }),
  'eu_ai_act:art26(9)': eu(AI_ACT, { article: '26', para: 9 }),
  'eu_ai_act:art26(11)': eu(AI_ACT, { article: '26', para: 11 }),
  'eu_ai_act:art27': eu(AI_ACT, { article: '27' }),
  'eu_ai_act:art50': eu(AI_ACT, { article: '50' }),
  'eu_ai_act:art50(1)': eu(AI_ACT, { article: '50', para: 1 }),
  'eu_ai_act:art50(2)': eu(AI_ACT, { article: '50', para: 2 }),
  'eu_ai_act:art50(4)': eu(AI_ACT, { article: '50', para: 4 }),
  'eu_ai_act:art86': eu(AI_ACT, { article: '86' }),
  'eu_ai_act:art99': eu(AI_ACT, { article: '99' }),
  'eu_gdpr:art5': eu(EU_GDPR, { article: '5' }),
  'eu_gdpr:art22': eu(EU_GDPR, { article: '22' }),
  'eu_gdpr:art32': eu(EU_GDPR, { article: '32' }),
  'eu_gdpr:art35': eu(EU_GDPR, { article: '35' }),
  'eu_dora:art17': eu(DORA, { article: '17' }),
  'eu_dora:art19': eu(DORA, { article: '19' }),
  'eu_dora:art28': eu(DORA, { article: '28' }),
  'uk_gdpr:art5': uk([ukArt('5')]),
  'uk_gdpr:art6': uk([ukArt('6')]),
  'uk_gdpr:art13-14': uk([ukArt('13'), ukArt('14')]),
  'uk_gdpr:art22': uk([ukArt('22', '2026-02-04')]),
  'uk_gdpr:art22a-22d': uk([ukArt('22A'), ukArt('22B'), ukArt('22C'), ukArt('22D')]),
  'uk_gdpr:art22b': uk([ukArt('22B')]),
  'uk_gdpr:art22c': uk([ukArt('22C')]),
  'uk_gdpr:art25': uk([ukArt('25')]),
  'uk_gdpr:art28': uk([ukArt('28')]),
  'uk_gdpr:art30': uk([ukArt('30')]),
  'uk_gdpr:art32': uk([ukArt('32')]),
  'uk_gdpr:art35': uk([ukArt('35')]),
  'uk_dpa_2018:s164a': uk([{ url: 'https://www.legislation.gov.uk/ukpga/2018/12/section/164A', id: 'section-164A' }]),
  'uk_fsma_2000:s19': uk([{ url: 'https://www.legislation.gov.uk/ukpga/2000/8/section/19', id: 'section-19' }]),
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const tidy = (s) => s.replace(/[\u00a0\s]+/g, ' ').trim();

async function get(url, accept) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'eng' }, redirect: 'follow' });
    if (res.ok) {
      const body = await res.text();
      if (body.length > 0) return body;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`Fetch failed: ${url}`);
}

// ------------------------------------------------------------------ EU (CELLAR XHTML)

const euDocs = new Map();
async function euLines(celex) {
  if (!euDocs.has(celex)) {
    const html = await get(`http://publications.europa.eu/resource/celex/${celex}`, 'application/xhtml+xml, text/html;q=0.9');
    let h = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
    h = h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n').replace(/<td[^>]*>/gi, ' ');
    h = decode(h.replace(/<[^>]+>/g, ''));
    const lines = h
      .split('\n')
      .map((l) => tidy(l.replace(/▼[A-Z]\d*/g, '').replace(/[◄►]/g, '')))
      .filter(Boolean);
    euDocs.set(celex, lines);
  }
  return euDocs.get(celex);
}

const ARTICLE_HEAD = /^Article \d+[a-z]?$/;
const BLOCK_HEAD = /^(CHAPTER|SECTION|TITLE|ANNEX) [IVXLC\d]+[a-z]?$/i;

function euArticle(lines, n) {
  const start = lines.findIndex((l) => l === `Article ${n}`);
  if (start < 0) throw new Error(`Article ${n} not found`);
  let end = start + 1;
  while (end < lines.length && !ARTICLE_HEAD.test(lines[end]) && !BLOCK_HEAD.test(lines[end])) end++;
  return lines.slice(start, end);
}

function euParagraph(article, p) {
  const head = article.slice(0, 2);
  const body = article.slice(2);
  const start = body.findIndex((l) => new RegExp(`^${p}\\.( |$)`).test(l));
  if (start < 0) throw new Error(`Paragraph ${p} not found in ${head[0]}`);
  let end = start + 1;
  while (end < body.length && !new RegExp(`^${p + 1}\\.( |$)`).test(body[end])) end++;
  return [...head, ...body.slice(start, end)];
}

function euAnnexPoint(lines, annex, point, letter) {
  const start = lines.findIndex((l) => l === `ANNEX ${annex}`);
  if (start < 0) throw new Error(`Annex ${annex} not found`);
  let end = start + 1;
  while (end < lines.length && !/^ANNEX [IVXLC]+$/.test(lines[end])) end++;
  const annexLines = lines.slice(start, end);
  const ps = annexLines.findIndex((l) => new RegExp(`^${point}\\.( |$)`).test(l));
  if (ps < 0) throw new Error(`Annex ${annex} point ${point} not found`);
  let pe = ps + 1;
  while (pe < annexLines.length && !new RegExp(`^${Number(point) + 1}\\.( |$)`).test(annexLines[pe])) pe++;
  const pointLines = annexLines.slice(ps, pe);
  if (!letter) return [`Annex ${annex}`, ...pointLines];
  const next = String.fromCharCode(letter.charCodeAt(0) + 1);
  const firstLetter = pointLines.findIndex((l) => /^\([a-z]\)/.test(l));
  const leadIn = pointLines.slice(0, firstLetter < 0 ? 1 : firstLetter);
  const ls = pointLines.findIndex((l) => l.startsWith(`(${letter})`));
  if (ls < 0) throw new Error(`Annex ${annex} point ${point}(${letter}) not found`);
  let le = ls + 1;
  while (le < pointLines.length && !pointLines[le].startsWith(`(${next})`)) le++;
  return [`Annex ${annex}`, ...leadIn, ...pointLines.slice(ls, le)];
}

async function captureEu({ celex, sel }) {
  const lines = await euLines(celex);
  let out;
  if (sel.annex) out = euAnnexPoint(lines, sel.annex, sel.point, sel.letter);
  else {
    const art = euArticle(lines, sel.article);
    out = sel.para ? euParagraph(art, sel.para) : art;
  }
  return { text: joinEu(out), url: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celex}` };
}

// Paragraph numbers and point letters sit on their own line in some layouts; join them to their text.
function joinEu(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /^(\d+\.|\([a-z0-9]+\))$/.test(prev)) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ UK (legislation.gov.uk XML)

function ukProvision(xml, id) {
  const at = xml.indexOf(`id="${id}"`);
  if (at < 0) throw new Error(`${id} not found`);
  const p1 = xml.lastIndexOf('<P1 ', at);
  const p1End = xml.indexOf('</P1>', at);
  const group = xml.lastIndexOf('<P1group', p1);
  const titleMatch = group >= 0 ? /<Title>([\s\S]*?)<\/Title>/.exec(xml.slice(group, p1)) : null;
  const title = titleMatch ? tidy(decode(titleMatch[1].replace(/<[^>]+>/g, ''))) : '';
  let body = xml.slice(p1, p1End);
  // Acts omit punctuation attributes; their subsections and paragraphs print in brackets.
  let n = 0;
  body = body.replace(/<Pnumber([^>]*)>([\s\S]*?)<\/Pnumber>/g, (_, attrs, inner) => {
    const first = n++ === 0;
    const label = inner.replace(/<[^>]+>/g, '').trim();
    const bare = first || /PuncBefore=|PuncAfter=/.test(attrs) || /[.)]$/.test(label);
    const before = /PuncBefore="([^"]*)"/.exec(attrs)?.[1] ?? (bare ? '' : '(');
    const after = /PuncAfter="([^"]*)"/.exec(attrs)?.[1] ?? (bare ? '' : ')');
    return `\n${before}${label}${after}${first && /^Article /.test(label) ? '\n' : ' '}`;
  });
  body = body.replace(/<FootnoteRef[^>]*\/>|<CommentaryRef[^>]*\/>/g, '');
  body = body.replace(/<\/Text>/g, '\n');
  const lines = decode(body.replace(/<[^>]+>/g, '')).split('\n').map(tidy).filter(Boolean);
  const joined = [];
  for (const l of lines) {
    const prev = joined[joined.length - 1];
    if (prev !== undefined && /^(\(?[0-9a-z]+[.)]|\d+[A-Z]?)$/.test(prev)) joined[joined.length - 1] = `${prev} ${l}`;
    else joined.push(l);
  }
  return [title, ...joined].filter(Boolean).join('\n');
}

const ukDocs = new Map();
async function captureUk({ parts }) {
  const texts = [];
  for (const p of parts) {
    if (!ukDocs.has(p.url)) {
      ukDocs.set(p.url, await get(`${p.url}/data.xml`, 'application/xml'));
      await new Promise((r) => setTimeout(r, 750));
    }
    texts.push(ukProvision(ukDocs.get(p.url), p.id));
  }
  return { text: texts.join('\n\n'), url: parts.length === 1 ? parts[0].url : `${UK_GDPR}/chapter/III/section/4A` };
}

// ------------------------------------------------------------------ main

const outIdx = process.argv.indexOf('--out');
const outPath = outIdx > 0 ? process.argv[outIdx + 1] : null;

const rows = [];
for (const [key, spec] of Object.entries(SPECS)) {
  try {
    const { text, url } = spec.type === 'eu' ? await captureEu(spec) : await captureUk(spec);
    if (text.length < 80) throw new Error(`Suspiciously short (${text.length} chars)`);
    if (text.includes('$reg$')) throw new Error('Text contains the SQL quote tag');
    const hash = createHash('sha256').update(text).digest('hex');
    rows.push({ key, text, url, hash });
    console.log(`ok   ${key.padEnd(26)} ${String(text.length).padStart(6)}  ${text.split('\n').slice(0, 2).join(' | ').slice(0, 110)}`);
  } catch (e) {
    console.log(`FAIL ${key.padEnd(26)} ${e.message}`);
  }
}

const failed = Object.keys(SPECS).length - rows.length;
console.log(`\n${rows.length} captured, ${failed} failed`);

if (outPath) {
  const sql = [
    '-- Phase 1a data: verbatim clause text for redistributable sources, captured by',
    `-- scripts/reg-capture-text.mjs on ${new Date().toISOString().slice(0, 10)}. AI Act text is the consolidated version ${AI_ACT}.`,
    '',
    ...rows.map(
      (r) =>
        `update reg.requirements set captured_text = $reg$${r.text}$reg$, captured_hash = '${r.hash}', captured_url = '${r.url}', captured_at = now(), updated_at = now() where key = '${r.key}';`,
    ),
    '',
  ].join('\n');
  writeFileSync(outPath, sql);
  console.log(`Wrote ${outPath}`);
}
if (failed) process.exitCode = 1;
