/**
 * Copy legacy portal assets into public/legacy so app.reganchor.com
 * can host the portal as the functional source of truth (parity bridge).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appRoot, '..')
const destRoot = path.join(appRoot, 'public', 'legacy')

const FILES = [
  'portal.html',
  'favicon.svg',
  'assessment.html',
  'diagnostic.html',
  'report.html',
  'system-report.html',
  'pricing.html',
  'login.html',
  'verify.html',
  'css/reganchor.css',
  'css/portal.css',
  'css/reganchor-flow.css',
  'css/reganchor-site.css',
  'css/reganchor-report.css',
  'css/product-pages.css',
  'js/stripe-config.js',
  'js/ra-contact.js',
  'js/ra-chrome.js',
  'js/portal-redirect.js',
  'js/ra-maturity.js',
  'js/asset-model-catalog.js',
  'js/portal-core.js',
  'js/portal-users.js',
  'js/portal-registry.js',
  'js/portal-analytics.js',
  'js/portal-mcp.js',
  'js/portal-dashboard.js',
  'js/portal-controls.js',
  'js/portal-policies.js',
  'js/portal-alerts.js',
  'js/portal-plans.js',
  'js/portal-billing.js',
  'js/portal-cert.js',
]

const DIRS = ['brand', 'providers']

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function copyFile(rel) {
  const src = path.join(repoRoot, rel)
  if (!fs.existsSync(src)) {
    console.warn('[copy-portal] skip missing', rel)
    return
  }
  const dest = path.join(destRoot, rel)
  ensureDir(path.dirname(dest))
  let body = fs.readFileSync(src)
  if (rel === 'js/portal-core.js' || rel.endsWith('.html')) {
    let text = body.toString('utf8')
    if (rel === 'js/portal-core.js') {
      text = text.replace(
        "window.location.href='login.html'+window.location.search+window.location.hash;",
        "window.location.href='/login?next='+encodeURIComponent('/legacy/portal.html'+window.location.hash);",
      )
      text = text.replace(
        /window\.location\.href\s*=\s*['"]login\.html['"]/g,
        "window.location.href='/login?next='+encodeURIComponent('/legacy/portal.html')",
      )
    }
    // Point sibling HTML auth bounce at app login
    text = text.replace(
      /window\.location\.href\s*=\s*['"]login\.html['"]/g,
      "window.location.href='/login?next='+encodeURIComponent(window.location.pathname+window.location.search+window.location.hash)",
    )
    body = Buffer.from(text, 'utf8')
  }
  fs.writeFileSync(dest, body)
}

function copyDir(rel) {
  const src = path.join(repoRoot, rel)
  if (!fs.existsSync(src)) {
    console.warn('[copy-portal] skip missing dir', rel)
    return
  }
  const dest = path.join(destRoot, rel)
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(path.join(rel, entry.name))
    } else {
      fs.copyFileSync(from, to)
    }
  }
}

ensureDir(destRoot)
for (const f of FILES) copyFile(f)
for (const d of DIRS) copyDir(d)

console.log('[copy-portal] ready at', destRoot)
