/**
 * MLA draft chat session helpers.
 *
 * Durable source of truth for an existing policy: policy_documents.meta.mla_thread
 * Ephemeral cache (live memory + sessionStorage) covers unsaved "new" drafts and
 * remounts; never treat empty cache writes as authoritative over a stored thread.
 */

export type ThreadMsg = { id: string; role: 'user' | 'assistant'; content: string }

export type DraftChatSession = {
  orgId: string
  policyId: string | null
  messages: ThreadMsg[]
  prompt: string
}

export type MlaThreadMeta = {
  messages: ThreadMsg[]
  prompt: string
  updated_at?: string
}

const THREAD_KEY_PREFIX = 'ra:policy-draft:thread:'
const PROMPT_KEY_PREFIX = 'ra:policy-draft:prompt:'

let liveChatSession: DraftChatSession | null = null

export function getLiveChatSession() {
  return liveChatSession
}

export function setLiveChatSession(next: DraftChatSession | null) {
  liveChatSession = next
}

function threadKey(orgId: string, draftId: string | null) {
  return `${THREAD_KEY_PREFIX}${orgId}:${draftId || 'new'}`
}

function promptKey(orgId: string, draftId: string | null) {
  return `${PROMPT_KEY_PREFIX}${orgId}:${draftId || 'new'}`
}

export function parseThread(raw: string | null): ThreadMsg[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as ThreadMsg[]
    return Array.isArray(parsed) ? parsed.filter((m) => m?.id && m?.role && typeof m.content === 'string') : []
  } catch {
    return []
  }
}

export function readThread(orgId: string, draftId: string | null): ThreadMsg[] {
  try {
    return parseThread(sessionStorage.getItem(threadKey(orgId, draftId)))
  } catch {
    return []
  }
}

export function writeThread(orgId: string, draftId: string | null, messages: ThreadMsg[]) {
  try {
    sessionStorage.setItem(threadKey(orgId, draftId), JSON.stringify(messages))
  } catch {
    /* ignore */
  }
}

export function readPrompt(orgId: string, draftId: string | null): string {
  try {
    return sessionStorage.getItem(promptKey(orgId, draftId)) || ''
  } catch {
    return ''
  }
}

export function writePrompt(orgId: string, draftId: string | null, value: string) {
  try {
    if (value) sessionStorage.setItem(promptKey(orgId, draftId), value)
    else sessionStorage.removeItem(promptKey(orgId, draftId))
  } catch {
    /* ignore */
  }
}

export function clearThread(orgId: string, draftId: string | null) {
  try {
    sessionStorage.removeItem(threadKey(orgId, draftId))
    sessionStorage.removeItem(promptKey(orgId, draftId))
  } catch {
    /* ignore */
  }
}

/** Clear in-memory + sessionStorage draft chat (New policy or logout). */
export function clearAllDraftChatMemory(orgId?: string | null) {
  liveChatSession = null
  if (!orgId) {
    try {
      const keys: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (k && (k.startsWith(THREAD_KEY_PREFIX) || k.startsWith(PROMPT_KEY_PREFIX))) keys.push(k)
      }
      for (const k of keys) sessionStorage.removeItem(k)
    } catch {
      /* ignore */
    }
    return
  }
  clearThread(orgId, null)
  // Also clear any draft-id keys for this org prefix.
  try {
    const prefixThread = `${THREAD_KEY_PREFIX}${orgId}:`
    const prefixPrompt = `${PROMPT_KEY_PREFIX}${orgId}:`
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && (k.startsWith(prefixThread) || k.startsWith(prefixPrompt))) keys.push(k)
    }
    for (const k of keys) sessionStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

export function migrateThread(orgId: string, fromId: string | null, toId: string) {
  if (fromId === toId) return
  const msgs = readThread(orgId, fromId)
  if (msgs.length) writeThread(orgId, toId, msgs)
  const p = readPrompt(orgId, fromId)
  if (p) writePrompt(orgId, toId, p)
  clearThread(orgId, fromId)
  if (liveChatSession?.orgId === orgId) {
    liveChatSession = {
      orgId,
      policyId: toId,
      messages: msgs.length ? msgs : liveChatSession.messages,
      prompt: p || liveChatSession.prompt,
    }
  }
}

export function threadFromMeta(meta: unknown): MlaThreadMeta | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const raw = (meta as { mla_thread?: unknown }).mla_thread
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as { messages?: unknown; prompt?: unknown; updated_at?: unknown }
  const messages = Array.isArray(t.messages)
    ? (t.messages as ThreadMsg[]).filter((m) => m?.id && m?.role && typeof m.content === 'string')
    : []
  const prompt = typeof t.prompt === 'string' ? t.prompt : ''
  if (!messages.length && !prompt) return null
  return {
    messages,
    prompt,
    updated_at: typeof t.updated_at === 'string' ? t.updated_at : undefined,
  }
}

export function buildMetaWithThread(existingMeta: unknown, messages: ThreadMsg[], prompt: string): Record<string, unknown> {
  const base =
    existingMeta && typeof existingMeta === 'object' && !Array.isArray(existingMeta)
      ? { ...(existingMeta as Record<string, unknown>) }
      : {}
  if (!messages.length && !prompt) {
    delete base.mla_thread
    return base
  }
  base.mla_thread = {
    messages,
    prompt,
    updated_at: new Date().toISOString(),
  } satisfies MlaThreadMeta
  return base
}

/**
 * Restore chat for a draft. Prefer live memory for same org (remount), then
 * sessionStorage. Callers overlay durable meta.mla_thread when loading a row.
 */
export function restoreChatSession(
  orgId: string,
  draftId: string | null,
  readLastDraftId?: (orgId: string) => string | null,
): { messages: ThreadMsg[]; prompt: string } {
  if (liveChatSession?.orgId === orgId) {
    const sameDraft =
      liveChatSession.policyId === draftId ||
      (liveChatSession.policyId == null && draftId == null) ||
      (liveChatSession.policyId != null && draftId != null && liveChatSession.policyId === draftId)
    if (sameDraft || liveChatSession.messages.length) {
      return { messages: liveChatSession.messages, prompt: liveChatSession.prompt }
    }
  }
  const primary = readThread(orgId, draftId)
  if (primary.length) return { messages: primary, prompt: readPrompt(orgId, draftId) }
  if (draftId) {
    const asNew = readThread(orgId, null)
    if (asNew.length) {
      migrateThread(orgId, null, draftId)
      return { messages: asNew, prompt: readPrompt(orgId, draftId) || readPrompt(orgId, null) }
    }
  } else if (readLastDraftId) {
    const remembered = readLastDraftId(orgId)
    if (remembered) {
      const fromLast = readThread(orgId, remembered)
      if (fromLast.length) return { messages: fromLast, prompt: readPrompt(orgId, remembered) }
    }
  }
  return { messages: [], prompt: readPrompt(orgId, draftId) }
}

export function rememberChatSession(
  orgId: string,
  draftId: string | null,
  messages: ThreadMsg[],
  prompt: string,
) {
  liveChatSession = { orgId, policyId: draftId, messages, prompt }
  // Never clobber a stored thread with an empty array (common during remount / editor-null hydrate).
  if (messages.length) writeThread(orgId, draftId, messages)
  writePrompt(orgId, draftId, prompt)
}
