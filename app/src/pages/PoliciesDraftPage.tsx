import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Table as TableIcon,
} from 'lucide-react'
import {
  BrandLoader,
  Button,
  EmptyState,
  Notice,
  PageFrame,
  PageHeader,
  RaNum,
  SelectMenu,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { actorName, writeAuditLog } from '../lib/audit'
import {
  DraftPolicyError,
  streamDraftPolicy,
  type DraftChatMessage,
  type DraftTier,
} from '../lib/draftPolicy'
import { canDraftPolicies, canPublishPolicies, canUsePolicyDrafting } from '../lib/org'
import { sb } from '../lib/supabase'
import {
  formatUsdCents,
  markdownToHtml,
  tipTapJsonToMarkdown,
  titleFromMarkdown,
} from '../lib/tiptapMarkdown'
import styles from './PoliciesDraftPage.module.css'

type CreditBalance = {
  balance_cents: number
  monthly_allowance_cents: number
  low_balance_cents: number
}

type ThreadMsg = { id: string; role: 'user' | 'assistant'; content: string }

const DEFAULT_TITLE = 'Untitled policy'
const AUTOSAVE_MS = 900
const AUTOSAVE_PREF_KEY = 'ra:policy-draft:autosave'
const THREAD_KEY_PREFIX = 'ra:policy-draft:thread:'

const TIER_OPTIONS = [
  { value: 'eco', label: 'Eco', description: 'Fast drafting' },
  { value: 'standard', label: 'Pro', description: 'Balanced governance work' },
  { value: 'premium', label: 'Ultra', description: 'Deep analysis and framework alignment' },
]

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isUntitled(value: string) {
  const t = value.trim()
  return !t || t === DEFAULT_TITLE
}

function lastDraftKey(orgId: string) {
  return `ra:policy-draft:last:${orgId}`
}

function threadKey(orgId: string, draftId: string | null) {
  return `${THREAD_KEY_PREFIX}${orgId}:${draftId || 'new'}`
}

function readLastDraftId(orgId: string): string | null {
  try {
    return localStorage.getItem(lastDraftKey(orgId))
  } catch {
    return null
  }
}

function writeLastDraftId(orgId: string, id: string) {
  try {
    localStorage.setItem(lastDraftKey(orgId), id)
  } catch {
    /* ignore quota / private mode */
  }
}

function clearLastDraftId(orgId: string) {
  try {
    localStorage.removeItem(lastDraftKey(orgId))
  } catch {
    /* ignore */
  }
}

function readAutosavePref(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function writeAutosavePref(on: boolean) {
  try {
    localStorage.setItem(AUTOSAVE_PREF_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function readThread(orgId: string, draftId: string | null): ThreadMsg[] {
  try {
    const raw = sessionStorage.getItem(threadKey(orgId, draftId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as ThreadMsg[]
    return Array.isArray(parsed) ? parsed.filter((m) => m?.id && m?.role && typeof m.content === 'string') : []
  } catch {
    return []
  }
}

function writeThread(orgId: string, draftId: string | null, messages: ThreadMsg[]) {
  try {
    sessionStorage.setItem(threadKey(orgId, draftId), JSON.stringify(messages))
  } catch {
    /* ignore */
  }
}

function clearThread(orgId: string, draftId: string | null) {
  try {
    sessionStorage.removeItem(threadKey(orgId, draftId))
  } catch {
    /* ignore */
  }
}

function migrateThread(orgId: string, fromId: string | null, toId: string) {
  if (fromId === toId) return
  const msgs = readThread(orgId, fromId)
  if (msgs.length) writeThread(orgId, toId, msgs)
  clearThread(orgId, fromId)
}

function ToolBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`${styles.toolBtn}${active ? ` ${styles.toolBtnActive}` : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function EditorToolbar({ editor, locked }: { editor: Editor | null; locked: boolean }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!editor) return
    const bump = () => setTick((n) => n + 1)
    editor.on('selectionUpdate', bump)
    editor.on('transaction', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('transaction', bump)
    }
  }, [editor])

  if (!editor) return null

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Policy formatting">
      <div className={styles.toolGroup}>
        <ToolBtn
          label="Bold"
          active={editor.isActive('bold')}
          disabled={locked}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={14} strokeWidth={2} />
        </ToolBtn>
        <ToolBtn
          label="Italic"
          active={editor.isActive('italic')}
          disabled={locked}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={14} strokeWidth={2} />
        </ToolBtn>
      </div>
      <span className={styles.toolDivider} aria-hidden />
      <div className={styles.toolGroup}>
        <ToolBtn
          label="Heading 1"
          active={editor.isActive('heading', { level: 1 })}
          disabled={locked}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 size={14} strokeWidth={2} />
        </ToolBtn>
        <ToolBtn
          label="Heading 2"
          active={editor.isActive('heading', { level: 2 })}
          disabled={locked}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={14} strokeWidth={2} />
        </ToolBtn>
        <ToolBtn
          label="Heading 3"
          active={editor.isActive('heading', { level: 3 })}
          disabled={locked}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 size={14} strokeWidth={2} />
        </ToolBtn>
      </div>
      <span className={styles.toolDivider} aria-hidden />
      <div className={styles.toolGroup}>
        <ToolBtn
          label="Bullet list"
          active={editor.isActive('bulletList')}
          disabled={locked}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={14} strokeWidth={2} />
        </ToolBtn>
        <ToolBtn
          label="Numbered list"
          active={editor.isActive('orderedList')}
          disabled={locked}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={14} strokeWidth={2} />
        </ToolBtn>
        <ToolBtn
          label="Insert table"
          disabled={locked}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <TableIcon size={14} strokeWidth={2} />
        </ToolBtn>
      </div>
    </div>
  )
}

function UsageLine({
  credits,
  balanceTone,
}: {
  credits: CreditBalance | null
  balanceTone: 'neutral' | 'warn' | 'risk'
}) {
  if (!credits) {
    return <span className={styles.usageLine}>Usage included</span>
  }

  const balance = credits.balance_cents
  const allowance = credits.monthly_allowance_cents
  const atFullAllowance = balanceTone === 'neutral' && balance >= allowance

  return (
    <span className={styles.usageLine} data-tone={balanceTone}>
      {atFullAllowance ? (
        'Usage included'
      ) : (
        <>
          <RaNum>{formatUsdCents(balance)}</RaNum> remaining
        </>
      )}
    </span>
  )
}

export function PoliciesDraftPage() {
  const { policyId: routePolicyId } = useParams<{ policyId?: string }>()
  const { session, org, role, profile, orgReady } = useAuth()
  const navigate = useNavigate()
  const orgId = org?.id || null
  const userId = session?.user?.id
  const entitled = canUsePolicyDrafting(org)
  const canDraft = canDraftPolicies(role)
  const canPublish = canPublishPolicies(role)

  const [tier, setTier] = useState<DraftTier>('eco')
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ThreadMsg[]>([])
  const [streaming, setStreaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'unsaved' | 'error'>('idle')
  const [autosaveOn, setAutosaveOn] = useState(() => readAutosavePref())
  const [policyId, setPolicyId] = useState<string | null>(routePolicyId || null)
  const [hydrating, setHydrating] = useState(true)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [docEmpty, setDocEmpty] = useState(true)
  const [offerSavePrompt, setOfferSavePrompt] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const paperEndRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const editorStageRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef(title)
  const policyIdRef = useRef<string | null>(policyId)
  const autosaveOnRef = useRef(autosaveOn)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPersistedRef = useRef('')
  const skipAutosaveRef = useRef(false)
  const persistInFlightRef = useRef<Promise<boolean> | null>(null)
  const streamDocRafRef = useRef(0)
  const pendingStreamMdRef = useRef<string | null>(null)

  titleRef.current = title
  policyIdRef.current = policyId
  autosaveOnRef.current = autosaveOn

  usePageChrome({
    title: 'Draft a policy',
    breadcrumbs: [
      { label: 'Policies', to: '/policies' },
      { label: 'Draft a policy' },
    ],
  })

  const scheduleAutosaveRef = useRef<() => void>(() => {})
  const markDirtyRef = useRef<() => void>(() => {})

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '',
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '',
    editable: true,
    editorProps: {
      attributes: {
        class: 'policy-draft-editor',
        'aria-label': 'Policy document',
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          // Keep Enter from bubbling into any ancestor form / chrome handlers.
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            event.stopPropagation()
          }
          return false
        },
      },
    },
    onUpdate: ({ editor: ed }) => {
      setDocEmpty(ed.isEmpty)
      if (skipAutosaveRef.current) {
        skipAutosaveRef.current = false
        return
      }
      if (streaming) return
      markDirtyRef.current()
      scheduleAutosaveRef.current()
    },
    onCreate: ({ editor: ed }) => {
      setDocEmpty(ed.isEmpty)
    },
  })

  function pushToast(text: string) {
    if (!text.trim()) return
    setToasts((prev) => [...prev, { id: uid(), text }])
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  function maybeAutofillTitle(markdown: string) {
    if (!isUntitled(titleRef.current)) return
    const next = titleFromMarkdown(markdown, DEFAULT_TITLE)
    if (next && next !== DEFAULT_TITLE) setTitle(next)
  }

  function fingerprintNow(): string {
    if (!editor) return ''
    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    const saveTitle = titleRef.current.trim() || titleFromMarkdown(markdown, DEFAULT_TITLE)
    return `${saveTitle}\n${markdown}`
  }

  function markDirty() {
    const fp = fingerprintNow()
    if (!fp.trim() || fp === lastPersistedRef.current) {
      if (fp === lastPersistedRef.current && policyIdRef.current) setSaveState('saved')
      return
    }
    setSaveState('unsaved')
    setOfferSavePrompt(false)
  }

  markDirtyRef.current = markDirty

  function scrollPaperToEnd(behavior: ScrollBehavior = 'smooth') {
    const stage = editorStageRef.current
    const end = paperEndRef.current
    if (!stage) return
    requestAnimationFrame(() => {
      if (end) {
        end.scrollIntoView({ behavior, block: 'end' })
      } else {
        stage.scrollTo({ top: stage.scrollHeight, behavior })
      }
    })
  }

  function applyStreamDoc(markdown: string) {
    if (!editor) return
    skipAutosaveRef.current = true
    const html = markdownToHtml(markdown)
    editor.commands.setContent(html || '')
    setDocEmpty(!markdown.trim())
    maybeAutofillTitle(markdown)
    scrollPaperToEnd('auto')
  }

  /** Coalesce rapid doc_set bursts onto one frame so the paper still grows progressively. */
  function queueStreamDoc(markdown: string) {
    pendingStreamMdRef.current = markdown
    if (streamDocRafRef.current) return
    streamDocRafRef.current = requestAnimationFrame(() => {
      streamDocRafRef.current = 0
      const next = pendingStreamMdRef.current
      pendingStreamMdRef.current = null
      if (next != null) applyStreamDoc(next)
    })
  }

  async function loadCredits() {
    if (!orgId) return
    const { data, error: creditErr } = await sb
      .from('org_ai_credit_balances')
      .select('balance_cents,monthly_allowance_cents,low_balance_cents')
      .eq('org_id', orgId)
      .maybeSingle()
    if (creditErr) {
      console.warn('loadCredits', creditErr.message)
    }
    if (data) {
      setCredits(data as CreditBalance)
    } else {
      setCredits({ balance_cents: 0, monthly_allowance_cents: 500, low_balance_cents: 50 })
    }
  }

  async function persistDraft(source: 'auto' | 'manual' | 'post-stream'): Promise<boolean> {
    if (!orgId || !userId || !editor) return false
    if (source === 'auto' && !autosaveOnRef.current) return false

    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    if (!markdown.trim()) {
      if (source === 'manual') setError('Add policy content before saving.')
      return false
    }

    const saveTitle = titleRef.current.trim() || titleFromMarkdown(markdown, DEFAULT_TITLE)
    const fingerprint = `${saveTitle}\n${markdown}`
    if (source !== 'manual' && fingerprint === lastPersistedRef.current && policyIdRef.current) {
      if (source === 'auto') setSaveState('saved')
      return true
    }

    if (persistInFlightRef.current) {
      await persistInFlightRef.current
    }

    const run = (async () => {
      if (source === 'manual') setSaving(true)
      setSaveState('saving')
      setError('')

      const existingId = policyIdRef.current
      const now = new Date().toISOString()
      const previousId = existingId

      if (existingId) {
        const { error: updateErr } = await sb
          .from('policy_documents')
          .update({
            title: saveTitle,
            content: markdown,
            updated_at: now,
          })
          .eq('id', existingId)
          .eq('org_id', orgId)
          .is('published_at', null)

        if (updateErr) {
          setSaveState('error')
          if (source === 'manual') setError(updateErr.message || 'Could not save draft.')
          else console.warn('autosave', updateErr.message)
          if (source === 'manual') setSaving(false)
          return false
        }
      } else {
        const { data, error: insertErr } = await sb
          .from('policy_documents')
          .insert({
            org_id: orgId,
            title: saveTitle,
            description: 'Drafted with MLA',
            content: markdown,
            version: '0.1',
            category: 'ai_governance',
            requires_acknowledgment: false,
            acknowledgment_frequency: 'once',
            published_at: null,
            created_by: userId,
            is_active: true,
          })
          .select('id')
          .single()

        if (insertErr || !data?.id) {
          setSaveState('error')
          if (source === 'manual') setError(insertErr?.message || 'Could not save draft.')
          else console.warn('autosave insert', insertErr?.message)
          if (source === 'manual') setSaving(false)
          return false
        }

        setPolicyId(data.id)
        policyIdRef.current = data.id
        writeLastDraftId(orgId, data.id)
        migrateThread(orgId, previousId, data.id)
        navigate(`/policies/draft/${data.id}`, { replace: true })

        await writeAuditLog({
          orgId,
          userId,
          action: 'policy_drafted',
          entityType: 'policy',
          entityId: data.id,
          changes: {
            _actor_name: actorName(profile?.full_name, session?.user?.email),
            policy: saveTitle,
            published: false,
            tier,
            autosave: source === 'auto',
          },
        })
      }

      if (isUntitled(titleRef.current) && saveTitle !== DEFAULT_TITLE) {
        setTitle(saveTitle)
      }

      lastPersistedRef.current = fingerprint
      if (orgId && policyIdRef.current) writeLastDraftId(orgId, policyIdRef.current)
      setSaveState('saved')
      setOfferSavePrompt(false)
      if (source === 'manual') {
        setSaving(false)
        pushToast('Draft saved.')
      }
      return true
    })()

    persistInFlightRef.current = run
    try {
      return await run
    } finally {
      if (persistInFlightRef.current === run) persistInFlightRef.current = null
    }
  }

  scheduleAutosaveRef.current = () => {
    if (!autosaveOnRef.current) return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      void persistDraft('auto')
    }, AUTOSAVE_MS)
  }

  async function publishPolicy() {
    if (!orgId || !userId || !canPublish || !editor) return
    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    if (!markdown.trim()) {
      setError('Add policy content before publishing.')
      return
    }

    setPublishing(true)
    setError('')

    // Ensure latest content is persisted before publish.
    const saved = await persistDraft('manual')
    const id = policyIdRef.current
    if (!saved || !id) {
      setPublishing(false)
      return
    }

    const publishedAt = new Date().toISOString()
    const saveTitle = titleRef.current.trim() || titleFromMarkdown(markdown, DEFAULT_TITLE)
    const { error: updateErr } = await sb
      .from('policy_documents')
      .update({
        published_at: publishedAt,
        requires_acknowledgment: true,
        acknowledgment_frequency: 'on_update',
        updated_at: publishedAt,
      })
      .eq('id', id)
      .eq('org_id', orgId)

    if (updateErr) {
      setPublishing(false)
      setError(updateErr.message || 'Could not publish policy.')
      return
    }

    await writeAuditLog({
      orgId,
      userId,
      action: 'policy_published',
      entityType: 'policy',
      entityId: id,
      changes: {
        _actor_name: actorName(profile?.full_name, session?.user?.email),
        policy: saveTitle,
        version: '0.1',
      },
    })

    if (orgId) {
      clearLastDraftId(orgId)
      clearThread(orgId, id)
      clearThread(orgId, null)
    }
    setPublishing(false)
    pushToast('Policy published.')
    navigate(`/policies/${id}`, { replace: true })
  }

  useEffect(() => {
    if (orgId && entitled) void loadCredits()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, entitled])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming])

  // Persist chat thread for this session (survives soft remounts / first-save URL change).
  useEffect(() => {
    if (!orgId || hydrating) return
    writeThread(orgId, policyId, messages)
  }, [orgId, policyId, messages, hydrating])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!streaming)
    const el = editor.view.dom
    el.classList.toggle('readonly', streaming)
  }, [editor, streaming])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      if (streamDocRafRef.current) cancelAnimationFrame(streamDocRafRef.current)
    }
  }, [])

  // Warn when leaving with unsaved edits (autosave off).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (autosaveOnRef.current) return
      if (saveState !== 'unsaved') return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saveState])

  // Restore unpublished draft from URL, or last local draft id for this org.
  useEffect(() => {
    if (!orgReady || !orgId || !editor || !entitled || !canDraft) {
      if (orgReady) setHydrating(false)
      return
    }

    let cancelled = false

    async function hydrate() {
      setHydrating(true)
      setError('')

      let id = routePolicyId || null
      if (!id) {
        const remembered = readLastDraftId(orgId!)
        if (remembered) {
          const { data } = await sb
            .from('policy_documents')
            .select('id')
            .eq('id', remembered)
            .eq('org_id', orgId!)
            .eq('is_active', true)
            .is('published_at', null)
            .maybeSingle()
          if (!cancelled && data?.id) {
            // Restore session thread before navigate so the single route keeps chat.
            const rememberedThread = readThread(orgId!, remembered)
            const newThread = readThread(orgId!, null)
            if (!rememberedThread.length && newThread.length) {
              migrateThread(orgId!, null, remembered)
            }
            navigate(`/policies/draft/${data.id}`, { replace: true })
            return
          }
          clearLastDraftId(orgId!)
        }
        if (!cancelled) {
          setPolicyId(null)
          policyIdRef.current = null
          setMessages(readThread(orgId!, null))
          setHydrating(false)
        }
        return
      }

      // Soft restore: keep in-memory thread when we already own this draft id
      // (first-save URL update on the unified route).
      const alreadyLoaded = policyIdRef.current === id && !editor!.isEmpty
      if (alreadyLoaded) {
        setMessages((prev) => (prev.length ? prev : readThread(orgId!, id)))
        setHydrating(false)
        return
      }

      const { data, error: loadErr } = await sb
        .from('policy_documents')
        .select('id,title,content,published_at')
        .eq('id', id)
        .eq('org_id', orgId!)
        .eq('is_active', true)
        .maybeSingle()

      if (cancelled) return

      if (loadErr || !data) {
        setError(loadErr?.message || 'Draft not found.')
        setPolicyId(null)
        policyIdRef.current = null
        setHydrating(false)
        return
      }

      if (data.published_at) {
        navigate(`/policies/${data.id}`, { replace: true })
        return
      }

      const md = typeof data.content === 'string' ? data.content : ''
      skipAutosaveRef.current = true
      setPolicyId(data.id)
      policyIdRef.current = data.id
      setTitle((data.title as string) || DEFAULT_TITLE)
      editor!.commands.setContent(md ? markdownToHtml(md) : '')
      setDocEmpty(!md.trim())
      lastPersistedRef.current = `${(data.title as string) || ''}\n${md}`
      writeLastDraftId(orgId!, data.id)
      setSaveState(md.trim() ? 'saved' : 'idle')
      setMessages(readThread(orgId!, data.id))
      setHydrating(false)

      requestAnimationFrame(() => {
        editorStageRef.current?.scrollTo({ top: 0 })
      })
    }

    void hydrate()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgReady, orgId, entitled, canDraft, editor, routePolicyId])

  // Debounced autosave when title changes (only if toggle on).
  useEffect(() => {
    if (hydrating || streaming || !editor || !autosaveOn) return
    if (docEmpty && !policyId) return
    markDirty()
    scheduleAutosaveRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  useEffect(() => {
    if (hydrating || streaming || !editor) return
    if (!autosaveOn) {
      markDirty()
      return
    }
    scheduleAutosaveRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveOn])

  async function sendPrompt() {
    if (!orgId || !session?.access_token || !editor || streaming) return
    const text = prompt.trim()
    if (!text) return
    if ((credits?.balance_cents ?? 0) <= 0) {
      setError('Insufficient AI credits. Credits refill on subscription renewal.')
      return
    }

    setError('')
    setPrompt('')
    setOfferSavePrompt(false)
    const userMsg: ThreadMsg = { id: uid(), role: 'user', content: text }
    const assistantId = uid()
    // Append user message immediately; keep a placeholder assistant row for MLA status.
    setMessages((prev) => {
      const next = [...prev, userMsg, { id: assistantId, role: 'assistant' as const, content: '' }]
      writeThread(orgId, policyIdRef.current, next)
      return next
    })
    setStreaming(true)
    editor.setEditable(false)

    const history: DraftChatMessage[] = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }))
    const currentDoc = tipTapJsonToMarkdown(editor.getJSON())

    const controller = new AbortController()
    abortRef.current = controller
    let gotDoc = false

    try {
      await streamDraftPolicy(
        {
          orgId,
          accessToken: session.access_token,
          tier,
          messages: history,
          docMarkdown: currentDoc || undefined,
          signal: controller.signal,
        },
        {
          onMeta: (meta) => {
            setCredits((prev) =>
              prev
                ? {
                    ...prev,
                    balance_cents: meta.balance_cents,
                    low_balance_cents: meta.low_balance_cents ?? prev.low_balance_cents,
                  }
                : {
                    balance_cents: meta.balance_cents,
                    monthly_allowance_cents: 500,
                    low_balance_cents: meta.low_balance_cents ?? 50,
                  },
            )
          },
          onChatDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
            )
          },
          onDocSet: (markdown) => {
            if (!markdown.trim()) return
            gotDoc = true
            queueStreamDoc(markdown)
          },
          onCredit: (credit) => {
            setCredits((prev) =>
              prev
                ? { ...prev, balance_cents: credit.balance_cents }
                : {
                    balance_cents: credit.balance_cents,
                    monthly_allowance_cents: 500,
                    low_balance_cents: 50,
                  },
            )
          },
          onDone: (done) => {
            if (done.chat) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: done.chat || m.content } : m)),
              )
            }
            if (done.doc_markdown) {
              gotDoc = true
              // Flush any coalesced frame, then apply final doc.
              if (streamDocRafRef.current) {
                cancelAnimationFrame(streamDocRafRef.current)
                streamDocRafRef.current = 0
              }
              pendingStreamMdRef.current = null
              applyStreamDoc(done.doc_markdown)
            }
            if (typeof done.balance_cents === 'number') {
              setCredits((prev) =>
                prev
                  ? { ...prev, balance_cents: done.balance_cents! }
                  : {
                      balance_cents: done.balance_cents!,
                      monthly_allowance_cents: 500,
                      low_balance_cents: 50,
                    },
              )
            }
          },
          onError: (message) => {
            setError(message)
          },
        },
      )
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      if (e instanceof DraftPolicyError) {
        setError(e.message)
        if (typeof e.balance_cents === 'number') {
          setCredits((prev) =>
            prev
              ? { ...prev, balance_cents: e.balance_cents! }
              : { balance_cents: e.balance_cents!, monthly_allowance_cents: 500, low_balance_cents: 50 },
          )
        }
      } else {
        setError(e instanceof Error ? e.message : 'Draft request failed.')
      }
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.id === assistantId && !last.content) return prev.slice(0, -1)
        return prev
      })
    } finally {
      setStreaming(false)
      abortRef.current = null
      editor.setEditable(true)
      void loadCredits()
      const md = tipTapJsonToMarkdown(editor.getJSON())
      if (gotDoc || md.trim()) {
        if (autosaveOnRef.current) {
          void persistDraft('post-stream')
        } else {
          // Keep stream result in the editor; mark unsaved and offer Save.
          setSaveState('unsaved')
          setOfferSavePrompt(true)
          scrollPaperToEnd('smooth')
        }
      }
    }
  }

  function onComposerSubmit(e: FormEvent) {
    e.preventDefault()
    void sendPrompt()
  }

  function confirmDiscardUnsaved(): boolean {
    if (autosaveOn || saveState !== 'unsaved') return true
    return window.confirm('You have unsaved changes. Leave without saving?')
  }

  function startFresh() {
    if (!confirmDiscardUnsaved()) return
    abortRef.current?.abort()
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    if (orgId) {
      clearThread(orgId, policyId)
      clearThread(orgId, null)
      clearLastDraftId(orgId)
    }
    setPolicyId(null)
    policyIdRef.current = null
    setTitle(DEFAULT_TITLE)
    setMessages([])
    setPrompt('')
    setError('')
    setSaveState('idle')
    setOfferSavePrompt(false)
    lastPersistedRef.current = ''
    skipAutosaveRef.current = true
    editor?.commands.clearContent()
    setDocEmpty(true)
    navigate('/policies/draft', { replace: true })
  }

  function toggleAutosave() {
    const next = !autosaveOn
    setAutosaveOn(next)
    writeAutosavePref(next)
    if (next) {
      scheduleAutosaveRef.current()
      pushToast('Autosave on.')
    } else {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      markDirty()
      pushToast('Autosave off. Save draft explicitly.')
    }
  }

  if (!orgReady) {
    return (
      <PageFrame>
        <PageHeader title="Draft a policy" description="Loading workspace" />
        <BrandLoader fill label="Loading" />
      </PageFrame>
    )
  }

  if (!orgId) {
    return (
      <PageFrame>
        <PageHeader title="Draft a policy" description="Organisation context required." />
        <EmptyState title="No organisation" body="Join or create an organisation to draft policies." />
      </PageFrame>
    )
  }

  if (!entitled) {
    return (
      <PageFrame>
        <PageHeader
          title="Draft a policy"
          description="AI policy drafting is included with Essentials, Professional, and Enterprise."
          actions={
            <Link to="/plans">
              <Button>View plans</Button>
            </Link>
          }
        />
        <div className={styles.gated}>
          <EmptyState
            title="Upgrade to draft policies"
            body="Paid plans unlock the drafting workspace with a $5 USD monthly AI credit allowance (refill to cap)."
            action={
              <Link to="/plans">
                <Button variant="ghost">Compare plans</Button>
              </Link>
            }
          />
        </div>
      </PageFrame>
    )
  }

  if (!canDraft) {
    return (
      <PageFrame>
        <PageHeader title="Draft a policy" description="Editor access or higher is required." />
        <EmptyState
          title="View-only access"
          body="Ask an organisation owner or admin to grant editor access if you need to draft policies."
        />
      </PageFrame>
    )
  }

  if (hydrating) {
    return (
      <PageFrame>
        <PageHeader title="Draft a policy" description="Loading workspace" />
        <BrandLoader fill label="Loading draft" />
      </PageFrame>
    )
  }

  const lowBalance =
    credits != null && credits.balance_cents > 0 && credits.balance_cents < credits.low_balance_cents
  const noBalance = credits != null && credits.balance_cents <= 0
  const balanceTone = noBalance ? 'risk' : lowBalance ? 'warn' : 'neutral'
  const pageBlurb =
    'Use MLA to draft, revise and structure your policy. Edit the document directly before saving.'

  // Doc status stays "Unpublished" only. Save state lives in a reserved slot so chrome does not jump.
  const docStatus = 'Unpublished'
  const saveSlotLabel =
    streaming
      ? 'Drafting…'
      : saveState === 'saving'
        ? 'Saving…'
        : saveState === 'unsaved'
          ? 'Unsaved'
          : saveState === 'error'
            ? 'Save failed'
            : saveState === 'saved'
              ? 'Saved'
              : '\u00a0'

  return (
    <PageFrame>
      <div className={styles.draftPage}>
        <PageHeader
          title="Draft a policy"
          description={pageBlurb}
          actions={
            <Link
              to="/policies"
              onClick={(e) => {
                if (!confirmDiscardUnsaved()) e.preventDefault()
              }}
            >
              <Button variant="ghost">Back to policies</Button>
            </Link>
          }
        />

        {error ? <Notice tone="risk" title="Error">{error}</Notice> : null}
        {noBalance ? (
          <Notice tone="warn" title="No AI credits">
            Balance is empty. Credits refill to $5 USD on subscription renewal.
          </Notice>
        ) : null}
        {lowBalance && !noBalance ? (
          <Notice tone="warn" title="Low AI credits">
            Balance is below {formatUsdCents(credits!.low_balance_cents)}. Consider a shorter prompt or Eco.
          </Notice>
        ) : null}
        {offerSavePrompt && saveState === 'unsaved' && !autosaveOn ? (
          <Notice tone="quiet" title="Draft ready">
            MLA finished generating. Save draft to keep this version, or turn on autosave.
            <span className={styles.noticeActions}>
              <Button size="sm" onClick={() => void persistDraft('manual')}>
                Save draft
              </Button>
            </span>
          </Notice>
        ) : null}

        {/*
          Shell layout (CSS grid):
          row1 chatHead | docChrome  — equal height, shared hairline
          row2 messages | editorStage
          row3 composer | (editor spans)
        */}
        <div className={styles.shell}>
          <div className={styles.chatHead} aria-label="MLA">
            <div className={styles.chatBrand}>
              <div className={styles.chatHeadTitle}>MLA</div>
              <p className={styles.chatHeadSupport}>Machine Learning Assurance</p>
            </div>
            <div className={styles.chatMeta}>
              <div className={styles.tierWrap}>
                <SelectMenu
                  aria-label="Model tier"
                  value={tier}
                  options={TIER_OPTIONS}
                  disabled={streaming}
                  onChange={(v) => setTier((v as DraftTier) || 'eco')}
                />
              </div>
              <UsageLine credits={credits} balanceTone={balanceTone} />
            </div>
          </div>

          <div className={styles.docChrome} aria-label="Policy document">
            <div className={styles.docHeadRow}>
              <div className={styles.docHeadLeft}>
                <div className={styles.docPaneLabel}>Policy document</div>
                <input
                  className={styles.docTitleInput}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setSaveState((s) => (s === 'saved' ? 'unsaved' : s === 'idle' ? 'unsaved' : s))
                  }}
                  disabled={streaming}
                  aria-label="Policy title"
                />
                <div className={styles.docMetaRow}>
                  <span className={styles.docMeta}>{docStatus}</span>
                  <span className={styles.saveSlot} aria-live="polite">
                    {saveSlotLabel}
                  </span>
                </div>
              </div>
              <div className={styles.docActions}>
                <label className={styles.autosaveToggle}>
                  <input
                    type="checkbox"
                    checked={autosaveOn}
                    disabled={streaming}
                    onChange={() => toggleAutosave()}
                  />
                  <span>Autosave</span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={streaming}
                  onClick={() => startFresh()}
                >
                  New
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  pending={saving}
                  disabled={streaming || saving || docEmpty || saveState === 'saved'}
                  onClick={() => void persistDraft('manual')}
                >
                  {saveState === 'saved' && !saving ? 'Saved' : 'Save draft'}
                </Button>
                {canPublish ? (
                  <Button
                    type="button"
                    size="sm"
                    pending={publishing}
                    disabled={streaming || publishing || docEmpty}
                    onClick={() => void publishPolicy()}
                  >
                    Publish
                  </Button>
                ) : null}
              </div>
            </div>
            <EditorToolbar editor={editor} locked={streaming} />
          </div>

          <div className={styles.messages} aria-label="MLA conversation">
            {messages.map((m) => {
              const thinking = streaming && m.role === 'assistant' && !m.content
              return (
                <div
                  key={m.id}
                  className={`${styles.msg} ${m.role === 'user' ? styles.msgUser : styles.msgAssistant}`}
                >
                  {thinking ? (
                    <div className={styles.thinkingRow}>
                      <BrandLoader size="sm" label="MLA is thinking" />
                      <span className={styles.thinkingCopy}>MLA is drafting…</span>
                    </div>
                  ) : (
                    m.content
                  )}
                </div>
              )
            })}
            {streaming && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content ? (
              <div className={styles.thinkingInline} aria-live="polite">
                <BrandLoader size="sm" label="MLA is drafting" />
                <span className={styles.thinkingCopy}>MLA is drafting…</span>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          <div
            ref={editorStageRef}
            className={`${styles.editorStage}${streaming ? ` ${styles.editorStageLocked}` : ''}`}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp') {
                e.stopPropagation()
              }
            }}
          >
            <div className={styles.paper}>
              {streaming && docEmpty ? (
                <div className={styles.paperLoading} aria-live="polite">
                  <BrandLoader size="md" label="Drafting policy" />
                  <div className={styles.paperLoadingCopy}>Drafting on the page…</div>
                </div>
              ) : null}
              {!streaming && docEmpty ? (
                <div className={styles.docEmpty}>
                  <div className={styles.docEmptyTitle}>Your policy will appear here</div>
                </div>
              ) : null}
              {streaming && !docEmpty ? (
                <div className={styles.paperStreamingBadge}>
                  <BrandLoader size="sm" label="Drafting policy" />
                </div>
              ) : null}
              <div className={streaming && docEmpty ? styles.editorHidden : undefined}>
                <EditorContent editor={editor} />
              </div>
              <div ref={paperEndRef} className={styles.paperEnd} aria-hidden />
            </div>
          </div>

          <form className={styles.composer} onSubmit={onComposerSubmit}>
            <textarea
              id="mla-composer"
              ref={composerRef}
              className={styles.composerInput}
              value={prompt}
              disabled={streaming || noBalance}
              placeholder="Tell MLA what you want to draft, revise or review…"
              aria-label="Ask MLA"
              rows={4}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  e.stopPropagation()
                  void sendPrompt()
                  return
                }
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                  e.stopPropagation()
                }
              }}
            />
            <div className={styles.composerActions}>
              <span className={styles.composerHint}>⌘/Ctrl + Enter</span>
              <div className={styles.composerButtons}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!streaming}
                  onClick={() => abortRef.current?.abort()}
                >
                  Stop
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  pending={streaming}
                  disabled={!prompt.trim() || noBalance}
                >
                  Ask MLA
                </Button>
              </div>
            </div>
          </form>
        </div>

        <ToastStack items={toasts} onDismiss={dismissToast} />
      </div>
    </PageFrame>
  )
}
