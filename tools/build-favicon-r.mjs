/**
 * Build favicon / brand-mark R from Inter Medium (matches live .ra-wordmark).
 * Usage: node tools/build-favicon-r.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import opentype from 'opentype.js';
import { decompress } from 'wawoff2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WOFF2 =
  'https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-Medium.woff2';

function fitPath(commands, viewBox, pad) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of commands) {
    for (const [xKey, yKey] of [
      ['x', 'y'],
      ['x1', 'y1'],
      ['x2', 'y2'],
    ]) {
      if (typeof c[xKey] === 'number' && typeof c[yKey] === 'number') {
        minX = Math.min(minX, c[xKey]);
        minY = Math.min(minY, c[yKey]);
        maxX = Math.max(maxX, c[xKey]);
        maxY = Math.max(maxY, c[yKey]);
      }
    }
  }
  const gw = maxX - minX;
  const gh = maxY - minY;
  const inner = viewBox - pad * 2;
  const scale = Math.min(inner / gw, inner / gh);
  const ox = pad + (inner - gw * scale) / 2 - minX * scale;
  const oy = pad + (inner - gh * scale) / 2 - minY * scale;
  const parts = [];
  for (const c of commands) {
    const tx = (n) => +(n * scale + ox).toFixed(2);
    const ty = (n) => +(n * scale + oy).toFixed(2);
    if (c.type === 'M') parts.push(`M${tx(c.x)} ${ty(c.y)}`);
    else if (c.type === 'L') parts.push(`L${tx(c.x)} ${ty(c.y)}`);
    else if (c.type === 'C')
      parts.push(`C${tx(c.x1)} ${ty(c.y1)} ${tx(c.x2)} ${ty(c.y2)} ${tx(c.x)} ${ty(c.y)}`);
    else if (c.type === 'Q') parts.push(`Q${tx(c.x1)} ${ty(c.y1)} ${tx(c.x)} ${ty(c.y)}`);
    else if (c.type === 'Z') parts.push('Z');
  }
  return parts.join('');
}

console.log('Fetching', WOFF2);
const res = await fetch(WOFF2);
if (!res.ok) throw new Error('HTTP ' + res.status);
const woff2 = new Uint8Array(await res.arrayBuffer());
console.log('Decompressing woff2…');
const ttf = await decompress(woff2);
const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
const glyphPath = font.getPath('R', 0, 0, 1000);
const d32 = fitPath(glyphPath.commands, 32, 6.5);
const d512 = fitPath(glyphPath.commands, 512, 104);

writeFileSync(
  join(root, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="RegAnchor">
  <!-- Outlined capital R from Inter Medium — matches live .ra-wordmark (Inter).
       Path (not <text>) so tabs / Google render without loading a webfont. -->
  <rect width="32" height="32" fill="#0A0E14"/>
  <path fill="#FFFFFF" d="${d32}"/>
</svg>
`
);

mkdirSync(join(root, 'brand'), { recursive: true });
writeFileSync(
  join(root, 'brand/mark-dark.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="RegAnchor">
  <!-- White R on ink — Inter Medium, matches live wordmark. -->
  <rect width="512" height="512" fill="#0A0E14"/>
  <path fill="#FFFFFF" d="${d512}"/>
</svg>
`
);
writeFileSync(
  join(root, 'brand/mark-light.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="RegAnchor">
  <!-- Ink R on transparent — Inter Medium, matches live wordmark. -->
  <path fill="#0A0E14" d="${d512}"/>
</svg>
`
);

writeFileSync(
  join(root, 'brand/README.md'),
  `# RegAnchor brand marks

| File | Use |
|------|-----|
| \`../favicon.svg\` | Browser tab / Google indexing (outlined R, no webfont dependency) |
| \`mark-light.svg\` | Light UI — ink R on transparent (512 viewBox) |
| \`mark-dark.svg\` | Dark UI / social — white R on \`#0A0E14\` square |
| \`ra-mark-light.png\` | 2048px raster for decks / partners (ink R on white) |
| \`ra-mark-dark.png\` | 2048px raster for decks / partners (white R on ink) |

The R path is extracted from **Inter Medium** so it matches the live \`.ra-wordmark\` on the public site and portal (Inter). Legal entity remains **MLA Group Ltd**.

Rebuild the SVG paths:

\`\`\`bash
node tools/build-favicon-r.mjs
\`\`\`

Export high-res PNGs from the SVGs:

\`\`\`bash
node tools/export-brand-marks.mjs
\`\`\`
`
);

console.log('Wrote favicon.svg + brand marks from Inter Medium');
console.log(d32.slice(0, 120));
