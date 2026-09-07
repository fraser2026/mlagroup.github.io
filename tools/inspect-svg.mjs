import { readFileSync } from 'fs';

const f = process.argv[2];
const s = readFileSync(f, 'utf8');
const paths = s.split('<path ').slice(1);
console.log('file:', f);
console.log('bytes:', s.length);
console.log('paths:', paths.length);
for (let i = 0; i < paths.length; i++) {
  const start = paths[i].indexOf('d="') + 3;
  const end = paths[i].indexOf('"', start);
  const d = paths[i].slice(start, end);
  const curves = d.split('c').length - 1;
  console.log(`  path ${i + 1}: ${d.length} chars, ~${curves} cubic segments`);
}
