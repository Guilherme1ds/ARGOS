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

/**
 * ARGOS é uma instalação de campus único: não existe organização/espaço no banco para limitar o alcance.
 * Por isso só `admin` (plataforma) recebe moderação, leitura de provas, relatórios e exportação.
 * Os papéis com nome de escopo (space_manager, org_admin, support) falham fechados: até existir um
 * modelo de tenant com filtro em cada consulta, eles têm apenas as permissões pessoais de cidadão.
 */
export const scopedRolesWithoutTenantModel: Role[] = ['space_manager', 'org_admin', 'support']

/** Papéis que a administração pode atribuir hoje. */
export const assignableRoles = ['citizen', 'admin'] as const

export const rolePermissions: Record<Role, Permission[]> = {
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

export function getPermissions(role: Role) {
  return rolePermissions[role] ?? rolePermissions.citizen
}

export function hasPermission(role: Role | undefined, permission: Permission) {
  return Boolean(role && getPermissions(role).includes(permission))
}

export function authorize(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!hasPermission(req.user?.role, permission)) {
      throw new HttpError(403, 'Acesso negado para esta ação.')
    }
    next()
  }
}
