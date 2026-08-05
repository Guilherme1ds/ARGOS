import type { NextFunction, Request, Response } from 'express'
import { HttpError } from '../utils/http.js'

const hits = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(max = 30, windowMs = 60_000) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const current = hits.get(ip)

    if (!current || current.resetAt < now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs })
      return next()
    }

    current.count += 1
    if (current.count > max) throw new HttpError(429, 'Muitas tentativas. Tente novamente em instantes.')
    next()
  }
}
