#!/usr/bin/env node
// Exports the reviewed requirement registry (approved and retired requirements, with sources)
// to scripts/data/reg-registry.json, so build checks run offline against a committed snapshot.
//
//   node scripts/reg-export.mjs
//
// Reads production through the Supabase CLI in read-only mode; needs `supabase login`.

import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'hueftewwenjaiagdoqmb';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data', 'reg-registry.json');

const SQL = `
select json_build_object(
  'sources', (
    select json_agg(json_build_object(
      'key', s.key, 'short_title', s.short_title, 'title', s.title, 'jurisdiction', s.jurisdiction
    ) order by s.display_order, s.key)
    from reg.sources s
  ),
  'requirements', (
    select json_agg(json_build_object(
      'key', r.key, 'source', s.key, 'kind', r.kind,
      'citation', r.citation, 'short_citation', r.short_citation, 'title', r.title,
      'review_state', r.review_state,
      'effective_from', r.effective_from, 'effective_to', r.effective_to
    ) order by r.key)
    from reg.requirements r
    join reg.sources s on s.id = r.source_id
    where r.review_state in ('approved', 'retired')
  )
) as export`.replace(/\s+/g, ' ').trim();

const sqlFile = join(tmpdir(), `reg-export-${process.pid}.sql`);
writeFileSync(sqlFile, SQL);
let raw;
try {
  raw = execSync(`npx -y supabase db query --remote=${PROJECT} --read-only -f "${sqlFile}"`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
} finally {
  rmSync(sqlFile, { force: true });
}

const json = JSON.parse(raw.slice(raw.indexOf('{')));
const data = json.rows?.[0]?.export;
if (!data?.requirements?.length) {
  throw new Error('Registry export returned no requirements');
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
console.log(`[reg-export] ${data.requirements.length} requirements, ${data.sources.length} sources -> ${OUT}`);
