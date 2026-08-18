import type { Permission, Role, User } from '../types/api'

const citizenPermissions: Permission[] = [
  'items:read_public',
  'items:create',
  'items:update_own',
  'items:return',
  'claims:create',
  'chat:send',
]

const rolePermissions: Record<Role, Permission[]> = {
  user: citizenPermissions,
  citizen: citizenPermissions,
  space_manager: [
    ...citizenPermissions,
    'items:moderate',
    'items:return',
    'claims:review',
    'claims:read_private',
    'reports:read_org',
  ],
  org_admin: [
    ...citizenPermissions,
    'items:moderate',
    'items:return',
    'claims:review',
    'claims:read_private',
    'reports:read_org',
    'reports:export_org',
    'users:manage_org',
  ],
  support: ['items:read_public', 'items:moderate', 'claims:review', 'claims:read_private', 'chat:moderate'],
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
