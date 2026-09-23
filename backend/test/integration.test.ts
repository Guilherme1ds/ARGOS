import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
