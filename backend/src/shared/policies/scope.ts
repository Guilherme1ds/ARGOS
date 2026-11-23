import { db } from '../../db/database.js'
import type { AuthUser } from '../../middleware/auth.js'
import { can, type Permission, type Scope } from './permissions.js'

/** Escopo (organização e espaço) de um espaço institucional; null quando o espaço não existe. */
export function spaceScope(spaceId: number | null | undefined): Scope | null {
  if (spaceId == null) return null
  const space = db.prepare('SELECT id, organization_id FROM spaces WHERE id = ?').get(spaceId) as
    | { id: number; organization_id: number }
    | undefined
  return space ? { organizationId: space.organization_id, spaceId: space.id } : null
}

/**
 * Permissão sobre um caso: papel global (moderador/admin) ou vínculo com o espaço institucional do caso.
 * Caso sem espaço só é alcançado por papel global.
 */
export function canOnItem(user: AuthUser | undefined, item: { space_id?: number | null }, permission: Permission) {
  if (!user) return false
  if (can(user, permission)) return true
  if (!user.memberships?.length || item.space_id == null) return false
  return can(user, permission, spaceScope(item.space_id))
}

/** Espaços em que a conta tem a permissão por vínculo (org_admin alcança todos os espaços da organização). */
export function scopedSpaceIds(user: AuthUser, permission: Permission): number[] {
  if (!user.memberships?.length) return []
  const organizationIds = [...new Set(user.memberships.map((membership) => membership.organizationId))]
  const rows = db
    .prepare(`SELECT id, organization_id FROM spaces WHERE organization_id IN (${organizationIds.map(() => '?').join(', ')})`)
    .all(...organizationIds) as Array<{ id: number; organization_id: number }>
  return rows.filter((space) => can(user, permission, { organizationId: space.organization_id, spaceId: space.id })).map((space) => space.id)
}
