import type { JSONContent } from '@tiptap/core'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

/**
 * Light GFM cleanup so TipTap/marked get real tables and headings:
 * blank lines around pipe tables and ATX headings; drop lone incomplete
 * trailing table stubs (header without separator) during progressive paint.
 */
export function normalizePolicyMarkdown(markdown: string): string {
  const raw = (markdown || '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return ''
  const lines = raw.split('\n')
  const out: string[] = []
  const isTable = (line: string) => /^\s*\|/.test(line)
  const isHeading = (line: string) => /^#{1,6}\s+\S/.test(line.trim())
  const isSep = (line: string) =>
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim())

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const prev = out.length ? out[out.length - 1] : ''
    if (isHeading(line) && prev.trim() !== '') out.push('')
    if (isTable(line) && prev.trim() !== '' && !isTable(prev)) out.push('')
    out.push(line)
    const next = lines[i + 1]
    if (next != null) {
      if (isHeading(line) && next.trim() !== '' && !isHeading(next)) out.push('')
      if (isTable(line) && !isTable(next) && next.trim() !== '') out.push('')
    }
  }

  // Hold back a trailing incomplete table (no separator yet).
  let end = out.length - 1
  while (end >= 0 && out[end].trim() === '') end -= 1
  if (end >= 0 && isTable(out[end])) {
    let start = end
    while (start > 0 && isTable(out[start - 1])) start -= 1
    const block = out.slice(start, end + 1)
    if (block.length < 2 || !isSep(block[1])) {
      return out.slice(0, start).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Convert policy markdown to HTML for TipTap setContent. */
export function markdownToHtml(markdown: string): string {
  const src = normalizePolicyMarkdown(markdown || '')
  if (!src) return ''
  return marked.parse(src, { async: false }) as string
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]{}()#+.!|-])/g, '\\$1')
}

function inlineText(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') {
    let t = node.text || ''
    const marks = node.marks || []
    for (const mark of marks) {
      if (mark.type === 'bold') t = `**${t}**`
      else if (mark.type === 'italic') t = `*${t}*`
      else if (mark.type === 'code') t = `\`${t}\``
      else if (mark.type === 'strike') t = `~~${t}~~`
      else if (mark.type === 'link' && mark.attrs?.href) t = `[${t}](${mark.attrs.href})`
    }
    return t
  }
  if (node.type === 'hardBreak') return '  \n'
  return (node.content || []).map(inlineText).join('')
}

function tableToMarkdown(node: JSONContent): string {
  const rows = (node.content || []).filter((r) => r.type === 'tableRow')
  if (!rows.length) return ''
  const cellText = (row: JSONContent) =>
    (row.content || []).map((cell) => {
      const inner = (cell.content || []).map((p) => inlineText(p).trim()).join(' ')
      return inner.replace(/\|/g, '\\|') || ' '
    })
  const header = cellText(rows[0])
  const sep = header.map(() => '---')
  const body = rows.slice(1).map((r) => cellText(r))
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ]
  return lines.join('\n')
}

function blockToMarkdown(node: JSONContent, listIndent = 0): string {
  switch (node.type) {
    case 'doc':
      return (node.content || []).map((c) => blockToMarkdown(c)).filter(Boolean).join('\n\n')
    case 'paragraph': {
      const t = inlineText(node).trim()
      return t
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      return `${'#'.repeat(level)} ${inlineText(node).trim()}`
    }
    case 'bulletList':
      return (node.content || [])
        .map((item) => {
          const parts = (item.content || []).map((c) => {
            if (c.type === 'paragraph') return inlineText(c).trim()
            return blockToMarkdown(c, listIndent + 1)
          })
          const head = parts[0] || ''
          const rest = parts.slice(1).join('\n')
          const pad = '  '.repeat(listIndent)
          return `${pad}- ${head}${rest ? `\n${rest}` : ''}`
        })
        .join('\n')
    case 'orderedList': {
      let i = Number(node.attrs?.start) || 1
      return (node.content || [])
        .map((item) => {
          const parts = (item.content || []).map((c) => {
            if (c.type === 'paragraph') return inlineText(c).trim()
            return blockToMarkdown(c, listIndent + 1)
          })
          const head = parts[0] || ''
          const rest = parts.slice(1).join('\n')
          const pad = '  '.repeat(listIndent)
          const line = `${pad}${i}. ${head}${rest ? `\n${rest}` : ''}`
          i += 1
          return line
        })
        .join('\n')
    }
    case 'blockquote':
      return (node.content || [])
        .map((c) => blockToMarkdown(c))
        .join('\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
    case 'codeBlock': {
      const lang = node.attrs?.language || ''
      const code = (node.content || []).map((c) => c.text || '').join('')
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }
    case 'horizontalRule':
      return '---'
    case 'table':
      return tableToMarkdown(node)
    default:
      if (node.content) return (node.content || []).map((c) => blockToMarkdown(c, listIndent)).join('\n\n')
      return node.text ? escapeMd(node.text) : ''
  }
}

/** Serialize TipTap JSON to markdown for policy_documents.content. */
export function tipTapJsonToMarkdown(doc: JSONContent | null | undefined): string {
  if (!doc) return ''
  return blockToMarkdown(doc).replace(/\n{3,}/g, '\n\n').trim()
}

/** Pull a plausible title from the first H1 / H2 in markdown. */
export function titleFromMarkdown(markdown: string, fallback = 'Untitled policy'): string {
  const m = markdown.match(/^#{1,2}\s+(.+)$/m)
  if (m?.[1]) return m[1].trim().slice(0, 160)
  const first = markdown
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('|') && !l.startsWith('-') && !l.startsWith('*'))
  return (first || fallback).replace(/^#+\s*/, '').slice(0, 160)
}

export function formatUsdCents(cents: number): string {
  const n = (Number(cents) || 0) / 100
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
