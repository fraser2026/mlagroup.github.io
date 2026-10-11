import { useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CircleHelp, Paperclip, X } from 'lucide-react'
import { Button, Drawer, Icon, Notice } from '../ui'
import { DelayTip } from '../ui/DelayTip'
import { useShellChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import { sb } from '../lib/supabase'
import styles from './HelpRequest.module.css'

const TOPICS = [
  'Using RegAnchor',
  'AI assets and registry',
  'Controls and evidence',
  'Assessments and reports',
  'Policies and frameworks',
  'Users and access',
  'Billing and plan',
  'Something else',
]

const MAX_BYTES = 10 * 1024 * 1024

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function HelpButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DelayTip text="Help and support" mode="always">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Help and support">
          <Icon icon={CircleHelp} size="sm" />
          <span className={styles.btnLabel}>Help</span>
        </Button>
      </DelayTip>
      <HelpRequestDrawer open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function HelpRequestDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { org, user, session, profile } = useAuth()
  const { breadcrumbs, pageTitle } = useShellChrome()
  const { pathname, search } = useLocation()
  const ids = { topic: useId(), subject: useId(), message: useId() }
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [topic, setTopic] = useState(TOPICS[0])
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const pageLabel =
    breadcrumbs.map((b) => b.label).filter(Boolean).join(' / ') || pageTitle || 'RegAnchor'
  const pagePath = pathname + search
  const replyEmail = profile?.email || user?.email || ''

  function reset() {
    setTopic(TOPICS[0])
    setSubject('')
    setMessage('')
    setFile(null)
    setError('')
    setSent(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function close() {
    if (busy) return
    onClose()
    if (sent) reset()
  }

  function pickFile(f: File | null) {
    setError('')
    if (f && f.size > MAX_BYTES) {
      setError('Attachments must be under 10 MB.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setFile(f)
  }

  async function submit() {
    if (!org?.id || !user?.id || !session?.access_token) {
      setError('Your session has expired. Sign in again to send a request.')
      return
    }
    if (!subject.trim()) {
      setError('Add a short subject.')
      return
    }
    if (message.trim().length < 5) {
      setError('Tell us a little more about what you need.')
      return
    }
    setBusy(true)
    setError('')
    try {
      let attachment: Record<string, unknown> = {}
      if (file) {
        const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-120)
        const path = `support/${org.id}/${crypto.randomUUID()}_${safe}`
        const { error: upErr } = await sb.storage
          .from('governance-reports')
          .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
        if (upErr) throw new Error(`Attachment upload failed: ${upErr.message}`)
        attachment = {
          attachment_path: path,
          attachment_name: file.name,
          attachment_size: file.size,
          attachment_type: file.type || null,
        }
      }

      const { data: row, error: insErr } = await sb
        .from('support_requests')
        .insert({
          org_id: org.id,
          requested_by: user.id,
          category: topic,
          subject: subject.trim(),
          client_message: message.trim(),
          page_path: pagePath,
          page_title: pageLabel,
          ...attachment,
        })
        .select('id')
        .single()
      if (insErr || !row) throw new Error(insErr?.message || 'Could not send your request.')

      try {
        await invokeEdge('send-mail', { kind: 'help-request', request_id: row.id }, session.access_token)
      } catch {
        /* request is saved and visible in the Control Centre even if the email fails */
      }
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your request.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      title="Help and support"
      description={
        sent
          ? undefined
          : 'Ask the RegAnchor team anything. We will reply by email, usually within one working day.'
      }
      onClose={close}
      footer={
        sent ? (
          <>
            <Button variant="ghost" size="sm" onClick={reset}>
              New request
            </Button>
            <Button size="sm" onClick={close}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" pending={busy} onClick={() => void submit()}>
              Send request
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <div className={styles.sent}>
          <p className={styles.sentTitle}>Request sent</p>
          <p className={styles.sentBody}>
            Thanks. The RegAnchor team has your request and will reply to{' '}
            <span className={styles.ink}>{replyEmail || 'your account email'}</span>.
          </p>
        </div>
      ) : (
        <div className={styles.form}>
          {error ? <Notice tone="risk">{error}</Notice> : null}

          <div className={styles.context}>
            <span className={styles.contextLabel}>Sent from</span>
            <span className={styles.contextValue}>{pageLabel}</span>
          </div>

          <label className={styles.field} htmlFor={ids.topic}>
            Topic
            <select
              id={ids.topic}
              className={styles.input}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={busy}
            >
              {TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field} htmlFor={ids.subject}>
            Subject
            <input
              id={ids.subject}
              className={styles.input}
              value={subject}
              maxLength={160}
              placeholder="A short summary"
              onChange={(e) => setSubject(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className={styles.field} htmlFor={ids.message}>
            Message
            <textarea
              id={ids.message}
              className={`${styles.input} ${styles.textarea}`}
              value={message}
              maxLength={4000}
              placeholder="What are you trying to do, and what happened?"
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
            />
          </label>

          <div className={styles.field}>
            Attachment
            {file ? (
              <div className={styles.fileRow}>
                <Icon icon={Paperclip} size="sm" />
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>{fmtSize(file.size)}</span>
                <button
                  type="button"
                  className={styles.fileRemove}
                  aria-label="Remove attachment"
                  onClick={() => pickFile(null)}
                  disabled={busy}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.dropzone}
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <Icon icon={Paperclip} size="sm" />
                <span>Attach a screenshot or file</span>
                <span className={styles.dropHint}>Up to 10 MB</span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              className={styles.hiddenFile}
              onChange={(e) => pickFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>
      )}
    </Drawer>
  )
}
