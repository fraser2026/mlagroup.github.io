import { sb } from './supabase'

export function actorName(profileName?: string | null, email?: string | null) {
  return profileName || email?.split('@')[0] || 'Unknown'
}

export async function writeAuditLog(input: {
  orgId: string
  userId: string
  action: string
  entityType: string
  entityId?: string | null
  changes?: Record<string, unknown>
}) {
  await sb.from('registry_audit_log').insert({
    org_id: input.orgId,
    user_id: input.userId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    changes: input.changes ?? {},
  })
}
