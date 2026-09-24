import { useEffect, useId, useRef, useState } from 'react'
import { Button, Drawer, Notice, Timeline } from '../ui'
import type { TimelineItem } from '../ui'
import { useOverlayScrollLock } from '../ui/useOverlayScrollLock'
import { SignaturePad } from './SignaturePad'
import styles from './DossierReview.module.css'

export type DossierSnapshot = Record<string, unknown>

type PreviewProps = {
  open: boolean
  dossierId: string
  snapshotHash: string
  iframeUrl: string | null
  busy: boolean
  onClose: () => void
  onSign: () => void
}

export function DossierPreviewOverlay({
  open,
  dossierId,
  snapshotHash,
  iframeUrl,
  busy,
  onClose,
  onSign,
}: PreviewProps) {
  useOverlayScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    /* Capture so Escape closes the sign drawer (higher z-index) before this preview. */
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={`${styles.overlay} ra-light`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dossier-preview-title"
    >
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.topbarCopy}>
            <h2 id="dossier-preview-title" className={styles.title}>
              Review dossier
            </h2>
            <p className={styles.meta}>
              {dossierId}
              {snapshotHash ? ` · Version ${snapshotHash}` : ''}
            </p>
          </div>
          <div className={styles.topbarActions}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" pending={busy} onClick={onSign}>
              Sign &amp; Finalise Dossier
            </Button>
          </div>
        </header>
        <div className={styles.stage}>
          {iframeUrl ? (
            <iframe title="AI Governance Dossier preview" className={styles.frame} src={iframeUrl} />
          ) : (
            <div className={styles.loading}>Preparing dossier preview…</div>
          )}
        </div>
      </div>
    </div>
  )
}

type SignProps = {
  open: boolean
  defaultName: string
  defaultRole: string
  pending: boolean
  error: string
  onClose: () => void
  onSubmit: (input: {
    signatory_name: string
    signatory_role: string
    signature_svg: string
    confirmed: boolean
  }) => void
}

export function DossierSignDrawer({
  open,
  defaultName,
  defaultRole,
  pending,
  error,
  onClose,
  onSubmit,
}: SignProps) {
  const confirmId = useId()
  const [name, setName] = useState(defaultName)
  const [role, setRole] = useState(defaultRole)
  const [svg, setSvg] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [localHint, setLocalHint] = useState('')
  const openedRef = useRef(false)

  useEffect(() => {
    if (open && !openedRef.current) {
      setName(defaultName)
      setRole(defaultRole)
      setSvg(null)
      setConfirmed(false)
      setLocalHint('')
      openedRef.current = true
    }
    if (!open) openedRef.current = false
  }, [open, defaultName, defaultRole])

  return (
    <Drawer
      open={open}
      elevated
      className="ra-light"
      title="Sign dossier"
      description="Confirm you have reviewed this version, then finalise with your signature."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            pending={pending}
            onClick={() => {
              if (!name.trim()) {
                setLocalHint('Enter your name to continue.')
                return
              }
              if (!role.trim()) {
                setLocalHint('Enter your role to continue.')
                return
              }
              if (!svg) {
                setLocalHint('Add your signature in the pad above.')
                return
              }
              if (!confirmed) {
                setLocalHint('Confirm you have reviewed this dossier before signing.')
                return
              }
              setLocalHint('')
              onSubmit({
                signatory_name: name.trim(),
                signatory_role: role.trim(),
                signature_svg: svg,
                confirmed: true,
              })
            }}
          >
            Sign &amp; Finalise Dossier
          </Button>
        </>
      }
    >
      <div className={styles.signForm}>
        {error ? <Notice tone="risk">{error}</Notice> : null}
        {localHint && !error ? <Notice tone="quiet">{localHint}</Notice> : null}
        <label className={styles.field}>
          Signer name
          <input
            className={styles.input}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setLocalHint('')
            }}
            autoComplete="name"
            disabled={pending}
          />
        </label>
        <label className={styles.field}>
          Signer role
          <input
            className={styles.input}
            value={role}
            onChange={(e) => {
              setRole(e.target.value)
              setLocalHint('')
            }}
            placeholder="e.g. Chief Risk Officer"
            autoComplete="organization-title"
            disabled={pending}
          />
        </label>
        <SignaturePad
          onChange={(next) => {
            setSvg(next)
            setLocalHint('')
          }}
          disabled={pending}
        />
        <label className={styles.check} htmlFor={confirmId}>
          <input
            id={confirmId}
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked)
              setLocalHint('')
            }}
            disabled={pending}
          />
          <span>I confirm that I have reviewed this dossier and approve it as presented.</span>
        </label>
      </div>
    </Drawer>
  )
}

export type DossierAuditEvent = {
  id: string
  event_type: string
  actor_name?: string | null
  actor_email?: string | null
  ip_address?: string | null
  user_agent?: string | null
  metadata?: Record<string, unknown> | null
  occurred_at: string
}

export type DossierAudit = {
  version: {
    version_id: string
    dossier_id: string
    snapshot_hash: string
    content_hash: string
    status: string
    created_at?: string | null
    signed_at?: string | null
  }
  signature: {
    id: string
    signatory_name?: string | null
    signatory_email?: string | null
    signatory_role?: string | null
    declaration_text?: string | null
    content_hash?: string | null
    ip_address?: string | null
    user_agent?: string | null
    signed_at?: string | null
  } | null
  events: DossierAuditEvent[]
}

const AUDIT_EVENT_LABELS: Record<string, string> = {
  generated: 'Version generated',
  viewed: 'Dossier viewed',
  signed: 'Signed',
  finalised: 'Signed dossier sealed',
  downloaded: 'Downloaded',
}

const AUDIT_EVENT_TONES: Record<string, TimelineItem['tone']> = {
  signed: 'ok',
  finalised: 'ok',
}

export function fmtDateTimeUtc(iso?: string | null) {
  if (!iso) return 'Not recorded'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Not recorded'
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
  return `${date}, ${time} UTC`
}

type AuditProps = {
  open: boolean
  loading: boolean
  error: string
  audit: DossierAudit | null
  onClose: () => void
}

export function DossierAuditDrawer({ open, loading, error, audit, onClose }: AuditProps) {
  const sig = audit?.signature
  const facts: Array<[string, string | null | undefined, boolean?]> = audit
    ? [
        ['Dossier reference', audit.version.dossier_id],
        ['Version', audit.version.snapshot_hash, true],
        ['Document hash (SHA-256)', audit.version.content_hash, true],
        ['Signature ID', sig?.id, true],
        ['Signer', sig?.signatory_name],
        ['Role', sig?.signatory_role],
        ['Account email', sig?.signatory_email],
        ['Signed', sig?.signed_at ? fmtDateTimeUtc(sig.signed_at) : null],
        ['IP address', sig?.ip_address],
        ['Device', sig?.user_agent],
        ['Declaration', sig?.declaration_text],
      ]
    : []

  const items: TimelineItem[] = (audit?.events || []).map((e) => {
    const who = e.actor_name || e.actor_email || 'Unknown user'
    const parts = [fmtDateTimeUtc(e.occurred_at), who]
    if (e.ip_address) parts.push(`IP ${e.ip_address}`)
    return {
      id: e.id,
      title: AUDIT_EVENT_LABELS[e.event_type] || e.event_type,
      meta: parts.join(' · '),
      tone: AUDIT_EVENT_TONES[e.event_type] || 'neutral',
    }
  })

  return (
    <Drawer
      open={open}
      title="Audit trail"
      description={
        audit
          ? `${audit.version.dossier_id} · Version ${audit.version.snapshot_hash}. All times in UTC.`
          : 'Signature and activity record for this dossier version.'
      }
      onClose={onClose}
    >
      {loading ? (
        <p className={styles.auditQuiet}>Loading audit trail…</p>
      ) : error ? (
        <Notice tone="risk">{error}</Notice>
      ) : audit ? (
        <div className={styles.audit}>
          <dl className={styles.auditFacts}>
            {facts.map(([k, v, mono]) => (
              <div key={k} className={styles.auditFact}>
                <dt>{k}</dt>
                <dd className={mono ? styles.auditMono : undefined}>{v || 'Not recorded'}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className={styles.auditHeading}>Events</h3>
            <Timeline
              items={items}
              empty={<p className={styles.auditQuiet}>No events recorded for this version.</p>}
            />
          </div>
        </div>
      ) : null}
    </Drawer>
  )
}
