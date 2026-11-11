import type { Permission, Role, User } from '../types/api'

const citizenPermissions: Permission[] = [
  'items:read_public',
  'items:create',
  'items:update_own',
  'claims:create',
  'chat:send',
]

// Espelho da política do servidor (campus único): papéis de escopo sem modelo de tenant têm só
// permissões de cidadão. O servidor sempre devolve `permissions`; isto é apenas o padrão de reserva.
const rolePermissions: Record<Role, Permission[]> = {
  user: citizenPermissions,
  citizen: citizenPermissions,
  space_manager: citizenPermissions,
  org_admin: citizenPermissions,
  support: citizenPermissions,
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
    'reports:read_org',
    'reports:export_org',
    'users:manage_org',
    'platform:admin',
  ],
}

export function hasPermission(user: User | null | undefined, permission: Permission) {
  if (!user) return false
  return user.permissions?.includes(permission) ?? rolePermissions[user.role].includes(permission)
}
