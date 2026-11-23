import type { Membership, Permission, Role, ScopedRole, User } from '../types/api'

const citizenPermissions: Permission[] = [
  'items:read_public',
  'items:create',
  'items:update_own',
  'claims:create',
  'chat:send',
]

// Espelho da política do servidor (backend/src/shared/policies/permissions.ts). O servidor sempre devolve
// `permissions` e `memberships`; isto é apenas o padrão de reserva. A autorização real é sempre do servidor.
const rolePermissions: Record<Role, Permission[]> = {
  user: citizenPermissions,
  citizen: citizenPermissions,
  space_manager: citizenPermissions,
  org_admin: citizenPermissions,
  moderator: [...citizenPermissions, 'items:moderate', 'chat:moderate', 'moderation:reports'],
  support: [...citizenPermissions, 'users:read', 'access_requests:review'],
  admin: [
    'items:read_public',
    'items:create',
    'items:update_own',
    'items:moderate',
    'items:return',
    'claims:create',
    'claims:review',
    'claims:read_private',
    'chat:send',
    'chat:moderate',
    'moderation:reports',
    'users:read',
    'access_requests:review',
    'custody:read',
    'custody:manage',
    'org:manage',
    'orgs:manage',
    'reports:read_org',
    'reports:export_org',
    'users:manage_org',
    'platform:admin',
  ],
}

const spaceManagerPermissions: Permission[] = ['items:moderate', 'items:return', 'claims:review', 'claims:read_private', 'custody:read', 'custody:manage']
const scopedRolePermissions: Record<ScopedRole, Permission[]> = {
  space_manager: spaceManagerPermissions,
  org_admin: [...spaceManagerPermissions, 'org:manage', 'reports:read_org'],
}

/** Permissão global do papel da conta. */
export function hasPermission(user: User | null | undefined, permission: Permission) {
  if (!user) return false
  return user.permissions?.includes(permission) ?? rolePermissions[user.role].includes(permission)
}

/** Permissão global OU concedida por algum vínculo de gestão (em qualquer organização). */
export function hasAnyPermission(user: User | null | undefined, permission: Permission) {
  if (!user) return false
  return hasPermission(user, permission) || (user.memberships ?? []).some((membership: Membership) => scopedRolePermissions[membership.role].includes(permission))
}

/** Telas do painel administrativo que a conta pode abrir (moderação, suporte ou administração). */
export function canOpenAdmin(user: User | null | undefined) {
  return (['platform:admin', 'items:moderate', 'moderation:reports', 'users:read', 'access_requests:review'] as Permission[]).some((permission) => hasPermission(user, permission))
}
