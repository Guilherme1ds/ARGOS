import type { NextFunction, Request, Response } from 'express'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { env } from '../config/env.js'
import { db, type DbUser } from '../db/database.js'
import { HttpError } from '../utils/http.js'

export type AuthUser = Pick<DbUser, 'id' | 'name' | 'email' | 'role' | 'status' | 'spam_score'>

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

export function auth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) throw new HttpError(401, 'Token ausente.')

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as unknown as { sub: string }
    const user = db
      .prepare('SELECT id, name, email, role, status, spam_score FROM users WHERE id = ?')
      .get(Number(payload.sub)) as AuthUser | undefined

    if (!user || user.status !== 'active') throw new HttpError(401, 'Usuário inativo ou inválido.')

    req.user = user
    next()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(401, 'Token inválido.')
  }
}

export function admin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Acesso restrito a administradores.')
  next()
}
