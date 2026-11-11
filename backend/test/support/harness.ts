import request from 'supertest'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { Express } from 'express'
import type Database from 'better-sqlite3'

export const adminPassword = 'Admin@Harness-2026'
export const userPassword = 'Password@123'
export const verificationSubject = 'Confirme seu e-mail no ARGOS'
export const resetSubject = 'Redefinição de senha'

export type Harness = Awaited<ReturnType<typeof startHarness>>

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export function refreshCookie(response: request.Response) {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = header?.find((entry) => entry.startsWith('argos_refresh='))
  return cookie?.split(';')[0] ?? ''
}

export function today() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

/**
 * Sobe a API com banco e uploads exclusivos em uma pasta temporária e integrações externas desligadas.
 * Cada arquivo de teste roda em processo próprio, então o módulo do app é carregado uma vez por arquivo.
 */
export async function startHarness(name: string, extraEnv: Record<string, string> = {}) {
  const root = join(tmpdir(), `argos-${name}-${Date.now()}-${process.pid}`)
  process.env.NODE_ENV = 'test'
  for (const key of [
    'ANTHROPIC_API_KEY', 'DEEPL_API_KEY', 'LIBRETRANSLATE_URL', 'GOOGLE_CLIENT_ID', 'TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  ]) {
    process.env[key] = ''
  }
  Object.assign(process.env, {
    DATABASE_URL: join(root, 'argos.sqlite'),
    UPLOAD_DIR: join(root, 'uploads'),
    JWT_SECRET: 'harness-secret-with-enough-length-for-tests',
    ADMIN_EMAIL: 'admin@argos.local',
    ADMIN_PASSWORD: adminPassword,
    TRUST_PROXY: '1',
    CORS_ORIGINS: 'http://localhost:5173',
    ENABLE_TEST_MAIL_SINK: 'false',
    ...extraEnv,
  })

  const { app } = (await import('../../src/app.js')) as { app: Express }
  const { db } = (await import('../../src/db/database.js')) as { db: Database.Database }
  let ipCounter = 10

  const nextIp = () => {
    ipCounter += 1
    return `203.0.113.${ipCounter % 250}`
  }

  function latestToken(email: string, subject: string) {
    const mail = db
      .prepare('SELECT body FROM mail_outbox WHERE LOWER(to_email) = LOWER(?) AND subject = ? ORDER BY id DESC')
      .get(email, subject) as { body: string } | undefined
    return mail ? /#token=([\w-]+)/.exec(mail.body)?.[1] : undefined
  }

  async function registerUnverified(email: string, password = userPassword) {
    const ip = nextIp()
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ name: `Pessoa ${email.split('@')[0]}`, email, password, privacyTermsAccepted: true })
      .expect(201)
    return { ip, id: Number(response.body.userId), response }
  }

  async function login(email: string, password = userPassword, ip = nextIp()) {
    const response = await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password }).expect(200)
    return { token: response.body.token as string, id: response.body.user.id as number, cookie: refreshCookie(response), response }
  }

  async function register(email: string, password = userPassword) {
    const { ip } = await registerUnverified(email, password)
    const token = latestToken(email, verificationSubject)!
    await request(app).post('/api/v1/auth/verify-email').set('X-Forwarded-For', ip).send({ token }).expect(200)
    return login(email, password, ip)
  }

  const admin = await login('admin@argos.local', adminPassword)

  async function createItem(token: string, overrides: Record<string, unknown> = {}) {
    const response = await request(app)
      .post('/api/v1/items')
      .set(bearer(token))
      .send({
        type: 'found',
        title: 'Garrafa térmica azul',
        description: 'Garrafa térmica azul encontrada perto do laboratório.',
        category: 'Outros',
        location: 'Bloco C',
        eventDate: today(),
        ...overrides,
      })
      .expect(201)
    return Number(response.body.id)
  }

  function cleanup() {
    db.close()
    // Só remove a pasta criada por este processo, conferindo o caminho absoluto.
    const absolute = resolve(root)
    if (absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes(`argos-${name}-`) && existsSync(absolute)) {
      rmSync(absolute, { recursive: true, force: true })
    }
  }

  return { app, db, root, admin, nextIp, latestToken, registerUnverified, register, login, createItem, cleanup }
}
