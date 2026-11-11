import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  bearer,
  refreshCookie,
  resetSubject,
  startHarness,
  userPassword,
  verificationSubject,
  type Harness,
} from './support/harness.js'

let h: Harness
let mail: typeof import('../src/utils/mail.js')
let envModule: typeof import('../src/config/env.js')
let privacyNotice: typeof import('../src/config/privacy-notice.js')['privacyNotice']

beforeAll(async () => {
  h = await startHarness('auth-privacy', { ENABLE_TEST_MAIL_SINK: 'true' })
  mail = await import('../src/utils/mail.js')
  envModule = await import('../src/config/env.js')
  privacyNotice = (await import('../src/config/privacy-notice.js')).privacyNotice
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => h.cleanup())

function captureConsole() {
  const lines: string[] = []
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    })
  }
  return lines
}

async function pngBuffer(color = '#336699') {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: color } }).png().toBuffer()
}

describe('SEC-01 authentication e-mails never leak their links', () => {
  it('delivers reset and verification links without logging them and redacts the stored body after sending', async () => {
    const output = captureConsole()
    await h.registerUnverified('leak-check@example.com')
    await request(app()).post('/api/v1/auth/forgot-password').set('X-Forwarded-For', h.nextIp()).send({ email: 'leak-check@example.com' }).expect(202)
    const verifyToken = h.latestToken('leak-check@example.com', verificationSubject)!
    const resetToken = h.latestToken('leak-check@example.com', resetSubject)!
    expect(verifyToken).toBeTruthy()
    expect(resetToken).toBeTruthy()

    const delivered: Array<{ subject: string; text: string; sensitive: boolean }> = []
    vi.spyOn(mail.mailTransport, 'send').mockImplementation(async (message) => {
      delivered.push(message)
    })
    await mail.processMailOutbox()

    const sent = delivered.filter((message) => message.text.includes(verifyToken) || message.text.includes(resetToken))
    expect(sent).toHaveLength(2)
    expect(sent.every((message) => message.sensitive)).toBe(true)
    // O link vai no fragmento (#), que o navegador não envia ao servidor web nem no Referer.
    expect(sent.every((message) => /\/(verify-email|reset-password)#token=/.test(message.text))).toBe(true)

    const rows = h.db
      .prepare("SELECT status, body FROM mail_outbox WHERE to_email = 'leak-check@example.com'")
      .all() as Array<{ status: string; body: string }>
    expect(rows.every((row) => row.status === 'sent' && row.body === mail.redactedMailBody)).toBe(true)
    expect(output.join('\n')).not.toContain(verifyToken)
    expect(output.join('\n')).not.toContain(resetToken)
    // O link continua funcionando depois que o corpo foi apagado (só o hash está no banco).
    await request(app()).post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'Reset@12345' }).expect(200)
  })

  it('omits authentication bodies from the development console fallback', async () => {
    const output = captureConsole()
    const env = envModule.env as { NODE_ENV: string }
    const previous = env.NODE_ENV
    env.NODE_ENV = 'development'
    try {
      await mail.sendMail('dev-person@example.com', 'Redefinição de senha', 'acesse http://x/reset-password#token=DEV_SECRET_TOKEN', true)
      await mail.sendMail('dev-person@example.com', 'Aviso', 'Conteúdo comum de notificação', false)
    } finally {
      env.NODE_ENV = previous
    }
    const text = output.join('\n')
    expect(text).not.toContain('DEV_SECRET_TOKEN')
    expect(text).not.toContain('dev-person@example.com')
    expect(text).toContain('corpo omitido')
    expect(text).toContain('Conteúdo comum de notificação')
  })

  it('fails safely without a transport in production-like mode and redacts the body on the terminal failure', async () => {
    const output = captureConsole()
    const env = envModule.env as { PRODUCTION_LIKE: boolean }
    const id = mail.queueMail('prod-check@example.com', 'Redefinição de senha', 'acesse http://x/reset-password#token=PROD_SECRET_TOKEN', {
      sensitive: true,
      expiresAt: Date.now() + 60_000,
    })
    env.PRODUCTION_LIKE = true
    try {
      await mail.processMailOutbox()
      const retry = h.db.prepare('SELECT status, attempts, last_error FROM mail_outbox WHERE id = ?').get(id) as { status: string; attempts: number; last_error: string }
      expect(retry).toMatchObject({ status: 'pending', attempts: 1 })
      expect(retry.last_error).toMatch(/não configurado/)
      h.db.prepare('UPDATE mail_outbox SET attempts = 4, next_attempt_at = 0 WHERE id = ?').run(id)
      await mail.processMailOutbox()
    } finally {
      env.PRODUCTION_LIKE = false
    }
    expect(h.db.prepare('SELECT status, body FROM mail_outbox WHERE id = ?').get(id)).toEqual({ status: 'failed', body: mail.redactedMailBody })
    expect(output.join('\n')).not.toContain('PROD_SECRET_TOKEN')
  })

  it('does not send links that already expired and purges processed rows after the retention window', async () => {
    const send = vi.spyOn(mail.mailTransport, 'send').mockResolvedValue(undefined)
    const id = mail.queueMail('expired@example.com', 'Redefinição de senha', 'link #token=EXPIRED_TOKEN', { sensitive: true, expiresAt: Date.now() - 1 })
    await mail.processMailOutbox()
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'expired@example.com' }))
    expect(h.db.prepare('SELECT status, body FROM mail_outbox WHERE id = ?').get(id)).toEqual({ status: 'expired', body: mail.redactedMailBody })

    h.db.prepare("UPDATE mail_outbox SET created_at = datetime('now', '-40 days') WHERE id = ?").run(id)
    const pending = mail.queueMail('pending@example.com', 'Aviso', 'pendente')
    h.db.prepare("UPDATE mail_outbox SET created_at = datetime('now', '-40 days') WHERE id = ?").run(pending)
    expect(mail.purgeMailOutbox(30)).toBeGreaterThanOrEqual(1)
    expect(h.db.prepare('SELECT 1 FROM mail_outbox WHERE id = ?').get(id)).toBeUndefined()
    expect(h.db.prepare('SELECT 1 FROM mail_outbox WHERE id = ?').get(pending)).toBeDefined()
  })

  it('redacts tokens and addresses from transport error messages', () => {
    expect(mail.redactSecrets('550 rejected <ana@example.com> url=http://x/reset#token=abc123&x=1')).toBe('550 rejected <[e-mail]> url=http://x/reset#token=[redigido]&x=1')
  })
})

function app() {
  return h.app
}

describe('SEC-03 e-mail ownership is confirmed before a password account operates', () => {
  it('creates an unverified account without a session and refuses login until confirmation', async () => {
    const { ip, response } = await h.registerUnverified('unverified@example.com')
    expect(response.body).toMatchObject({ verificationRequired: true, email: 'unverified@example.com' })
    expect(response.headers['set-cookie']).toBeUndefined()

    const denied = await request(app()).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: 'unverified@example.com', password: userPassword }).expect(403)
    expect(denied.body.details).toEqual({ code: 'email_unverified' })
    expect(refreshCookie(denied)).toBe('')
    await request(app()).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: 'unverified@example.com', password: 'wrong-pass' }).expect(401)

    const token = h.latestToken('unverified@example.com', verificationSubject)!
    await request(app()).post('/api/v1/auth/verify-email').send({ token: 'x'.repeat(43) }).expect(400)
    await request(app()).post('/api/v1/auth/verify-email').send({ token }).expect(200)
    const reused = await request(app()).post('/api/v1/auth/verify-email').send({ token }).expect(400)
    expect(reused.body.details).toEqual({ code: 'verification_invalid' })

    const session = await h.login('unverified@example.com', userPassword, ip)
    expect(session.response.body.user.emailVerified).toBe(true)
  })

  it('rejects expired links and rate-limits resends per account without revealing accounts', async () => {
    const { id } = await h.registerUnverified('resend@example.com')
    const first = h.latestToken('resend@example.com', verificationSubject)!
    h.db.prepare("UPDATE email_verifications SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run(id)
    await request(app()).post('/api/v1/auth/verify-email').send({ token: first }).expect(400)

    const count = () =>
      (h.db.prepare('SELECT COUNT(*) AS total FROM mail_outbox WHERE to_email = ? AND subject = ?').get('resend@example.com', verificationSubject) as { total: number }).total
    const generic = await request(app()).post('/api/v1/auth/resend-verification').set('X-Forwarded-For', h.nextIp()).send({ email: 'resend@example.com' }).expect(202)
    expect(count()).toBe(1) // dentro do intervalo mínimo de um minuto
    const unknown = await request(app()).post('/api/v1/auth/resend-verification').set('X-Forwarded-For', h.nextIp()).send({ email: 'nobody@example.com' }).expect(202)
    expect(unknown.body.message).toBe(generic.body.message)

    h.db.prepare("UPDATE email_verifications SET created_at = datetime('now', '-2 minutes') WHERE user_id = ?").run(id)
    await request(app()).post('/api/v1/auth/resend-verification').set('X-Forwarded-For', h.nextIp()).send({ email: 'RESEND@example.com' }).expect(202)
    expect(count()).toBe(2)
    const second = h.latestToken('resend@example.com', verificationSubject)!
    expect(second).not.toBe(first)
    await request(app()).post('/api/v1/auth/verify-email').send({ token: second }).expect(200)

    // Limite diário: cinco links por conta em 24 horas.
    const { id: other } = await h.registerUnverified('daily@example.com')
    h.db.prepare("UPDATE email_verifications SET created_at = datetime('now', '-2 hours') WHERE user_id = ?").run(other)
    for (let index = 0; index < 4; index += 1) {
      h.db.prepare("INSERT INTO email_verifications (user_id, token_hash, expires_at, created_at) VALUES (?, ?, '2999-01-01T00:00:00.000Z', datetime('now', '-1 hour'))").run(other, `daily-${index}`)
    }
    const before = (h.db.prepare('SELECT COUNT(*) AS total FROM mail_outbox WHERE to_email = ?').get('daily@example.com') as { total: number }).total
    await request(app()).post('/api/v1/auth/resend-verification').set('X-Forwarded-For', h.nextIp()).send({ email: 'daily@example.com' }).expect(202)
    expect((h.db.prepare('SELECT COUNT(*) AS total FROM mail_outbox WHERE to_email = ?').get('daily@example.com') as { total: number }).total).toBe(before)
  })

  it('treats a completed password reset as proof of ownership', async () => {
    const { ip } = await h.registerUnverified('reset-verifies@example.com')
    await request(app()).post('/api/v1/auth/forgot-password').set('X-Forwarded-For', ip).send({ email: 'reset-verifies@example.com' }).expect(202)
    const token = h.latestToken('reset-verifies@example.com', resetSubject)!
    await request(app()).post('/api/v1/auth/reset-password').send({ token, password: 'Owner@Reset123' }).expect(200)
    const session = await h.login('reset-verifies@example.com', 'Owner@Reset123', ip)
    expect(session.response.body.user.emailVerified).toBe(true)
    // O link de confirmação pendente deixa de valer.
    await request(app()).post('/api/v1/auth/verify-email').send({ token: h.latestToken('reset-verifies@example.com', verificationSubject)! }).expect(400)
  })

  it('invalidates the unproven password when the real owner links Google to a squatted address', async () => {
    const env = envModule.env as { GOOGLE_CLIENT_ID?: string }
    env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com'
    const { googleVerifier } = await import('../src/integrations/google.js')
    vi.spyOn(googleVerifier, 'verify').mockResolvedValue({ sub: 'google-owner', email: 'squatted@example.com', name: 'Dona real', emailVerified: true })
    try {
      const { ip } = await h.registerUnverified('squatted@example.com', 'Squatter@123')
      const linked = await request(app()).post('/api/v1/auth/google').send({ credential: 'google-credential-token-value' }).expect(200)
      expect(linked.body.user.emailVerified).toBe(true)
      await request(app()).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: 'squatted@example.com', password: 'Squatter@123' }).expect(401)
      const audit = h.db.prepare("SELECT metadata FROM audit_logs WHERE action = 'auth.google_linked' ORDER BY id DESC").get() as { metadata: string }
      expect(JSON.parse(audit.metadata)).toEqual({ replacedUnverifiedPassword: true })

      vi.spyOn(googleVerifier, 'verify').mockResolvedValue({ sub: 'another-google', email: 'squatted@example.com', name: 'Outra', emailVerified: true })
      await request(app()).post('/api/v1/auth/google').send({ credential: 'google-credential-token-value' }).expect(401)
    } finally {
      env.GOOGLE_CLIENT_ID = undefined
    }
  })

  it('stops sessions of accounts that are not verified (policy for legacy accounts)', async () => {
    const session = await h.register('legacy-session@example.com')
    h.db.prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?').run(session.id)
    const me = await request(app()).get('/api/v1/auth/me').set(bearer(session.token)).expect(403)
    expect(me.body.details).toEqual({ code: 'email_unverified' })
    await request(app()).post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(403)
    const active = h.db.prepare('SELECT COUNT(*) AS total FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL').get(session.id) as { total: number }
    expect(active.total).toBe(0)
  })

  it('serves test links only through the guarded sink (loopback, .test recipients, test env)', async () => {
    await h.registerUnverified('sink.person@example.test')
    const sink = await request(app()).get('/api/v1/__test__/mail/latest').query({ to: 'sink.person@example.test', kind: 'verification' }).expect(200)
    expect(sink.body.link).toMatch(/\/verify-email#token=/)
    await request(app()).get('/api/v1/__test__/mail/latest').query({ to: 'person@example.com', kind: 'verification' }).expect(422)
  })
})

describe('OPS-02 refresh cookie attributes and CSRF origin check', () => {
  it('issues an HttpOnly SameSite=Lax cookie scoped to /api and rejects cookie use from untrusted origins', async () => {
    const session = await h.register('cookie@example.com')
    const header = (session.response.headers['set-cookie'] as unknown as string[]).find((value) => value.startsWith('argos_refresh='))!
    expect(header).toMatch(/HttpOnly/)
    expect(header).toMatch(/SameSite=Lax/)
    expect(header).toMatch(/Path=\/api/)

    await request(app()).post('/api/v1/auth/refresh').set('Origin', 'https://evil.example').set('Cookie', session.cookie).expect(403)
    await request(app()).post('/api/v1/auth/logout').set('Origin', 'https://evil.example').set('Cookie', session.cookie).expect(403)
    const allowed = await request(app()).post('/api/v1/auth/refresh').set('Origin', 'http://localhost:5173').set('Cookie', session.cookie).expect(200)
    // Cliente nativo (sem Origin) continua renovando.
    await request(app()).post('/api/v1/auth/refresh').set('Cookie', refreshCookie(allowed)).expect(200)
  })
})

describe('AUTH-01 roles without a tenant model fail closed', () => {
  const citizen = ['items:read_public', 'items:create', 'items:update_own', 'claims:create', 'chat:send']

  it.each(['space_manager', 'org_admin', 'support'])('%s gets only personal permissions and no global data', async (role) => {
    const owner = await h.register(`${role}-owner@example.com`)
    const actor = await h.register(`${role}-actor@example.com`)
    h.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, actor.id)

    const itemId = await h.createItem(owner.token, { title: `Carteira ${role}` })
    const claimant = await h.register(`${role}-claimant@example.com`)
    const claim = await request(app()).post(`/api/v1/items/${itemId}/claim`).set(bearer(claimant.token))
      .send({ message: 'Acredito que esta carteira é minha.', proofDetails: 'Tem um cartão da biblioteca dentro.' }).expect(201)
    const hidden = await h.createItem(owner.token, { title: `Oculto ${role}` })
    await request(app()).patch(`/api/v1/admin/items/${hidden}/status`).set(bearer(h.admin.token)).send({ approvalStatus: 'rejected' }).expect(200)

    const me = await request(app()).get('/api/v1/auth/me').set(bearer(actor.token)).expect(200)
    expect(me.body.user.permissions).toEqual(citizen)
    await request(app()).get('/api/v1/reports/items.csv').set(bearer(actor.token)).expect(403)
    const dashboard = await request(app()).get('/api/v1/dashboard').set(bearer(actor.token)).expect(200)
    expect(dashboard.body.scope).toBe('personal')
    expect(dashboard.body.recent).toHaveLength(0)
    const claims = await request(app()).get(`/api/v1/items/${itemId}/claims`).set(bearer(actor.token)).expect(403)
    expect(JSON.stringify(claims.body)).not.toContain('cartão da biblioteca')
    await request(app()).patch(`/api/v1/items/${itemId}/claims/${claim.body.id}/reject`).set(bearer(actor.token)).expect(403)
    await request(app()).patch(`/api/v1/items/${itemId}`).set(bearer(actor.token)).send({ title: 'Invasão' }).expect(403)
    await request(app()).patch(`/api/v1/items/${itemId}/return`).set(bearer(actor.token)).send({}).expect(403)
    await request(app()).delete(`/api/v1/items/${itemId}`).set(bearer(actor.token)).expect(403)
    await request(app()).get(`/api/v1/items/${itemId}/matches`).set(bearer(actor.token)).expect(403)
    await request(app()).get(`/api/v1/items/${hidden}`).set(bearer(actor.token)).expect(404)
    await request(app()).get('/api/v1/admin/users').set(bearer(actor.token)).expect(403)
    await request(app()).get('/api/v1/admin/reports').set(bearer(actor.token)).expect(403)
    await request(app()).get('/api/v1/audit-logs').set(bearer(actor.token)).expect(403)
    const detail = await request(app()).get(`/api/v1/items/${itemId}`).set(bearer(actor.token)).expect(200)
    expect(detail.body.capabilities).toMatchObject({ edit: false, delete: false, return: false, readClaims: false })
    expect(detail.body.item).not.toHaveProperty('owner_id')
  })

  it('does not allow assigning scoped roles while keeping explicit platform administration', async () => {
    const person = await h.register('role-target@example.com')
    for (const role of ['space_manager', 'org_admin', 'support']) {
      await request(app()).patch(`/api/v1/admin/users/${person.id}`).set(bearer(h.admin.token)).send({ role }).expect(422)
    }
    await request(app()).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Pedido suporte', email: 'support-request@example.com', password: userPassword, requestAccess: true }).expect(202)
    const pending = h.db.prepare("SELECT id FROM access_requests WHERE email = 'support-request@example.com'").get() as { id: number }
    await request(app()).patch(`/api/v1/admin/access-requests/${pending.id}`).set(bearer(h.admin.token)).send({ status: 'approved', role: 'support' }).expect(422)
    await request(app()).get('/api/v1/reports/items.csv').set(bearer(h.admin.token)).expect(200)
  })
})

describe('DATA-02 privacy notice version is authoritative on the server', () => {
  it('rejects outdated client versions, records the server version and lets the account accept a new one', async () => {
    const outdated = await request(app()).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Versão antiga', email: 'old-terms@example.com', password: userPassword, privacyTermsAccepted: true, privacyTermsVersion: '2026-08-18' })
      .expect(409)
    expect(outdated.body.details).toEqual({ code: 'terms_outdated', currentVersion: privacyNotice.version })
    expect(h.db.prepare("SELECT 1 FROM users WHERE email = 'old-terms@example.com'").get()).toBeUndefined()

    const session = await h.register('terms@example.com')
    const consent = h.db.prepare('SELECT terms_version, granted FROM privacy_consents WHERE user_id = ?').get(session.id)
    expect(consent).toEqual({ terms_version: privacyNotice.version, granted: 1 })

    const summary = await request(app()).get('/api/v1/privacy/summary').set(bearer(session.token)).expect(200)
    expect(summary.body.data.termsVersion).toBe(privacyNotice.version)
    expect(summary.body.data.consentStatus).toMatchObject({ upToDate: true, acceptedVersion: privacyNotice.version })
    expect(summary.body.data.retention.length).toBeGreaterThan(3)
    // Os direitos exibidos apontam para ações que existem no produto.
    expect(summary.body.data.userRights.join(' ')).toMatch(/Exportar meus dados/)
    expect(summary.body.data.userRights.join(' ')).toMatch(/Excluir conta/)

    h.db.prepare("UPDATE privacy_consents SET terms_version = '2026-08-18' WHERE user_id = ?").run(session.id)
    const stale = await request(app()).get('/api/v1/privacy/summary').set(bearer(session.token)).expect(200)
    expect(stale.body.data.consentStatus.upToDate).toBe(false)
    await request(app()).post('/api/v1/privacy/consents').set(bearer(session.token)).send({ accepted: true, termsVersion: '2026-08-18' }).expect(409)
    const accepted = await request(app()).post('/api/v1/privacy/consents').set(bearer(session.token)).send({ accepted: true, termsVersion: privacyNotice.version }).expect(201)
    expect(accepted.body.consentStatus.upToDate).toBe(true)
    await request(app()).post('/api/v1/privacy/consents').set(bearer(session.token)).send({ accepted: true, termsVersion: privacyNotice.version }).expect(200)
    await request(app()).post('/api/v1/privacy/consents').send({ accepted: true, termsVersion: privacyNotice.version }).expect(401)
  })
})

describe('DATA-01 export and deletion reach every table that holds personal data', () => {
  it('exports and then deletes or anonymizes a registered account across operational tables', async () => {
    const email = 'complete-delete@example.com'
    const person = await h.register(email)
    const owner = await h.register('delete-counterpart@example.com')
    const ip = h.nextIp()

    const upload = async () =>
      (await request(app()).post('/api/v1/uploads').set(bearer(person.token)).attach('file', await pngBuffer(), { filename: 'joao-silva.png', contentType: 'image/png' }).expect(201)).body.url as string
    const returnedPhoto = await upload()
    const unusedPhoto = await upload()
    const avatar = await upload()
    await request(app()).patch('/api/v1/auth/me').set(bearer(person.token)).send({ avatarUrl: avatar, phone: '(11) 90000-0000' }).expect(200)

    const openItem = await h.createItem(person.token, { title: 'Caderno aberto da pessoa' })
    const returnedItem = await h.createItem(person.token, { type: 'lost', title: 'Fone devolvido da pessoa', imageUrl: returnedPhoto })
    await request(app()).patch(`/api/v1/items/${returnedItem}/return`).set(bearer(person.token)).send({}).expect(200)
    const othersItem = await h.createItem(owner.token, { title: 'Casaco de outra pessoa' })
    await request(app()).post(`/api/v1/items/${othersItem}/claim`).set(bearer(person.token))
      .send({ message: 'Este casaco parece ser o meu.', proofDetails: 'Etiqueta com meu nome completo.' }).expect(201)
    await request(app()).post(`/api/v1/items/${othersItem}/comments`).set(bearer(person.token)).send({ body: 'Vi algo parecido no ginásio.' }).expect(201)
    await request(app()).post(`/api/v1/items/${othersItem}/follow`).set(bearer(person.token)).expect(201)
    await request(app()).post(`/api/v1/items/${othersItem}/report`).set(bearer(person.token)).send({ reason: 'Conferir a descrição.' }).expect(201)
    await request(app()).post('/api/v1/saved-searches').set(bearer(person.token)).send({ name: 'Casacos', query: { q: 'casaco' } }).expect(201)
    await request(app()).post('/api/v1/push/subscribe').set(bearer(person.token))
      .send({ endpoint: 'https://push.example.com/sub/delete', keys: { p256dh: 'BPx'.padEnd(87, 'a'), auth: 'auth-secret-1' } }).expect(201)
    await request(app()).post('/api/v1/auth/forgot-password').set('X-Forwarded-For', ip).send({ email }).expect(202)
    await request(app()).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password: 'wrong-pass' }).expect(401)
    h.db.prepare("INSERT INTO access_requests (name, email, reason, status) VALUES ('Pessoa', ?, 'Pedido antigo', 'rejected')").run(email.toUpperCase())
    h.db.prepare("INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ('auth.login_failed', 'user', ?)").run(email)

    const exported = await request(app()).get('/api/v1/privacy/export').set(bearer(person.token)).expect(200)
    expect(exported.headers['cache-control']).toBe('no-store')
    for (const key of ['profile', 'consents', 'accessRequests', 'items', 'itemHistory', 'claims', 'comments', 'reportsFiled', 'following', 'savedSearches', 'notifications', 'emails', 'uploads', 'pushSubscriptions', 'securityEvents']) {
      expect(exported.body).toHaveProperty(key)
    }
    expect(exported.body.accessRequests).toHaveLength(1)
    expect(exported.body.reportsFiled).toHaveLength(1)
    expect(exported.body.emails.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(exported.body)
    expect(serialized).not.toMatch(/password_hash|token_hash|p256dh|#token=|google_sub/)

    const response = await request(app()).delete('/api/v1/auth/me').set(bearer(person.token)).send({ password: userPassword }).expect(200)
    expect(response.body.message).toMatch(/anonimizados/)
    expect(response.body.message).not.toMatch(/foram removidos\.$/)

    const count = (sql: string, ...params: unknown[]) => (h.db.prepare(sql).get(...params) as { total: number }).total
    expect(h.db.prepare('SELECT name, email, phone, avatar_url, email_verified_at FROM users WHERE id = ?').get(person.id)).toEqual({
      name: 'Conta removida', email: `removida+${person.id}@argos.invalid`, phone: null, avatar_url: null, email_verified_at: null,
    })
    expect(count('SELECT COUNT(*) AS total FROM access_requests WHERE LOWER(email) = ?', email)).toBe(0)
    expect(count('SELECT COUNT(*) AS total FROM mail_outbox WHERE LOWER(to_email) = ?', email)).toBe(0)
    expect(count('SELECT COUNT(*) AS total FROM audit_logs WHERE LOWER(entity_id) = ? OR metadata LIKE ?', email, `%${email}%`)).toBe(0)
    for (const table of ['comments', 'favorites', 'saved_searches', 'notifications', 'push_subscriptions', 'email_verifications', 'password_resets', 'refresh_tokens', 'mobile_operations']) {
      expect(count(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ?`, person.id)).toBe(0)
    }
    expect(h.db.prepare('SELECT message, proof_details, status FROM claims WHERE claimant_id = ?').get(person.id)).toEqual({
      message: '[removido: conta excluída]', proof_details: '[removido: conta excluída]', status: 'withdrawn',
    })
    expect(count('SELECT COUNT(*) AS total FROM item_reports WHERE reporter_id = ?', person.id)).toBe(0)
    expect(count('SELECT COUNT(*) AS total FROM item_reports WHERE item_id = ?', othersItem)).toBe(1)
    expect(count('SELECT COUNT(*) AS total FROM items WHERE id = ?', openItem)).toBe(0)
    expect(count('SELECT COUNT(*) AS total FROM items WHERE id = ?', returnedItem)).toBe(1)

    // Foto de caso devolvido fica sem o nome original; as demais saem do banco e do disco.
    const uploads = h.db.prepare('SELECT url, original_name FROM uploads WHERE user_id = ?').all(person.id)
    expect(uploads).toEqual([{ url: returnedPhoto, original_name: 'removido' }])
    const uploadDir = join(h.root, 'uploads')
    expect(existsSync(join(uploadDir, unusedPhoto.split('/').pop()!))).toBe(false)
    expect(existsSync(join(uploadDir, avatar.split('/').pop()!))).toBe(false)
    expect(existsSync(join(uploadDir, returnedPhoto.split('/').pop()!))).toBe(true)

    // O aceite fica como prova e a revogação é registrada.
    const consents = h.db.prepare('SELECT granted FROM privacy_consents WHERE user_id = ? ORDER BY id').all(person.id)
    expect(consents).toEqual([{ granted: 1 }, { granted: 0 }])
    await request(app()).post('/api/v1/auth/login').send({ email, password: userPassword }).expect(401)
  })

  it('removes the access request of an institutionally approved account on deletion', async () => {
    const email = 'approved-person@example.com'
    await request(app()).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Pessoa aprovada', email, password: userPassword, requestAccess: true, reason: 'Funcionária da biblioteca' }).expect(202)
    const pending = h.db.prepare('SELECT id FROM access_requests WHERE email = ?').get(email) as { id: number }
    const approval = await request(app()).patch(`/api/v1/admin/access-requests/${pending.id}`).set(bearer(h.admin.token)).send({ status: 'approved' }).expect(200)
    const session = await h.login(email, approval.body.temporaryPassword)
    await request(app()).delete('/api/v1/auth/me').set(bearer(session.token)).send({ password: approval.body.temporaryPassword }).expect(200)
    expect(h.db.prepare('SELECT 1 FROM access_requests WHERE email = ?').get(email)).toBeUndefined()
  })
})

describe('Retention purge', () => {
  it('removes expired operational records and keeps audit logs by default', async () => {
    const { runRetentionPurge } = await import('../src/utils/retention.js')
    const person = await h.register('retention@example.com')
    h.db.prepare("INSERT INTO password_resets (user_id, token_hash, expires_at, used_at) VALUES (?, 'old-reset', '2000-01-01T00:00:00.000Z', '2000-01-01 00:00:00')").run(person.id)
    h.db.prepare("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, 'valid-reset', '2999-01-01T00:00:00.000Z')").run(person.id)
    h.db.prepare("INSERT INTO access_requests (name, email, status, reviewed_at) VALUES ('Antiga', 'old-request@example.com', 'rejected', '2000-01-01 00:00:00')").run()
    h.db.prepare("INSERT INTO access_requests (name, email, status) VALUES ('Pendente', 'pending-request@example.com', 'pending')").run()
    h.db.prepare("INSERT INTO audit_logs (action, entity_type, created_at) VALUES ('old.event', 'test', '2000-01-01 00:00:00')").run()

    const report = runRetentionPurge()
    expect(report.passwordResets).toBeGreaterThanOrEqual(1)
    expect(report.accessRequests).toBe(1)
    expect(report.auditLogs).toBe(0)
    expect(h.db.prepare("SELECT 1 FROM password_resets WHERE token_hash = 'valid-reset'").get()).toBeDefined()
    expect(h.db.prepare("SELECT 1 FROM access_requests WHERE email = 'pending-request@example.com'").get()).toBeDefined()
    expect(h.db.prepare("SELECT 1 FROM audit_logs WHERE action = 'old.event'").get()).toBeDefined()
  })
})
