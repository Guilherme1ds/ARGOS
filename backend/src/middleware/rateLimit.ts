import type { NextFunction, Request, Response } from 'express'
import { HttpError } from '../utils/http.js'

const hits = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(max = 30, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const route = req.baseUrl || req.path || 'global'
    const key = `${route}:${ip}`
    const now = Date.now()
    const current = hits.get(key)

    for (const [hitKey, hit] of hits) {
      if (hit.resetAt < now) hits.delete(hitKey)
    }

    if (!current || current.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }

    current.count += 1
    if (current.count > max) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000))
      throw new HttpError(429, 'Muitas tentativas. Tente novamente em instantes.')
    }
    next()
  }
}
