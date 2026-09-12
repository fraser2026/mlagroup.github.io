import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { BrandLoader, Button, EmptyState, Notice, PageFrame, PageHeader, Section, ToastStack } from '../ui'
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
type Profile = { id: string; full_name?: string | null; email?: string | null }

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
      const { data: profs } = await sb.from('profiles').select('id,full_name,email').in('id', ids)
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
  const seatNote =
    `${seatsUsed} of ${limit} seats used` +
    ((org?.plan || 'free') !== 'professional' && (org?.plan || '') !== 'enterprise'
      ? '. Professional includes 5 seats'
      : '')

  async function onInvite(e: FormEvent) {
    e.preventDefault()
    if (!org?.id || !email.trim()) return
    setError('')
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
        { id: 'members', label: 'Members' },
        { id: 'roles', label: 'Roles' },
      ]}
    >
      <PageHeader title="Users" description="Invite colleagues and manage role-based access." />
      {error ? <Notice tone="risk">{error}</Notice> : null}
      {!org ? (
        <EmptyState title="No organisation" body="Organisation context is still loading." />
      ) : loading ? (
        <BrandLoader fill label="Loading users" />
      ) : (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Members</div>
              <div className={styles.statValue}>{members.length}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Pending</div>
              <div className={styles.statValue}>{invites.length}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Seats</div>
              <div className={styles.statValue}>
                {seatsUsed}/{limit}
              </div>
              <div className={styles.meta}>{PLAN_LABELS[org.plan || 'free'] || 'Free'}</div>
            </div>
          </div>

          <Section id="invite" title="Invite a colleague" description={seatNote}>
            {!canManageMembers ? (
              <p className={styles.copy}>Only owners and admins can invite people or change roles.</p>
            ) : atLimit ? (
              <p className={styles.copy}>
                Seat limit reached. Upgrade to Professional for 5 seats, or revoke a pending invite.{' '}
                {(org.plan || '') !== 'professional' ? <Link to="/plans">View plans</Link> : null}
              </p>
            ) : (
              <form className={styles.invite} onSubmit={onInvite}>
                <label className={styles.label}>
                  Work email
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
                <label className={styles.label}>
                  Role
                  <select className={styles.input} value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
                <Button type="submit">Send invite</Button>
              </form>
            )}
          </Section>

          <Section id="members" title="Members" description="Role-based access">
            <div className={styles.list}>
              {members.map((m) => {
                const p = profiles[m.user_id] || {}
                const name = p.full_name || 'Unknown'
                const isYou = m.user_id === user?.id
                return (
                  <div key={m.id} className={styles.row}>
                    <div>
                      <div className={styles.name}>
                        {name}
                        {isYou ? ' (you)' : ''}
                      </div>
                      <div className={styles.meta}>{p.email || 'Not set'}</div>
                    </div>
                    {canManageMembers && m.role !== 'owner' ? (
                      <select
                        className={styles.input}
                        value={m.role}
                        aria-label={`Role for ${name}`}
                        onChange={(e) => void changeRole(m.id, e.target.value)}
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span className={styles.chip}>{MEMBER_ROLE_LABELS[m.role] || m.role}</span>
                    )}
                    {canManageMembers && m.role !== 'owner' && !isYou ? (
                      <Button variant="ghost" type="button" onClick={() => void removeMember(m.id, name)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Section>

          {invites.length ? (
            <Section id="pending" title="Pending invitations">
              <div className={styles.list}>
                {invites.map((inv) => (
                  <div key={inv.id} className={styles.row}>
                    <div>
                      <div className={styles.name}>{inv.email}</div>
                      <div className={styles.meta}>
                        Expires {fmtDate(inv.expires_at)} Â· {MEMBER_ROLE_LABELS[inv.role] || inv.role}
                      </div>
                    </div>
                    {canManageMembers ? (
                      <Button variant="ghost" type="button" onClick={() => void revoke(inv.id)}>
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          <Section id="roles" title="Roles">
            <p className={styles.copy}>
              <strong>Owner:</strong> billing, members, and all registry actions. One per organisation.
            </p>
            <p className={styles.copy}>
              <strong>Admin:</strong> invite, change roles, and edit systems. Cannot remove the owner.
            </p>
            <p className={styles.copy}>
              <strong>Editor:</strong> register and update AI systems, controls, and assessments.
            </p>
            <p className={styles.copy}>
              <strong>Viewer:</strong> read the registry and reports. Cannot change records.
            </p>
          </Section>
        </>
      )}

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
