import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  EmptyState,
  Ledger,
  LedgerRow,
  MetricStrip,
  Notice,
  PageFrame,
  PageHeader,
  Section,
  SelectMenu,
  StatusLabel,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { APP_ORIGIN } from '../lib/config'
import { sb } from '../lib/supabase'
import { EdgeError, invokeEdge } from '../lib/edge'
import { orgSeatLimit } from '../lib/org'
import { parseRpcPayload, fmtDate } from '../lib/rpc'
import { MEMBER_ROLE_LABELS, PLAN_LABELS } from '../lib/stripe'
import styles from './UsersPage.module.css'

type InviteRpc = {
  ok?: boolean
  error?: string
  token?: string
  email?: string
  role?: string
  invite_id?: string
}

/** Always refresh — getSession alone can return an expired JWT after a long tab. */
async function freshAccessToken(): Promise<string | null> {
  const { data: refreshed, error } = await sb.auth.refreshSession()
  if (!error && refreshed.session?.access_token) {
    return refreshed.session.access_token
  }
  const { data: first } = await sb.auth.getSession()
  return first.session?.access_token || null
}

/** Never block invite email on clipboard permission / hang after async RPC. */
async function copyInviteLink(url: string): Promise<boolean> {
  try {
    const write = navigator.clipboard?.writeText?.(url)
    if (!write) return false
    await Promise.race([
      write,
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('clipboard timeout')), 800)
      }),
    ])
    return true
  } catch {
    return false
  }
}

function mailErrorMessage(err: unknown): string {
  if (err instanceof EdgeError) return err.message || 'Email could not be sent'
  if (err instanceof Error && err.message) return err.message
  return 'Email could not be sent'
}

type Member = { id: string; user_id: string; role: string }
type Invite = { id: string; email: string; role: string; expires_at: string; invited_by?: string }
type Profile = {
  id: string
  full_name?: string | null
  email?: string | null
  job_title?: string | null
  department?: string | null
  work_phone?: string | null
}

function roleTone(role: string): 'ok' | 'info' | 'neutral' {
  if (role === 'owner' || role === 'admin') return 'ok'
  if (role === 'editor') return 'info'
  return 'neutral'
}

const ACCESS_ROLES: { id: string; name: string; description: string }[] = [
  {
    id: 'owner',
    name: 'Workspace admin',
    description: 'Billing, members, and all registry actions. One per organisation.',
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Invite people, change roles, and edit systems. Cannot remove the workspace admin.',
  },
  {
    id: 'editor',
    name: 'Editor',
    description: 'Register and update AI systems, controls, and assessments.',
  },
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read the registry and reports. Cannot change records.',
  },
]

const INVITE_ROLE_OPTIONS = [
  { value: 'editor', label: 'Editor' },
  { value: 'admin', label: 'Admin' },
  { value: 'viewer', label: 'Viewer' },
]

const MEMBER_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
]

export function UsersPage() {
  const { org, canManageMembers, user, refreshOrg } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [seatsUsed, setSeatsUsed] = useState(0)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [resendBusyId, setResendBusyId] = useState<string | null>(null)

  usePageChrome({ title: 'Users', breadcrumbs: [{ label: 'Users' }] })

  function pushToast(text: string) {
    if (!text.trim()) return
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, text }])
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  async function load() {
    if (!org?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const [{ data: used }, { data: mems }, invRes] = await Promise.all([
      sb.rpc('org_seats_used', { p_org_id: org.id }),
      sb.from('org_members').select('id,user_id,role').eq('org_id', org.id).order('created_at', { ascending: true }),
      canManageMembers
        ? sb
            .from('org_invites')
            .select('id,email,role,expires_at,invited_by')
            .eq('org_id', org.id)
            .is('accepted_at', null)
            .is('revoked_at', null)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as Invite[] }),
    ])
    const memberRows = (mems as Member[]) || []
    const inviteRows = (invRes.data as Invite[]) || []
    setMembers(memberRows)
    setInvites(inviteRows)
    setSeatsUsed(used != null ? Number(used) : memberRows.length)
    const ids = [
      ...memberRows.map((m) => m.user_id),
      ...inviteRows.map((i) => i.invited_by).filter(Boolean),
    ] as string[]
    if (ids.length) {
      const { data: profs } = await sb
        .from('profiles')
        .select('id,full_name,email,job_title,department,work_phone')
        .in('id', ids)
      const map: Record<string, Profile> = {}
      for (const p of profs || []) map[p.id] = p as Profile
      setProfiles(map)
    } else setProfiles({})
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [org?.id, canManageMembers])

  const limit = orgSeatLimit(org?.plan)
  const atLimit = seatsUsed >= limit
  const planLabel = PLAN_LABELS[org?.plan || 'free'] || 'Free'
  const seatHint =
    (org?.plan || 'free') !== 'professional' && (org?.plan || '') !== 'enterprise'
      ? 'Professional includes 15 seats'
      : undefined

  async function sendOrgInviteMail(inviteId: string, inviteUrl: string): Promise<{
    emailed: boolean
    detail?: string
  }> {
    const attempt = async (accessToken: string) =>
      invokeEdge(
        'send-mail',
        {
          kind: 'org-invite',
          invite_id: inviteId,
          invite_url: inviteUrl,
        },
        accessToken,
      )

    const accessToken = await freshAccessToken()
    if (!accessToken) {
      return { emailed: false, detail: 'Sign in expired. Refresh the page and try again.' }
    }
    try {
      await attempt(accessToken)
      return { emailed: true }
    } catch (mailErr) {
      // One retry with a forced refresh when Edge rejects the JWT.
      if (mailErr instanceof EdgeError && mailErr.status === 401) {
        const retryToken = await freshAccessToken()
        if (retryToken) {
          try {
            await attempt(retryToken)
            return { emailed: true }
          } catch (retryErr) {
            console.warn('Invite email failed after refresh', retryErr)
            return { emailed: false, detail: mailErrorMessage(retryErr) }
          }
        }
      }
      console.warn('Invite email failed', mailErr)
      return { emailed: false, detail: mailErrorMessage(mailErr) }
    }
  }

  async function createAndDeliverInvite(input: {
    email: string
    role: string
  }): Promise<{ ok: boolean }> {
    if (!org?.id) return { ok: false }
    const { data, error: err } = await sb.rpc('invite_org_member', {
      p_org_id: org.id,
      p_email: input.email,
      p_role: input.role,
    })
    const payload = parseRpcPayload<InviteRpc>(data)
    if (err || !payload || payload.ok === false) {
      setError(payload?.error || err?.message || 'Invite failed')
      return { ok: false }
    }
    const token = payload.token
    const invitedEmail = payload.email || input.email
    const inviteId = payload.invite_id
    // Prefer APP_ORIGIN so Edge inviteUrlOk always sees app.reganchor.com
    // (preview / alternate hosts can reject the link and block Resend).
    const url = token
      ? `${APP_ORIGIN}/invite?token=${encodeURIComponent(token)}`
      : ''

    // Email first. Clipboard after async RPC can hang on permission prompts and
    // previously blocked the Resend call entirely (revoke → invite-again looked
    // successful in the table, with zero POST /emails).
    let emailed = false
    let mailDetail = ''
    if (!url || !inviteId) {
      mailDetail = 'Invite row was created without a deliverable link.'
    } else {
      const mail = await sendOrgInviteMail(inviteId, url)
      emailed = mail.emailed
      mailDetail = mail.detail || ''
    }

    const copied = url ? await copyInviteLink(url) : false

    if (emailed && copied) {
      pushToast(
        `Invite emailed to ${invitedEmail}. Link also copied. They open it to create a password or sign in.`,
      )
    } else if (emailed) {
      pushToast(
        `Invite emailed to ${invitedEmail}. They open it to create a password or sign in.`,
      )
    } else if (copied) {
      const why = mailDetail ? ` ${mailDetail}` : ''
      pushToast(
        `Invite created for ${invitedEmail}. Email was not sent.${why} Link copied. They open it to create a password or sign in.`,
      )
      setError(`Invite saved for ${invitedEmail}, but email was not sent.${why}`)
    } else if (url) {
      setError(
        `Invite created for ${invitedEmail}, but email and clipboard both failed.${
          mailDetail ? ` ${mailDetail}` : ''
        } Copy this link: ${url}`,
      )
    } else {
      setError(`Invite created for ${invitedEmail}, but email was not sent.${mailDetail ? ` ${mailDetail}` : ''}`)
    }
    await load()
    return { ok: true }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault()
    if (!org?.id || !email.trim()) return
    setError('')
    setInviteBusy(true)
    try {
      const result = await createAndDeliverInvite({ email: email.trim(), role })
      if (result.ok) setEmail('')
    } finally {
      setInviteBusy(false)
    }
  }

  async function emailAgain(inv: Invite) {
    if (!org?.id) return
    setError('')
    setResendBusyId(inv.id)
    try {
      // invite_org_member revokes any active invite for this email and mints a new token.
      await createAndDeliverInvite({ email: inv.email, role: inv.role })
    } finally {
      setResendBusyId(null)
    }
  }

  async function revoke(id: string) {
    await sb.rpc('revoke_org_invite', { p_invite_id: id })
    await load()
  }

  async function changeRole(memberId: string, next: string) {
    const { data, error: err } = await sb.rpc('set_org_member_role', {
      p_member_id: memberId,
      p_role: next,
    })
    const payload = parseRpcPayload(data)
    if (err || !payload || payload.ok === false) {
      setError(payload?.error || err?.message || 'Could not change role')
    }
    await refreshOrg()
    await load()
  }

  async function removeMember(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from this organisation?`)) return
    const { data, error: err } = await sb.rpc('remove_org_member', { p_member_id: memberId })
    const payload = parseRpcPayload(data)
    if (err || !payload || payload.ok === false) {
      setError(payload?.error || err?.message || 'Could not remove member')
      return
    }
    await load()
  }

  return (
    <PageFrame
      railItems={[
        { id: 'invite', label: 'Invite' },
        { id: 'members', label: 'People' },
        { id: 'roles', label: 'Access' },
      ]}
    >
      <PageHeader
        title="Users"
        description="People in this organisation: contact details for governance ownership, and workspace roles for who can sign in and change records."
      />

      {error ? (
        <Notice tone="risk" title="Users">
          {error}
        </Notice>
      ) : null}

      {!org ? (
        <EmptyState title="No organisation" body="Organisation context is still loading." />
      ) : loading ? (
        <BrandLoader fill label="Loading users" />
      ) : (
        <>
          <MetricStrip
            className={styles.metrics}
            items={[
              { id: 'members', label: 'Members', value: members.length },
              { id: 'pending', label: 'Pending', value: invites.length },
              {
                id: 'seats',
                label: 'Seats',
                value: `${seatsUsed}/${limit}`,
                hint: seatHint || planLabel,
                tone: atLimit ? 'warn' : 'default',
              },
            ]}
          />

          <Section
            id="invite"
            title="Invite"
            description={`${seatsUsed} of ${limit} seats used on ${planLabel}.`}
          >
            {!canManageMembers ? (
              <p className={styles.copy}>
                Only workspace admins and admins can invite people or change roles.
              </p>
            ) : atLimit ? (
              <p className={styles.copy}>
                Seat limit reached. Upgrade to Professional for 15 seats, or revoke a pending invite.
                {(org.plan || '') !== 'professional' && (org.plan || '') !== 'enterprise' ? (
                  <>
                    {' '}
                    <Link to="/plans">View plans</Link>
                  </>
                ) : null}
              </p>
            ) : (
              <form className={styles.invite} onSubmit={onInvite}>
                <label className={`${styles.field} ${styles.fieldEmail}`}>
                  <span className={styles.label}>Work email</span>
                  <input
                    className={styles.input}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="colleague@organisation.com"
                    autoComplete="off"
                    required
                  />
                </label>
                <div className={`${styles.field} ${styles.fieldRole}`}>
                  <span className={styles.label}>Role</span>
                  <SelectMenu
                    aria-label="Role"
                    value={role}
                    onChange={setRole}
                    options={INVITE_ROLE_OPTIONS}
                  />
                </div>
                <div className={styles.inviteAction}>
                  <Button type="submit" size="sm" pending={inviteBusy}>
                    Send invite
                  </Button>
                </div>
              </form>
            )}
          </Section>

          <Section
            id="members"
            title="People"
            description="Directory for AI asset ownership. Each person updates their own job title and contact details in Settings."
          >
            {members.length === 0 ? (
              <EmptyState title="No members yet" body="Invite a colleague to get started." />
            ) : (
              <Ledger>
                {members.map((m) => {
                  const p = profiles[m.user_id] || {}
                  const name = p.full_name || 'Unknown'
                  const isYou = m.user_id === user?.id
                  const detailParts = [
                    p.job_title || null,
                    p.department || null,
                    p.email || null,
                    p.work_phone || null,
                  ].filter(Boolean)
                  const description = detailParts.length
                    ? detailParts.join(' · ')
                    : 'Add job title and contact in Settings'
                  return (
                    <LedgerRow
                      key={m.id}
                      title={
                        <>
                          {name}
                          {isYou ? <span className={styles.youMark}> (you)</span> : null}
                        </>
                      }
                      description={description}
                      meta={
                        <div className={styles.rowMeta}>
                          {canManageMembers && m.role !== 'owner' ? (
                            <SelectMenu
                              className={styles.roleSelect}
                              value={m.role}
                              aria-label={`Role for ${name}`}
                              onChange={(v) => void changeRole(m.id, v)}
                              options={MEMBER_ROLE_OPTIONS}
                            />
                          ) : (
                            <StatusLabel tone={roleTone(m.role)}>
                              {MEMBER_ROLE_LABELS[m.role] || m.role}
                            </StatusLabel>
                          )}
                        </div>
                      }
                      trailing={
                        isYou ? (
                          <Link className={styles.profileLink} to="/settings">
                            Edit profile
                          </Link>
                        ) : canManageMembers && m.role !== 'owner' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => void removeMember(m.id, name)}
                          >
                            Remove
                          </Button>
                        ) : null
                      }
                    />
                  )
                })}
              </Ledger>
            )}
          </Section>

          {invites.length ? (
            <Section id="pending" title="Pending invitations">
              <Ledger>
                {invites.map((inv) => (
                  <LedgerRow
                    key={inv.id}
                    title={inv.email}
                    description={`Expires ${fmtDate(inv.expires_at)}`}
                    meta={
                      <StatusLabel tone={roleTone(inv.role)}>
                        {MEMBER_ROLE_LABELS[inv.role] || inv.role}
                      </StatusLabel>
                    }
                    trailing={
                      canManageMembers ? (
                        <div className={styles.pendingActions}>
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            pending={resendBusyId === inv.id}
                            disabled={inviteBusy || resendBusyId != null}
                            onClick={() => void emailAgain(inv)}
                          >
                            Email again
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            disabled={inviteBusy || resendBusyId != null}
                            onClick={() => void revoke(inv.id)}
                          >
                            Revoke
                          </Button>
                        </div>
                      ) : null
                    }
                  />
                ))}
              </Ledger>
            </Section>
          ) : null}

          <Section
            id="roles"
            title="Workspace access"
            description="These roles control who can sign in and change records. They are not AI asset governance owners. Business, Compliance, and Technical owners are assigned on each asset."
          >
            <div className={styles.roleList}>
              {ACCESS_ROLES.map((r) => (
                <div key={r.id} className={styles.roleItem}>
                  <div className={styles.roleName}>{r.name}</div>
                  <p className={styles.roleDesc}>{r.description}</p>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
