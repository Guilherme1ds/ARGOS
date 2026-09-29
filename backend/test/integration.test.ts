import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Express } from 'express'
import type Database from 'better-sqlite3'
import sharp from 'sharp'

const testRoot = join(tmpdir(), `argos-integration-${Date.now()}`)
const adminPassword = 'Admin@Integration123'

let app: Express
let db: Database.Database
const tokens = { owner: '', other: '', claimant: '', admin: '' }
const ids = { owner: 0, other: 0, claimant: 0, admin: 0 }

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

function refreshCookie(response: request.Response) {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = header?.find((entry) => entry.startsWith('argos_refresh='))
  return cookie?.split(';')[0] ?? ''
}

function today() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function itemPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'found',
    title: 'Garrafa térmica azul',
    description: 'Garrafa térmica azul encontrada perto do laboratório.',
    category: 'Outros',
    location: 'Bloco C',
    eventDate: today(),
    ...overrides,
  }
}

async function createItem(token: string, overrides: Record<string, unknown> = {}) {
  const response = await request(app).post('/api/v1/items').set(bearer(token)).send(itemPayload(overrides)).expect(201)
  return Number(response.body.id)
}

let clientIpCounter = 10

async function register(email: string) {
  clientIpCounter += 1
  const response = await request(app)
    .post('/api/v1/auth/register')
    .set('X-Forwarded-For', `198.51.100.${clientIpCounter}`)
    .send({ name: `Pessoa ${email.split('@')[0]}`, email, password: 'Password@123', privacyTermsAccepted: true })
    .expect(201)
  return { token: response.body.token as string, id: response.body.user.id as number, cookie: refreshCookie(response) }
}

function expectSafeError(body: Record<string, unknown>) {
  expect(body.message).toEqual(expect.any(String))
  expect(body.requestId).toEqual(expect.any(String))
  const serialized = JSON.stringify(body)
  expect(serialized).not.toMatch(/password_hash|stack|SQLITE|at \w+ \(/i)
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  // Integrações externas desligadas por padrão, mesmo que o .env local tenha chaves; cada teste liga a sua.
  for (const key of ['ANTHROPIC_API_KEY', 'DEEPL_API_KEY', 'LIBRETRANSLATE_URL', 'GOOGLE_CLIENT_ID', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) {
    process.env[key] = ''
  }
  process.env.SMTP_HOST = ''
  process.env.DATABASE_URL = join(testRoot, 'argos.sqlite')
  process.env.JWT_SECRET = 'integration-secret-with-enough-length'
  process.env.UPLOAD_DIR = join(testRoot, 'uploads')
  process.env.ADMIN_EMAIL = 'admin@argos.local'
  process.env.ADMIN_PASSWORD = adminPassword
  process.env.MAX_UPLOAD_MB = '1'
  // Valor textual para validar o parsing booleano e permitir IPs distintos por cadastro.
  process.env.TRUST_PROXY = 'true'

  app = (await import('../src/app.js')).app
  db = (await import('../src/db/database.js')).db

  for (const name of ['owner', 'other', 'claimant'] as const) {
    const session = await register(`${name}@example.com`)
    tokens[name] = session.token
    ids[name] = session.id
  }
  const admin = await request(app).post('/api/v1/auth/login').send({ email: 'admin@argos.local', password: adminPassword }).expect(200)
  tokens.admin = admin.body.token
  ids.admin = admin.body.user.id
})

afterAll(() => {
  db.close()
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true })
})

describe('HTTP errors', () => {
  it('returns JSON 404 for unknown API routes', async () => {
    const response = await request(app).get('/api/v1/does-not-exist').expect(404)
    expect(response.headers['content-type']).toMatch(/json/)
    expectSafeError(response.body)
  })

  it('returns 400 for malformed JSON and 413 for oversized bodies', async () => {
    const malformed = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400)
    expectSafeError(malformed.body)
    const oversized = await request(app)
      .post('/api/v1/items')
      .set(bearer(tokens.owner))
      .send(itemPayload({ description: 'x'.repeat(1024 * 1024 + 10) }))
      .expect(413)
    expectSafeError(oversized.body)
  })

  it('returns 422 with field errors for invalid payloads and queries', async () => {
    const invalid = await request(app).post('/api/v1/items').set(bearer(tokens.owner)).send({ type: 'stolen' }).expect(422)
    expect(invalid.body.errors.fieldErrors).toHaveProperty('type')
    await request(app).get('/api/v1/items/search?limit=500').expect(422)
    await request(app).get('/api/v1/items/search?from=2026-02-10&to=2026-02-01').expect(422)
    await request(app).get('/api/v1/items/search?from=10/02/2026').expect(422)
    await request(app).get('/api/v1/items/search?page=0').expect(422)
  })

  it('rate limits repeated registrations from the same client with 429 and Retry-After', async () => {
    let limited: request.Response | undefined
    for (let attempt = 0; attempt < 6; attempt += 1) {
      limited = await request(app)
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', '203.0.113.99')
        .send({ name: 'Limite', email: `limit${attempt}@example.com`, password: 'Password@123', privacyTermsAccepted: true })
    }
    expect(limited!.status).toBe(429)
    expect(Number(limited!.headers['retry-after'])).toBeGreaterThan(0)
    expectSafeError(limited!.body)
  })

  it('rejects missing and forged bearer tokens with 401', async () => {
    await request(app).get('/api/v1/auth/me').expect(401)
    const forged = await request(app).get('/api/v1/auth/me').set(bearer('not-a-jwt')).expect(401)
    expectSafeError(forged.body)
  })
})

describe('authentication and sessions', () => {
  it('logs in regardless of e-mail casing and surrounding spaces', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: '  Owner@Example.COM ', password: 'Password@123' })
      .expect(200)
    expect(response.body.user.id).toBe(ids.owner)
    expect(JSON.stringify(response.body)).not.toContain('password_hash')
  })

  it('uses the same response for unknown e-mail and wrong password', async () => {
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'Password@123' }).expect(401)
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'wrong-password' }).expect(401)
    expect(unknown.body.message).toBe(wrong.body.message)
  })

  it('rejects duplicated registration regardless of casing', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Duplicado', email: 'OWNER@example.com', password: 'Password@123', privacyTermsAccepted: true })
      .expect(409)
  })

  it('tolerates concurrent refreshes without revoking the rotated session', async () => {
    const session = await register('concurrent@example.com')
    const [first, second] = await Promise.all([
      request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie),
      request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie),
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])

    const winner = first.status === 200 ? first : second
    const loser = first.status === 200 ? second : first
    expect(refreshCookie(loser)).toBe('')
    await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie(winner)).expect(200)
  })

  it('limits refresh per session so users sharing an IP (NAT) are not logged out', async () => {
    let cookie = (await register('nat@example.com')).cookie
    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await request(app).post('/api/v1/auth/refresh').set('X-Forwarded-For', '203.0.113.50').set('Cookie', cookie).expect(200)
      cookie = refreshCookie(response)
    }
  })

  it('treats replay of an old rotated token as reuse and revokes the family', async () => {
    const session = await register('replay@example.com')
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(200)
    db.prepare("UPDATE refresh_tokens SET revoked_at = datetime('now', '-1 minute') WHERE user_id = ? AND replaced_by_token_hash IS NOT NULL").run(session.id)

    await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401)
    await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie(rotated)).expect(401)
  })
})

describe('items lifecycle and authorization', () => {
  it('edits own items and blocks edits from other citizens', async () => {
    const itemId = await createItem(tokens.owner)
    await request(app).patch(`/api/v1/items/${itemId}`).set(bearer(tokens.owner)).send({ title: 'Garrafa térmica azul-marinho' }).expect(200)
    await request(app).patch(`/api/v1/items/${itemId}`).set(bearer(tokens.other)).send({ title: 'Invasão' }).expect(403)
    await request(app).patch(`/api/v1/items/${itemId}`).set(bearer(tokens.owner)).send({ type: 'lost' }).expect(422)
    await request(app).patch(`/api/v1/items/${itemId}`).set(bearer(tokens.owner)).send({ eventDate: '2999-01-01' }).expect(422)

    const detail = await request(app).get(`/api/v1/items/${itemId}`).expect(200)
    expect(detail.body.item.title).toBe('Garrafa térmica azul-marinho')
    const search = await request(app).get('/api/v1/items/search?q=marinho').expect(200)
    expect(search.body.data.map((item: { id: number }) => item.id)).toContain(itemId)
  })

  it('lets moderators save an item that keeps the author photo', async () => {
    const upload = await request(app)
      .post('/api/v1/uploads')
      .set(bearer(tokens.owner))
      .attach('file', await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123456' } }).png().toBuffer(), {
        filename: 'item.png',
        contentType: 'image/png',
      })
      .expect(201)
    const itemId = await createItem(tokens.owner, { imageUrl: upload.body.url })
    await request(app).patch(`/api/v1/items/${itemId}`).set(bearer(tokens.admin)).send({ title: 'Garrafa revisada', imageUrl: upload.body.url }).expect(200)

    const foreign = await request(app)
      .post('/api/v1/uploads')
      .set(bearer(tokens.other))
      .attach('file', await sharp({ create: { width: 4, height: 4, channels: 3, background: '#654321' } }).png().toBuffer(), {
        filename: 'other.png',
        contentType: 'image/png',
      })
      .expect(201)
    await request(app).patch(`/api/v1/items/${itemId}`).set(bearer(tokens.owner)).send({ imageUrl: foreign.body.url }).expect(422)
  })

  it('deletes items with per-resource authorization and notifies interested users', async () => {
    const itemId = await createItem(tokens.owner, { title: 'Chaveiro com três chaves' })
    await request(app).post(`/api/v1/items/${itemId}/follow`).set(bearer(tokens.other)).expect(201)
    await request(app)
      .post(`/api/v1/items/${itemId}/claim`)
      .set(bearer(tokens.claimant))
      .send({ message: 'Acredito que o chaveiro é meu.', proofDetails: 'Tem um pingente de coruja verde.' })
      .expect(201)

    await request(app).delete(`/api/v1/items/${itemId}`).expect(401)
    await request(app).delete(`/api/v1/items/${itemId}`).set(bearer(tokens.other)).expect(403)
    await request(app).delete(`/api/v1/items/${itemId}`).set(bearer(tokens.owner)).expect(200)
    await request(app).get(`/api/v1/items/${itemId}`).expect(404)
    await request(app).delete(`/api/v1/items/${itemId}`).set(bearer(tokens.owner)).expect(404)

    const claimantNotifications = await request(app).get('/api/v1/notifications').set(bearer(tokens.claimant)).expect(200)
    expect(claimantNotifications.body.data.some((entry: { type: string }) => entry.type === 'item_removed')).toBe(true)
    const followerNotifications = await request(app).get('/api/v1/notifications').set(bearer(tokens.other)).expect(200)
    expect(followerNotifications.body.data.some((entry: { type: string }) => entry.type === 'item_removed')).toBe(true)
    const claims = await request(app).get('/api/v1/items/my-claims').set(bearer(tokens.claimant)).expect(200)
    expect(claims.body.data.some((claim: { item_id: number }) => claim.item_id === itemId)).toBe(false)
  })

  it('hides unapproved items from non-owners on delete and keeps returned cases for authors', async () => {
    const hiddenId = await createItem(tokens.owner)
    await request(app).patch(`/api/v1/admin/items/${hiddenId}/status`).set(bearer(tokens.admin)).send({ approvalStatus: 'rejected' }).expect(200)
    await request(app).delete(`/api/v1/items/${hiddenId}`).set(bearer(tokens.other)).expect(404)

    const lostId = await createItem(tokens.owner, { type: 'lost', title: 'Fone de ouvido branco' })
    await request(app).patch(`/api/v1/items/${lostId}/return`).set(bearer(tokens.owner)).send({}).expect(200)
    await request(app).delete(`/api/v1/items/${lostId}`).set(bearer(tokens.owner)).expect(409)

    await request(app).delete(`/api/v1/items/${lostId}`).set(bearer(tokens.admin)).expect(200)
    const ownerNotifications = await request(app).get('/api/v1/notifications').set(bearer(tokens.owner)).expect(200)
    expect(ownerNotifications.body.data.some((entry: { title: string }) => entry.title === 'Publicação removida')).toBe(true)
  })

  it('does not resurrect a deleted item through an idempotent replay', async () => {
    const key = 'integration-delete-replay-01'
    const created = await request(app).post('/api/v1/items').set(bearer(tokens.owner)).set('Idempotency-Key', key).send(itemPayload()).expect(201)
    await request(app).delete(`/api/v1/items/${created.body.id}`).set(bearer(tokens.owner)).expect(200)
    await request(app).post('/api/v1/items').set(bearer(tokens.owner)).set('Idempotency-Key', key).send(itemPayload()).expect(409)
  })
})

describe('claims and returns', () => {
  it('accepts only one of two concurrent claims from the same user', async () => {
    const itemId = await createItem(tokens.owner, { title: 'Carteira marrom de couro' })
    const claim = { message: 'Esta carteira é minha, perdi ontem.', proofDetails: 'Tem minha carteirinha de estudante.' }
    const responses = await Promise.all([
      request(app).post(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.claimant)).send(claim),
      request(app).post(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.claimant)).send(claim),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])

    await request(app).post(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.owner)).send(claim).expect(422)
    await request(app).patch(`/api/v1/items/${itemId}/return`).set(bearer(tokens.owner)).send({}).expect(422)
    await request(app).patch(`/api/v1/items/${itemId}/return`).set(bearer(tokens.owner)).send({ claimId: 999999 }).expect(422)

    const claims = await request(app).get(`/api/v1/items/${itemId}/claims`).set(bearer(tokens.owner)).expect(200)
    const claimId = claims.body.data[0].id
    const [firstReturn, secondReturn] = await Promise.all([
      request(app).patch(`/api/v1/items/${itemId}/return`).set(bearer(tokens.owner)).send({ claimId }),
      request(app).patch(`/api/v1/items/${itemId}/return`).set(bearer(tokens.owner)).send({ claimId }),
    ])
    expect([firstReturn.status, secondReturn.status].sort()).toEqual([200, 409])
    await request(app).post(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.other)).send(claim).expect(422)

    const notifications = await request(app).get('/api/v1/notifications/unread-count').set(bearer(tokens.claimant)).expect(200)
    expect(notifications.body.total).toBeGreaterThan(0)
    await request(app).post('/api/v1/notifications/read-all').set(bearer(tokens.claimant)).expect(200)
    const afterRead = await request(app).get('/api/v1/notifications/unread-count').set(bearer(tokens.claimant)).expect(200)
    expect(afterRead.body.total).toBe(0)
  })
})

describe('public search pagination', () => {
  it('paginates consistently and never exposes private fields', async () => {
    for (let index = 0; index < 3; index += 1) {
      await createItem(tokens.other, { type: 'lost', title: `Caderno quadriculado ${index}`, category: 'Materiais escolares' })
    }
    const pageOne = await request(app).get('/api/v1/items/search?q=quadriculado&limit=2&page=1').expect(200)
    const pageTwo = await request(app).get('/api/v1/items/search?q=quadriculado&limit=2&page=2').expect(200)
    expect(pageOne.body.meta.total).toBe(3)
    expect(pageOne.body.data).toHaveLength(2)
    expect(pageTwo.body.data).toHaveLength(1)
    const pageIds = [...pageOne.body.data, ...pageTwo.body.data].map((item: { id: number }) => item.id)
    expect(new Set(pageIds).size).toBe(3)

    const filtered = await request(app).get('/api/v1/items/search?q=quadriculado&type=found').expect(200)
    expect(filtered.body.meta.total).toBe(0)
    const byCategory = await request(app).get('/api/v1/items/search?category=materiais%20ESCOLARES&q=quadriculado').expect(200)
    expect(byCategory.body.meta.total).toBe(3)

    for (const item of pageOne.body.data) {
      expect(item).not.toHaveProperty('owner_id')
      expect(item).not.toHaveProperty('owner_email')
      expect(item).not.toHaveProperty('contact_preference')
    }
  })
})

describe('uploads', () => {
  const png = () => sharp({ create: { width: 3, height: 3, channels: 3, background: '#abcdef' } }).png().toBuffer()

  it('rejects unsupported, corrupted, mismatched and multiple files', async () => {
    await request(app).post('/api/v1/uploads').attach('file', await png(), { filename: 'a.png', contentType: 'image/png' }).expect(401)

    const pdf = await request(app)
      .post('/api/v1/uploads')
      .set(bearer(tokens.owner))
      .attach('file', Buffer.from('%PDF-1.7\n'), { filename: 'doc.pdf', contentType: 'application/pdf' })
      .expect(422)
    expect(pdf.body.message).toMatch(/JPEG, PNG ou WebP/)

    const valid = await png()
    const corrupted = Buffer.concat([valid.subarray(0, 24), Buffer.alloc(40, 7)])
    const broken = await request(app)
      .post('/api/v1/uploads')
      .set(bearer(tokens.owner))
      .attach('file', corrupted, { filename: 'broken.png', contentType: 'image/png' })
      .expect(422)
    expect(broken.body.message).toMatch(/corrompida/)

    await request(app)
      .post('/api/v1/uploads')
      .set(bearer(tokens.owner))
      .attach('file', valid, { filename: 'mismatch.jpg', contentType: 'image/jpeg' })
      .expect(422)

    await request(app)
      .post('/api/v1/uploads')
      .set(bearer(tokens.owner))
      .attach('file', valid, { filename: 'one.png', contentType: 'image/png' })
      .attach('file', valid, { filename: 'two.png', contentType: 'image/png' })
      .expect(422)

    await request(app)
      .post('/api/v1/uploads')
      .set(bearer(tokens.owner))
      .attach('other', valid, { filename: 'field.png', contentType: 'image/png' })
      .expect(422)

    await request(app).post('/api/v1/uploads').set(bearer(tokens.owner)).expect(422)
  })

  it('enforces the configured size limit with 413', async () => {
    const response = await request(app)
      .post('/api/v1/uploads')
      .set(bearer(tokens.owner))
      .attach('file', Buffer.alloc(1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' })
      .expect(413)
    expectSafeError(response.body)
  })
})

describe('administration', () => {
  it('restricts admin endpoints to administrators', async () => {
    await request(app).get('/api/v1/admin/users').expect(401)
    await request(app).get('/api/v1/admin/users').set(bearer(tokens.owner)).expect(403)
    await request(app).patch(`/api/v1/admin/users/${ids.owner}`).set(bearer(tokens.owner)).send({ role: 'admin' }).expect(403)
  })

  it('returns 404 for unknown users and prevents self lockout', async () => {
    await request(app).patch('/api/v1/admin/users/999999').set(bearer(tokens.admin)).send({ status: 'blocked' }).expect(404)
    await request(app).patch(`/api/v1/admin/users/${ids.admin}`).set(bearer(tokens.admin)).send({ status: 'blocked' }).expect(422)
    await request(app).patch(`/api/v1/admin/users/${ids.admin}`).set(bearer(tokens.admin)).send({ role: 'citizen' }).expect(422)
  })

  it('blocking a user revokes access and refresh sessions immediately', async () => {
    const session = await register('blocked@example.com')
    await request(app).patch(`/api/v1/admin/users/${session.id}`).set(bearer(tokens.admin)).send({ status: 'blocked' }).expect(200)
    await request(app).get('/api/v1/auth/me').set(bearer(session.token)).expect(401)
    await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401)
    const active = db.prepare('SELECT COUNT(*) AS total FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL').get(session.id) as {
      total: number
    }
    expect(active.total).toBe(0)
    await request(app).post('/api/v1/auth/login').send({ email: 'blocked@example.com', password: 'Password@123' }).expect(403)
  })
})

describe('input hardening', () => {
  it('rejects calendar dates that do not exist', async () => {
    await request(app).get('/api/v1/items/search?from=2026-02-31').expect(422)
    await request(app).get('/api/v1/items/search?to=2026-13-01').expect(422)
    const invalid = await request(app).post('/api/v1/items').set(bearer(tokens.owner)).send(itemPayload({ eventDate: '2025-02-29' })).expect(422)
    expect(invalid.body.errors.fieldErrors).toHaveProperty('eventDate')
    await request(app).post('/api/v1/items').set(bearer(tokens.owner)).send(itemPayload({ eventDate: '2024-02-29' })).expect(201)
  })

  it('echoes safe request ids and replaces unsafe ones', async () => {
    const safe = await request(app).get('/health/live').set('X-Request-Id', 'trace-123:abc').expect(200)
    expect(safe.headers['x-request-id']).toBe('trace-123:abc')
    const unsafe = await request(app).get('/health/live').set('X-Request-Id', 'x'.repeat(300)).expect(200)
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    const injected = await request(app).get('/health/live').set('X-Request-Id', 'a b"<script>').expect(200)
    expect(injected.headers['x-request-id']).not.toContain('<')
  })

  it('accepts only HS256 access tokens', async () => {
    const jwt = (await import('jsonwebtoken')).default
    const forged = jwt.sign({ sub: String(ids.owner), role: 'citizen' }, 'integration-secret-with-enough-length', { algorithm: 'HS512' })
    await request(app).get('/api/v1/auth/me').set(bearer(forged)).expect(401)
  })
})

describe('notifications', () => {
  it('marks a single notification as read only for its owner', async () => {
    const itemId = await createItem(tokens.owner, { title: 'Mochila cinza do laboratório' })
    await request(app).post(`/api/v1/items/${itemId}/comments`).set(bearer(tokens.other)).send({ body: 'Vi uma parecida na cantina.' }).expect(201)

    const list = await request(app).get('/api/v1/notifications').set(bearer(tokens.owner)).expect(200)
    const notification = list.body.data.find((entry: { action_url: string; read_at: string | null }) => entry.action_url === `/items/${itemId}`)
    expect(notification?.read_at).toBeNull()

    const before = await request(app).get('/api/v1/notifications/unread-count').set(bearer(tokens.owner)).expect(200)
    await request(app).patch(`/api/v1/notifications/${notification.id}/read`).set(bearer(tokens.other)).expect(404)
    await request(app).patch(`/api/v1/notifications/${notification.id}/read`).set(bearer(tokens.owner)).expect(200)
    await request(app).patch(`/api/v1/notifications/${notification.id}/read`).set(bearer(tokens.owner)).expect(200)
    await request(app).patch('/api/v1/notifications/abc/read').set(bearer(tokens.owner)).expect(404)
    const after = await request(app).get('/api/v1/notifications/unread-count').set(bearer(tokens.owner)).expect(200)
    expect(after.body.total).toBe(before.body.total - 1)
  })
})

describe('claim lifecycle', () => {
  it('lets the owner reject a claim and reopens the case when no claim is left', async () => {
    const itemId = await createItem(tokens.owner, { title: 'Carteira marrom do auditório' })
    const claim = await request(app).post(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.claimant))
      .send({ message: 'Acredito que esta carteira é minha.', proofDetails: 'Tem um cartão da biblioteca dentro.' }).expect(201)

    await request(app).patch(`/api/v1/items/${itemId}/claims/${claim.body.id}/reject`).set(bearer(tokens.other)).expect(403)
    await request(app).patch(`/api/v1/items/${itemId}/claims/${claim.body.id}/reject`).set(bearer(tokens.owner)).expect(200)
    await request(app).patch(`/api/v1/items/${itemId}/claims/${claim.body.id}/reject`).set(bearer(tokens.owner)).expect(409)

    const detail = await request(app).get(`/api/v1/items/${itemId}`).expect(200)
    expect(detail.body.item.status).toBe('found')
    const notifications = await request(app).get('/api/v1/notifications').set(bearer(tokens.claimant)).expect(200)
    expect(notifications.body.data.some((entry: { title: string }) => entry.title === 'Reivindicação não aceita')).toBe(true)
  })

  it('lets the claimant withdraw and claim again later', async () => {
    const itemId = await createItem(tokens.owner, { title: 'Fone de ouvido branco' })
    const payload = { message: 'Este fone parece ser o meu.', proofDetails: 'Tem um arranhão na caixa.' }
    await request(app).post(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.claimant)).send(payload).expect(201)
    await request(app).delete(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.other)).expect(404)
    await request(app).delete(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.claimant)).expect(200)

    const detail = await request(app).get(`/api/v1/items/${itemId}`).set(bearer(tokens.claimant)).expect(200)
    expect(detail.body.item.status).toBe('found')
    expect(detail.body.myClaim).toBeNull()
    await request(app).post(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.claimant)).send(payload).expect(201)
  })
})

describe('comments moderation', () => {
  it('lets the author or a moderator delete a clue', async () => {
    const itemId = await createItem(tokens.owner, { title: 'Chaveiro com pingente' })
    const first = await request(app).post(`/api/v1/items/${itemId}/comments`).set(bearer(tokens.other)).send({ body: 'Vi um igual no bloco A.' }).expect(201)
    const second = await request(app).post(`/api/v1/items/${itemId}/comments`).set(bearer(tokens.other)).send({ body: 'Talvez na portaria.' }).expect(201)

    await request(app).delete(`/api/v1/items/${itemId}/comments/${first.body.comment.id}`).set(bearer(tokens.claimant)).expect(403)
    await request(app).delete(`/api/v1/items/${itemId}/comments/${first.body.comment.id}`).set(bearer(tokens.other)).expect(200)
    await request(app).delete(`/api/v1/items/${itemId}/comments/${second.body.comment.id}`).set(bearer(tokens.admin)).expect(200)
    await request(app).delete(`/api/v1/items/${itemId}/comments/${second.body.comment.id}`).set(bearer(tokens.admin)).expect(404)
  })

  it('alerts moderators when a case is reported', async () => {
    const itemId = await createItem(tokens.owner, { title: 'Guarda-chuva preto' })
    await request(app).post(`/api/v1/items/${itemId}/report`).set(bearer(tokens.other)).send({ reason: 'Parece anúncio de venda.' }).expect(201)
    const notifications = await request(app).get('/api/v1/notifications').set(bearer(tokens.admin)).expect(200)
    expect(
      notifications.body.data.some((entry: { action_url: string; type: string }) => entry.type === 'report' && entry.action_url === `/items/${itemId}`),
    ).toBe(true)
  })
})

describe('account security', () => {
  it('changes the password and revokes other sessions', async () => {
    const session = await register('change-password@example.com')
    await request(app).post('/api/v1/auth/change-password').set(bearer(session.token))
      .send({ currentPassword: 'wrong-password', newPassword: 'NewPassword@123' }).expect(422)
    const changed = await request(app).post('/api/v1/auth/change-password').set(bearer(session.token))
      .send({ currentPassword: 'Password@123', newPassword: 'NewPassword@123' }).expect(200)
    expect(changed.body.token).toEqual(expect.any(String))

    await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401)
    await request(app).post('/api/v1/auth/login').send({ email: 'change-password@example.com', password: 'Password@123' }).expect(401)
    await request(app).post('/api/v1/auth/login').send({ email: 'change-password@example.com', password: 'NewPassword@123' }).expect(200)
  })

  it('resets a forgotten password with a single-use e-mailed link', async () => {
    await register('forgot@example.com')
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(202)
    const known = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'Forgot@Example.com' }).expect(202)
    expect(known.body.message).toBe(unknown.body.message)

    const mail = db
      .prepare("SELECT body FROM mail_outbox WHERE to_email = 'forgot@example.com' AND subject = 'Redefinição de senha' ORDER BY id DESC")
      .get() as { body: string }
    const token = /token=([\w-]+)/.exec(mail.body)![1]

    await request(app).post('/api/v1/auth/reset-password').send({ token: 'x'.repeat(40), password: 'Reset@12345' }).expect(400)
    await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Reset@12345' }).expect(200)
    await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Another@12345' }).expect(400)
    await request(app).post('/api/v1/auth/login').send({ email: 'forgot@example.com', password: 'Reset@12345' }).expect(200)
  })

  it('exports personal data and anonymizes the account on deletion', async () => {
    const session = await register('leaving@example.com')
    const ownItem = await createItem(session.token, { title: 'Estojo azul de canetas' })
    const othersItem = await createItem(tokens.owner, { title: 'Casaco cinza com capuz' })
    await request(app).post(`/api/v1/items/${othersItem}/claim`).set(bearer(session.token))
      .send({ message: 'Este casaco parece ser meu.', proofDetails: 'Tem meu nome na etiqueta.' }).expect(201)

    const exported = await request(app).get('/api/v1/privacy/export').set(bearer(session.token)).expect(200)
    expect(exported.headers['content-disposition']).toMatch(/attachment/)
    expect(exported.body.profile.email).toBe('leaving@example.com')
    expect(exported.body.items).toHaveLength(1)
    expect(exported.body.claims).toHaveLength(1)
    expect(JSON.stringify(exported.body)).not.toMatch(/password_hash/)

    await request(app).delete('/api/v1/auth/me').set(bearer(session.token)).send({ password: 'wrong' }).expect(422)
    await request(app).delete('/api/v1/auth/me').set(bearer(tokens.admin)).send({ password: adminPassword }).expect(422)
    await request(app).delete('/api/v1/auth/me').set(bearer(session.token)).send({ password: 'Password@123' }).expect(200)

    await request(app).get('/api/v1/auth/me').set(bearer(session.token)).expect(401)
    await request(app).post('/api/v1/auth/login').send({ email: 'leaving@example.com', password: 'Password@123' }).expect(401)
    await request(app).get(`/api/v1/items/${ownItem}`).expect(404)
    const reopened = await request(app).get(`/api/v1/items/${othersItem}`).expect(200)
    expect(reopened.body.item.status).toBe('found')
    const row = db.prepare('SELECT name, email, phone FROM users WHERE id = ?').get(session.id)
    expect(row).toEqual({ name: 'Conta removida', email: `removida+${session.id}@argos.invalid`, phone: null })
    // Permite recadastro com o mesmo e-mail.
    await register('leaving@example.com')
  })
})

describe('notification e-mails', () => {
  function mailsTo(email: string) {
    return db.prepare('SELECT subject, body FROM mail_outbox WHERE to_email = ? ORDER BY id').all(email) as Array<{ subject: string; body: string }>
  }

  it('e-mails important events and respects the opt-out and daily digest preferences', async () => {
    const owner = await register('mail-owner@example.com')
    const itemId = await createItem(owner.token, { title: 'Relógio prateado' })
    const claimBody = { message: 'Este relógio parece ser o meu.', proofDetails: 'Tem uma gravação no verso.' }

    await request(app).post(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.claimant)).send(claimBody).expect(201)
    expect(mailsTo('mail-owner@example.com').filter((mail) => mail.subject === 'ARGOS: Nova reivindicação')).toHaveLength(1)
    expect(mailsTo('mail-owner@example.com').at(-1)!.body).toContain(`/items/${itemId}`)

    // Pistas públicas ficam só no app.
    await request(app).post(`/api/v1/items/${itemId}/comments`).set(bearer(tokens.other)).send({ body: 'Vi um parecido na biblioteca.' }).expect(201)
    expect(mailsTo('mail-owner@example.com').some((mail) => mail.subject.includes('pista'))).toBe(false)

    await request(app).patch('/api/v1/auth/me').set(bearer(owner.token)).send({ notificationPreferences: { digestEnabled: true } }).expect(200)
    await request(app).delete(`/api/v1/items/${itemId}/claim`).set(bearer(tokens.claimant)).expect(200)
    const beforeDigest = mailsTo('mail-owner@example.com').length
    expect(mailsTo('mail-owner@example.com').at(-1)!.subject).toBe('ARGOS: Nova reivindicação')

    const { sendDailyDigests } = await import('../src/utils/mail.js')
    const tomorrow = new Date(Date.now() + 60_000)
    expect(sendDailyDigests(tomorrow)).toBeGreaterThanOrEqual(1)
    const digest = mailsTo('mail-owner@example.com').at(-1)!
    expect(mailsTo('mail-owner@example.com')).toHaveLength(beforeDigest + 1)
    expect(digest.subject).toMatch(/resumo/)
    expect(digest.body).toContain('Reivindicação cancelada')
    // Um resumo por dia.
    sendDailyDigests(tomorrow)
    expect(mailsTo('mail-owner@example.com')).toHaveLength(beforeDigest + 1)
  })
})

describe('external integrations', () => {
  async function loadEnv() {
    return (await import('../src/config/env.js')).env
  }

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  async function uploadPng(token: string) {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#1d4ed8' } }).png().toBuffer()
    const response = await request(app).post('/api/v1/uploads').set(bearer(token)).attach('file', png, { filename: 'item.png', contentType: 'image/png' }).expect(201)
    return response.body.url as string
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    const env = await loadEnv()
    Object.assign(env, {
      ANTHROPIC_API_KEY: undefined,
      DEEPL_API_KEY: undefined,
      GOOGLE_CLIENT_ID: undefined,
      TURNSTILE_SITE_KEY: undefined,
      TURNSTILE_SECRET_KEY: undefined,
    })
  })

  it('exposes only public feature flags in /config', async () => {
    const response = await request(app).get('/api/v1/config').expect(200)
    expect(response.body).toMatchObject({ ai: false, translation: null, googleClientId: null, turnstileSiteKey: null })
    expect(response.body.map.center).toHaveLength(2)
    expect(response.body.push.publicKey).toMatch(/^[\w-]{80,}$/)
    expect(JSON.stringify(response.body)).not.toMatch(/private|secret/i)
    // O par VAPID gerado fica estável entre chamadas (as inscrições dependem dele).
    const again = await request(app).get('/api/v1/config').expect(200)
    expect(again.body.push.publicKey).toBe(response.body.push.publicKey)
  })

  it('stores map coordinates, rounds them publicly and lists them on the map', async () => {
    await request(app).post('/api/v1/items').set(bearer(tokens.owner)).send(itemPayload({ latitude: -23.55 })).expect(422)
    await request(app).post('/api/v1/items').set(bearer(tokens.owner)).send(itemPayload({ latitude: 95, longitude: 10 })).expect(422)
    const itemId = await createItem(tokens.owner, { title: 'Caderno com capa verde', latitude: -23.5505123, longitude: -46.6333987 })

    const detail = await request(app).get(`/api/v1/items/${itemId}`).expect(200)
    expect(detail.body.item).toMatchObject({ latitude: -23.5505, longitude: -46.6334 })
    const map = await request(app).get('/api/v1/items/map').expect(200)
    expect(map.body.data.some((entry: { id: number }) => entry.id === itemId)).toBe(true)

    await request(app).patch(`/api/v1/items/${itemId}`).set(bearer(tokens.owner)).send({ latitude: null, longitude: null }).expect(200)
    const cleared = await request(app).get('/api/v1/items/map').expect(200)
    expect(cleared.body.data.some((entry: { id: number }) => entry.id === itemId)).toBe(false)
  })

  it('translates item content with DeepL and caches the result', async () => {
    const itemId = await createItem(tokens.claimant, { title: 'Estojo azul', description: 'Estojo azul com canetas coloridas e régua.' })
    await request(app).post(`/api/v1/items/${itemId}/translate`).send({ language: 'en-US' }).expect(503)

    const env = await loadEnv()
    env.DEEPL_API_KEY = 'test-key:fx'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://api-free.deepl.com/v2/translate')
      expect(JSON.parse(String(init?.body))).toMatchObject({ target_lang: 'EN-US', text: ['Estojo azul', 'Estojo azul com canetas coloridas e régua.'] })
      return jsonResponse({ translations: [{ text: 'Blue pencil case' }, { text: 'Blue pencil case with colored pens and a ruler.' }] })
    })

    const first = await request(app).post(`/api/v1/items/${itemId}/translate`).send({ language: 'en-US' }).expect(200)
    expect(first.body.translation).toMatchObject({ title: 'Blue pencil case', provider: 'deepl', cached: false })
    const second = await request(app).post(`/api/v1/items/${itemId}/translate`).send({ language: 'en-US' }).expect(200)
    expect(second.body.translation.cached).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    await request(app).post(`/api/v1/items/${itemId}/translate`).send({ language: 'fr-FR' }).expect(422)
  })

  it('suggests item fields from a photo with Claude (structured output + server-side fallback)', async () => {
    const imageUrl = await uploadPng(tokens.owner)
    await request(app).post('/api/v1/ai/describe-item').set(bearer(tokens.owner)).send({ imageUrl }).expect(503)

    const env = await loadEnv()
    env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const suggestion = {
      title: 'Garrafa azul',
      category: 'Outros',
      description: 'Garrafa térmica azul com tampa preta.',
      color: 'azul',
      distinctiveFeatures: ['tampa preta'],
    }
    let sentBody: Record<string, unknown> = {}
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toContain('/v1/messages')
      sentBody = JSON.parse(String(init?.body))
      return jsonResponse({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: JSON.stringify(suggestion) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      })
    })

    const response = await request(app).post('/api/v1/ai/describe-item').set(bearer(tokens.owner)).send({ imageUrl }).expect(200)
    expect(response.body.suggestion).toEqual(suggestion)
    expect(sentBody).toMatchObject({ model: 'claude-opus-5', fallbacks: 'default' })
    expect(JSON.stringify(sentBody)).toContain('"type":"image"')

    // Foto de outra conta não pode ser enviada para a IA.
    await request(app).post('/api/v1/ai/describe-item').set(bearer(tokens.other)).send({ imageUrl }).expect(422)
  })

  it('requires a valid Turnstile token on sign up when the CAPTCHA is configured', async () => {
    const env = await loadEnv()
    env.TURNSTILE_SITE_KEY = 'site-key'
    env.TURNSTILE_SECRET_KEY = 'secret-key'
    const payload = { name: 'Pessoa Captcha', email: 'captcha@example.com', password: 'Password@123', privacyTermsAccepted: true }

    await request(app).post('/api/v1/auth/register').set('X-Forwarded-For', '198.51.100.201').send(payload).expect(422)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ success: false })).mockResolvedValueOnce(jsonResponse({ success: true }))
    await request(app).post('/api/v1/auth/register').set('X-Forwarded-For', '198.51.100.201').send({ ...payload, captchaToken: 'bad' }).expect(422)
    await request(app).post('/api/v1/auth/register').set('X-Forwarded-For', '198.51.100.201').send({ ...payload, captchaToken: 'good' }).expect(201)
    const config = await request(app).get('/api/v1/config').expect(200)
    expect(config.body.turnstileSiteKey).toBe('site-key')
  })

  it('signs in with Google, asking for the privacy terms before creating an account', async () => {
    const env = await loadEnv()
    env.GOOGLE_CLIENT_ID = 'client-id.apps.googleusercontent.com'
    const { googleVerifier } = await import('../src/integrations/google.js')
    const identities: Record<string, { sub: string; email: string; name: string; emailVerified: boolean }> = {
      novo: { sub: 'google-novo', email: 'google.novo@example.com', name: 'Pessoa Google', emailVerified: true },
      dono: { sub: 'google-dono', email: 'owner@example.com', name: 'Dono', emailVerified: true },
      naoverificado: { sub: 'google-x', email: 'x@example.com', name: 'X', emailVerified: false },
    }
    vi.spyOn(googleVerifier, 'verify').mockImplementation(async (credential) => {
      const identity = identities[credential.replace('token-', '').replace(/-+$/, '')]
      if (!identity) throw new Error('invalid')
      return identity
    })
    const credential = (name: string) => `token-${name}`.padEnd(24, '-')

    const needsTerms = await request(app).post('/api/v1/auth/google').send({ credential: credential('novo') }).expect(422)
    expect(needsTerms.body.details).toEqual({ code: 'terms_required' })
    const created = await request(app).post('/api/v1/auth/google').send({ credential: credential('novo'), privacyTermsAccepted: true }).expect(200)
    expect(created.body.user.email).toBe('google.novo@example.com')
    await request(app).post('/api/v1/auth/google').send({ credential: credential('novo') }).expect(200)

    const linked = await request(app).post('/api/v1/auth/google').send({ credential: credential('dono') }).expect(200)
    expect(linked.body.user.id).toBe(ids.owner)
    await request(app).post('/api/v1/auth/google').send({ credential: credential('naoverificado') }).expect(401)
    await request(app).post('/api/v1/auth/google').send({ credential: credential('invalido') }).expect(401)
  })

  it('delivers browser push with each notification and drops expired subscriptions', async () => {
    const webpush = (await import('web-push')).default
    const sendSpy = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} })
    const subscription = { endpoint: 'https://push.example.com/sub/claimant-1', keys: { p256dh: 'BPx'.padEnd(87, 'a'), auth: 'auth-secret-1' } }

    await request(app).post('/api/v1/push/subscribe').set(bearer(tokens.claimant)).send({ ...subscription, endpoint: 'http://insecure.example.com' }).expect(422)
    await request(app).post('/api/v1/push/subscribe').set(bearer(tokens.claimant)).send(subscription).expect(201)

    const itemId = await createItem(tokens.claimant, { title: 'Agenda roxa' })
    await request(app).post(`/api/v1/items/${itemId}/comments`).set(bearer(tokens.other)).send({ body: 'Vi uma agenda assim na biblioteca.' }).expect(201)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const [target, payload] = sendSpy.mock.calls[0]
    expect(target.endpoint).toBe(subscription.endpoint)
    expect(JSON.parse(String(payload))).toMatchObject({ title: 'Nova pista pública', url: `/items/${itemId}` })

    sendSpy.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    await request(app).post('/api/v1/push/test').set(bearer(tokens.claimant)).expect(200)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const remaining = db.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = ?').get(ids.claimant) as { total: number }
    expect(remaining.total).toBe(0)
  })

  it('reports SMTP status on the admin e-mail test', async () => {
    await request(app).post('/api/v1/admin/mail-test').set(bearer(tokens.owner)).expect(403)
    const response = await request(app).post('/api/v1/admin/mail-test').set(bearer(tokens.admin)).expect(200)
    expect(response.body.configured).toBe(false)
  })
})
