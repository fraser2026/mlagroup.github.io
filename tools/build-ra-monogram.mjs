/**
 * Import Desktop RA monogram SVGs into favicon + brand/ square marks.
 * Source: OneDrive RegAnchor WordMark/RA (Asset 8 = ink, Asset 9 = white).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir =
  process.env.RA_MONOGRAM_DIR ||
  'C:/Users/Fraser/OneDrive/Desktop/RegAnchor WordMark/RA'
const inkSrc = join(srcDir, 'Asset 8.svg')
const whiteSrc = join(srcDir, 'Asset 9.svg')

if (!existsSync(inkSrc) || !existsSync(whiteSrc)) {
  console.error('Missing source SVGs in', srcDir)
  process.exit(1)
}

function extractPaths(svg) {
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*>/g)].map((m) => m[1])
  if (!paths.length) throw new Error('No paths in SVG')
  return paths
}

const inkSvg = readFileSync(inkSrc, 'utf8')
const whiteSvg = readFileSync(whiteSrc, 'utf8')
const inkPaths = extractPaths(inkSvg)
const whitePaths = extractPaths(whiteSvg)
const vbW = 85.28
const vbH = 54

function squareSvg(size, fill, bg) {
  const pad = size === 32 ? 3.2 : size * 0.12
  const inner = size - pad * 2
  const scale = Math.min(inner / vbW, inner / vbH)
  const w = vbW * scale
  const h = vbH * scale
  const ox = pad + (inner - w) / 2
  const oy = pad + (inner - h) / 2
  const source = fill === '#FFFFFF' ? whitePaths : inkPaths
  const paths = source.map((d) => `    <path fill="${fill}" d="${d}"/>`).join('\n')
  const bgRect = bg ? `  <rect width="${size}" height="${size}" fill="${bg}"/>\n` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="RegAnchor">
  <!-- RA monogram — combined R+A lockup (replaces Inter capital R). -->
${bgRect}  <g transform="translate(${ox.toFixed(2)}, ${oy.toFixed(2)}) scale(${scale.toFixed(5)})">
${paths}
  </g>
</svg>
`
}

mkdirSync(join(root, 'brand'), { recursive: true })
writeFileSync(join(root, 'favicon.svg'), squareSvg(32, '#FFFFFF', '#0A0E14'))
writeFileSync(join(root, 'brand/mark-dark.svg'), squareSvg(512, '#FFFFFF', '#0A0E14'))
writeFileSync(join(root, 'brand/mark-light.svg'), squareSvg(512, '#0A0E14', null))
copyFileSync(inkSrc, join(root, 'brand/ra-monogram-ink.svg'))
copyFileSync(whiteSrc, join(root, 'brand/ra-monogram-white.svg'))
console.log('Wrote favicon.svg, brand/mark-*.svg, brand/ra-monogram-*.svg')
