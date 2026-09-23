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
  StatusLabel,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { sb } from '../lib/supabase'
import { orgSeatLimit } from '../lib/org'
import { parseRpcPayload, fmtDate } from '../lib/rpc'
import { MEMBER_ROLE_LABELS, PLAN_LABELS } from '../lib/stripe'
import styles from './UsersPage.module.css'

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

  async function onInvite(e: FormEvent) {
    e.preventDefault()
    if (!org?.id || !email.trim()) return
    setError('')
    setInviteBusy(true)
    try {
      const { data, error: err } = await sb.rpc('invite_org_member', {
        p_org_id: org.id,
        p_email: email.trim(),
        p_role: role,
      })
      const payload = parseRpcPayload(data)
      if (err || !payload || payload.ok === false) {
        setError(payload?.error || err?.message || 'Invite failed')
        return
      }
      const token = (payload as { token?: string }).token
      const invitedEmail = (payload as { email?: string }).email
      if (token) {
        const url = `${window.location.origin}/login?invite=${encodeURIComponent(token)}`
        try {
          await navigator.clipboard.writeText(url)
        } catch {
          /* ignore */
        }
      }
      pushToast(
        `Invite created for ${invitedEmail || email}. Link copied. Send it to them. They must sign in with that email.`,
      )
      setEmail('')
      await load()
    } finally {
      setInviteBusy(false)
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
                <label className={`${styles.field} ${styles.fieldRole}`}>
                  <span className={styles.label}>Role</span>
                  <select
                    className={styles.select}
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
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
                            <select
                              className={`${styles.select} ${styles.roleSelect}`}
                              value={m.role}
                              aria-label={`Role for ${name}`}
                              onChange={(e) => void changeRole(m.id, e.target.value)}
                            >
                              <option value="admin">Admin</option>
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
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
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          onClick={() => void revoke(inv.id)}
                        >
                          Revoke
                        </Button>
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
