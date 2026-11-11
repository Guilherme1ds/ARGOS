import type { NextFunction, Request, Response } from 'express'
import { corsOrigins, env } from '../config/env.js'
import { HttpError } from '../utils/http.js'

const apiOrigin = (() => {
  try {
    return new URL(env.API_PUBLIC_URL).origin
  } catch {
    return null
  }
})()

/**
 * Defesa contra CSRF nas rotas que usam o cookie de sessão: navegadores sempre enviam Origin em POST;
 * se vier de um site não autorizado, a requisição é recusada. Clientes nativos (sem Origin) seguem normalmente.
 */
export function requireTrustedOrigin(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get('origin')
  if (!origin || env.NODE_ENV === 'development') return next()
  if (corsOrigins.includes(origin) || origin === apiOrigin) return next()
  throw new HttpError(403, 'Origem da requisição não autorizada.')
}
