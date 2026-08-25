import type { NextFunction, Request, Response } from 'express'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { env } from '../config/env.js'
import { db, type DbUser } from '../db/database.js'
import { hasPermission } from '../shared/policies/permissions.js'
import { HttpError } from '../utils/http.js'

export type AuthUser = Pick<
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
>

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function signToken(user: AuthUser) {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] }
  return jwt.sign({ sub: String(user.id), role: user.role }, env.JWT_SECRET, options)
}

function readBearerUser(req: Request) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) return null

  const payload = jwt.verify(token, env.JWT_SECRET) as unknown as { sub: string }
  const user = db
    .prepare(
      `SELECT id, name, nickname, email, role, status, spam_score, avatar_url, phone, department, bio,
              preferred_contact, language, theme, timezone, date_format, compact_mode, high_contrast
       FROM users
       WHERE id = ?`,
    )
    .get(Number(payload.sub)) as AuthUser | undefined

  if (!user || user.status !== 'active') throw new HttpError(401, 'Usuário inativo ou inválido.')

  return user
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
