import { ensureOrg, ensureProfile } from './org'

export type Workspace = {
  userId: string
  orgId: string | null
  orgName: string
  email: string | null
  role: string | null
}

/** Portal-parity workspace load (ensureOrg + profile). */
export async function loadWorkspace(userId: string, email?: string | null): Promise<Workspace> {
  const profile = await ensureProfile(userId, email)
  const ctx = await ensureOrg(userId, profile)
  return {
    userId,
    orgId: ctx.org?.id || null,
    orgName: ctx.org?.name || ctx.profile?.organisation || 'Your organisation',
    email: ctx.profile?.email || email || null,
    role: ctx.role,
  }
}

export function pct(done: number, total: number) {
  if (total <= 0) return 0
  return Math.round((done / total) * 100)
}

export async function getOrgIdOrThrow(userId: string) {
  const ws = await loadWorkspace(userId)
  if (!ws.orgId) throw new Error('Organisation not ready.')
  return ws.orgId
}
