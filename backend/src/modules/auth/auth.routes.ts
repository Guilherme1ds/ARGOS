import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes, createHash } from 'node:crypto'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db, type DbUser } from '../../db/database.js'
import { auth, signToken, type AuthUser } from '../../middleware/auth.js'
import { getPermissions } from '../../shared/policies/permissions.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { sendMail } from '../../utils/mail.js'
import { rateLimit } from '../../middleware/rateLimit.js'

const router = Router()
const refreshCookieName = 'argos_refresh'
const defaultTermsVersion = '2026-08-18'

const registerSchema = z.object({
  name: z.string().min(3).max(120),
  email: z.string().email().max(160),
  password: z.string().min(8).max(120),
  requestAccess: z.boolean().optional(),
  reason: z.string().max(500).optional(),
  privacyTermsAccepted: z.boolean().optional(),
  privacyTermsVersion: z.string().min(3).max(40).default(defaultTermsVersion),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

type RefreshTokenRow = {
  id: number
  user_id: number
  token_hash: string
  expires_at: string
  revoked_at: string | null
}

function parseDurationMs(value: string) {
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  if (!match) return 30 * 24 * 60 * 60 * 1000

  const amount = Number(match[1])
  const unit = match[2]
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return amount * multipliers[unit as keyof typeof multipliers]
}

function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function readCookie(req: Request, name: string) {
  const cookie = req.headers.cookie
  if (!cookie) return null

  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === name) return decodeURIComponent(rawValue.join('='))
  }

  return null
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${refreshCookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/api; Max-Age=${maxAge}; SameSite=Lax${secure}`,
  )
}

function clearRefreshCookie(res: Response) {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${refreshCookieName}=; HttpOnly; Path=/api; Max-Age=0; SameSite=Lax${secure}`)
}

function createRefreshToken(userId: number) {
  const token = randomBytes(48).toString('base64url')
  const expiresAt = new Date(Date.now() + parseDurationMs(env.REFRESH_TOKEN_EXPIRES_IN))

  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
    userId,
    hashRefreshToken(token),
    expiresAt.toISOString(),
  )

  return { token, expiresAt }
}

function publicUser(user: Pick<DbUser, 'id' | 'name' | 'email' | 'role' | 'status' | 'spam_score'>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    spamScore: user.spam_score,
    permissions: getPermissions(user.role),
  }
}

function issueSession(res: Response, user: AuthUser | DbUser) {
  const refresh = createRefreshToken(user.id)
  setRefreshCookie(res, refresh.token, refresh.expiresAt)
  return { user: publicUser(user), token: signToken(user) }
}

router.post(
  '/register',
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email)
    if (existing) throw new HttpError(409, 'E-mail já cadastrado.')

    if (input.requestAccess) {
      db.prepare('INSERT INTO access_requests (name, email, reason) VALUES (?, ?, ?)').run(
        input.name,
        input.email,
        input.reason ?? null,
      )
      logAudit(req, 'auth.access_requested', 'access_request', input.email)
      return res.status(202).json({ message: 'Solicitação de acesso enviada para aprovação.' })
    }

    if (!input.privacyTermsAccepted) {
      throw new HttpError(422, 'Aceite os termos de privacidade para criar a conta.')
    }

    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
      .run(input.name, input.email, await bcrypt.hash(input.password, 12), 'citizen', 'active')

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as DbUser
    db.prepare(
      `INSERT INTO privacy_consents (user_id, terms_version, purpose, granted, ip_address, user_agent)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(user.id, input.privacyTermsVersion, 'account_registration', req.ip, req.get('user-agent') ?? null)

    await sendMail(user.email, 'Bem-vindo ao ARGOS', 'Sua conta foi criada com sucesso.')
    logAudit(req, 'auth.registered', 'user', user.id, { termsVersion: input.privacyTermsVersion })
    res.status(201).json(issueSession(res, user))
  }),
)

router.post(
  '/login',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email) as DbUser | undefined
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      logAudit(req, 'auth.login_failed', 'user', input.email)
      throw new HttpError(401, 'Credenciais inválidas.')
    }
    if (user.status !== 'active') throw new HttpError(403, 'Usuário pendente ou bloqueado.')

    logAudit(req, 'auth.login_succeeded', 'user', user.id)
    res.json(issueSession(res, user))
  }),
)

router.post(
  '/refresh',
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const token = readCookie(req, refreshCookieName)
    if (!token) throw new HttpError(401, 'Sessão expirada.')

    const tokenHash = hashRefreshToken(token)
    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash) as RefreshTokenRow | undefined
    if (!row) throw new HttpError(401, 'Sessão inválida.')

    if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND revoked_at IS NULL').run(
        row.user_id,
      )
      logAudit(req, 'auth.refresh_rejected', 'refresh_token', row.id, { reason: row.revoked_at ? 'reused' : 'expired' })
      clearRefreshCookie(res)
      throw new HttpError(401, 'Sessão inválida.')
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as DbUser | undefined
    if (!user || user.status !== 'active') {
      clearRefreshCookie(res)
      throw new HttpError(401, 'Usuário inativo ou inválido.')
    }

    const refresh = createRefreshToken(user.id)
    db.prepare(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP, replaced_by_token_hash = ? WHERE id = ?',
    ).run(hashRefreshToken(refresh.token), row.id)
    setRefreshCookie(res, refresh.token, refresh.expiresAt)
    req.user = user
    logAudit(req, 'auth.refresh_rotated', 'refresh_token', row.id)
    res.json({ user: publicUser(user), token: signToken(user) })
  }),
)

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = readCookie(req, refreshCookieName)
    if (token) {
      const row = db
        .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
        .get(hashRefreshToken(token)) as RefreshTokenRow | undefined
      if (row) {
        db.prepare('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE id = ?').run(row.id)
        logAudit(req, 'auth.logout', 'refresh_token', row.id)
      }
    }

    clearRefreshCookie(res)
    res.json({ message: 'Sessão encerrada.' })
  }),
)

router.get(
  '/me',
  auth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user!) })
  }),
)

export { router as authRoutes }
