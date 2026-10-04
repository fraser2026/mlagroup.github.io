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
  Drawer,
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
import {
  buildMetaWithThread,
  clearAllDraftChatMemory,
  getLiveChatSession,
  migrateThread,
  readThread,
  rememberChatSession,
  restoreChatSession as restoreChatSessionBase,
  setLiveChatSession,
  threadFromMeta,
  type ThreadMsg,
} from '../lib/draftChatSession'
import { canDraftPolicies, canPublishPolicies, canUsePolicyDrafting } from '../lib/org'
import {
  DEFAULT_DRAFT_VERSION,
  isPolicyUniqueViolation,
  listActivePolicyTitleCatalog,
  lookupPolicyTitleVersionConflict,
  normalizePolicyTitle,
  suggestCanonicalTitle,
  suggestNextPolicyVersion,
  suggestVersionForTitleLineage,
  trimPolicyTitle,
  versionsForTitle,
  type PolicyTitleCatalogEntry,
  type PolicyTitleVersionConflict,
} from '../lib/policyVersionGuard'
import { sb } from '../lib/supabase'
import { PlaceholderHighlight } from '../lib/placeholderHighlight'
import {
  listUniquePlaceholders,
  placeholderLabel,
  replacePlaceholderAll,
} from '../lib/policyPlaceholders'
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

const DEFAULT_TITLE = 'Untitled policy'
const AUTOSAVE_MS = 900
const AUTOSAVE_PREF_KEY = 'ra:policy-draft:autosave'
const THREAD_PERSIST_MS = 500
const STREAM_STALL_MS = 2200
const TITLE_CATALOG_MS = 400

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

/** Keep the paper H1 aligned when the conflict modal renames the policy. */
function replaceLeadingTitle(markdown: string, newTitle: string): string {
  const heading = `# ${newTitle.trim()}`
  if (/^#{1,2}\s+.+$/m.test(markdown)) {
    return markdown.replace(/^#{1,2}\s+.+$/m, heading)
  }
  if (!markdown.trim()) return `${heading}\n`
  return `${heading}\n\n${markdown}`
}

type ConflictPending = 'save' | 'publish'

type ConflictDraft = {
  title: string
  version: string
  suggestedVersion: string
  pending: ConflictPending
  conflict: PolicyTitleVersionConflict
}

function lastDraftKey(orgId: string) {
  return `ra:policy-draft:last:${orgId}`
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

function restoreChatSession(orgId: string, draftId: string | null) {
  return restoreChatSessionBase(orgId, draftId, readLastDraftId)
}

async function persistThreadMeta(
  orgId: string,
  policyId: string,
  messages: ThreadMsg[],
  prompt: string,
) {
  // Empty must not wipe a stored durable thread (remount races); New clears explicitly.
  if (!messages.length && !prompt.trim()) return
  const { data, error: loadErr } = await sb
    .from('policy_documents')
    .select('meta')
    .eq('id', policyId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (loadErr) {
    console.warn('persistThreadMeta load', loadErr.message)
    return
  }
  const meta = buildMetaWithThread(data?.meta, messages, prompt)
  const { error: updateErr } = await sb
    .from('policy_documents')
    .update({ meta })
    .eq('id', policyId)
    .eq('org_id', orgId)
  if (updateErr) console.warn('persistThreadMeta', updateErr.message)
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
  /** Brief ok-coloured "Saved" beside Save (Controls detail pattern); auto-clears. */
  const [saveCue, setSaveCue] = useState(false)
  const [autosaveOn, setAutosaveOn] = useState(() => readAutosavePref())
  const [policyId, setPolicyId] = useState<string | null>(routePolicyId || null)
  const [hydrating, setHydrating] = useState(true)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [docEmpty, setDocEmpty] = useState(true)
  const [offerSavePrompt, setOfferSavePrompt] = useState(false)
  /** True when editing a published policy body (owner/admin only). */
  const [isPublished, setIsPublished] = useState(false)
  const [policyVersion, setPolicyVersion] = useState(DEFAULT_DRAFT_VERSION)
  /** User edited title in the identity row (stops silent AI overwrite). */
  const [titleTouched, setTitleTouched] = useState(false)
  /** User edited version explicitly (stops lineage prefill from replacing it). */
  const [versionTouched, setVersionTouched] = useState(false)
  /** Active org titles for lineage prefill + optional near-match hint. */
  const [titleCatalog, setTitleCatalog] = useState<PolicyTitleCatalogEntry[]>([])
  const [titleHint, setTitleHint] = useState<string | null>(null)
  /** Centred modal when title+version collides with another active org policy. */
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictDraft, setConflictDraft] = useState<ConflictDraft | null>(null)
  const [conflictTitle, setConflictTitle] = useState('')
  const [conflictVersion, setConflictVersion] = useState('')
  const [conflictError, setConflictError] = useState('')
  const [conflictBusy, setConflictBusy] = useState(false)
  /** RA mark on paper only while waiting for first bytes or a stalled stream. */
  const [paperWaiting, setPaperWaiting] = useState(false)
  /**
   * Default composer highlight on draft load.
   * Cleared on pointer-down anywhere outside the composer form; restored only on focus.
   */
  const [composerInvite, setComposerInvite] = useState(true)
  const [composerPulse, setComposerPulse] = useState(false)
  /** Unique remaining [bracket] fields after stream / edits (Stage B). */
  const [reviewTokens, setReviewTokens] = useState<string[]>([])
  /** Draft values keyed by placeholder token for the Review fields strip. */
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({})

  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const paperEndRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const editorStageRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef(title)
  const policyVersionRef = useRef(policyVersion)
  const titleTouchedRef = useRef(titleTouched)
  const versionTouchedRef = useRef(versionTouched)
  const titleCatalogRef = useRef<PolicyTitleCatalogEntry[]>([])
  const titleCatalogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const policyIdRef = useRef<string | null>(policyId)
  const autosaveOnRef = useRef(autosaveOn)
  const conflictOpenRef = useRef(false)
  /** Last conflict key shown so autosave does not re-open the modal every tick. */
  const conflictShownKeyRef = useRef('')
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const threadPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPersistedRef = useRef('')
  const skipAutosaveRef = useRef(false)
  const persistInFlightRef = useRef<Promise<boolean> | null>(null)
  const streamDocRafRef = useRef(0)
  const pendingStreamMdRef = useRef<string | null>(null)
  const streamStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatHydratedRef = useRef(false)
  /** Which policy id's body was last applied into TipTap (prevents blank Edit skip). */
  const contentAppliedForIdRef = useRef<string | null>(null)
  /** Last known policy meta (for merge on save / thread persist). */
  const policyMetaRef = useRef<Record<string, unknown>>({})
  const messagesRef = useRef<ThreadMsg[]>(messages)
  const promptRef = useRef(prompt)
  messagesRef.current = messages
  promptRef.current = prompt

  titleRef.current = title
  policyVersionRef.current = policyVersion
  titleTouchedRef.current = titleTouched
  versionTouchedRef.current = versionTouched
  titleCatalogRef.current = titleCatalog
  policyIdRef.current = policyId
  autosaveOnRef.current = autosaveOn
  conflictOpenRef.current = conflictOpen

  function bumpStreamActivity(hasDocBytes: boolean) {
    if (streamStallTimerRef.current) clearTimeout(streamStallTimerRef.current)
    if (hasDocBytes) {
      setPaperWaiting(false)
      return
    }
    // Still waiting for first paper bytes (or stalled before any land).
    setPaperWaiting(true)
    streamStallTimerRef.current = setTimeout(() => {
      setPaperWaiting((prev) => prev || true)
    }, STREAM_STALL_MS)
  }

  usePageChrome({
    title: isPublished ? 'Edit policy' : 'Draft a policy',
    breadcrumbs: [
      { label: 'Policies', to: '/policies' },
      { label: isPublished ? 'Edit policy' : 'Draft a policy' },
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
      PlaceholderHighlight,
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

  function refreshReviewFields(markdown?: string) {
    if (!editor && markdown == null) {
      setReviewTokens([])
      return
    }
    const md = markdown ?? (editor ? tipTapJsonToMarkdown(editor.getJSON()) : '')
    const tokens = listUniquePlaceholders(md)
    setReviewTokens(tokens)
    setReviewDrafts((prev) => {
      const next: Record<string, string> = {}
      for (const token of tokens) {
        if (prev[token] != null) next[token] = prev[token]
      }
      return next
    })
  }

  function applyReviewField(token: string) {
    if (!editor || streaming) return
    const value = (reviewDrafts[token] || '').trim()
    if (!value) return
    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    const next = replacePlaceholderAll(markdown, token, value)
    if (next === markdown) return
    skipAutosaveRef.current = true
    editor.commands.setContent(markdownToHtml(next) || '')
    setDocEmpty(!next.trim())
    refreshReviewFields(next)
    markDirty()
    scheduleAutosaveRef.current()
  }

  function pushToast(text: string) {
    if (!text.trim()) return
    setToasts((prev) => [...prev, { id: uid(), text }])
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  /** Quiet success on the Editor status slot — ok colour on the label only, then clear. */
  function flashSavedCue() {
    if (saveCueTimerRef.current) clearTimeout(saveCueTimerRef.current)
    setSaveCue(true)
    saveCueTimerRef.current = setTimeout(() => {
      setSaveCue(false)
      saveCueTimerRef.current = null
    }, 2500)
  }

  function syncPaperTitle(nextTitle: string) {
    if (!editor) return
    const trimmed = trimPolicyTitle(nextTitle)
    if (!trimmed || isUntitled(trimmed)) return
    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    if (!markdown.trim()) return
    const currentHeading = titleFromMarkdown(markdown, DEFAULT_TITLE)
    if (normalizePolicyTitle(currentHeading) === normalizePolicyTitle(trimmed)) return
    skipAutosaveRef.current = true
    const nextMd = replaceLeadingTitle(markdown, trimmed)
    editor.commands.setContent(markdownToHtml(nextMd) || '')
    setDocEmpty(!nextMd.trim())
  }

  function refreshTitleHint(candidate: string, catalog = titleCatalogRef.current) {
    if (isUntitled(candidate)) {
      setTitleHint(null)
      return
    }
    const suggested = suggestCanonicalTitle(candidate, catalog)
    if (!suggested || normalizePolicyTitle(suggested) === normalizePolicyTitle(candidate)) {
      setTitleHint(null)
      return
    }
    setTitleHint(suggested)
  }

  function applyLineageVersion(forTitle: string, catalog = titleCatalogRef.current) {
    if (versionTouchedRef.current || isUntitled(forTitle)) return
    const next = suggestVersionForTitleLineage(versionsForTitle(catalog, forTitle))
    if (next === policyVersionRef.current) return
    setPolicyVersion(next)
    policyVersionRef.current = next
  }

  async function refreshTitleCatalog() {
    if (!orgId) {
      setTitleCatalog([])
      titleCatalogRef.current = []
      return
    }
    const catalog = await listActivePolicyTitleCatalog(orgId, policyIdRef.current)
    setTitleCatalog(catalog)
    titleCatalogRef.current = catalog
    refreshTitleHint(titleRef.current, catalog)
    if (!versionTouchedRef.current && !isUntitled(titleRef.current)) {
      applyLineageVersion(titleRef.current, catalog)
    }
  }

  function scheduleTitleCatalogRefresh() {
    if (titleCatalogTimerRef.current) clearTimeout(titleCatalogTimerRef.current)
    titleCatalogTimerRef.current = setTimeout(() => {
      void refreshTitleCatalog()
    }, TITLE_CATALOG_MS)
  }

  function commitIdentityTitle(raw: string, opts?: { touched?: boolean; syncPaper?: boolean }) {
    const next = trimPolicyTitle(raw) || DEFAULT_TITLE
    const touched = opts?.touched ?? true
    setTitle(next)
    titleRef.current = next
    if (touched) setTitleTouched(true)
    if (opts?.syncPaper !== false) syncPaperTitle(next)
    refreshTitleHint(next)
    if (!versionTouchedRef.current) applyLineageVersion(next)
    markDirty()
    scheduleAutosaveRef.current()
  }

  function commitIdentityVersion(raw: string, opts?: { touched?: boolean }) {
    const next = raw.trim() || DEFAULT_DRAFT_VERSION
    setPolicyVersion(next)
    policyVersionRef.current = next
    if (opts?.touched !== false) setVersionTouched(true)
    markDirty()
    scheduleAutosaveRef.current()
  }

  function maybeAutofillTitle(markdown: string) {
    if (titleTouchedRef.current) return
    if (!isUntitled(titleRef.current)) return
    const next = titleFromMarkdown(markdown, DEFAULT_TITLE)
    if (!next || next === DEFAULT_TITLE) return
    setTitle(next)
    titleRef.current = next
    refreshTitleHint(next)
    applyLineageVersion(next)
    scheduleTitleCatalogRefresh()
  }

  function fingerprintNow(): string {
    if (!editor) return ''
    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    const saveTitle = titleRef.current.trim() || titleFromMarkdown(markdown, DEFAULT_TITLE)
    const saveVersion = policyVersionRef.current.trim() || DEFAULT_DRAFT_VERSION
    return `${saveTitle}\n${saveVersion}\n${markdown}`
  }

  function markDirty() {
    const fp = fingerprintNow()
    if (!fp.trim() || fp === lastPersistedRef.current) {
      if (fp === lastPersistedRef.current && policyIdRef.current) setSaveState('saved')
      return
    }
    if (saveCueTimerRef.current) {
      clearTimeout(saveCueTimerRef.current)
      saveCueTimerRef.current = null
    }
    setSaveCue(false)
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

  // Stage B: rescan remaining [brackets] when the paper settles (not mid-stream).
  useEffect(() => {
    if (!editor || streaming || hydrating) return
    refreshReviewFields()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, streaming, hydrating, docEmpty])

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

  function conflictKey(titleValue: string, versionValue: string) {
    return `${normalizePolicyTitle(titleValue)}::${versionValue.trim()}`
  }

  function openTitleVersionConflict(args: {
    title: string
    version: string
    suggestedVersion: string
    pending: ConflictPending
    conflict: PolicyTitleVersionConflict
  }) {
    conflictShownKeyRef.current = conflictKey(args.title, args.version)
    setConflictDraft(args)
    setConflictTitle(args.title)
    setConflictVersion(args.suggestedVersion)
    setConflictError('')
    setConflictBusy(false)
    setConflictOpen(true)
    setSaveState('unsaved')
  }

  function closeConflictModal() {
    conflictOpenRef.current = false
    setConflictOpen(false)
    setConflictBusy(false)
    setConflictError('')
  }

  async function ensureTitleVersionAvailable(
    saveTitle: string,
    version: string,
    source: 'auto' | 'manual' | 'post-stream' | 'publish',
  ): Promise<boolean> {
    if (!orgId) return false
    if (source === 'auto' && conflictOpenRef.current) return false

    const key = conflictKey(saveTitle, version)
    if (source === 'auto' && conflictShownKeyRef.current === key) return false

    const lookup = await lookupPolicyTitleVersionConflict({
      orgId,
      title: saveTitle,
      version,
      excludeId: policyIdRef.current,
    })
    if (!lookup.conflict) return true

    const suggested = suggestNextPolicyVersion(version, lookup.titleVersions)
    openTitleVersionConflict({
      title: saveTitle,
      version,
      suggestedVersion: suggested,
      pending: source === 'publish' ? 'publish' : 'save',
      conflict: lookup.conflict,
    })
    if (source === 'manual' || source === 'publish') {
      setError('Another active policy already uses this title and version.')
    } else {
      console.warn('autosave blocked: title+version collision', saveTitle, version)
    }
    return false
  }

  function applyConflictIdentity(nextTitle: string, nextVersion: string) {
    const trimmed = trimPolicyTitle(nextTitle) || DEFAULT_TITLE
    setTitle(trimmed)
    titleRef.current = trimmed
    setTitleTouched(true)
    setPolicyVersion(nextVersion)
    policyVersionRef.current = nextVersion
    setVersionTouched(true)
    setTitleHint(null)
    syncPaperTitle(trimmed)
  }

  async function resolveConflictContinue() {
    if (!conflictDraft) return
    const nextTitle = conflictTitle.trim()
    const nextVersion = conflictVersion.trim()
    if (!nextTitle) {
      setConflictError('Enter a title.')
      return
    }
    if (!nextVersion) {
      setConflictError('Enter a version.')
      return
    }

    setConflictBusy(true)
    setConflictError('')
    const lookup = await lookupPolicyTitleVersionConflict({
      orgId: orgId!,
      title: nextTitle,
      version: nextVersion,
      excludeId: policyIdRef.current,
    })
    if (lookup.conflict) {
      const suggested = suggestNextPolicyVersion(nextVersion, lookup.titleVersions)
      setConflictVersion(suggested)
      setConflictError(
        `Still in use (${lookup.conflict.published ? 'published' : 'draft'}). Try version ${suggested} or another title.`,
      )
      setConflictBusy(false)
      return
    }

    const pending = conflictDraft.pending
    applyConflictIdentity(nextTitle, nextVersion)
    conflictShownKeyRef.current = ''
    closeConflictModal()
    setError('')
    setConflictBusy(false)

    if (pending === 'publish') {
      await publishPolicy()
    } else {
      await persistDraft('manual')
    }
  }

  async function persistDraft(source: 'auto' | 'manual' | 'post-stream'): Promise<boolean> {
    if (!orgId || !userId || !editor) return false
    if (source === 'auto' && !autosaveOnRef.current) return false
    if (source === 'auto' && conflictOpenRef.current) return false

    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    if (!markdown.trim()) {
      if (source === 'manual') setError('Add policy content before saving.')
      return false
    }

    const saveTitle =
      trimPolicyTitle(titleRef.current) || titleFromMarkdown(markdown, DEFAULT_TITLE)
    const saveVersion = policyVersionRef.current.trim() || DEFAULT_DRAFT_VERSION
    const fingerprint = `${saveTitle}\n${saveVersion}\n${markdown}`
    if (source !== 'manual' && fingerprint === lastPersistedRef.current && policyIdRef.current) {
      if (source === 'auto') setSaveState('saved')
      return true
    }

    const allowed = await ensureTitleVersionAvailable(saveTitle, saveVersion, source)
    if (!allowed) {
      setSaveState('unsaved')
      return false
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
        // Editors may only update unpublished rows (RLS). Owner/admin may save published bodies.
        if (isPublished && !canPublish) {
          setSaveState('error')
          if (source === 'manual') setError('Only an owner or admin can edit a published policy.')
          if (source === 'manual') setSaving(false)
          return false
        }

        const meta = buildMetaWithThread(policyMetaRef.current, messagesRef.current, promptRef.current)
        policyMetaRef.current = meta

        let updateQuery = sb
          .from('policy_documents')
          .update({
            title: saveTitle,
            content: markdown,
            version: saveVersion,
            meta,
            updated_at: now,
          })
          .eq('id', existingId)
          .eq('org_id', orgId)

        if (!isPublished) {
          updateQuery = updateQuery.is('published_at', null)
        }

        const { error: updateErr } = await updateQuery

        if (updateErr) {
          if (isPolicyUniqueViolation(updateErr)) {
            const lookup = await lookupPolicyTitleVersionConflict({
              orgId,
              title: saveTitle,
              version: saveVersion,
              excludeId: existingId,
            })
            openTitleVersionConflict({
              title: saveTitle,
              version: saveVersion,
              suggestedVersion: suggestNextPolicyVersion(saveVersion, lookup.titleVersions),
              pending: 'save',
              conflict: lookup.conflict || {
                id: '',
                title: saveTitle,
                version: saveVersion,
                published: true,
              },
            })
            setSaveState('unsaved')
            if (source === 'manual') setError('Another active policy already uses this title and version.')
            if (source === 'manual') setSaving(false)
            return false
          }
          setSaveState('error')
          if (source === 'manual') setError(updateErr.message || 'Could not save draft.')
          else console.warn('autosave', updateErr.message)
          if (source === 'manual') setSaving(false)
          return false
        }
        contentAppliedForIdRef.current = existingId
      } else {
        const meta = buildMetaWithThread({}, messagesRef.current, promptRef.current)
        policyMetaRef.current = meta
        const { data, error: insertErr } = await sb
          .from('policy_documents')
          .insert({
            org_id: orgId,
            title: saveTitle,
            description: 'Drafted with MLA',
            content: markdown,
            version: saveVersion,
            category: 'ai_governance',
            requires_acknowledgment: false,
            acknowledgment_frequency: 'once',
            published_at: null,
            created_by: userId,
            is_active: true,
            meta,
          })
          .select('id')
          .single()

        if (insertErr || !data?.id) {
          if (isPolicyUniqueViolation(insertErr)) {
            const lookup = await lookupPolicyTitleVersionConflict({
              orgId,
              title: saveTitle,
              version: saveVersion,
              excludeId: null,
            })
            openTitleVersionConflict({
              title: saveTitle,
              version: saveVersion,
              suggestedVersion: suggestNextPolicyVersion(saveVersion, lookup.titleVersions),
              pending: 'save',
              conflict: lookup.conflict || {
                id: '',
                title: saveTitle,
                version: saveVersion,
                published: true,
              },
            })
            setSaveState('unsaved')
            if (source === 'manual') setError('Another active policy already uses this title and version.')
            if (source === 'manual') setSaving(false)
            return false
          }
          setSaveState('error')
          if (source === 'manual') setError(insertErr?.message || 'Could not save draft.')
          else console.warn('autosave insert', insertErr?.message)
          if (source === 'manual') setSaving(false)
          return false
        }

        setPolicyId(data.id)
        policyIdRef.current = data.id
        contentAppliedForIdRef.current = data.id
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
            version: saveVersion,
            published: false,
            tier,
            autosave: source === 'auto',
          },
        })
      }

      if (isUntitled(titleRef.current) && saveTitle !== DEFAULT_TITLE) {
        setTitle(saveTitle)
      }

      conflictShownKeyRef.current = ''
      lastPersistedRef.current = fingerprint
      if (orgId && policyIdRef.current) writeLastDraftId(orgId, policyIdRef.current)
      setSaveState('saved')
      setOfferSavePrompt(false)
      if (source === 'manual') {
        setSaving(false)
        flashSavedCue()
        pushToast(isPublished ? 'Policy saved.' : 'Draft saved.')
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

  async function deactivateUnpublishedSiblings(org: string, title: string, keepId: string) {
    const now = new Date().toISOString()
    const { error: deactivateErr } = await sb
      .from('policy_documents')
      .update({ is_active: false, updated_at: now })
      .eq('org_id', org)
      .eq('title', title)
      .eq('is_active', true)
      .is('published_at', null)
      .neq('id', keepId)
    if (deactivateErr) console.warn('deactivate unpublished siblings', deactivateErr.message)
  }

  async function publishPolicy() {
    if (!orgId || !userId || !canPublish || !editor || isPublished) return
    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    if (!markdown.trim()) {
      setError('Add policy content before publishing.')
      return
    }

    const saveTitle =
      trimPolicyTitle(titleRef.current) || titleFromMarkdown(markdown, DEFAULT_TITLE)
    const saveVersion = policyVersionRef.current.trim() || DEFAULT_DRAFT_VERSION
    const allowed = await ensureTitleVersionAvailable(saveTitle, saveVersion, 'publish')
    if (!allowed) return

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
    const { data: publishedRow, error: updateErr } = await sb
      .from('policy_documents')
      .update({
        published_at: publishedAt,
        requires_acknowledgment: true,
        acknowledgment_frequency: 'on_update',
        updated_at: publishedAt,
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('published_at', null)
      .select('id,published_at,version,title')
      .maybeSingle()

    if (updateErr || !publishedRow?.published_at) {
      setPublishing(false)
      if (isPolicyUniqueViolation(updateErr)) {
        const lookup = await lookupPolicyTitleVersionConflict({
          orgId,
          title: saveTitle,
          version: saveVersion,
          excludeId: id,
        })
        openTitleVersionConflict({
          title: saveTitle,
          version: saveVersion,
          suggestedVersion: suggestNextPolicyVersion(saveVersion, lookup.titleVersions),
          pending: 'publish',
          conflict: lookup.conflict || {
            id: '',
            title: saveTitle,
            version: saveVersion,
            published: true,
          },
        })
        setError('Another active policy already uses this title and version.')
        return
      }
      setError(updateErr?.message || 'Could not publish policy.')
      return
    }

    // Drop orphan same-title drafts so the library does not keep an Unpublished twin.
    await deactivateUnpublishedSiblings(orgId, saveTitle, id)

    const version = (publishedRow.version as string) || policyVersion || DEFAULT_DRAFT_VERSION
    await writeAuditLog({
      orgId,
      userId,
      action: 'policy_published',
      entityType: 'policy',
      entityId: id,
      changes: {
        _actor_name: actorName(profile?.full_name, session?.user?.email),
        policy: (publishedRow.title as string) || saveTitle,
        version,
      },
    })

    // Keep MLA thread on the policy (meta + live cache) so Publish → Edit restores chat.
    if (orgId) {
      clearLastDraftId(orgId)
      rememberChatSession(orgId, id, messagesRef.current, promptRef.current)
      void persistThreadMeta(orgId, id, messagesRef.current, promptRef.current)
    }
    setIsPublished(true)
    setPublishing(false)
    flashSavedCue()
    pushToast('Policy published.')
    navigate(`/policies/${id}`, { replace: true })
  }

  useEffect(() => {
    if (orgId && entitled) void loadCredits()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, entitled])

  useEffect(() => {
    if (!orgId || !entitled || !canDraft) {
      setTitleCatalog([])
      titleCatalogRef.current = []
      return
    }
    void refreshTitleCatalog()
    return () => {
      if (titleCatalogTimerRef.current) clearTimeout(titleCatalogTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, entitled, canDraft, policyId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming])

  // Seed chat once per org mount from live memory / sessionStorage (before hydrate can wipe).
  useEffect(() => {
    if (!orgId || chatHydratedRef.current) return
    const restored = restoreChatSession(orgId, routePolicyId || policyIdRef.current)
    chatHydratedRef.current = true
    if (restored.messages.length) setMessages(restored.messages)
    if (restored.prompt) setPrompt(restored.prompt)
  }, [orgId, routePolicyId])

  // Persist chat + composer for this session. Never write empty over a stored thread.
  useEffect(() => {
    if (!orgId || !chatHydratedRef.current) return
    rememberChatSession(orgId, policyId, messages, prompt)
  }, [orgId, policyId, messages, prompt])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!streaming)
    const el = editor.view.dom
    el.classList.toggle('readonly', streaming)
  }, [editor, streaming])

  useEffect(() => {
    if (!streaming) {
      setPaperWaiting(false)
      if (streamStallTimerRef.current) clearTimeout(streamStallTimerRef.current)
    }
  }, [streaming])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      if (saveCueTimerRef.current) clearTimeout(saveCueTimerRef.current)
      if (threadPersistTimerRef.current) clearTimeout(threadPersistTimerRef.current)
      if (streamDocRafRef.current) cancelAnimationFrame(streamDocRafRef.current)
      if (streamStallTimerRef.current) clearTimeout(streamStallTimerRef.current)
    }
  }, [])

  // One-shot restrained pulse when the default composer invite appears after hydrate.
  useEffect(() => {
    if (hydrating || !composerInvite) return
    setComposerPulse(true)
    const t = window.setTimeout(() => setComposerPulse(false), 900)
    return () => window.clearTimeout(t)
  }, [hydrating, routePolicyId])

  // Clear default invite on any pointer-down outside the composer (Ask MLA controls included).
  // Re-highlight only when the textarea receives focus again — not on chat/Eco/Editor clicks.
  useEffect(() => {
    if (!composerInvite) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (composerFormRef.current?.contains(t)) return
      setComposerInvite(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [composerInvite])

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

  // Restore draft/published body from URL. Always load TipTap from the row for an id
  // unless we already applied that id's content this mount (first-save URL / remount).
  useEffect(() => {
    if (!orgReady || !orgId || !editor || !entitled || !canDraft) {
      if (orgReady && (!entitled || !canDraft || !orgId)) setHydrating(false)
      return
    }

    let cancelled = false

    async function hydrate() {
      const id = routePolicyId || null
      const live = getLiveChatSession()

      setError('')

      // Soft path: same id already applied into the editor — only refresh chat cache.
      if (
        id &&
        contentAppliedForIdRef.current === id &&
        policyIdRef.current === id &&
        !editor!.isEmpty
      ) {
        const restored = restoreChatSession(orgId!, id)
        setMessages((prev) => (prev.length ? prev : restored.messages))
        if (restored.prompt) setPrompt((p) => p || restored.prompt)
        setHydrating(false)
        return
      }

      const hasSession =
        messagesRef.current.length > 0 ||
        (live?.orgId === orgId && live.messages.length > 0) ||
        !editor!.isEmpty
      if (!hasSession) setHydrating(true)

      if (!id) {
        contentAppliedForIdRef.current = null
        policyMetaRef.current = {}
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
          setIsPublished(false)
          const restored = restoreChatSession(orgId!, null)
          setMessages((prev) => (prev.length ? prev : restored.messages))
          if (restored.prompt) setPrompt((p) => p || restored.prompt)
          setHydrating(false)
          setComposerInvite(true)
        }
        return
      }

      const { data, error: loadErr } = await sb
        .from('policy_documents')
        .select('id,title,content,published_at,version,meta')
        .eq('id', id)
        .eq('org_id', orgId!)
        .eq('is_active', true)
        .maybeSingle()

      if (cancelled) return

      if (loadErr || !data) {
        setError(loadErr?.message || 'Draft not found.')
        setPolicyId(null)
        policyIdRef.current = null
        contentAppliedForIdRef.current = null
        policyMetaRef.current = {}
        setIsPublished(false)
        setHydrating(false)
        return
      }

      // Published bodies: owner/admin may continue editing; editors stay locked on detail.
      if (data.published_at && !canPublish) {
        navigate(`/policies/${data.id}`, { replace: true })
        return
      }

      const md = typeof data.content === 'string' ? data.content : ''
      const published = !!data.published_at
      const metaObj =
        data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)
          ? { ...(data.meta as Record<string, unknown>) }
          : {}
      policyMetaRef.current = metaObj

      skipAutosaveRef.current = true
      setPolicyId(data.id)
      policyIdRef.current = data.id
      setIsPublished(published)
      const loadedVersion = (data.version as string) || DEFAULT_DRAFT_VERSION
      const loadedTitle = (data.title as string) || DEFAULT_TITLE
      setPolicyVersion(loadedVersion)
      policyVersionRef.current = loadedVersion
      setVersionTouched(true)
      versionTouchedRef.current = true
      setTitle(loadedTitle)
      titleRef.current = loadedTitle
      setTitleTouched(!isUntitled(loadedTitle))
      titleTouchedRef.current = !isUntitled(loadedTitle)
      setTitleHint(null)
      editor!.commands.setContent(md ? markdownToHtml(md) : '')
      setDocEmpty(!md.trim())
      contentAppliedForIdRef.current = data.id
      lastPersistedRef.current = `${loadedTitle}\n${loadedVersion}\n${md}`
      conflictShownKeyRef.current = ''
      if (!published) writeLastDraftId(orgId!, data.id)
      setSaveState(md.trim() ? 'saved' : 'idle')
      void refreshTitleCatalog()

      // Durable thread on the policy wins; fall back to live/session cache for same id.
      const fromMeta = threadFromMeta(metaObj)
      const restored = restoreChatSession(orgId!, data.id)
      const nextMessages = fromMeta?.messages?.length
        ? fromMeta.messages
        : restored.messages
      const nextPrompt = fromMeta?.prompt || restored.prompt || ''
      setMessages((prev) => (prev.length && !fromMeta?.messages?.length ? prev : nextMessages))
      if (nextPrompt) setPrompt((p) => p || nextPrompt)
      rememberChatSession(orgId!, data.id, nextMessages.length ? nextMessages : messagesRef.current, nextPrompt || promptRef.current)

      setHydrating(false)
      setComposerInvite(true)

      requestAnimationFrame(() => {
        editorStageRef.current?.scrollTo({ top: 0 })
      })
    }

    void hydrate()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgReady, orgId, entitled, canDraft, canPublish, editor, routePolicyId])

  // Debounced durable chat persist onto policy_documents.meta.mla_thread.
  useEffect(() => {
    if (!orgId || !policyId || hydrating || !chatHydratedRef.current) return
    if (threadPersistTimerRef.current) clearTimeout(threadPersistTimerRef.current)
    threadPersistTimerRef.current = setTimeout(() => {
      void persistThreadMeta(orgId, policyId, messages, prompt)
    }, THREAD_PERSIST_MS)
    return () => {
      if (threadPersistTimerRef.current) clearTimeout(threadPersistTimerRef.current)
    }
  }, [orgId, policyId, messages, prompt, hydrating])

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
      rememberChatSession(orgId, policyIdRef.current, next, '')
      return next
    })
    setStreaming(true)
    setPaperWaiting(true)
    bumpStreamActivity(false)
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
            bumpStreamActivity(gotDoc)
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
            )
          },
          onDocSet: (markdown) => {
            if (!markdown.trim()) return
            gotDoc = true
            bumpStreamActivity(true)
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
              bumpStreamActivity(true)
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
    if (threadPersistTimerRef.current) clearTimeout(threadPersistTimerRef.current)

    // Abandoning an unpublished draft via New should not leave an Unpublished twin in the library.
    const abandonId = policyIdRef.current
    const abandonPublished = isPublished
    if (orgId && abandonId && !abandonPublished) {
      const now = new Date().toISOString()
      void sb
        .from('policy_documents')
        .update({
          is_active: false,
          updated_at: now,
          meta: buildMetaWithThread(policyMetaRef.current, [], ''),
        })
        .eq('id', abandonId)
        .eq('org_id', orgId)
        .is('published_at', null)
        .then(({ error: deactivateErr }) => {
          if (deactivateErr) console.warn('deactivate abandoned draft', deactivateErr.message)
        })
    }

    if (orgId) {
      clearAllDraftChatMemory(orgId)
      clearLastDraftId(orgId)
      setLiveChatSession({ orgId, policyId: null, messages: [], prompt: '' })
    } else {
      clearAllDraftChatMemory()
    }
    chatHydratedRef.current = true
    contentAppliedForIdRef.current = null
    policyMetaRef.current = {}
    setPolicyId(null)
    policyIdRef.current = null
    setIsPublished(false)
    setPolicyVersion(DEFAULT_DRAFT_VERSION)
    policyVersionRef.current = DEFAULT_DRAFT_VERSION
    setVersionTouched(false)
    versionTouchedRef.current = false
    setTitle(DEFAULT_TITLE)
    titleRef.current = DEFAULT_TITLE
    setTitleTouched(false)
    titleTouchedRef.current = false
    setTitleHint(null)
    setMessages([])
    setPrompt('')
    setError('')
    setSaveState('idle')
    if (saveCueTimerRef.current) {
      clearTimeout(saveCueTimerRef.current)
      saveCueTimerRef.current = null
    }
    setSaveCue(false)
    setOfferSavePrompt(false)
    setPaperWaiting(false)
    setComposerInvite(true)
    lastPersistedRef.current = ''
    conflictShownKeyRef.current = ''
    closeConflictModal()
    setConflictDraft(null)
    setReviewTokens([])
    setReviewDrafts({})
    skipAutosaveRef.current = true
    editor?.commands.clearContent()
    setDocEmpty(true)
    navigate('/policies/draft', { replace: true })
    void refreshTitleCatalog()
  }

  function toggleAutosave() {
    // Preference only — do not remount, clear chat, or touch message state.
    const next = !autosaveOn
    setAutosaveOn(next)
    writeAutosavePref(next)
    if (orgId) rememberChatSession(orgId, policyIdRef.current, messages, prompt)
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
      <PageFrame denseWorkspace>
        <PageHeader title="Draft a policy" description="Loading workspace" />
        <BrandLoader fill label="Loading" />
      </PageFrame>
    )
  }

  if (!orgId) {
    return (
      <PageFrame denseWorkspace>
        <PageHeader title="Draft a policy" description="Organisation context required." />
        <EmptyState title="No organisation" body="Join or create an organisation to draft policies." />
      </PageFrame>
    )
  }

  if (!entitled) {
    return (
      <PageFrame denseWorkspace>
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
      <PageFrame denseWorkspace>
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
      <PageFrame denseWorkspace>
        <PageHeader title="Draft a policy" description="Loading workspace" />
        <BrandLoader fill label="Loading draft" />
      </PageFrame>
    )
  }

  const lowBalance =
    credits != null && credits.balance_cents > 0 && credits.balance_cents < credits.low_balance_cents
  const noBalance = credits != null && credits.balance_cents <= 0
  const balanceTone = noBalance ? 'risk' : lowBalance ? 'warn' : 'neutral'
  const pageTitle = isPublished ? 'Edit policy' : 'Draft a policy'
  const pageBlurb = isPublished
    ? 'Update the published policy document. Editors cannot change published policies.'
    : 'Use MLA to draft, revise and structure your policy. Edit the document directly before saving.'

  const saveSlotLabel =
    streaming
      ? 'Drafting…'
      : saveState === 'saving'
        ? 'Saving…'
        : saveState === 'unsaved'
          ? 'Unsaved'
          : saveState === 'error'
            ? 'Save failed'
            : saveCue
              ? 'Saved'
              : ''

  const showPaperLoader = paperWaiting && (docEmpty || streaming)

  return (
    <PageFrame denseWorkspace>
      <div className={styles.draftPage}>
        <PageHeader
          title={pageTitle}
          description={pageBlurb}
          actions={
            <Link
              to="/policies"
              onClick={(e) => {
                if (!confirmDiscardUnsaved()) e.preventDefault()
              }}
            >
              <Button variant="ghost" size="sm">
                Back to policies
              </Button>
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
            MLA finished generating. Save to keep this version, or turn on autosave.
            <span className={styles.noticeActions}>
              <Button size="sm" onClick={() => void persistDraft('manual')}>
                Save
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
          <div
            className={styles.chatHead}
            aria-label="MLA — Machine Learning Assurance"
            title="Machine Learning Assurance"
          >
            {/*
              Inner band packs at the top of the shared grid head track so the
              MLA meta row lines up with Editor title; bottom hairline stays Δ0
              with docChrome (title + toolbar).
            */}
            <div className={styles.chatHeadBand}>
              <div className={styles.chatBrand}>
                <div className={styles.chatHeadTitle}>MLA</div>
                <UsageLine credits={credits} balanceTone={balanceTone} />
              </div>
              <div className={styles.tierWrap}>
                <SelectMenu
                  aria-label="Model tier"
                  value={tier}
                  options={TIER_OPTIONS}
                  disabled={streaming}
                  onChange={(v) => setTier((v as DraftTier) || 'eco')}
                />
              </div>
            </div>
          </div>

          <div className={styles.docChrome} aria-label="Editor">
            <div className={styles.docHeadRow}>
              <div className={styles.docPaneTitle}>Editor</div>
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
                {saveSlotLabel ? (
                  <span
                    className={
                      saveCue && saveSlotLabel === 'Saved'
                        ? `${styles.saveStatus} ${styles.saveStatusOk}`
                        : styles.saveStatus
                    }
                    aria-live="polite"
                  >
                    {saveSlotLabel}
                  </span>
                ) : (
                  <span className={styles.saveStatus} aria-hidden>
                    {'\u00a0'}
                  </span>
                )}
                <Button type="button" size="sm" variant="ghost" disabled={streaming} onClick={() => startFresh()}>
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
                  Save
                </Button>
                {canPublish && !isPublished ? (
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
            <div className={styles.identityRow} aria-label="Policy title and version">
              <label className={styles.identityField}>
                <span className={styles.identityLabel}>Title</span>
                <input
                  className={styles.identityInput}
                  type="text"
                  value={isUntitled(title) ? '' : title}
                  placeholder={DEFAULT_TITLE}
                  disabled={streaming}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Policy title"
                  onChange={(e) => {
                    const next = e.target.value
                    setTitle(next)
                    titleRef.current = next
                    setTitleTouched(true)
                    titleTouchedRef.current = true
                    refreshTitleHint(next)
                    markDirty()
                  }}
                  onBlur={() => {
                    commitIdentityTitle(titleRef.current, { touched: true, syncPaper: true })
                    scheduleTitleCatalogRefresh()
                  }}
                />
              </label>
              <label className={`${styles.identityField} ${styles.identityVersion}`}>
                <span className={styles.identityLabel}>Version</span>
                <input
                  className={styles.identityInput}
                  type="text"
                  value={policyVersion}
                  disabled={streaming}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Policy version"
                  onChange={(e) => {
                    const next = e.target.value
                    setPolicyVersion(next)
                    policyVersionRef.current = next
                    setVersionTouched(true)
                    versionTouchedRef.current = true
                    markDirty()
                  }}
                  onBlur={() => {
                    commitIdentityVersion(policyVersionRef.current, { touched: true })
                  }}
                />
              </label>
            </div>
            {titleHint ? (
              <div className={styles.identityHint} role="note">
                Similar to "{titleHint}".{' '}
                <button
                  type="button"
                  className={styles.identityHintAction}
                  disabled={streaming}
                  onClick={() => {
                    commitIdentityTitle(titleHint, { touched: true, syncPaper: true })
                    setTitleHint(null)
                    scheduleTitleCatalogRefresh()
                  }}
                >
                  Use that title
                </button>
              </div>
            ) : null}
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
                    <span className={styles.thinkingCopy}>MLA is drafting…</span>
                  ) : (
                    m.content
                  )}
                </div>
              )
            })}
            {streaming &&
            messages.length > 0 &&
            messages[messages.length - 1]?.role === 'assistant' &&
            messages[messages.length - 1]?.content ? (
              <div className={styles.thinkingInline} aria-live="polite">
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
              {showPaperLoader && docEmpty ? (
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
              {showPaperLoader && !docEmpty ? (
                <div className={styles.paperWaitingBadge}>
                  <BrandLoader size="sm" label="Waiting for draft" />
                </div>
              ) : null}
              <div className={streaming && docEmpty && showPaperLoader ? styles.editorHidden : undefined}>
                <EditorContent editor={editor} />
              </div>
              <div ref={paperEndRef} className={styles.paperEnd} aria-hidden />
            </div>

            {!streaming && !docEmpty && reviewTokens.length > 0 ? (
              <div className={styles.reviewFields} aria-label="Review fields">
                <div className={styles.reviewFieldsTitle}>Review fields</div>
                <div className={styles.reviewFieldsHint}>
                  Remaining gaps in the document. Apply replaces every instance.
                </div>
                <ul className={styles.reviewFieldsList}>
                  {reviewTokens.map((token, index) => {
                    const draft = reviewDrafts[token] || ''
                    const canApply = Boolean(draft.trim())
                    const fieldId = `review-field-${index}`
                    return (
                      <li key={token} className={styles.reviewFieldRow}>
                        <label className={styles.reviewFieldLabel} htmlFor={fieldId}>
                          {placeholderLabel(token)}
                        </label>
                        <input
                          id={fieldId}
                          className={styles.reviewFieldInput}
                          type="text"
                          value={draft}
                          disabled={streaming}
                          placeholder={token}
                          autoComplete="off"
                          onChange={(e) =>
                            setReviewDrafts((prev) => ({ ...prev, [token]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              applyReviewField(token)
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!canApply || streaming}
                          onClick={() => applyReviewField(token)}
                        >
                          Apply
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </div>

          <form ref={composerFormRef} className={styles.composer} onSubmit={onComposerSubmit}>
            <textarea
              id="mla-composer"
              ref={composerRef}
              className={[
                styles.composerInput,
                composerInvite ? styles.composerInputInvite : '',
                composerPulse ? styles.composerInputPulse : '',
              ]
                .filter(Boolean)
                .join(' ')}
              value={prompt}
              disabled={streaming || noBalance}
              placeholder="Tell MLA what you want to draft, revise or review…"
              aria-label="Ask MLA"
              rows={3}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setComposerInvite(true)}
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
                <Button type="submit" size="sm" pending={streaming} disabled={!prompt.trim() || noBalance}>
                  Ask MLA
                </Button>
              </div>
            </div>
          </form>
        </div>

        <Drawer
          open={conflictOpen}
          placement="center"
          onClose={() => closeConflictModal()}
          title="Title and version already in use"
          description={
            conflictDraft
              ? `Another active ${conflictDraft.conflict.published ? 'published' : 'draft'} policy already uses "${conflictDraft.conflict.title}" v${conflictDraft.conflict.version}. Choose a new title, or keep the title and set a new version.`
              : 'Choose a new title, or keep the title and set a new version.'
          }
          footer={
            <div className={styles.drawerActions}>
              <Button variant="ghost" size="sm" disabled={conflictBusy} onClick={() => closeConflictModal()}>
                Cancel
              </Button>
              <Button size="sm" pending={conflictBusy} onClick={() => void resolveConflictContinue()}>
                Continue
              </Button>
            </div>
          }
        >
          <label className={styles.conflictField}>
            <span>Title</span>
            <input
              className={styles.conflictInput}
              value={conflictTitle}
              onChange={(e) => setConflictTitle(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className={styles.conflictField}>
            <span>Version</span>
            <input
              className={styles.conflictInput}
              value={conflictVersion}
              onChange={(e) => setConflictVersion(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {conflictDraft?.suggestedVersion ? (
              <span className={styles.conflictHint}>
                Suggested next revision: {conflictDraft.suggestedVersion}
              </span>
            ) : null}
          </label>
          {conflictError ? <div className={styles.conflictError}>{conflictError}</div> : null}
        </Drawer>

        <ToastStack items={toasts} onDismiss={dismissToast} />
      </div>
    </PageFrame>
  )
}
