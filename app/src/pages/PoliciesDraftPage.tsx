import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import {
  BrandLoader,
  Button,
  EmptyState,
  Notice,
  PageFrame,
  PageHeader,
  RaNum,
  SelectMenu,
  StatusLabel,
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
import { canDraftPolicies, canUsePolicyDrafting } from '../lib/org'
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

const TIER_OPTIONS = [
  { value: 'eco', label: 'Regan Eco' },
  { value: 'standard', label: 'Regan Pro' },
  { value: 'premium', label: 'Regan Ultra' },
]

function uid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function PoliciesDraftPage() {
  const { session, org, role, profile, orgReady } = useAuth()
  const navigate = useNavigate()
  const orgId = org?.id || null
  const userId = session?.user?.id
  const entitled = canUsePolicyDrafting(org)
  const canDraft = canDraftPolicies(role)

  const [tier, setTier] = useState<DraftTier>('eco')
  const [title, setTitle] = useState('AI governance policy')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ThreadMsg[]>([])
  const [streaming, setStreaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  usePageChrome({
    title: 'Draft with AI',
    breadcrumbs: [
      { label: 'Policies', to: '/policies' },
      { label: 'Draft with AI' },
    ],
  })

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Ask Regan to draft or amend a policy. The document streams here.',
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
      },
    },
  })

  function pushToast(text: string) {
    if (!text.trim()) return
    setToasts((prev) => [...prev, { id: uid(), text }])
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  async function loadCredits() {
    if (!orgId) return
    const { data } = await sb
      .from('org_ai_credit_balances')
      .select('balance_cents,monthly_allowance_cents,low_balance_cents')
      .eq('org_id', orgId)
      .maybeSingle()
    if (data) {
      setCredits(data as CreditBalance)
    } else {
      setCredits({ balance_cents: 0, monthly_allowance_cents: 500, low_balance_cents: 50 })
    }
  }

  useEffect(() => {
    if (orgId && entitled) void loadCredits()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, entitled])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!streaming)
    const el = editor.view.dom
    el.classList.toggle('readonly', streaming)
  }, [editor, streaming])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

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
    const userMsg: ThreadMsg = { id: uid(), role: 'user', content: text }
    const assistantId = uid()
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }])
    setStreaming(true)
    editor.setEditable(false)

    const history: DraftChatMessage[] = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }))
    const currentDoc = tipTapJsonToMarkdown(editor.getJSON())

    const controller = new AbortController()
    abortRef.current = controller

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
                ? { ...prev, balance_cents: meta.balance_cents, low_balance_cents: meta.low_balance_cents ?? prev.low_balance_cents }
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
            const html = markdownToHtml(markdown)
            editor.commands.setContent(html || '')
            if (!title.trim() || title === 'AI governance policy') {
              setTitle(titleFromMarkdown(markdown, 'AI governance policy'))
            }
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
              editor.commands.setContent(markdownToHtml(done.doc_markdown))
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
    }
  }

  async function saveDraft() {
    if (!orgId || !userId || !editor || saving) return
    const markdown = tipTapJsonToMarkdown(editor.getJSON())
    if (!markdown.trim()) {
      setError('Add policy content before saving.')
      return
    }
    setSaving(true)
    setError('')
    const saveTitle = title.trim() || titleFromMarkdown(markdown)
    const { data, error: insertErr } = await sb
      .from('policy_documents')
      .insert({
        org_id: orgId,
        title: saveTitle,
        description: 'Drafted with Regan',
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
      setSaving(false)
      setError(insertErr?.message || 'Could not save draft.')
      return
    }

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
      },
    })

    setSaving(false)
    pushToast('Saved as unpublished draft.')
    navigate(`/policies/${data.id}`)
  }

  if (!orgReady) {
    return (
      <PageFrame>
        <PageHeader title="Draft with AI" description="Loading workspace" />
        <BrandLoader fill label="Loading" />
      </PageFrame>
    )
  }

  if (!orgId) {
    return (
      <PageFrame>
        <PageHeader title="Draft with AI" description="Organisation context required." />
        <EmptyState title="No organisation" body="Join or create an organisation to draft policies." />
      </PageFrame>
    )
  }

  if (!entitled) {
    return (
      <PageFrame>
        <PageHeader
          title="Draft with AI"
          description="AI policy drafting is included with Essentials, Professional, and Enterprise."
          actions={
            <Link to="/plans">
              <Button>View plans</Button>
            </Link>
          }
        />
        <div className={styles.gated}>
          <EmptyState
            title="Upgrade to draft with AI"
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
        <PageHeader title="Draft with AI" description="Editor access or higher is required." />
        <EmptyState
          title="View-only access"
          body="Ask an organisation owner or admin to grant editor access if you need to draft policies."
        />
      </PageFrame>
    )
  }

  const lowBalance =
    credits != null && credits.balance_cents > 0 && credits.balance_cents < credits.low_balance_cents
  const noBalance = credits != null && credits.balance_cents <= 0

  return (
    <PageFrame>
      <PageHeader
        title="Draft with AI"
        description="Chat with Regan on the left. The policy document streams on the right. Save as an unpublished draft for review."
        actions={
          <Link to="/policies">
            <Button variant="ghost">Back to policies</Button>
          </Link>
        }
      />

      {error ? <Notice tone="risk" title="Error">{error}</Notice> : null}
      {noBalance ? (
        <Notice tone="warn" title="No AI credits">
          Balance is empty. Credits refill to $5 USD on subscription renewal. Top-ups will be available later.
        </Notice>
      ) : null}
      {lowBalance && !noBalance ? (
        <Notice tone="warn" title="Low AI credits">
          Balance is below {formatUsdCents(credits!.low_balance_cents)}. Consider a shorter prompt or Regan Eco.
        </Notice>
      ) : null}

      <div className={styles.shell}>
        <aside className={styles.chatPane}>
          <div className={styles.chatHead}>
            <div className={styles.chatHeadTitle}>Regan</div>
            <div className={styles.tierWrap}>
              <SelectMenu
                aria-label="Regan model tier"
                value={tier}
                options={TIER_OPTIONS}
                disabled={streaming}
                onChange={(v) => setTier((v as DraftTier) || 'eco')}
              />
            </div>
          </div>
          <div className={styles.balanceRow}>
            <span className={styles.balanceLabel}>Credits</span>
            <span className={styles.balanceValue}>
              <RaNum>{formatUsdCents(credits?.balance_cents ?? 0)}</RaNum>
              <span style={{ color: 'var(--ra-text-3)' }}>
                {' '}
                / {formatUsdCents(credits?.monthly_allowance_cents ?? 500)} monthly
              </span>
            </span>
            {streaming ? (
              <StatusLabel tone="neutral">Regan is drafting…</StatusLabel>
            ) : null}
          </div>
          <div className={styles.messages}>
            {messages.length === 0 ? (
              <p className={styles.msgHint}>
                Ask Regan to draft a policy (for example: “Draft an acceptable use policy for generative AI in
                customer support”), or ask Regan to amend section 3 of the document. Regan replies briefly here;
                the full document appears on the right.
              </p>
            ) : null}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`${styles.msg} ${m.role === 'user' ? styles.msgUser : styles.msgAssistant}`}
              >
                {m.content || (streaming && m.role === 'assistant' ? 'Regan is drafting…' : '')}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className={styles.composer}>
            <textarea
              className={styles.composerInput}
              value={prompt}
              disabled={streaming || noBalance}
              placeholder="Ask Regan to draft or revise a policy…"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void sendPrompt()
                }
              }}
            />
            <div className={styles.composerActions}>
              <Button
                size="sm"
                variant="ghost"
                disabled={!streaming}
                onClick={() => abortRef.current?.abort()}
              >
                Stop
              </Button>
              <Button
                size="sm"
                pending={streaming}
                disabled={!prompt.trim() || noBalance}
                onClick={() => void sendPrompt()}
              >
                Ask Regan
              </Button>
            </div>
          </div>
        </aside>

        <section className={styles.docPane}>
          <div className={styles.docHead}>
            <div className={styles.docHeadLeft}>
              <input
                className={styles.docTitleInput}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={streaming}
                aria-label="Policy title"
              />
              <div className={styles.docMeta}>
                {streaming
                  ? 'Regan is drafting…'
                  : 'Editable after generation · saves as unpublished draft'}
              </div>
            </div>
            <div className={styles.docActions}>
              <Button
                pending={saving}
                disabled={streaming || saving}
                onClick={() => void saveDraft()}
              >
                Save draft
              </Button>
            </div>
          </div>
          <div className={styles.editorWrap}>
            <EditorContent editor={editor} />
          </div>
        </section>
      </div>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
