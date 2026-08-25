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
import { queueMail } from '../../utils/mail.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { assertOwnedUpload } from '../../utils/uploads.js'

const router = Router()
const refreshCookieName = 'argos_refresh'
const defaultTermsVersion = '2026-08-18'

const registerSchema = z.object({
  name: z.string().min(3).max(120),
  email: z.string().trim().toLowerCase().email().max(160),
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

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable()
const nicknameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(40)
  .refine((value) => value === '' || /^[a-z0-9._]{3,40}$/.test(value), {
    message: 'Use 3 a 40 caracteres: letras minusculas, numeros, ponto ou underline.',
  })
  .optional()
  .nullable()
const avatarUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^\/uploads\/[\w.-]+$/.test(value), {
    message: 'Use uma imagem enviada pelo ARGOS.',
  })
  .optional()
  .nullable()

const updateProfileSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  nickname: nicknameSchema,
  avatarUrl: avatarUrlSchema,
  phone: optionalText(30),
  department: optionalText(120),
  bio: optionalText(300),
  preferredContact: z.enum(['in_app', 'email']).optional(),
  language: z.enum(['pt-BR', 'en-US', 'es-ES']).optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  timezone: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .refine(
      (value) => {
        try {
          Intl.DateTimeFormat('pt-BR', { timeZone: value })
          return true
        } catch {
          return false
        }
      },
      { message: 'Fuso horario invalido.' },
    )
    .optional(),
  dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']).optional(),
  compactMode: z.boolean().optional(),
  highContrast: z.boolean().optional(),
  notificationPreferences: z
    .object({
      emailEnabled: z.boolean().optional(),
      inAppEnabled: z.boolean().optional(),
      digestEnabled: z.boolean().optional(),
    })
    .optional(),
})

type RefreshTokenRow = {
  id: number
  user_id: number
  token_hash: string
  expires_at: string
  revoked_at: string | null
}

type NotificationPreferenceRow = {
  email_enabled: number
  in_app_enabled: number
  digest_enabled: number
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

function getNotificationPreferences(userId: number) {
  const row = db
    .prepare('SELECT email_enabled, in_app_enabled, digest_enabled FROM notification_preferences WHERE user_id = ?')
    .get(userId) as NotificationPreferenceRow | undefined

  return {
    emailEnabled: row ? Boolean(row.email_enabled) : true,
    inAppEnabled: row ? Boolean(row.in_app_enabled) : true,
    digestEnabled: row ? Boolean(row.digest_enabled) : false,
  }
}

function cleanNullableText(value: string | null | undefined) {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function publicNickname(user: Pick<DbUser, 'id' | 'name' | 'nickname'>) {
  const cleaned = cleanNullableText(user.nickname)
  if (cleaned) return cleaned

  const fallback = user.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 28)

  return fallback || `usuario.${user.id}`
}

function publicUser(
  user: Pick<
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
  >,
) {
  return {
    id: user.id,
    name: user.name,
    nickname: publicNickname(user),
    email: user.email,
    role: user.role,
    status: user.status,
    spamScore: user.spam_score,
    avatarUrl: user.avatar_url,
    phone: user.phone,
    department: user.department,
    bio: user.bio,
    preferredContact: user.preferred_contact,
    language: user.language,
    theme: user.theme,
    timezone: user.timezone,
    dateFormat: user.date_format,
    compactMode: Boolean(user.compact_mode),
    highContrast: Boolean(user.high_contrast),
    notificationPreferences: getNotificationPreferences(user.id),
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
      db.prepare(
        `INSERT INTO access_requests (name, email, reason) VALUES (?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           name = excluded.name,
           reason = excluded.reason,
           status = CASE WHEN access_requests.status = 'rejected' THEN 'pending' ELSE access_requests.status END,
           reviewed_by = CASE WHEN access_requests.status = 'rejected' THEN NULL ELSE access_requests.reviewed_by END,
           reviewed_at = CASE WHEN access_requests.status = 'rejected' THEN NULL ELSE access_requests.reviewed_at END`,
      ).run(input.name, input.email, input.reason ?? null)
      const accessRequest = db.prepare('SELECT status FROM access_requests WHERE email = ?').get(input.email) as { status: string }
      if (accessRequest.status === 'approved') throw new HttpError(409, 'Esta solicitação de acesso já foi aprovada.')
      logAudit(req, 'auth.access_requested', 'access_request', input.email)
      return res.status(202).json({ message: 'Solicitação de acesso enviada para aprovação.' })
    }

    if (!input.privacyTermsAccepted) {
      throw new HttpError(422, 'Aceite os termos de privacidade para criar a conta.')
    }

    const passwordHash = await bcrypt.hash(input.password, 12)
    const createAccount = db.transaction(() => {
      const result = db
        .prepare('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
        .run(input.name, input.email, passwordHash, 'citizen', 'active')
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as DbUser
      db.prepare(
        `INSERT INTO privacy_consents (user_id, terms_version, purpose, granted, ip_address, user_agent)
         VALUES (?, ?, ?, 1, ?, ?)`,
      ).run(user.id, input.privacyTermsVersion, 'account_registration', req.ip, req.get('user-agent') ?? null)
      queueMail(user.email, 'Bem-vindo ao ARGOS', 'Sua conta foi criada com sucesso.')
      logAudit(req, 'auth.registered', 'user', user.id, { termsVersion: input.privacyTermsVersion })
      return user
    })

    let user: DbUser
    try {
      user = createAccount()
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) throw new HttpError(409, 'E-mail já cadastrado.')
      throw error
    }
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

router.patch(
  '/me',
  auth,
  asyncHandler(async (req, res) => {
    const input = updateProfileSchema.parse(req.body)
    const hasInput = (field: keyof typeof input) => Object.prototype.hasOwnProperty.call(input, field)
    const updates: Array<{ column: string; value: string | number | null }> = []

    if (input.name !== undefined) updates.push({ column: 'name', value: input.name })
    if (hasInput('nickname')) {
      const nickname = cleanNullableText(input.nickname)
      if (nickname) {
        const existing = db
          .prepare('SELECT id FROM users WHERE LOWER(nickname) = LOWER(?) AND id <> ?')
          .get(nickname, req.user!.id) as { id: number } | undefined
        if (existing) throw new HttpError(409, 'Este nickname ja esta em uso.')
      }
      updates.push({ column: 'nickname', value: nickname })
    }
    if (hasInput('avatarUrl')) {
      assertOwnedUpload(req.user!.id, input.avatarUrl)
      updates.push({ column: 'avatar_url', value: cleanNullableText(input.avatarUrl) })
    }
    if (hasInput('phone')) updates.push({ column: 'phone', value: cleanNullableText(input.phone) })
    if (hasInput('department')) updates.push({ column: 'department', value: cleanNullableText(input.department) })
    if (hasInput('bio')) updates.push({ column: 'bio', value: cleanNullableText(input.bio) })
    if (input.preferredContact !== undefined) updates.push({ column: 'preferred_contact', value: input.preferredContact })
    if (input.language !== undefined) updates.push({ column: 'language', value: input.language })
    if (input.theme !== undefined) updates.push({ column: 'theme', value: input.theme })
    if (input.timezone !== undefined) updates.push({ column: 'timezone', value: input.timezone })
    if (input.dateFormat !== undefined) updates.push({ column: 'date_format', value: input.dateFormat })
    if (input.compactMode !== undefined) updates.push({ column: 'compact_mode', value: input.compactMode ? 1 : 0 })
    if (input.highContrast !== undefined) updates.push({ column: 'high_contrast', value: input.highContrast ? 1 : 0 })

    if (updates.length) {
      db.prepare(
        `UPDATE users
         SET ${updates.map((update) => `${update.column} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(...updates.map((update) => update.value), req.user!.id)
    }

    const notificationUpdates = input.notificationPreferences
    const hasNotificationUpdates = Boolean(notificationUpdates && Object.keys(notificationUpdates).length)
    if (notificationUpdates && hasNotificationUpdates) {
      const current = getNotificationPreferences(req.user!.id)
      const next = {
        emailEnabled: notificationUpdates.emailEnabled ?? current.emailEnabled,
        inAppEnabled: notificationUpdates.inAppEnabled ?? current.inAppEnabled,
        digestEnabled: notificationUpdates.digestEnabled ?? current.digestEnabled,
      }

      db.prepare(
        `INSERT INTO notification_preferences (user_id, email_enabled, in_app_enabled, digest_enabled, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           email_enabled = excluded.email_enabled,
           in_app_enabled = excluded.in_app_enabled,
           digest_enabled = excluded.digest_enabled,
           updated_at = CURRENT_TIMESTAMP`,
      ).run(req.user!.id, next.emailEnabled ? 1 : 0, next.inAppEnabled ? 1 : 0, next.digestEnabled ? 1 : 0)
    }

    if (updates.length || hasNotificationUpdates) {
      logAudit(req, 'auth.profile_updated', 'user', req.user!.id, {
        fields: updates.map((update) => update.column),
        notificationPreferences: hasNotificationUpdates,
      })
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as DbUser
    res.json({ user: publicUser(user) })
  }),
)

export { router as authRoutes }
