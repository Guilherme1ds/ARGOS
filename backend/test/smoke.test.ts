import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request, { type Agent } from 'supertest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Express } from 'express'

const testRoot = join(tmpdir(), `argos-smoke-${Date.now()}`)
const dbPath = join(testRoot, 'argos.sqlite')
const uploadDir = join(testRoot, 'uploads')

let app: Express
let db: { close: () => void }
let ownerAgent: Agent
let claimantAgent: Agent
let adminAgent: Agent
let ownerToken = ''
let claimantToken = ''
let adminToken = ''
let itemId = 0

async function register(agent: Agent, email: string) {
  const response = await agent
    .post('/api/v1/auth/register')
    .send({
      name: email.split('@')[0],
      email,
      password: 'Password@123',
      privacyTermsAccepted: true,
      privacyTermsVersion: '2026-08-18',
    })
    .expect(201)

  return response.body.token as string
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = dbPath
  process.env.JWT_SECRET = 'test-secret-with-more-than-sixteen-chars'
  process.env.JWT_EXPIRES_IN = '15m'
  process.env.REFRESH_TOKEN_EXPIRES_IN = '30d'
  process.env.API_PUBLIC_URL = 'http://localhost:3333'
  process.env.CORS_ORIGINS = 'http://localhost:5173'
  process.env.UPLOAD_DIR = uploadDir
  process.env.ADMIN_EMAIL = 'admin@argos.local'
  process.env.ADMIN_PASSWORD = 'Admin@Test123'

  const appModule = await import('../src/app.js')
  const dbModule = await import('../src/db/database.js')
  app = appModule.app
  db = dbModule.db
  ownerAgent = request.agent(app)
  claimantAgent = request.agent(app)
  adminAgent = request.agent(app)
})

afterAll(() => {
  db.close()
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true })
})

describe('ARGOS smoke flow', () => {
  it('responds to health checks', async () => {
    await request(app).get('/api/health').expect(200)
    await request(app).get('/health/ready').expect(200)
  })

  it('registers users, refreshes sessions and rejects citizen admin access', async () => {
    ownerToken = await register(ownerAgent, 'owner@example.com')
    claimantToken = await register(claimantAgent, 'claimant@example.com')

    const refresh = await ownerAgent.post('/api/v1/auth/refresh').expect(200)
    expect(refresh.body.token).toEqual(expect.any(String))

    await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${ownerToken}`).expect(403)
    await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${ownerToken}`).expect(403)
  })

  it('allows admin login', async () => {
    const response = await adminAgent
      .post('/api/v1/auth/login')
      .send({ email: 'admin@argos.local', password: 'Admin@Test123' })
      .expect(200)

    adminToken = response.body.token
    expect(response.body.user.permissions).toContain('platform:admin')
  })

  it('creates pending items and keeps them out of public search until approval', async () => {
    const create = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'lost',
        title: 'Carteira azul',
        description: 'Carteira azul com detalhes internos para validacao.',
        category: 'documentos',
        location: 'Campus Central',
        approximatePlace: 'Biblioteca',
        eventDate: '2026-08-18',
      })
      .expect(201)

    itemId = Number(create.body.id)

    const pendingSearch = await request(app).get('/api/v1/items/search?q=Carteira').expect(200)
    expect(pendingSearch.body.data).toHaveLength(0)

    await request(app)
      .patch(`/api/v1/admin/items/${itemId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approvalStatus: 'approved' })
      .expect(200)

    const approvedSearch = await request(app).get('/api/v1/items/search?q=Carteira').expect(200)
    expect(approvedSearch.body.data).toHaveLength(1)
    expect(approvedSearch.body.requestId).toEqual(expect.any(String))
    expect(approvedSearch.body.data[0]).not.toHaveProperty('owner_email')
    expect(approvedSearch.body.data[0]).not.toHaveProperty('owner_id')
  })

  it('hides private history publicly and allows a second user to claim', async () => {
    const publicDetail = await request(app).get(`/api/v1/items/${itemId}`).expect(200)
    expect(publicDetail.body.history).toHaveLength(0)
    expect(publicDetail.body.item).not.toHaveProperty('owner_id')

    await request(app)
      .post(`/api/v1/items/${itemId}/claim`)
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({
        message: 'Acredito que este item seja meu.',
        proofDetails: 'Ele tem um compartimento interno especifico.',
      })
      .expect(201)

    await request(app).get(`/api/v1/items/${itemId}/claims`).expect(401)

    const claims = await request(app)
      .get(`/api/v1/items/${itemId}/claims`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
    expect(claims.body.data).toHaveLength(1)
    expect(claims.body.data[0].proof_details).toEqual(expect.any(String))

    const filteredAdminItems = await request(app)
      .get('/api/v1/admin/items?approvalStatus=approved&status=claimed&q=Carteira')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    expect(filteredAdminItems.body.data.some((item: { id: number }) => item.id === itemId)).toBe(true)

    const auditLogs = await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${adminToken}`).expect(200)
    expect(auditLogs.body.data.length).toBeGreaterThan(0)
  })

  it('accepts real PNG magic bytes and rejects forged image uploads', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ])

    const upload = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', png, { filename: 'item.png', contentType: 'image/png' })
      .expect(201)

    await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'found',
        title: 'Mochila preta',
        description: 'Mochila preta com etiqueta interna para validacao.',
        category: 'bolsas',
        location: 'Campus Central',
        approximatePlace: 'Recepcao',
        eventDate: '2026-08-18',
        imageUrl: upload.body.url,
      })
      .expect(201)

    await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', Buffer.from('not an image'), { filename: 'fake.png', contentType: 'image/png' })
      .expect(422)
  })

  it('revokes refresh token on logout', async () => {
    await ownerAgent.post('/api/v1/auth/logout').expect(200)
    await ownerAgent.post('/api/v1/auth/refresh').expect(401)
  })
})
