import type { NextFunction, Request, Response } from 'express'
import type { Role } from '../../db/database.js'
import { HttpError } from '../../utils/http.js'

export type Permission =
  | 'items:read_public'
  | 'items:create'
  | 'items:update_own'
  | 'items:moderate'
  | 'items:return'
  | 'claims:create'
  | 'claims:review'
  | 'claims:read_private'
  | 'chat:send'
  | 'chat:moderate'
  | 'reports:read_org'
  | 'reports:export_org'
  | 'users:manage_org'
  | 'platform:admin'

const citizenPermissions: Permission[] = [
  'items:read_public',
  'items:create',
  'items:update_own',
  'claims:create',
  'chat:send',
]

export const rolePermissions: Record<Role, Permission[]> = {
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

export function getPermissions(role: Role) {
  return rolePermissions[role] ?? rolePermissions.citizen
}

export function hasPermission(role: Role | undefined, permission: Permission) {
  return Boolean(role && getPermissions(role).includes(permission))
}

export function authorize(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!hasPermission(req.user?.role, permission)) {
      throw new HttpError(403, 'Acesso negado para esta acao.')
    }
    next()
  }
}
