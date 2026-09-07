import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let s = readFileSync(join(root, 'brand/mark-shield-new.svg'), 'utf8');
s = s
  .replace(/width="[^"]*"\s*/, '')
  .replace(/height="[^"]*"\s*/, '')
  .replace('viewBox="0 0 310.56 151.62"', 'viewBox="0 0 299 151.62"')
  .replace(
    '<svg ',
    '<svg role="img" aria-label="RegAnchor shield mark" shape-rendering="geometricPrecision" '
  );
writeFileSync(join(root, 'brand/mark-shield.svg'), s);
console.log('Wrote brand/mark-shield.svg', s.length, 'bytes');
