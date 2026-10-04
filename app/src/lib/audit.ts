import { personDisplayName, type PersonName } from './accountLabel'
import { sb } from './supabase'

export function actorName(
  profileOrName?: string | PersonName | null,
  email?: string | null,
) {
  if (profileOrName && typeof profileOrName === 'object') {
    return personDisplayName({ ...profileOrName, email: profileOrName.email ?? email })
  }
  return personDisplayName({ full_name: profileOrName, email })
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
