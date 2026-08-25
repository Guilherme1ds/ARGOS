import type { NextFunction, Request, Response } from 'express'
import { createHash } from 'node:crypto'
import { db } from '../db/database.js'
import { HttpError } from '../utils/http.js'

let cleanupCounter = 0

const consumeWindow = db.transaction((bucketKey: string, now: number, windowMs: number) => {
  const current = db.prepare('SELECT hit_count, reset_at FROM rate_limit_windows WHERE bucket_key = ?').get(bucketKey) as
    | { hit_count: number; reset_at: number }
    | undefined

  if (!current || current.reset_at <= now) {
    const resetAt = now + windowMs
    db.prepare(
      `INSERT INTO rate_limit_windows (bucket_key, hit_count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET hit_count = 1, reset_at = excluded.reset_at`,
    ).run(bucketKey, resetAt)
    return { count: 1, resetAt }
  }

  db.prepare('UPDATE rate_limit_windows SET hit_count = hit_count + 1 WHERE bucket_key = ?').run(bucketKey)
  return { count: current.hit_count + 1, resetAt: current.reset_at }
})

export function rateLimit(max = 30, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const route = `${req.baseUrl}${String(req.route?.path ?? req.path ?? '')}`
    const key = createHash('sha256').update(`${req.method}:${route}:${ip}`).digest('hex')
    const now = Date.now()
    const current = consumeWindow(key, now, windowMs)

    if (current.count > max) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000))
      throw new HttpError(429, 'Muitas tentativas. Tente novamente em instantes.')
    }

    // Amortiza a limpeza e mantém o custo fora do caminho de cada requisição.
    cleanupCounter += 1
    if (cleanupCounter >= 500) {
      cleanupCounter = 0
      db.prepare('DELETE FROM rate_limit_windows WHERE reset_at < ?').run(now - windowMs)
    }
    next()
  }
}
