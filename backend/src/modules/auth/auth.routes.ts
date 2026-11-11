import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes, createHash } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { privacyNotice } from '../../config/privacy-notice.js'
import { db, type DbUser } from '../../db/database.js'
import { afterCommit, atomic } from '../../db/transaction.js'
import { auth, emailUnverifiedMessage, signToken, type AuthUser } from '../../middleware/auth.js'
import { requireTrustedOrigin } from '../../middleware/origin.js'
import { getPermissions, hasPermission } from '../../shared/policies/permissions.js'
import { logAudit, logItemHistory, notify } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { queueMail } from '../../utils/mail.js'
import { hashPassword, verifyPassword } from '../../utils/password.js'
import { pseudonymizeEmail } from '../../utils/pseudonym.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { requireCaptcha } from '../../integrations/captcha.js'
import { verifyGoogleCredential } from '../../integrations/google.js'
import { publicNickname } from '../../utils/public-profile.js'
import { assertOwnedUpload } from '../../utils/uploads.js'

const router = Router()
const refreshCookieName = 'argos_refresh'

const passwordSchema = z.string().min(8).max(120)
// A versão aceita é sempre a do servidor; se o cliente informar outra, ele mostrou um texto desatualizado.
const termsVersionSchema = z.string().trim().min(3).max(40).optional()

const registerSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().toLowerCase().email().max(160),
    // Solicitação de acesso não define senha: a conta aprovada recebe uma senha temporária (ou a pessoa cria
    // a sua por "Esqueci minha senha"). Clientes antigos ainda enviam o campo, que é ignorado nesse caso.
    password: passwordSchema.optional(),
    requestAccess: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
    privacyTermsAccepted: z.boolean().optional(),
    privacyTermsVersion: termsVersionSchema,
    captchaToken: z.string().max(4096).optional(),
  })
  .superRefine((input, ctx) => {
    if (!input.requestAccess && !input.password) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Informe uma senha com pelo menos 8 caracteres.' })
    }
  })

const googleLoginSchema = z.object({
  credential: z.string().min(20).max(8192),
  privacyTermsAccepted: z.boolean().optional(),
  privacyTermsVersion: termsVersionSchema,
})

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(1).max(120),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(120),
  newPassword: passwordSchema,
})

const emailOnlySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  captchaToken: z.string().max(4096).optional(),
})

const tokenSchema = z.string().trim().min(20).max(200)

const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
})

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(120),
})

const passwordResetTtlMs = 60 * 60 * 1000
/** Teto de tentativas de login por IP e minuto (todas as contas somadas). */
export const loginIpLimitPerMinute = 60
const verificationResendCooldownMs = 60_000
const verificationMaxPerDay = 5

// Hash descartável usado quando o e-mail não existe, para que o tempo de resposta não revele contas cadastradas.
const timingGuardHash = bcrypt.hashSync(randomBytes(16).toString('hex'), 12)
// Janela em que um refresh token recém-rotacionado ainda é aceito como corrida legítima (abas ou requisições paralelas).
const refreshRotationGraceMs = 10_000

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable()
const nicknameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(40)
  .refine((value) => value === '' || /^[a-z0-9._]{3,40}$/.test(value), {
    message: 'Use 3 a 40 caracteres: letras minúsculas, números, ponto ou sublinhado.',
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
      { message: 'Fuso horário inválido.' },
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
  replaced_by_token_hash: string | null
}

type NotificationPreferenceRow = {
  email_enabled: number
  in_app_enabled: number
  digest_enabled: number
}

function sqliteTimestampMs(value: string) {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime()
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function frontendLink(path: string, token: string) {
  // Token no fragmento (#): o navegador não o envia ao servidor web nem em cabeçalhos Referer.
  return `${env.FRONTEND_URL.replace(/\/$/, '')}${path}#token=${token}`
}

function assertCurrentTermsVersion(version?: string) {
  if (version && version !== privacyNotice.version) {
    throw new HttpError(409, 'O resumo de privacidade foi atualizado. Leia a versão vigente e confirme novamente.', {
      code: 'terms_outdated',
      currentVersion: privacyNotice.version,
    })
  }
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

function cookieAttributes() {
  const sameSite = { lax: 'Lax', strict: 'Strict', none: 'None' }[env.COOKIE_SAMESITE]
  const secure = env.PRODUCTION_LIKE || env.COOKIE_SAMESITE === 'none' ? '; Secure' : ''
  return `HttpOnly; Path=/api; SameSite=${sameSite}${secure}`
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  res.setHeader('Set-Cookie', `${refreshCookieName}=${encodeURIComponent(token)}; Max-Age=${maxAge}; ${cookieAttributes()}`)
}

function clearRefreshCookie(res: Response) {
  res.setHeader('Set-Cookie', `${refreshCookieName}=; Max-Age=0; ${cookieAttributes()}`)
}

function createRefreshToken(userId: number) {
  const token = randomBytes(48).toString('base64url')
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_MS)

  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
    userId,
    hashToken(token),
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
    | 'email_verified_at'
  >,
) {
  return {
    id: user.id,
    name: user.name,
    nickname: publicNickname(user),
    email: user.email,
    emailVerified: Boolean(user.email_verified_at),
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

function revokeAllSessions(userId: number) {
  db.prepare('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND revoked_at IS NULL').run(userId)
}

/** Limita reenvios: um a cada minuto e no máximo cinco por dia por conta. */
function canSendVerification(userId: number, now = Date.now()) {
  const recent = db
    .prepare(
      `SELECT COUNT(*) AS total, MAX(created_at) AS latest FROM email_verifications
       WHERE user_id = ? AND created_at > datetime('now', '-1 day')`,
    )
    .get(userId) as { total: number; latest: string | null }
  if (recent.total >= verificationMaxPerDay) return false
  return !recent.latest || now - sqliteTimestampMs(recent.latest) >= verificationResendCooldownMs
}

/** Gera um link de uso único (só o hash fica no banco) e enfileira o e-mail sem registrar o corpo. */
function sendEmailVerification(user: { id: number; email: string }) {
  const token = randomBytes(32).toString('base64url')
  const ttlMs = env.EMAIL_VERIFICATION_TTL_HOURS * 3_600_000
  const expiresAt = Date.now() + ttlMs
  db.prepare("UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL").run(user.id)
  db.prepare('INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
    user.id,
    hashToken(token),
    new Date(expiresAt).toISOString(),
  )
  queueMail(
    user.email,
    'Confirme seu e-mail no ARGOS',
    `Para ativar sua conta no ARGOS, confirme o e-mail em: ${frontendLink('/verify-email', token)}\n` +
      `O link expira em ${env.EMAIL_VERIFICATION_TTL_HOURS} horas e só pode ser usado uma vez. Se você não criou esta conta, ignore esta mensagem.`,
    { sensitive: true, expiresAt },
  )
}

const verificationSentMessage = 'Conta criada. Enviamos um link de confirmação para o seu e-mail; confirme para entrar.'
export const accessRequestedMessage =
  'Solicitação enviada. Se a administração aprovar, você recebe uma senha temporária por um canal institucional ou pode criar a sua em “Esqueci minha senha” com este e-mail.'
export const accountInactiveMessage = 'Sua conta está bloqueada ou aguardando aprovação. Fale com a administração do ARGOS.'

router.post(
  '/register',
  rateLimit(5, 60_000),
  requireCaptcha,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email)
    if (existing) throw new HttpError(409, 'E-mail já cadastrado.')

    if (input.requestAccess) {
      const requestId = atomic(() => {
        // Uma solicitação já aprovada não é reaberta nem tem nome/justificativa sobrescritos.
        const current = db.prepare('SELECT id, status FROM access_requests WHERE email = ?').get(input.email) as
          | { id: number; status: string }
          | undefined
        if (current?.status === 'approved') throw new HttpError(409, 'Esta solicitação de acesso já foi aprovada.')
        db.prepare(
          `INSERT INTO access_requests (name, email, reason) VALUES (?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             name = excluded.name,
             reason = excluded.reason,
             status = 'pending',
             reviewed_by = NULL,
             reviewed_at = NULL`,
        ).run(input.name, input.email, input.reason || null)
        const saved = db.prepare('SELECT id FROM access_requests WHERE email = ?').get(input.email) as { id: number }
        logAudit(req, 'auth.access_requested', 'access_request', saved.id)
        return saved.id
      })
      return res.status(202).json({ id: requestId, message: accessRequestedMessage })
    }

    if (!input.privacyTermsAccepted) {
      throw new HttpError(422, 'Aceite os termos de privacidade para criar a conta.')
    }
    assertCurrentTermsVersion(input.privacyTermsVersion)

    const passwordHash = await hashPassword(input.password!, 12)
    let userId: number
    try {
      userId = atomic(() => {
        // A conta nasce sem e-mail verificado e não recebe sessão até a confirmação.
        const result = db
          .prepare('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
          .run(input.name, input.email, passwordHash, 'citizen', 'active')
        const id = Number(result.lastInsertRowid)
        db.prepare(
          `INSERT INTO privacy_consents (user_id, terms_version, purpose, granted, ip_address, user_agent)
           VALUES (?, ?, ?, 1, ?, ?)`,
        ).run(id, privacyNotice.version, 'account_registration', req.ip, req.get('user-agent') ?? null)
        sendEmailVerification({ id, email: input.email })
        logAudit(req, 'auth.registered', 'user', id, { termsVersion: privacyNotice.version, emailVerified: false })
        return id
      })
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) throw new HttpError(409, 'E-mail já cadastrado.')
      throw error
    }
    res.status(201).json({ verificationRequired: true, email: input.email, userId, message: verificationSentMessage })
  }),
)

// Login: 10 tentativas por minuto para a mesma conta a partir do mesmo IP (força bruta) e um teto por IP mais alto.
// Em campus com NAT muitas pessoas saem pelo mesmo IP; um limite só por IP barraria logins legítimos no início das aulas.
const loginAccountSubject = (req: Request) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 160) : ''
  return `login:${email ? pseudonymizeEmail(email) : '-'}:${req.ip ?? 'unknown'}`
}

router.post(
  '/login',
  rateLimit(loginIpLimitPerMinute, 60_000),
  rateLimit(10, 60_000, loginAccountSubject),
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(input.email) as DbUser | undefined
    const passwordMatches = await verifyPassword(input.password, user?.password_hash ?? timingGuardHash)
    if (!user || !passwordMatches) {
      // Pseudônimo em vez do e-mail digitado: correlaciona tentativas sem guardar o endereço.
      logAudit(req, 'auth.login_failed', 'user', pseudonymizeEmail(input.email))
      throw new HttpError(401, 'Credenciais inválidas.')
    }
    if (user.status !== 'active') throw new HttpError(403, accountInactiveMessage, { code: 'account_inactive' })
    if (!user.email_verified_at) {
      // Senha correta, e-mail ainda não confirmado: reenvia o link (respeitando o limite) e não abre sessão.
      if (canSendVerification(user.id)) atomic(() => sendEmailVerification(user))
      logAudit(req, 'auth.login_unverified', 'user', user.id)
      throw new HttpError(403, emailUnverifiedMessage, { code: 'email_unverified' })
    }

    logAudit(req, 'auth.login_succeeded', 'user', user.id)
    res.json(issueSession(res, user))
  }),
)

router.post(
  '/verify-email',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = z.object({ token: tokenSchema }).parse(req.body)
    const invalid = () => new HttpError(400, 'Link de confirmação inválido ou expirado. Solicite um novo.', { code: 'verification_invalid' })
    const verification = db
      .prepare('SELECT id, user_id, expires_at, used_at FROM email_verifications WHERE token_hash = ?')
      .get(hashToken(input.token)) as { id: number; user_id: number; expires_at: string; used_at: string | null } | undefined
    if (!verification || verification.used_at || new Date(verification.expires_at).getTime() <= Date.now()) throw invalid()

    const verified = atomic(() => {
      const consumed = db
        .prepare('UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL')
        .run(verification.id).changes
      if (!consumed) return false
      db.prepare(
        'UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).run(verification.user_id)
      db.prepare('UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').run(verification.user_id)
      logAudit(req, 'auth.email_verified', 'user', verification.user_id)
      return true
    })
    if (!verified) throw invalid()
    res.json({ message: 'E-mail confirmado. Agora você pode entrar com sua senha.' })
  }),
)

router.post(
  '/resend-verification',
  rateLimit(3, 60_000),
  asyncHandler(async (req, res) => {
    const input = emailOnlySchema.parse(req.body)
    const user = db
      .prepare("SELECT id, email, email_verified_at FROM users WHERE LOWER(email) = ? AND status = 'active'")
      .get(input.email) as { id: number; email: string; email_verified_at: string | null } | undefined
    if (user && !user.email_verified_at && canSendVerification(user.id)) {
      atomic(() => {
        sendEmailVerification(user)
        logAudit(req, 'auth.verification_resent', 'user', user.id)
      })
    }
    // Mesma resposta para qualquer e-mail, para não revelar contas.
    res.status(202).json({ message: 'Se houver uma conta aguardando confirmação, enviaremos um novo link.' })
  }),
)

router.post(
  '/google',
  rateLimit(10, 60_000),
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const input = googleLoginSchema.parse(req.body)
    const identity = await verifyGoogleCredential(input.credential)
    if (!identity.emailVerified) throw new HttpError(401, 'Confirme seu e-mail na conta Google antes de entrar.')

    // Conta já vinculada ao Google, ou conta existente com o mesmo e-mail verificado (vincula na primeira vez).
    let user = (db.prepare('SELECT * FROM users WHERE google_sub = ?').get(identity.sub) ??
      db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(identity.email)) as DbUser | undefined

    if (user) {
      if (user.status !== 'active') throw new HttpError(403, accountInactiveMessage, { code: 'account_inactive' })
      if (user.google_sub && user.google_sub !== identity.sub) {
        throw new HttpError(401, 'Esta conta já está vinculada a outro login do Google.')
      }
      if (!user.google_sub) {
        const unverified = !user.email_verified_at
        const linked = user
        // Quem cadastrou a senha nunca provou ter o e-mail: ao vincular, essa senha e as sessões deixam de valer.
        const replacementHash = unverified ? await hashPassword(randomBytes(24).toString('hex'), 10) : null
        atomic(() => {
          db.prepare(
            `UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
               password_hash = COALESCE(?, password_hash), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          ).run(identity.sub, replacementHash, linked.id)
          if (unverified) revokeAllSessions(linked.id)
          logAudit(req, 'auth.google_linked', 'user', linked.id, { replacedUnverifiedPassword: unverified })
        })
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(linked.id) as DbUser
      }
    } else {
      if (!input.privacyTermsAccepted) {
        throw new HttpError(422, 'Aceite os termos de privacidade para criar a conta.', { code: 'terms_required' })
      }
      assertCurrentTermsVersion(input.privacyTermsVersion)
      // Senha aleatória: a conta entra pelo Google; "Esqueci minha senha" permite criar uma senha depois.
      const passwordHash = await hashPassword(randomBytes(24).toString('hex'), 10)
      user = atomic(() => {
        const result = db
          .prepare(
            `INSERT INTO users (name, email, password_hash, role, status, google_sub, email_verified_at)
             VALUES (?, ?, ?, 'citizen', 'active', ?, CURRENT_TIMESTAMP)`,
          )
          .run(identity.name.slice(0, 120), identity.email, passwordHash, identity.sub)
        const created = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as DbUser
        db.prepare(
          `INSERT INTO privacy_consents (user_id, terms_version, purpose, granted, ip_address, user_agent)
           VALUES (?, ?, 'account_registration', 1, ?, ?)`,
        ).run(created.id, privacyNotice.version, req.ip, req.get('user-agent') ?? null)
        queueMail(created.email, 'Bem-vindo ao ARGOS', 'Sua conta foi criada com o login do Google.')
        logAudit(req, 'auth.registered', 'user', created.id, { provider: 'google', termsVersion: privacyNotice.version })
        return created
      })
    }

    logAudit(req, 'auth.login_succeeded', 'user', user.id, { provider: 'google' })
    res.json(issueSession(res, user))
  }),
)

// Com cookie, o limite é por sessão: em redes com NAT (campus) muitos usuários compartilham o mesmo IP.
const refreshRateSubject = (req: Request) => {
  const token = readCookie(req, refreshCookieName)
  return token ? `session:${hashToken(token)}` : null
}

router.post(
  '/refresh',
  rateLimit(30, 60_000, refreshRateSubject),
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const token = readCookie(req, refreshCookieName)
    if (!token) throw new HttpError(401, 'Sessão expirada.')

    const tokenHash = hashToken(token)
    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash) as RefreshTokenRow | undefined
    if (!row) throw new HttpError(401, 'Sessão inválida.')

    if (row.revoked_at && row.replaced_by_token_hash && Date.now() - sqliteTimestampMs(row.revoked_at) <= refreshRotationGraceMs) {
      // Outra requisição rotacionou este token há instantes: não trata como reuso nem limpa o cookie novo.
      logAudit(req, 'auth.refresh_concurrent', 'refresh_token', row.id)
      throw new HttpError(409, 'Sessão renovada por outra requisição. Tente novamente.')
    }

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
    if (!user.email_verified_at) {
      // Sessões abertas antes da exigência de confirmação não são renovadas.
      revokeAllSessions(user.id)
      clearRefreshCookie(res)
      throw new HttpError(403, emailUnverifiedMessage, { code: 'email_unverified' })
    }

    const refresh = createRefreshToken(user.id)
    db.prepare(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP, replaced_by_token_hash = ? WHERE id = ?',
    ).run(hashToken(refresh.token), row.id)
    setRefreshCookie(res, refresh.token, refresh.expiresAt)
    req.user = user
    logAudit(req, 'auth.refresh_rotated', 'refresh_token', row.id)
    res.json({ user: publicUser(user), token: signToken(user) })
  }),
)

router.post(
  '/logout',
  requireTrustedOrigin,
  asyncHandler(async (req, res) => {
    const token = readCookie(req, refreshCookieName)
    if (token) {
      const row = db
        .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
        .get(hashToken(token)) as RefreshTokenRow | undefined
      if (row) {
        db.prepare(`WITH RECURSIVE family(token_hash, replaced_by_token_hash) AS (
          SELECT token_hash, replaced_by_token_hash FROM refresh_tokens WHERE id = ?
          UNION
          SELECT next.token_hash, next.replaced_by_token_hash FROM refresh_tokens AS next
          JOIN family ON next.token_hash = family.replaced_by_token_hash
        ) UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
          WHERE token_hash IN (SELECT token_hash FROM family)`).run(row.id)
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
        if (existing) throw new HttpError(409, 'Este nickname já está em uso.')
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

router.post(
  '/change-password',
  auth,
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as DbUser
    if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
      logAudit(req, 'auth.password_change_failed', 'user', user.id)
      throw new HttpError(422, 'Senha atual incorreta.')
    }
    if (input.currentPassword === input.newPassword) throw new HttpError(422, 'A nova senha deve ser diferente da atual.')

    const passwordHash = await hashPassword(input.newPassword, 12)
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, user.id)
      // Encerra as demais sessões (outros navegadores/dispositivos) e emite uma nova para esta.
      revokeAllSessions(user.id)
    })()
    logAudit(req, 'auth.password_changed', 'user', user.id)
    queueMail(user.email, 'Senha alterada', 'A senha da sua conta ARGOS foi alterada. Se não foi você, redefina a senha imediatamente.')
    res.json({ ...issueSession(res, user), message: 'Senha alterada. As outras sessões foram encerradas.' })
  }),
)

router.post(
  '/forgot-password',
  rateLimit(5, 60_000),
  requireCaptcha,
  asyncHandler(async (req, res) => {
    const input = emailOnlySchema.parse(req.body)
    const user = db.prepare("SELECT id, email FROM users WHERE LOWER(email) = ? AND status = 'active'").get(input.email) as
      | { id: number; email: string }
      | undefined

    if (user) {
      const token = randomBytes(32).toString('base64url')
      const expiresAt = Date.now() + passwordResetTtlMs
      atomic(() => {
        // Só o link mais recente vale.
        db.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').run(user.id)
        db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
          user.id,
          hashToken(token),
          new Date(expiresAt).toISOString(),
        )
        queueMail(
          user.email,
          'Redefinição de senha',
          `Para criar uma nova senha no ARGOS, acesse: ${frontendLink('/reset-password', token)}\nO link expira em 1 hora. Se não foi você, ignore esta mensagem.`,
          { sensitive: true, expiresAt },
        )
        logAudit(req, 'auth.password_reset_requested', 'user', user.id)
      })
    }

    // Mesma resposta para e-mails cadastrados ou não, para não revelar contas.
    res.status(202).json({ message: 'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.' })
  }),
)

router.post(
  '/reset-password',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = resetPasswordSchema.parse(req.body)
    const reset = db
      .prepare('SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?')
      .get(hashToken(input.token)) as { id: number; user_id: number; expires_at: string; used_at: string | null } | undefined
    if (!reset || reset.used_at || new Date(reset.expires_at).getTime() <= Date.now()) {
      throw new HttpError(400, 'Link de redefinição inválido ou expirado. Solicite um novo.')
    }

    const passwordHash = await hashPassword(input.password, 12)
    const consumed = atomic(() => {
      const changes = db.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL').run(reset.id).changes
      if (!changes) return false
      const before = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(reset.user_id) as { email_verified_at: string | null }
      // Abrir o link recebido por e-mail comprova a posse do endereço.
      db.prepare(
        `UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(passwordHash, reset.user_id)
      db.prepare('UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').run(reset.user_id)
      revokeAllSessions(reset.user_id)
      logAudit(req, 'auth.password_reset', 'user', reset.user_id, { emailVerifiedByReset: !before.email_verified_at })
      return true
    })
    if (!consumed) throw new HttpError(400, 'Link de redefinição inválido ou expirado. Solicite um novo.')

    res.json({ message: 'Senha redefinida. Entre com a nova senha.' })
  }),
)

const removedClaimText = '[removido: conta excluída]'

/**
 * Exclusão de conta: apaga o que é operacional e anonimiza o que precisa permanecer (casos devolvidos,
 * reivindicações em casos de terceiros, trilha de auditoria). O aceite de privacidade recebe um registro de revogação.
 */
function anonymizeAccount(user: Pick<DbUser, 'id' | 'email'>, placeholderHash: string, req: Request) {
  const uploadRoot = resolve(env.UPLOAD_DIR)
  const filesToDelete: string[] = []
  atomic(() => {
    const userId = user.id
    // Reivindicações abertas em casos de terceiros são canceladas e os casos voltam ao status original.
    const openClaims = db
      .prepare("SELECT id, item_id FROM claims WHERE claimant_id = ? AND status IN ('pending', 'approved')")
      .all(userId) as Array<{ id: number; item_id: number }>
    for (const claim of openClaims) {
      db.prepare("UPDATE claims SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(claim.id)
      const item = db.prepare('SELECT owner_id, title, type, status FROM items WHERE id = ?').get(claim.item_id) as {
        owner_id: number
        title: string
        type: string
        status: string
      }
      const stillOpen = db.prepare("SELECT 1 FROM claims WHERE item_id = ? AND status IN ('pending', 'approved') LIMIT 1").get(claim.item_id)
      if (item.status === 'claimed' && !stillOpen) {
        db.prepare('UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.type, claim.item_id)
        logItemHistory(claim.item_id, null, 'item.reopened', { status: item.type })
      }
      // Quem publicou o caso fica sabendo que a solicitação saiu (sem identificar a pessoa).
      if (item.owner_id !== userId) {
        const found = item.type === 'found'
        notify(
          item.owner_id,
          found ? 'Reivindicação cancelada' : 'Informação retirada',
          `Uma ${found ? 'reivindicação' : 'informação privada'} sobre "${item.title}" foi retirada porque a conta de quem enviou foi excluída.`,
          'claim',
          `/items/${claim.item_id}`,
        )
      }
    }

    // Quem reivindicou ou acompanha um caso aberto desta conta é avisado de que ele sai do ar (como na exclusão de um caso).
    const affected = db
      .prepare(
        `SELECT DISTINCT items.id AS item_id, items.title, people.user_id
         FROM items
         JOIN (
           SELECT item_id, claimant_id AS user_id FROM claims WHERE status IN ('pending', 'approved')
           UNION SELECT item_id, user_id FROM favorites
         ) AS people ON people.item_id = items.id
         WHERE items.owner_id = ? AND items.status <> 'returned' AND people.user_id <> ?`,
      )
      .all(userId, userId) as Array<{ item_id: number; title: string; user_id: number }>
    // Mensagens e provas escritas pela pessoa não ficam nos casos de terceiros.
    db.prepare('UPDATE claims SET message = ?, proof_details = ?, updated_at = CURRENT_TIMESTAMP WHERE claimant_id = ?').run(
      removedClaimText,
      removedClaimText,
      userId,
    )

    // Casos ainda abertos saem do ar; devolvidos ficam no histórico, sem vínculo com dados pessoais.
    db.prepare("DELETE FROM items WHERE owner_id = ? AND status <> 'returned'").run(userId)
    for (const entry of affected) {
      notify(entry.user_id, 'Caso removido', `O caso "${entry.title}" foi removido e não está mais disponível.`, 'item_removed')
    }
    db.prepare('DELETE FROM comments WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM saved_searches WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM notification_preferences WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM mobile_operations WHERE user_id = ?').run(userId)
    // Tabelas sem vínculo direto com a conta guardavam o e-mail em texto.
    db.prepare('DELETE FROM access_requests WHERE LOWER(email) = LOWER(?)').run(user.email)
    db.prepare('DELETE FROM mail_outbox WHERE LOWER(to_email) = LOWER(?)').run(user.email)
    db.prepare('UPDATE audit_logs SET entity_id = ? WHERE LOWER(entity_id) = LOWER(?)').run(pseudonymizeEmail(user.email), user.email)
    db.prepare('UPDATE item_reports SET reporter_id = NULL WHERE reporter_id = ?').run(userId)

    // Fotos: as que ainda ilustram casos devolvidos ficam (sem o nome original); as demais são apagadas.
    const uploads = db.prepare('SELECT id, filename, url FROM uploads WHERE user_id = ?').all(userId) as Array<{ id: number; filename: string; url: string }>
    for (const upload of uploads) {
      const referenced = db.prepare('SELECT 1 FROM items WHERE image_url = ? LIMIT 1').get(upload.url)
      if (referenced) {
        db.prepare("UPDATE uploads SET original_name = 'removido' WHERE id = ?").run(upload.id)
        continue
      }
      db.prepare('DELETE FROM uploads WHERE id = ?').run(upload.id)
      const target = resolve(uploadRoot, upload.filename)
      if (/^[\w.-]+$/.test(upload.filename) && dirname(target) === uploadRoot) filesToDelete.push(target)
    }

    // Revogação registrada antes da anonimização: prova de que o consentimento deixou de valer.
    db.prepare(
      `INSERT INTO privacy_consents (user_id, terms_version, purpose, granted, ip_address, user_agent)
       VALUES (?, ?, 'account_registration', 0, ?, ?)`,
    ).run(userId, privacyNotice.version, req.ip, req.get('user-agent') ?? null)
    db.prepare(
      `UPDATE users
       SET name = 'Conta removida', nickname = NULL, email = ?, password_hash = ?, status = 'blocked', google_sub = NULL,
           avatar_url = NULL, phone = NULL, department = NULL, bio = NULL, email_verified_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(`removida+${userId}@argos.invalid`, placeholderHash, userId)
    logAudit(req, 'auth.account_deleted', 'user', userId, { uploadsRemoved: filesToDelete.length })
    afterCommit(() => {
      for (const file of filesToDelete) if (existsSync(file)) unlinkSync(file)
    })
  })
}

router.delete(
  '/me',
  auth,
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const input = deleteAccountSchema.parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as DbUser
    if (!(await verifyPassword(input.password, user.password_hash))) throw new HttpError(422, 'Senha incorreta.')
    if (hasPermission(user.role, 'platform:admin')) {
      throw new HttpError(422, 'Contas de administrador não podem ser excluídas por aqui. Transfira o acesso antes.')
    }

    // Hash de senha aleatória: a conta anonimizada nunca mais consegue entrar.
    anonymizeAccount(user, await hashPassword(randomBytes(24).toString('hex'), 10), req)
    clearRefreshCookie(res)
    res.json({ message: accountDeletedMessage })
  }),
)

export const accountDeletedMessage =
  'Conta excluída. Seus dados pessoais foram apagados ou anonimizados; registros mínimos de segurança e de consentimento ficam guardados sem identificação direta, conforme a política de retenção.'

export { router as authRoutes }
