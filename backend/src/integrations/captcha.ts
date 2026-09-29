import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { HttpError } from '../utils/http.js'

export function captchaEnabled() {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY)
}

async function verifyTurnstile(token: string, remoteIp?: string) {
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(10_000),
  })
  const data = (await response.json()) as { success: boolean; 'error-codes'?: string[] }
  return data.success
}

/** Exige um token Turnstile válido em `captchaToken` quando o CAPTCHA estiver configurado. */
export async function requireCaptcha(req: Request, _res: Response, next: NextFunction) {
  if (!captchaEnabled()) return next()
  const token = typeof req.body?.captchaToken === 'string' ? req.body.captchaToken : ''
  if (!token) return next(new HttpError(422, 'Confirme que você não é um robô.'))
  try {
    if (!(await verifyTurnstile(token, req.ip))) return next(new HttpError(422, 'Verificação anti-robô falhou. Tente novamente.'))
    next()
  } catch (error) {
    console.error('[captcha] Falha ao validar o Turnstile.', error)
    next(new HttpError(503, 'Não foi possível validar o CAPTCHA agora. Tente novamente em instantes.'))
  }
}
