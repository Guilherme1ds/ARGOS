import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request, { type Agent } from 'supertest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Express } from 'express'
import sharp from 'sharp'

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

function localIsoDate(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

async function pngBuffer() {
  return sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 90, b: 160 } },
  })
    .png()
    .toBuffer()
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

    const avatarUpload = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', await pngBuffer(), { filename: 'avatar.png', contentType: 'image/png' })
      .expect(201)

    const profile = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Owner Student',
        nickname: 'owner.student',
        avatarUrl: avatarUpload.body.url,
        phone: '(11) 99999-0000',
        department: 'Biblioteca',
        bio: 'Ajudo a reunir itens perdidos no campus.',
        preferredContact: 'email',
        language: 'en-US',
        theme: 'dark',
        timezone: 'UTC',
        dateFormat: 'yyyy-MM-dd',
        compactMode: true,
        highContrast: true,
        notificationPreferences: {
          emailEnabled: false,
          inAppEnabled: true,
          digestEnabled: true,
        },
      })
      .expect(200)

    expect(profile.body.user.name).toBe('Owner Student')
    expect(profile.body.user.nickname).toBe('owner.student')
    expect(profile.body.user.avatarUrl).toBe(avatarUpload.body.url)
    expect(profile.body.user.theme).toBe('dark')
    expect(profile.body.user.compactMode).toBe(true)
    expect(profile.body.user.notificationPreferences.emailEnabled).toBe(false)
    expect(profile.body.user.notificationPreferences.digestEnabled).toBe(true)

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${ownerToken}`).expect(200)
    expect(me.body.user.department).toBe('Biblioteca')
    expect(me.body.user.timezone).toBe('UTC')

    await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${ownerToken}`).expect(403)
    await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${ownerToken}`).expect(403)
  })

  it('handles repeated access requests without a database error', async () => {
    const payload = {
      name: 'Visitor User',
      email: 'visitor@example.com',
      password: 'Password@123',
      requestAccess: true,
      reason: 'Preciso acessar o fluxo institucional.',
    }
    await request(app).post('/api/v1/auth/register').send(payload).expect(202)
    await request(app).post('/api/v1/auth/register').send(payload).expect(202)
  })

  it('allows admin login', async () => {
    const response = await adminAgent
      .post('/api/v1/auth/login')
      .send({ email: 'admin@argos.local', password: 'Admin@Test123' })
      .expect(200)

    adminToken = response.body.token
    expect(response.body.user.permissions).toContain('platform:admin')
  })

  it('publishes items with the real event date', async () => {
    const tomorrow = localIsoDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
    await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'lost',
        title: 'Chave futura',
        description: 'Tentativa com data futura para validacao.',
        category: 'chaves',
        location: 'Campus Central',
        eventDate: tomorrow,
      })
      .expect(422)

    await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'found',
        title: 'Cartao com contato',
        description: 'Achei este item. Meu telefone e (11) 99999-0000 para combinar retirada.',
        category: 'documentos',
        location: 'Campus Central',
      })
      .expect(422)

    const eventDate = localIsoDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
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
        eventDate,
      })
      .expect(201)

    itemId = Number(create.body.id)

    const search = await request(app).get('/api/v1/items/search?q=Carteira').expect(200)
    expect(search.body.data).toHaveLength(1)
    expect(search.body.requestId).toEqual(expect.any(String))
    expect(search.body.data[0].approval_status).toBe('approved')
    expect(search.body.data[0].event_date).toBe(eventDate)
    expect(search.body.data[0].owner_nickname).toBe('owner.student')
    expect(search.body.data[0].owner_avatar_url).toContain('/uploads/')
    expect(search.body.data[0]).not.toHaveProperty('owner_email')
    expect(search.body.data[0]).not.toHaveProperty('owner_id')
  })

  it('hides private history publicly and allows a second user to claim', async () => {
    const publicDetail = await request(app).get(`/api/v1/items/${itemId}`).expect(200)
    expect(publicDetail.body.history).toHaveLength(0)
    expect(publicDetail.body.item).not.toHaveProperty('owner_id')

    await request(app)
      .post(`/api/v1/items/${itemId}/comments`)
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({ body: 'Ainda esta disponivel?' })
      .expect(201)

    const comments = await request(app).get(`/api/v1/items/${itemId}/comments`).expect(200)
    expect(comments.body.data).toHaveLength(1)
    expect(comments.body.data[0].author_name).toBe('claimant')
    expect(comments.body.data[0].author_nickname).toBe('claimant')

    await request(app)
      .post(`/api/v1/items/${itemId}/comments`)
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({ body: 'Pode chamar no telefone (11) 99999-0000.' })
      .expect(422)

    await request(app).post(`/api/v1/items/${itemId}/follow`).set('Authorization', `Bearer ${claimantToken}`).expect(201)
    await request(app).delete(`/api/v1/items/${itemId}/follow`).set('Authorization', `Bearer ${claimantToken}`).expect(200)
    await request(app)
      .post(`/api/v1/items/${itemId}/report`)
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({ reason: 'Publicacao precisa de revisao.' })
      .expect(201)

    const feed = await request(app).get('/api/v1/items/search?q=Carteira').expect(200)
    expect(feed.body.data[0].comments_count).toBe(1)
    expect(feed.body.data[0].latest_comments).toHaveLength(1)

    await request(app)
      .post(`/api/v1/items/${itemId}/claim`)
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({
        message: 'Acredito que este item seja meu.',
        proofDetails: 'Ele tem um compartimento interno especifico.',
      })
      .expect(201)

    await request(app)
      .post(`/api/v1/items/${itemId}/claim`)
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({
        message: 'Tentativa duplicada para o mesmo item.',
        proofDetails: 'Os mesmos detalhes privados da tentativa anterior.',
      })
      .expect(409)

    await request(app).patch(`/api/v1/items/${itemId}/return`).expect(401)
    await request(app).patch(`/api/v1/items/${itemId}/return`).set('Authorization', `Bearer ${claimantToken}`).expect(403)

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

    await request(app).patch(`/api/v1/items/${itemId}/return`).set('Authorization', `Bearer ${ownerToken}`).expect(200)
    const returnedDetail = await request(app).get(`/api/v1/items/${itemId}`).expect(200)
    expect(returnedDetail.body.item.status).toBe('returned')

    const auditLogs = await request(app).get('/api/v1/audit-logs').set('Authorization', `Bearer ${adminToken}`).expect(200)
    expect(auditLogs.body.data.length).toBeGreaterThan(0)
  })

  it('selects exactly one claim when returning a found item', async () => {
    const found = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'found',
        title: 'Fone de ouvido branco',
        description: 'Fone guardado com detalhes privados para confirmar a posse.',
        category: 'Eletrônicos',
        location: 'Campus Central',
        campusBlock: 'Bloco A',
        eventDate: localIsoDate(),
      })
      .expect(201)

    const firstClaim = await request(app)
      .post(`/api/v1/items/${found.body.id}/claim`)
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({ message: 'Acredito que o fone encontrado seja meu.', proofDetails: 'A caixa possui uma pequena marca na lateral.' })
      .expect(201)
    await request(app)
      .post(`/api/v1/items/${found.body.id}/claim`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ message: 'Também posso identificar este fone encontrado.', proofDetails: 'Conheço a inscrição gravada na parte interna.' })
      .expect(201)

    await request(app)
      .patch(`/api/v1/items/${found.body.id}/return`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(422)
    await request(app)
      .patch(`/api/v1/items/${found.body.id}/return`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ claimId: firstClaim.body.id })
      .expect(200)

    const claims = await request(app)
      .get(`/api/v1/items/${found.body.id}/claims`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
    expect(claims.body.data.filter((claim: { status: string }) => claim.status === 'approved')).toHaveLength(1)
    expect(claims.body.data.filter((claim: { status: string }) => claim.status === 'rejected')).toHaveLength(1)
    expect(claims.body.data.find((claim: { id: number }) => claim.id === firstClaim.body.id).status).toBe('approved')
  })

  it('matches opposite cases and notifies saved searches', async () => {
    const saved = await request(app)
      .post('/api/v1/saved-searches')
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({ name: 'Eletrônicos encontrados', query: { type: 'found', category: 'Eletrônicos', location: 'Campus Central' } })
      .expect(201)

    const lost = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${claimantToken}`)
      .send({
        type: 'lost',
        title: 'Notebook prateado',
        description: 'Notebook prateado com adesivo discreto próximo ao teclado.',
        category: 'Eletrônicos',
        location: 'Campus Central',
        campusBlock: 'Bloco B',
        eventDate: localIsoDate(),
      })
      .expect(201)
    const found = await request(app)
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'found',
        title: 'Notebook prateado encontrado',
        description: 'Notebook prateado localizado perto das salas do bloco.',
        category: 'Eletrônicos',
        location: 'Campus Central',
        campusBlock: 'Bloco B',
        eventDate: localIsoDate(),
      })
      .expect(201)

    const matches = await request(app)
      .get(`/api/v1/items/${found.body.id}/matches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
    expect(matches.body.data.some((match: { id: number }) => match.id === Number(lost.body.id))).toBe(true)

    const prefixSearch = await request(app).get('/api/v1/items/search?q=noteb').expect(200)
    expect(prefixSearch.body.data.length).toBeGreaterThanOrEqual(2)
    const locationSearch = await request(app).get('/api/v1/items/search?location=Bloco%20B').expect(200)
    expect(locationSearch.body.data.length).toBeGreaterThanOrEqual(2)

    const notifications = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${claimantToken}`)
      .expect(200)
    expect(notifications.body.data.some((entry: { type: string }) => entry.type === 'saved_search')).toBe(true)
    expect(notifications.body.data.some((entry: { type: string }) => entry.type === 'match')).toBe(true)

    await request(app).patch(`/api/v1/saved-searches/${saved.body.id}`).set('Authorization', `Bearer ${claimantToken}`).send({ enabled: false }).expect(200)
    await request(app).delete(`/api/v1/saved-searches/${saved.body.id}`).set('Authorization', `Bearer ${claimantToken}`).expect(200)
  })

  it('scopes citizen dashboards to their own items', async () => {
    const personal = await request(app).get('/api/v1/dashboard').set('Authorization', `Bearer ${claimantToken}`).expect(200)
    expect(personal.body.scope).toBe('personal')
    expect(personal.body.recent.every((item: { owner_id?: number; title: string }) => !('owner_id' in item) && item.title !== 'Fone de ouvido branco')).toBe(true)

    const organization = await request(app).get('/api/v1/dashboard').set('Authorization', `Bearer ${adminToken}`).expect(200)
    expect(organization.body.scope).toBe('organization')
    expect(organization.body.recent[0]).not.toHaveProperty('moderation_note')
  })

  it('accepts real PNG magic bytes and rejects forged image uploads', async () => {
    const png = await pngBuffer()

    const upload = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', png, { filename: 'item.png', contentType: 'image/png' })
      .expect(201)

    const jpegWithMetadata = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 120, g: 80, b: 40 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const sanitizedJpeg = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', jpegWithMetadata, { filename: 'location.jpg', contentType: 'image/jpeg' })
      .expect(201)
    const sanitizedMetadata = await sharp(join(uploadDir, String(sanitizedJpeg.body.url).split('/').pop()!)).metadata()
    expect(sanitizedMetadata.exif).toBeUndefined()
    expect(sanitizedMetadata.orientation).toBeUndefined()

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
