function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineFmt(s: string) {
  let h = esc(s)
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  return h
}

/** Portal-parity markdown subset for policy documents. */
export function renderPolicyMarkdown(md?: string | null, title?: string | null) {
  if (!md) return '<div class="empty">No content available.</div>'
  let text = String(md).replace(/\r\n/g, '\n').trim()
  if (title) {
    const titleRe = new RegExp(
      '^#\\s+' + String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:\\n+|$)',
      'i',
    )
    text = text.replace(titleRe, '')
  } else {
    text = text.replace(/^#\s+[^\n]+\n+/, '')
  }
  text = text.trim()
  if (!text) return '<div class="empty">No content available.</div>'

  const lines = text.split('\n')
  const out: string[] = []
  let listBuf: string[] = []
  let paraBuf: string[] = []

  function flushList() {
    if (!listBuf.length) return
    out.push(`<ul class="md-list">${listBuf.join('')}</ul>`)
    listBuf = []
  }
  function flushPara() {
    if (!paraBuf.length) return
    const p = paraBuf.join(' ').trim()
    if (p) out.push(`<p class="md-p">${inlineFmt(p)}</p>`)
    paraBuf = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      flushPara()
      continue
    }
    let m: RegExpMatchArray | null
    if ((m = trimmed.match(/^###\s+(.+)$/))) {
      flushList()
      flushPara()
      out.push(`<h4 class="md-h4">${inlineFmt(m[1])}</h4>`)
      continue
    }
    if ((m = trimmed.match(/^##\s+(.+)$/))) {
      flushList()
      flushPara()
      out.push(`<h3 class="md-h3">${inlineFmt(m[1])}</h3>`)
      continue
    }
    if ((m = trimmed.match(/^#\s+(.+)$/))) {
      flushList()
      flushPara()
      out.push(`<h2 class="md-h2">${inlineFmt(m[1])}</h2>`)
      continue
    }
    if ((m = trimmed.match(/^\*\*(\d+\.\s+[^*]+)\*\*$/))) {
      flushList()
      flushPara()
      out.push(`<h3 class="md-h3">${esc(m[1])}</h3>`)
      continue
    }
    if ((m = trimmed.match(/^\*\*([^*]+)\*\*$/))) {
      flushList()
      flushPara()
      out.push(`<h4 class="md-h4">${esc(m[1])}</h4>`)
      continue
    }
    if ((m = trimmed.match(/^_(.+)_$/))) {
      flushList()
      flushPara()
      out.push(`<div class="md-foot">${inlineFmt(m[1])}</div>`)
      continue
    }
    if ((m = trimmed.match(/^[-*]\s+(.+)$/))) {
      flushPara()
      listBuf.push(
        `<li class="md-li"><span class="md-li__bullet" aria-hidden="true"></span><span class="md-li__text">${inlineFmt(m[1])}</span></li>`,
      )
      continue
    }
    flushList()
    paraBuf.push(trimmed)
  }
  flushList()
  flushPara()
  return `<div class="policy-doc">${out.join('')}</div>`
}

export const POLICY_CATS: Record<string, string> = {
  ai_governance: 'AI Governance',
  data_protection: 'Data Protection',
  acceptable_use: 'Acceptable Use',
  risk_management: 'Risk Management',
  security: 'Security',
  ethics: 'Ethics',
  other: 'Other',
}
