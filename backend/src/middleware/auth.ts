import type { NextFunction, Request, Response } from 'express'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { env } from '../config/env.js'
import { db, type DbUser } from '../db/database.js'
import { hasPermission, type Membership } from '../shared/policies/permissions.js'
import { HttpError } from '../utils/http.js'

export type AuthUser = { memberships?: Membership[] } & Pick<
  DbUser,
  | 'id'
  | 'name'
  | 'nickname'
  | 'email'
  | 'role'
  | 'status'
  | 'spam_score'
  | 'avatar_url'
  | 'phone'
  | 'department'
  | 'bio'
  | 'preferred_contact'
  | 'language'
  | 'theme'
  | 'timezone'
  | 'date_format'
  | 'compact_mode'
  | 'high_contrast'
  | 'email_verified_at'
>

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export const emailUnverifiedMessage = 'Confirme seu e-mail para continuar. Enviamos um link de confirmação para o endereço cadastrado.'

export function signToken(user: AuthUser) {
  const options: SignOptions = { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] }
  return jwt.sign({ sub: String(user.id), role: user.role }, env.JWT_SECRET, options)
}

function readBearerUser(req: Request) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) return null

  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as unknown as { sub: string }
  const user = db
    .prepare(
      `SELECT id, name, nickname, email, role, status, spam_score, avatar_url, phone, department, bio,
              preferred_contact, language, theme, timezone, date_format, compact_mode, high_contrast, email_verified_at
       FROM users
       WHERE id = ?`,
    )
    .get(Number(payload.sub)) as AuthUser | undefined

  if (!user || user.status !== 'active') throw new HttpError(401, 'Usuário inativo ou inválido.')
  // Cadastro por senha só opera depois de confirmar o e-mail (sessões anteriores à migração também param aqui).
  if (!user.email_verified_at) throw new HttpError(403, emailUnverifiedMessage, { code: 'email_unverified' })

  user.memberships = loadMemberships(user.id)
  return user
}

/** Vínculos de escopo da conta (organizações e espaços ativos). Relido a cada requisição: revogar vale na hora. */
export function loadMemberships(userId: number): Membership[] {
  const rows = db
    .prepare(
      `SELECT organization_members.organization_id, organization_members.space_id, organization_members.role
       FROM organization_members
       JOIN organizations ON organizations.id = organization_members.organization_id AND organizations.status = 'active'
       LEFT JOIN spaces ON spaces.id = organization_members.space_id
       WHERE organization_members.user_id = ? AND (organization_members.space_id IS NULL OR spaces.status = 'active')`,
    )
    .all(userId) as Array<{ organization_id: number; space_id: number | null; role: Membership['role'] }>
  return rows.map((row) => ({ organizationId: row.organization_id, spaceId: row.space_id, role: row.role }))
}

export function auth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = readBearerUser(req)
    if (!user) throw new HttpError(401, 'Token ausente.')
    req.user = user
    next()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(401, 'Token inválido.')
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = readBearerUser(req)
    if (user) req.user = user
  } catch {
    req.user = undefined
  }
  next()
}

export function admin(req: Request, _res: Response, next: NextFunction) {
  if (!hasPermission(req.user?.role, 'platform:admin')) throw new HttpError(403, 'Acesso restrito a administradores.')
  next()
}
