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
  | 'moderation:reports'
  | 'users:read'
  | 'access_requests:review'
  | 'custody:read'
  | 'custody:manage'
  | 'org:manage'
  | 'orgs:manage'
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
 * RBAC do ARGOS (Sprint 5).
 *
 * Papéis GLOBAIS ficam em `users.role` e valem para a plataforma inteira:
 * - `citizen`: publica, busca, reivindica e conversa;
 * - `moderator`: cidadão + moderação de conteúdo (casos, pistas, conversas) e fila de denúncias;
 * - `support`: cidadão + consulta de contas e avaliação de solicitações de acesso (sem alterar papéis nem bloquear);
 * - `admin`: tudo.
 *
 * Papéis de ESCOPO (`org_admin`, `space_manager`) não vêm de `users.role`: vêm de `organization_members`
 * e só valem dentro da organização/espaço do vínculo (ver `hasScopedPermission`). Uma conta com
 * `users.role = 'org_admin'` e sem vínculo continua com permissões de cidadão (falha fechada).
 */
export const membershipScopedRoles: Role[] = ['space_manager', 'org_admin']

/** Papéis globais que a administração pode atribuir. */
export const assignableRoles = ['citizen', 'moderator', 'support', 'admin'] as const

export const rolePermissions: Record<Role, Permission[]> = {
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

export type ScopedRole = 'org_admin' | 'space_manager'

/** Vínculo de uma conta com uma organização (org_admin) ou com um espaço dela (space_manager). */
export type Membership = {
  organizationId: number
  spaceId: number | null
  role: ScopedRole
}

/** Onde a ação acontece: a organização e, quando houver, o espaço. */
export type Scope = { organizationId?: number | null; spaceId?: number | null }

const spaceManagerPermissions: Permission[] = [
  'items:moderate',
  'items:return',
  'claims:review',
  'claims:read_private',
  'custody:read',
  'custody:manage',
]

export const scopedRolePermissions: Record<ScopedRole, Permission[]> = {
  space_manager: spaceManagerPermissions,
  org_admin: [...spaceManagerPermissions, 'org:manage', 'reports:read_org'],
}

export function getPermissions(role: Role) {
  return rolePermissions[role] ?? rolePermissions.citizen
}

export function hasPermission(role: Role | undefined, permission: Permission) {
  return Boolean(role && getPermissions(role).includes(permission))
}

/**
 * Permissão concedida por vínculo. `org_admin` cobre a organização inteira; `space_manager`, só o próprio
 * espaço. Sem organização no escopo (caso sem espaço institucional), nenhum vínculo se aplica.
 */
export function hasScopedPermission(memberships: Membership[] | undefined, permission: Permission, scope?: Scope | null) {
  if (!memberships?.length || !scope?.organizationId) return false
  return memberships.some(
    (membership) =>
      membership.organizationId === scope.organizationId &&
      (membership.role === 'org_admin' || (scope.spaceId != null && membership.spaceId === scope.spaceId)) &&
      scopedRolePermissions[membership.role].includes(permission),
  )
}

type Actor = { role: Role; memberships?: Membership[] }

/** Permissão global do papel OU permissão de escopo dentro da organização/espaço informado. */
export function can(user: Actor | undefined | null, permission: Permission, scope?: Scope | null) {
  return Boolean(user && (hasPermission(user.role, permission) || hasScopedPermission(user.memberships, permission, scope)))
}

/** Verdadeiro se algum vínculo da conta concede a permissão (em qualquer organização). */
export function hasAnyScopedPermission(memberships: Membership[] | undefined, permission: Permission) {
  return Boolean(memberships?.some((membership) => scopedRolePermissions[membership.role].includes(permission)))
}

/** Middleware: exige uma permissão global do papel. */
export function authorize(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!hasPermission(req.user?.role, permission)) {
      throw new HttpError(403, 'Acesso negado para esta ação.')
    }
    next()
  }
}

/** Middleware: exige ao menos uma das permissões globais (ex.: telas compartilhadas por moderação e suporte). */
export function authorizeAny(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!permissions.some((permission) => hasPermission(req.user?.role, permission))) {
      throw new HttpError(403, 'Acesso negado para esta ação.')
    }
    next()
  }
}

/**
 * Middleware: exige a permissão dentro da organização da rota (`:id` por padrão), por papel global ou
 * por vínculo. Para regras por espaço, use `can()` com o escopo do recurso dentro do handler.
 */
export function authorizeOrganization(permission: Permission, param = 'id') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const organizationId = Number(req.params[param])
    if (!Number.isInteger(organizationId) || organizationId <= 0) throw new HttpError(404, 'Organização não encontrada.')
    if (!can(req.user, permission, { organizationId })) throw new HttpError(403, 'Acesso negado para esta organização.')
    next()
  }
}
