#!/usr/bin/env node
// Checks that every regulatory citation in client-facing pages and code is in the reviewed
// requirement registry and still in force (or pending). Runs offline against the snapshot
// written by scripts/reg-export.mjs.
//
//   node scripts/check-citations.mjs                    fail on findings not in the baseline
//   node scripts/check-citations.mjs --all              list every finding, baseline included
//   node scripts/check-citations.mjs --update-baseline  accept current findings as the baseline
//
// The baseline holds known findings awaiting a content decision, so the build fails only on
// new ones. Remove entries by fixing the citation or adding the requirement to the registry.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REGISTRY = join(HERE, 'data', 'reg-registry.json');
const BASELINE = join(HERE, 'data', 'citation-baseline.json');

const args = new Set(process.argv.slice(2));
const today = new Date().toISOString().slice(0, 10);

// Pages that are not product methodology (MLA Group's own legal notices) or are retired design studies.
const EXCLUDE_PAGES = new Set([
  'privacy.html',
  'terms.html',
  'cookies.html',
  'reganchorsystem.html',
  'reganchor-shapestudy.html',
  'premium-object.html',
  'design-checkout.html',
]);

const SCAN = [
  { dir: '.', exts: ['.html'], deep: false },
  { dir: 'js', exts: ['.js'], deep: false },
  { dir: '.', exts: ['.js'], deep: false },
  { dir: 'app/src', exts: ['.ts', '.tsx'], deep: true },
  { dir: 'supabase/functions', exts: ['.ts'], deep: true },
];

const SOURCE_ALIASES = {
  'EU AI Act': ['eu_ai_act'],
  'AI Act': ['eu_ai_act'],
  'UK GDPR': ['uk_gdpr'],
  'EU GDPR': ['eu_gdpr'],
  GDPR: ['uk_gdpr', 'eu_gdpr'],
  DORA: ['eu_dora'],
};

const NUM = String.raw`\d+[A-Za-z]?(?:\(\d+\))?`;
const SEP = String.raw`\s*(?:,|and|&|\/|to|-|–)\s*`;
const ARTICLE_RE = new RegExp(
  String.raw`\b(EU AI Act|AI Act|UK GDPR|EU GDPR|GDPR|DORA)\s*,?\s*(?:Articles?|Arts?\.)\s*(${NUM}(?:${SEP}${NUM})*)`,
  'g',
);
const CODE_RE = /\b(?:(?:SS|PS|DP|CP|FG|FS|GC)\d{1,2}\/\d{1,2}|(?:SYSC|PRIN|DISP)\s?\d+[A-Z]?)\b/g;
// Named guidance cited by year, e.g. "ICO AI Guidance 2023"; must match a registry citation or title.
const NAMED_RE = /\b(?:ICO|FCA|PRA)(?: [A-Z][A-Za-z]*)* (?:Guidance|Guide|Update|Statement) \d{4}\b/g;

const normCode = (c) => c.replace(/^(SYSC|PRIN|DISP)\s?/, '$1 ');
const base = (token) => token.replace(/\(\d+\)$/, '').toUpperCase();

// "22A to 22D" -> 22A..22D, "13-14" -> 13, 14, "9, 11 and 17" -> 9, 11, 17
function expandArticles(list) {
  const out = [];
  const parts = list.split(/\s*(?:,|and|&|\/)\s*/).filter(Boolean);
  for (const part of parts) {
    const range = part.match(new RegExp(String.raw`^(${NUM})\s*(?:to|-|–)\s*(${NUM})$`));
    if (!range) {
      out.push(base(part.trim()));
      continue;
    }
    const [a, b] = [base(range[1]), base(range[2])];
    const la = a.match(/^(\d+)([A-Z]?)$/);
    const lb = b.match(/^(\d+)([A-Z]?)$/);
    if (la && lb && la[1] === lb[1] && la[2] && lb[2]) {
      for (let c = la[2].charCodeAt(0); c <= lb[2].charCodeAt(0); c += 1) out.push(la[1] + String.fromCharCode(c));
    } else if (la && lb && !la[2] && !lb[2] && Number(lb[1]) - Number(la[1]) <= 20) {
      for (let n = Number(la[1]); n <= Number(lb[1]); n += 1) out.push(String(n));
    } else {
      out.push(a, b);
    }
  }
  return out;
}

function loadRegistry() {
  const data = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const articles = new Map(); // `${source}:${base}` -> 'live' | 'repealed'
  const codes = new Map(); // code -> 'live' | 'repealed'
  const named = []; // approved citations and titles, lower case, for named guidance
  const mark = (map, key, live) => {
    if (live) map.set(key, 'live');
    else if (!map.has(key)) map.set(key, 'repealed');
  };
  for (const r of data.requirements) {
    if (r.review_state !== 'approved') continue;
    const live = !r.effective_to || r.effective_to >= today;
    const text = `${r.citation} ${r.short_citation}`;
    const m = text.match(new RegExp(String.raw`Articles?\s+(${NUM}(?:${SEP}${NUM})*)`));
    if (m) for (const a of expandArticles(m[1])) mark(articles, `${r.source}:${a}`, live);
    for (const c of text.match(CODE_RE) || []) mark(codes, normCode(c), live);
    if (live) named.push(`${r.citation} ${r.title}`.toLowerCase());
  }
  return { articles, codes, named };
}

function listFiles() {
  const files = [];
  const walk = (dir, exts, deep) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (deep && !['node_modules', 'dist', 'legacy'].includes(name)) walk(full, exts, deep);
      } else if (exts.some((e) => name.endsWith(e)) && !EXCLUDE_PAGES.has(name)) {
        files.push(full);
      }
    }
  };
  for (const s of SCAN) walk(join(ROOT, s.dir), s.exts, s.deep);
  return [...new Set(files)];
}

function scan(registry) {
  const findings = [];
  for (const file of listFiles()) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(ARTICLE_RE)) {
        const sources = SOURCE_ALIASES[m[1]];
        for (const a of expandArticles(m[2])) {
          const states = sources.map((s) => registry.articles.get(`${s}:${a}`));
          if (states.includes('live')) continue;
          const reason = states.includes('repealed') ? 'no longer in force' : 'not in the registry';
          findings.push({ file: rel, line: i + 1, citation: `${m[1]} Article ${a}`, reason });
        }
      }
      for (const m of line.matchAll(CODE_RE)) {
        const code = normCode(m[0]);
        const state = registry.codes.get(code);
        if (state === 'live') continue;
        findings.push({ file: rel, line: i + 1, citation: code, reason: state ? 'no longer in force' : 'not in the registry' });
      }
      for (const m of line.matchAll(NAMED_RE)) {
        if (registry.named.some((n) => n.includes(m[0].toLowerCase()))) continue;
        findings.push({ file: rel, line: i + 1, citation: m[0], reason: 'not in the registry' });
      }
    });
  }
  return findings;
}

const keyOf = (f) => `${f.file} | ${f.citation} | ${f.reason}`;

const registry = loadRegistry();
const findings = scan(registry);
const keys = [...new Set(findings.map(keyOf))].sort();

if (args.has('--update-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify(keys, null, 2)}\n`);
  console.log(`[citations] baseline updated: ${keys.length} known findings`);
  process.exit(0);
}

const baseline = new Set(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : []);
const fresh = findings.filter((f) => !baseline.has(keyOf(f)));
const resolved = [...baseline].filter((k) => !keys.includes(k));
const shown = args.has('--all') ? findings : fresh;

for (const f of shown) console.log(`${f.file}:${f.line}  ${f.citation}  (${f.reason})`);
if (resolved.length) {
  console.log(`[citations] ${resolved.length} baseline entries no longer occur; run with --update-baseline to drop them.`);
}
console.log(
  `[citations] ${findings.length} findings, ${findings.length - fresh.length} known in baseline, ${fresh.length} new.`,
);
process.exit(fresh.length ? 1 : 0);
