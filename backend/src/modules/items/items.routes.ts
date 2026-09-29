import { Router } from 'express'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { auth, optionalAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { hasPermission } from '../../shared/policies/permissions.js'
import { activeUserIdsWith, logAudit, logItemHistory, notify, notifyFollowers } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { queueMail } from '../../utils/mail.js'
import { ftsPrefixQuery, normalizeKey } from '../../utils/normalization.js'
import { containsPublicSensitiveInfo, publicTextSafetyMessage } from '../../utils/privacy.js'
import { publicNickname } from '../../utils/public-profile.js'
import { assertOwnedUpload } from '../../utils/uploads.js'
import { discoverItemMatches, notifySavedSearches } from './item-matching.js'
import { translateItem, translationLanguages } from '../../integrations/translation.js'

const router = Router()
const publicSearchLimit = env.NODE_ENV === 'development' ? rateLimit(600, 60_000) : rateLimit(60, 60_000)

function todayIsoDate(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use datas no formato YYYY-MM-DD.')
  // Date "rola" dias inexistentes (31/02 vira 03/03); a ida e volta garante que a data existe no calendário.
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Data inválida.')

const eventDateSchema = dateSchema.refine((value) => value <= todayIsoDate(), 'A data do ocorrido não pode ser futura.')

const imageUrlSchema = z.union([z.literal(''), z.string().regex(/^\/uploads\/[\w.-]+$/, 'Use uma imagem enviada pelo ARGOS.')])

function publicText(schema: z.ZodString) {
  return schema.superRefine((value, ctx) => {
    if (containsPublicSensitiveInfo(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: publicTextSafetyMessage })
    }
  })
}

const baseItemSchema = z.object({
  type: z.enum(['lost', 'found']),
  title: publicText(z.string().trim().min(3).max(120)),
  description: publicText(z.string().trim().min(10).max(2000)),
  category: z.string().trim().min(2).max(80).transform((value) => value.replace(/\s+/g, ' ')),
  location: publicText(z.string().trim().min(2).max(120)),
  campusBlock: publicText(z.string().trim().max(60)).optional(),
  approximatePlace: publicText(z.string().trim().max(160)).optional(),
  imageUrl: imageUrlSchema.optional(),
  contactPreference: z.enum(['in_app', 'email']).default('in_app'),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
})

// Latitude e longitude andam juntas: as duas ou nenhuma (null remove a marcação).
function pairedCoordinates<T extends { latitude?: number | null; longitude?: number | null }>(input: T) {
  return (input.latitude === undefined) === (input.longitude === undefined) && (input.latitude === null) === (input.longitude === null)
}
const coordinatesMessage = { message: 'Informe latitude e longitude juntas.', path: ['latitude'] }

const createItemSchema = baseItemSchema
  .extend({
    eventDate: eventDateSchema.default(() => todayIsoDate()),
  })
  .refine(pairedCoordinates, coordinatesMessage)

const updateItemSchema = baseItemSchema
  .partial()
  .extend({
    eventDate: eventDateSchema.optional(),
  })
  .refine(pairedCoordinates, coordinatesMessage)

const translateSchema = z.object({ language: z.enum(translationLanguages) })

// ~11 m de precisão: suficiente para achar o lugar sem expor a posição exata de quem publicou.
function publicCoordinate(value?: number | null) {
  return value == null ? null : Math.round(value * 10_000) / 10_000
}

const searchSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    type: z.enum(['lost', 'found']).optional(),
    category: z.string().trim().max(80).optional(),
    location: z.string().trim().max(120).optional(),
    status: z.enum(['lost', 'found', 'claimed', 'returned']).optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    hasImage: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value ? value === 'true' : undefined)),
    sort: z.enum(['newest', 'oldest', 'event_date_desc', 'event_date_asc']).default('newest'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: 'A data inicial deve ser anterior ou igual à data final.',
    path: ['from'],
  })

const claimSchema = z.object({
  message: z.string().trim().min(10).max(1000),
  proofDetails: z.string().trim().min(10).max(1000),
})

const returnSchema = z.object({
  claimId: z.coerce.number().int().positive().optional(),
})

const commentSchema = z.object({
  body: publicText(z.string().trim().min(1).max(500)),
})

const reportSchema = z.object({
  reason: z.string().trim().min(4).max(500).default('Conteudo suspeito ou inadequado.'),
})

type ItemRow = {
  id: number
  owner_id: number
  owner_name?: string
  owner_nickname?: string | null
  owner_avatar_url?: string | null
  type: 'lost' | 'found'
  title: string
  description: string
  category: string
  category_key: string
  location: string
  location_key: string
  campus_block?: string | null
  approximate_place?: string | null
  event_date: string
  status: 'lost' | 'found' | 'claimed' | 'returned'
  approval_status: 'pending' | 'approved' | 'rejected'
  moderation_note?: string | null
  image_url?: string | null
  contact_preference: 'in_app' | 'email'
  latitude?: number | null
  longitude?: number | null
  created_at: string
  updated_at?: string
}

type CommentRow = {
  id: number
  item_id: number
  user_id: number
  author_name: string
  author_nickname?: string | null
  author_avatar_url?: string | null
  body: string
  created_at: string
}

function absoluteFileUrl(url?: string | null) {
  if (!url || !/^\/uploads\/[\w.-]+$/.test(url)) return null
  return url
}

function publicCommentDto(row: CommentRow) {
  return {
    id: row.id,
    item_id: row.item_id,
    user_id: row.user_id,
    author_name: row.author_name,
    author_nickname: publicNickname({ id: row.user_id, name: row.author_name, nickname: row.author_nickname }),
    author_avatar_url: absoluteFileUrl(row.author_avatar_url),
    body: row.body,
    created_at: row.created_at,
  }
}

type CommentSummary = { count: number; latest: ReturnType<typeof publicCommentDto>[] }

function commentSummaries(itemIds: number[]) {
  const summaries = new Map<number, CommentSummary>()
  if (!itemIds.length) return summaries

  const placeholders = itemIds.map(() => '?').join(', ')
  const counts = db
    .prepare(`SELECT item_id, COUNT(*) AS count FROM comments WHERE item_id IN (${placeholders}) GROUP BY item_id`)
    .all(...itemIds) as Array<{ item_id: number; count: number }>
  for (const itemId of itemIds) summaries.set(itemId, { count: 0, latest: [] })
  for (const row of counts) summaries.get(row.item_id)!.count = row.count

  const latest = db
    .prepare(
      `WITH ranked AS (
         SELECT comments.*, users.name AS author_name,
                users.nickname AS author_nickname, users.avatar_url AS author_avatar_url,
                ROW_NUMBER() OVER (PARTITION BY comments.item_id ORDER BY comments.created_at DESC, comments.id DESC) AS position
         FROM comments
         JOIN users ON users.id = comments.user_id
         WHERE comments.item_id IN (${placeholders})
       )
       SELECT * FROM ranked WHERE position <= 2 ORDER BY item_id, created_at ASC, id ASC`,
    )
    .all(...itemIds) as Array<CommentRow & { position: number }>
  for (const row of latest) summaries.get(row.item_id)!.latest.push(publicCommentDto(row))
  return summaries
}

function publicItemDto(row: ItemRow, comments: CommentSummary = { count: 0, latest: [] }) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    approximate_place: row.approximate_place,
    event_date: row.event_date,
    status: row.status,
    approval_status: row.approval_status,
    image_url: absoluteFileUrl(row.image_url),
    latitude: publicCoordinate(row.latitude),
    longitude: publicCoordinate(row.longitude),
    created_at: row.created_at,
    owner_nickname: publicNickname({ id: row.owner_id, name: row.owner_name, nickname: row.owner_nickname }),
    owner_avatar_url: absoluteFileUrl(row.owner_avatar_url),
    comments_count: comments.count,
    latest_comments: comments.latest,
  }
}

function privateItemDto(row: ItemRow, comments?: CommentSummary) {
  return {
    ...publicItemDto(row, comments),
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    campus_block: row.campus_block,
    contact_preference: row.contact_preference,
    moderation_note: row.moderation_note,
    updated_at: row.updated_at,
  }
}

function buildSearch(input: z.infer<typeof searchSchema>) {
  const clauses = ["items.approval_status = 'approved'"]
  const params: unknown[] = []

  if (input.q) {
    const query = ftsPrefixQuery(input.q)
    clauses.push(query ? 'items.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)' : '0')
    if (query) params.push(query)
  }
  if (input.type) {
    clauses.push('items.type = ?')
    params.push(input.type)
  }
  if (input.category) {
    clauses.push('items.category_key = ?')
    params.push(normalizeKey(input.category))
  }
  if (input.location) {
    const location = ftsPrefixQuery(input.location)
    clauses.push(location ? 'items.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)' : '0')
    if (location) params.push(`{location campus_block approximate_place} : (${location})`)
  }
  if (input.status) {
    clauses.push('items.status = ?')
    params.push(input.status)
  }
  if (input.from) {
    clauses.push('items.event_date >= ?')
    params.push(input.from)
  }
  if (input.to) {
    clauses.push('items.event_date <= ?')
    params.push(input.to)
  }
  if (input.hasImage === true) clauses.push("items.image_url IS NOT NULL AND items.image_url <> ''")
  if (input.hasImage === false) clauses.push("(items.image_url IS NULL OR items.image_url = '')")

  return { where: clauses.join(' AND '), params }
}

function sortSql(sort: z.infer<typeof searchSchema>['sort']) {
  const options = {
    newest: 'items.created_at DESC',
    oldest: 'items.created_at ASC',
    event_date_desc: 'items.event_date DESC',
    event_date_asc: 'items.event_date ASC',
  }
  return options[sort]
}

function canViewPrivateItem(row: ItemRow, user?: Express.Request['user']) {
  return Boolean(user && (row.owner_id === user.id || hasPermission(user.role, 'items:moderate')))
}

const registerReturn = db.transaction((itemId: number, actorId: number, claimId?: number) => {
  const item = db.prepare('SELECT id, owner_id, title, type, status FROM items WHERE id = ?').get(itemId) as
    | { id: number; owner_id: number; title: string; type: 'lost' | 'found'; status: ItemRow['status'] }
    | undefined
  if (!item) throw new HttpError(404, 'Item não encontrado.')
  if (item.status === 'returned') throw new HttpError(409, 'A devolução deste item já foi registrada.')
  if (item.type === 'found' && !claimId) {
    throw new HttpError(422, 'Selecione a reivindicação correspondente ao proprietário antes de registrar a devolução.')
  }

  let selectedClaimantId: number | null = null
  const rejectedClaimants: number[] = []
  if (claimId) {
    const claim = db
      .prepare("SELECT id, claimant_id FROM claims WHERE id = ? AND item_id = ? AND status IN ('pending', 'approved')")
      .get(claimId, item.id) as { id: number; claimant_id: number } | undefined
    if (!claim) throw new HttpError(422, 'Reivindicação inválida para este item.')

    selectedClaimantId = claim.claimant_id
    const rejected = db
      .prepare("SELECT claimant_id FROM claims WHERE item_id = ? AND id <> ? AND status IN ('pending', 'approved')")
      .all(item.id, claim.id) as Array<{ claimant_id: number }>
    rejectedClaimants.push(...rejected.map((entry) => entry.claimant_id))

    // Rejeita concorrentes antes de aprovar a escolhida para respeitar o índice único.
    db.prepare(
      "UPDATE claims SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND id <> ? AND status IN ('pending', 'approved')",
    ).run(item.id, claim.id)
    db.prepare("UPDATE claims SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(claim.id)
  } else {
    const rejected = db
      .prepare("SELECT claimant_id FROM claims WHERE item_id = ? AND status IN ('pending', 'approved')")
      .all(item.id) as Array<{ claimant_id: number }>
    rejectedClaimants.push(...rejected.map((entry) => entry.claimant_id))
    db.prepare(
      "UPDATE claims SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND status IN ('pending', 'approved')",
    ).run(item.id)
  }

  db.prepare("UPDATE items SET status = 'returned', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.id)
  logItemHistory(item.id, actorId, 'item.returned', { claimId: claimId ?? null })
  return { item, selectedClaimantId, rejectedClaimants }
})

// Sem reivindicações abertas, o caso volta a "perdido"/"encontrado" para continuar visível como pendente.
function reopenIfNoOpenClaims(itemId: number, actorId: number) {
  const item = db.prepare('SELECT type, status FROM items WHERE id = ?').get(itemId) as { type: 'lost' | 'found'; status: ItemRow['status'] }
  if (item.status !== 'claimed') return
  const open = db.prepare("SELECT 1 FROM claims WHERE item_id = ? AND status IN ('pending', 'approved') LIMIT 1").get(itemId)
  if (open) return
  db.prepare('UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.type, itemId)
  logItemHistory(itemId, actorId, 'item.reopened', { status: item.type })
}

const closeClaim = db.transaction((itemId: number, claimId: number, status: 'rejected' | 'withdrawn', actorId: number) => {
  const changed = db
    .prepare("UPDATE claims SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND item_id = ? AND status IN ('pending', 'approved')")
    .run(status, claimId, itemId).changes
  if (!changed) throw new HttpError(409, 'Esta reivindicação já foi encerrada.')
  logItemHistory(itemId, actorId, status === 'rejected' ? 'claim.rejected' : 'claim.withdrawn', { claimId })
  reopenIfNoOpenClaims(itemId, actorId)
})

router.get(
  '/search',
  publicSearchLimit,
  asyncHandler(async (req, res) => {
    const input = searchSchema.parse(req.query)
    const { where, params } = buildSearch(input)
    const offset = (input.page - 1) * input.limit
    const total = db.prepare(`SELECT COUNT(*) AS count FROM items WHERE ${where}`).get(...params) as { count: number }
    const items = db
      .prepare(
        `SELECT items.*, users.name AS owner_name, users.nickname AS owner_nickname, users.avatar_url AS owner_avatar_url
         FROM items
         JOIN users ON users.id = items.owner_id
         WHERE ${where}
         ORDER BY ${sortSql(input.sort)}, items.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, offset) as ItemRow[]
    const summaries = commentSummaries(items.map((item) => item.id))

    res.json({
      data: items.map((item) => publicItemDto(item, summaries.get(item.id))),
      meta: { page: input.page, limit: input.limit, total: total.count, sort: input.sort },
    })
  }),
)

router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT items.*, users.name AS owner_name, users.nickname AS owner_nickname, users.avatar_url AS owner_avatar_url
         FROM items
         JOIN users ON users.id = items.owner_id
         WHERE items.owner_id = ?
         ORDER BY items.created_at DESC`,
      )
      .all(req.user!.id) as ItemRow[]
    const summaries = commentSummaries(rows.map((item) => item.id))
    res.json({ data: rows.map((item) => privateItemDto(item, summaries.get(item.id))) })
  }),
)

router.post(
  '/',
  auth,
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const input = createItemSchema.parse(req.body)
    if (!hasPermission(req.user!.role, 'items:create')) throw new HttpError(403, 'Sem permissão para publicar itens.')
    if (req.user!.spam_score >= 5) throw new HttpError(403, 'Usuário com restrição anti-spam.')
    assertOwnedUpload(req.user!.id, input.imageUrl)

    const operationKey = req.header('Idempotency-Key')
    if (operationKey && !/^[a-zA-Z0-9_-]{16,100}$/.test(operationKey)) throw new HttpError(422, 'Chave de operação inválida.')
    const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const existingOperation = operationKey ? db.prepare('SELECT payload_hash, item_id FROM mobile_operations WHERE user_id = ? AND operation_key = ?')
      .get(req.user!.id, operationKey) as { payload_hash: string; item_id: number } | undefined : undefined
    if (existingOperation) {
      if (existingOperation.payload_hash !== payloadHash) throw new HttpError(409, 'Esta operação já foi usada com outros dados. Confira Meus itens.')
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(existingOperation.item_id)) {
        throw new HttpError(409, 'Este item já foi publicado e depois removido.')
      }
      return res.status(200).json({ id: existingOperation.item_id, message: 'Item publicado.', replayed: true })
    }
    const initialStatus = input.type === 'lost' ? 'lost' : 'found'
    const result = db.transaction(() => {
      const inserted = db
      .prepare(
        `INSERT INTO items
        (owner_id, type, title, description, category, category_key, location, location_key, campus_block,
         approximate_place, event_date, status, approval_status, image_url, contact_preference, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
      )
      .run(
        req.user!.id,
        input.type,
        input.title,
        input.description,
        input.category,
        normalizeKey(input.category),
        input.location,
        normalizeKey(input.location),
        input.campusBlock ?? null,
        input.approximatePlace ?? null,
        input.eventDate,
        initialStatus,
        input.imageUrl || null,
        input.contactPreference,
        input.latitude ?? null,
        input.longitude ?? null,
      )
      if (operationKey) db.prepare('INSERT INTO mobile_operations (user_id, operation_key, payload_hash, item_id) VALUES (?, ?, ?, ?)').run(req.user!.id, operationKey, payloadHash, inserted.lastInsertRowid)
      return inserted
    })()
    logItemHistory(Number(result.lastInsertRowid), req.user!.id, 'item.created', {
      approvalStatus: 'approved',
      eventDate: input.eventDate,
    })
    logAudit(req, 'item.created', 'item', result.lastInsertRowid, { approvalStatus: 'approved', eventDate: input.eventDate })
    try {
      discoverItemMatches(Number(result.lastInsertRowid))
    } catch (error) {
      console.error('[item-matching] Falha ao processar correspondências.', error)
    }
    try {
      notifySavedSearches(Number(result.lastInsertRowid))
    } catch (error) {
      console.error('[saved-search] Falha ao processar notificações.', error)
    }
    res.status(201).json({ id: result.lastInsertRowid, message: 'Item publicado.' })
  }),
)

// User-scoped collections must precede /:id.
router.get('/following', auth, asyncHandler(async (req, res) => {
  const input = searchSchema.parse(req.query)
  const visible = "(items.approval_status = 'approved' OR items.owner_id = ?)"
  const rows = db.prepare(`SELECT items.*, users.name AS owner_name, users.nickname AS owner_nickname,
      users.avatar_url AS owner_avatar_url FROM favorites JOIN items ON items.id = favorites.item_id
      JOIN users ON users.id = items.owner_id WHERE favorites.user_id = ? AND ${visible}
      ORDER BY items.id DESC LIMIT ? OFFSET ?`).all(req.user!.id, req.user!.id, input.limit, (input.page - 1) * input.limit) as ItemRow[]
  const count = db.prepare(`SELECT COUNT(*) AS total FROM favorites JOIN items ON items.id = favorites.item_id
      WHERE favorites.user_id = ? AND ${visible}`).get(req.user!.id, req.user!.id) as { total: number }
  res.json({ data: rows.map(row => publicItemDto(row)), meta: { ...count, page: input.page, limit: input.limit } })
}))

router.get('/my-claims', auth, asyncHandler(async (req, res) => {
  const input = searchSchema.parse(req.query)
  const rows = db.prepare(`SELECT claims.id, claims.item_id, claims.status, claims.created_at,
      items.title AS item_title, items.status AS item_status FROM claims JOIN items ON items.id = claims.item_id
      WHERE claims.claimant_id = ? ORDER BY claims.id DESC LIMIT ? OFFSET ?`)
      .all(req.user!.id, input.limit, (input.page - 1) * input.limit)
  const count = db.prepare('SELECT COUNT(*) AS total FROM claims WHERE claimant_id = ?').get(req.user!.id) as { total: number }
  res.json({ data: rows, meta: { ...count, page: input.page, limit: input.limit } })
}))

// Casos aprovados com marcação no mapa (sem paginação: o mapa mostra todos de uma vez).
router.get(
  '/map',
  publicSearchLimit,
  asyncHandler(async (req, res) => {
    const input = z.object({ type: z.enum(['lost', 'found']).optional(), includeReturned: z.enum(['true', 'false']).optional() }).parse(req.query)
    const clauses = ["approval_status = 'approved'", 'latitude IS NOT NULL', 'longitude IS NOT NULL']
    const params: unknown[] = []
    if (input.type) {
      clauses.push('type = ?')
      params.push(input.type)
    }
    if (input.includeReturned !== 'true') clauses.push("status <> 'returned'")
    const rows = db
      .prepare(
        `SELECT id, type, title, category, location, event_date, status, image_url, latitude, longitude
         FROM items WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 500`,
      )
      .all(...params) as Array<Pick<ItemRow, 'id' | 'type' | 'title' | 'category' | 'location' | 'event_date' | 'status' | 'image_url' | 'latitude' | 'longitude'>>
    res.json({
      data: rows.map((row) => ({
        ...row,
        image_url: absoluteFileUrl(row.image_url),
        latitude: publicCoordinate(row.latitude),
        longitude: publicCoordinate(row.longitude),
      })),
    })
  }),
)

router.post(
  '/:id/translate',
  optionalAuth,
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const input = translateSchema.parse(req.body)
    const item = db.prepare('SELECT id, owner_id, title, description, approval_status FROM items WHERE id = ?').get(req.params.id) as
      | Pick<ItemRow, 'id' | 'owner_id' | 'title' | 'description' | 'approval_status'>
      | undefined
    if (!item || (item.approval_status !== 'approved' && !canViewPrivateItem(item as ItemRow, req.user))) {
      throw new HttpError(404, 'Item não encontrado.')
    }
    res.json({ translation: await translateItem(item, input.language) })
  }),
)

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const item = db
      .prepare(
        `SELECT items.*, users.name AS owner_name, users.nickname AS owner_nickname, users.avatar_url AS owner_avatar_url
         FROM items JOIN users ON users.id = items.owner_id
         WHERE items.id = ?`,
      )
      .get(req.params.id) as ItemRow | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')

    const canViewPrivate = canViewPrivateItem(item, req.user)
    if (item.approval_status !== 'approved' && !canViewPrivate) throw new HttpError(404, 'Item não encontrado.')

    const history = canViewPrivate
      ? db.prepare('SELECT id, action, details, created_at FROM item_history WHERE item_id = ? ORDER BY created_at DESC').all(req.params.id)
      : []

    const comments = commentSummaries([item.id]).get(item.id)
    res.json({ item: canViewPrivate ? privateItemDto(item, comments) : publicItemDto(item, comments), history,
      capabilities: {
        edit: canViewPrivate,
        delete: canViewPrivate && (item.status !== 'returned' || Boolean(req.user && hasPermission(req.user.role, 'items:moderate'))),
        return: Boolean(req.user && (item.owner_id === req.user.id || hasPermission(req.user.role, 'items:return')) && item.status !== 'returned'),
        readClaims: Boolean(req.user && (item.owner_id === req.user.id || hasPermission(req.user.role, 'claims:read_private'))),
        claim: Boolean(req.user && item.owner_id !== req.user.id && item.status !== 'returned' && item.approval_status === 'approved' && hasPermission(req.user.role, 'claims:create')),
      },
      following: Boolean(req.user && db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id)),
      myClaim: req.user ? db.prepare("SELECT id, status FROM claims WHERE item_id = ? AND claimant_id = ? AND status IN ('pending', 'approved')").get(item.id, req.user.id) ?? null : null,
    })
  }),
)

router.get(
  '/:id/matches',
  auth,
  asyncHandler(async (req, res) => {
    const source = db.prepare('SELECT id, owner_id FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number }
      | undefined
    if (!source) throw new HttpError(404, 'Item não encontrado.')
    if (source.owner_id !== req.user!.id && !hasPermission(req.user!.role, 'items:moderate')) {
      throw new HttpError(403, 'Sem permissão para ver correspondências deste item.')
    }

    const rows = db
      .prepare(
        `SELECT matched.id, matched.type, matched.title, matched.category, matched.location,
                matched.campus_block, matched.approximate_place, matched.event_date, matched.status,
                matched.image_url, item_matches.score, item_matches.reasons
         FROM item_matches
         JOIN items AS matched ON matched.id = CASE
           WHEN item_matches.item_id = ? THEN item_matches.matched_item_id ELSE item_matches.item_id END
         WHERE (item_matches.item_id = ? OR item_matches.matched_item_id = ?)
           AND matched.approval_status = 'approved'
         ORDER BY item_matches.score DESC, item_matches.created_at DESC`,
      )
      .all(source.id, source.id, source.id) as Array<Record<string, unknown> & { image_url?: string | null; reasons: string }>
    res.json({
      data: rows.map((row) => ({
        ...row,
        image_url: absoluteFileUrl(row.image_url),
        reasons: JSON.parse(row.reasons),
      })),
    })
  }),
)

router.get(
  '/:id/comments',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as ItemRow | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.approval_status !== 'approved' && !canViewPrivateItem(item, req.user)) throw new HttpError(404, 'Item não encontrado.')

    const pagination = searchSchema.parse(req.query)
    const paginated = req.query.page !== undefined
    const rows = db
      .prepare(
        `SELECT comments.*, users.name AS author_name,
                users.nickname AS author_nickname, users.avatar_url AS author_avatar_url
         FROM comments
         JOIN users ON users.id = comments.user_id
         WHERE comments.item_id = ?
         ORDER BY comments.created_at ASC, comments.id ASC ${paginated ? 'LIMIT ? OFFSET ?' : ''}`,
      )
      .all(item.id, ...(paginated ? [pagination.limit, (pagination.page - 1) * pagination.limit] : [])) as CommentRow[]

    const count = db.prepare('SELECT COUNT(*) AS total FROM comments WHERE item_id = ?').get(item.id) as { total: number }
    res.json({ data: rows.map(publicCommentDto), meta: { ...count, page: pagination.page, limit: pagination.limit } })
  }),
)

router.post(
  '/:id/comments',
  auth,
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const input = commentSchema.parse(req.body)
    if (!hasPermission(req.user!.role, 'chat:send')) throw new HttpError(403, 'Sem permissão para enviar pistas públicas.')
    const item = db.prepare('SELECT id, owner_id, title, approval_status FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; approval_status: string }
      | undefined
    if (!item || item.approval_status !== 'approved') throw new HttpError(404, 'Item não encontrado.')

    const result = db.prepare('INSERT INTO comments (item_id, user_id, body) VALUES (?, ?, ?)').run(item.id, req.user!.id, input.body)
    const comment = db
      .prepare(
        `SELECT comments.*, users.name AS author_name,
                users.nickname AS author_nickname, users.avatar_url AS author_avatar_url
         FROM comments
         JOIN users ON users.id = comments.user_id
         WHERE comments.id = ?`,
      )
      .get(result.lastInsertRowid) as CommentRow

    if (item.owner_id !== req.user!.id) {
      notify(item.owner_id, 'Nova pista pública', `O item "${item.title}" recebeu uma pista pública.`, 'clue', `/items/${item.id}`)
    }
    notifyFollowers(item.id, req.user!.id, 'Nova pista em caso acompanhado', `O caso ${item.title} recebeu uma pista pública.`)
    logAudit(req, 'comment.created', 'comment', result.lastInsertRowid, { itemId: item.id })
    res.status(201).json({ comment: publicCommentDto(comment) })
  }),
)

router.post(
  '/:id/report',
  auth,
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = reportSchema.parse(req.body)
    const item = db.prepare('SELECT id, owner_id, title, approval_status FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; approval_status: 'pending' | 'approved' | 'rejected' }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.approval_status !== 'approved' && !canViewPrivateItem(item as ItemRow, req.user)) {
      throw new HttpError(404, 'Item não encontrado.')
    }

    logAudit(req, 'item.reported', 'item', item.id, { reason: input.reason })
    if (item.owner_id !== req.user!.id) {
      notify(item.owner_id, 'Item sinalizado', `O item "${item.title}" recebeu uma sinalização.`, 'report', `/items/${item.id}`)
    }
    for (const moderatorId of activeUserIdsWith('items:moderate')) {
      if (moderatorId === req.user!.id || moderatorId === item.owner_id) continue
      notify(moderatorId, 'Denúncia para revisar', `O caso "${item.title}" foi sinalizado: ${input.reason}`, 'report', `/items/${item.id}`)
    }
    res.status(201).json({ message: 'Sinalização enviada para análise.' })
  }),
)

router.post(
  '/:id/follow',
  auth,
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT id, owner_id, title, approval_status FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; approval_status: 'pending' | 'approved' | 'rejected' }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.approval_status !== 'approved' && !canViewPrivateItem(item as ItemRow, req.user)) {
      throw new HttpError(404, 'Item não encontrado.')
    }

    db.prepare('INSERT OR IGNORE INTO favorites (user_id, item_id) VALUES (?, ?)').run(req.user!.id, item.id)
    logAudit(req, 'item.followed', 'item', item.id)
    res.status(201).json({ message: 'Caso adicionado aos acompanhamentos.' })
  }),
)

router.delete(
  '/:id/follow',
  auth,
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT id, owner_id, approval_status FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; approval_status: 'pending' | 'approved' | 'rejected' }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.approval_status !== 'approved' && !canViewPrivateItem(item as ItemRow, req.user)) {
      throw new HttpError(404, 'Item não encontrado.')
    }

    db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ?').run(req.user!.id, item.id)
    logAudit(req, 'item.unfollowed', 'item', item.id)
    res.json({ message: 'Caso removido dos acompanhamentos.' })
  }),
)

router.get(
  '/:id/claims',
  auth,
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT id, owner_id FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')

    const canReadClaims = item.owner_id === req.user!.id || hasPermission(req.user!.role, 'claims:read_private')
    if (!canReadClaims) throw new HttpError(403, 'Sem permissão para ver reivindicações deste item.')

    const rows = db
      .prepare(
        `SELECT claims.id, claims.item_id, claims.claimant_id, users.name AS claimant_name,
                claims.message, claims.proof_details, claims.status, claims.created_at, claims.updated_at
         FROM claims
         JOIN users ON users.id = claims.claimant_id
         WHERE claims.item_id = ?
         ORDER BY claims.created_at DESC`,
      )
      .all(item.id)

    logAudit(req, 'claims.viewed', 'item', item.id, { count: rows.length })
    res.json({ data: rows })
  }),
)

router.patch(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as ItemRow | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.owner_id !== req.user!.id && !hasPermission(req.user!.role, 'items:moderate')) {
      throw new HttpError(403, 'Sem permissão para editar.')
    }

    const input = updateItemSchema.parse(req.body)
    if (input.type && input.type !== item.type) throw new HttpError(422, 'O tipo do caso não pode ser alterado após a publicação.')
    // Moderadores podem reenviar a imagem atual do autor sem que ela precise pertencer à própria conta.
    if (input.imageUrl !== undefined && input.imageUrl !== (item.image_url ?? '')) assertOwnedUpload(req.user!.id, input.imageUrl)

    const next = {
      title: input.title ?? item.title,
      description: input.description ?? item.description,
      category: input.category ?? item.category,
      location: input.location ?? item.location,
      campusBlock: input.campusBlock === undefined ? item.campus_block : input.campusBlock || null,
      approximatePlace: input.approximatePlace === undefined ? item.approximate_place : input.approximatePlace || null,
      eventDate: input.eventDate ?? item.event_date,
      imageUrl: input.imageUrl === undefined ? item.image_url : input.imageUrl || null,
      contactPreference: input.contactPreference ?? item.contact_preference,
      latitude: input.latitude === undefined ? item.latitude ?? null : input.latitude,
      longitude: input.longitude === undefined ? item.longitude ?? null : input.longitude,
    }
    db.prepare(
      `UPDATE items SET title = ?, description = ?, category = ?, category_key = ?, location = ?, location_key = ?,
       campus_block = ?, approximate_place = ?, event_date = ?, image_url = ?, contact_preference = ?,
       latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(
      next.title,
      next.description,
      next.category,
      normalizeKey(next.category),
      next.location,
      normalizeKey(next.location),
      next.campusBlock,
      next.approximatePlace,
      next.eventDate,
      next.imageUrl,
      next.contactPreference,
      next.latitude,
      next.longitude,
      req.params.id,
    )
    logItemHistory(Number(req.params.id), req.user!.id, 'item.updated', input)
    logAudit(req, 'item.updated', 'item', String(req.params.id), input)
    res.json({ message: 'Item atualizado.' })
  }),
)

router.post(
  '/:id/claim',
  auth,
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = claimSchema.parse(req.body)
    if (!hasPermission(req.user!.role, 'claims:create')) throw new HttpError(403, 'Sem permissão para reivindicar itens.')
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; type: 'lost' | 'found'; status: string; approval_status: string }
      | undefined
    if (!item || item.approval_status !== 'approved') throw new HttpError(404, 'Item não encontrado.')
    if (item.owner_id === req.user!.id) throw new HttpError(422, 'Você não pode reivindicar seu próprio item.')
    if (item.status === 'returned') throw new HttpError(422, 'Item já entregue.')

    const existingClaim = db
      .prepare("SELECT id FROM claims WHERE item_id = ? AND claimant_id = ? AND status IN ('pending', 'approved')")
      .get(item.id, req.user!.id)
    if (existingClaim) throw new HttpError(409, 'Você já possui uma reivindicação aberta para este item.')

    const createClaim = db.transaction(() => {
      const result = db
        .prepare('INSERT INTO claims (item_id, claimant_id, message, proof_details) VALUES (?, ?, ?, ?)')
        .run(item.id, req.user!.id, input.message, input.proofDetails)
      db.prepare("UPDATE items SET status = 'claimed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.id)
      logItemHistory(item.id, req.user!.id, 'claim.created', { claimId: result.lastInsertRowid })
      return result
    })

    let result: ReturnType<typeof createClaim>
    try {
      result = createClaim()
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) {
        throw new HttpError(409, 'Você já possui uma reivindicação aberta para este item.')
      }
      throw error
    }
    logAudit(req, 'claim.created', 'claim', result.lastInsertRowid, { itemId: item.id })
    const isFoundItem = item.type === 'found'
    notify(
      item.owner_id,
      isFoundItem ? 'Nova reivindicação' : 'Nova informação',
      `O item "${item.title}" recebeu ${isFoundItem ? 'uma reivindicação' : 'uma informação privada'}.`,
      'claim',
      `/items/${item.id}`,
    )
    res.status(201).json({ id: result.lastInsertRowid, message: isFoundItem ? 'Reivindicação enviada.' : 'Informação enviada.' })
  }),
)

router.patch(
  '/:id/claims/:claimId/reject',
  auth,
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT id, owner_id, title, status FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; status: ItemRow['status'] }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.owner_id !== req.user!.id && !hasPermission(req.user!.role, 'claims:review')) {
      throw new HttpError(403, 'Sem permissão para avaliar reivindicações deste item.')
    }
    if (item.status === 'returned') throw new HttpError(409, 'A devolução deste item já foi registrada.')

    const claim = db.prepare('SELECT id, claimant_id FROM claims WHERE id = ? AND item_id = ?').get(req.params.claimId, item.id) as
      | { id: number; claimant_id: number }
      | undefined
    if (!claim) throw new HttpError(404, 'Reivindicação não encontrada.')

    closeClaim(item.id, claim.id, 'rejected', req.user!.id)
    notify(claim.claimant_id, 'Reivindicação não aceita', `Sua reivindicação para "${item.title}" não foi aceita pelo responsável.`, 'claim', `/items/${item.id}`)
    logAudit(req, 'claim.rejected', 'claim', claim.id, { itemId: item.id })
    res.json({ message: 'Reivindicação recusada.' })
  }),
)

router.delete(
  '/:id/claim',
  auth,
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT id, owner_id, title, type FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; type: 'lost' | 'found' }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    const claim = db
      .prepare("SELECT id FROM claims WHERE item_id = ? AND claimant_id = ? AND status IN ('pending', 'approved')")
      .get(item.id, req.user!.id) as { id: number } | undefined
    if (!claim) throw new HttpError(404, 'Você não possui reivindicação aberta para este item.')

    closeClaim(item.id, claim.id, 'withdrawn', req.user!.id)
    notify(
      item.owner_id,
      item.type === 'found' ? 'Reivindicação cancelada' : 'Informação retirada',
      `Uma ${item.type === 'found' ? 'reivindicação' : 'informação privada'} sobre "${item.title}" foi cancelada por quem enviou.`,
      'claim',
      `/items/${item.id}`,
    )
    logAudit(req, 'claim.withdrawn', 'claim', claim.id, { itemId: item.id })
    res.json({ message: 'Reivindicação cancelada.' })
  }),
)

router.delete(
  '/:id/comments/:commentId',
  auth,
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const comment = db.prepare('SELECT id, user_id FROM comments WHERE id = ? AND item_id = ?').get(req.params.commentId, req.params.id) as
      | { id: number; user_id: number }
      | undefined
    if (!comment) throw new HttpError(404, 'Pista não encontrada.')
    if (comment.user_id !== req.user!.id && !hasPermission(req.user!.role, 'items:moderate')) {
      throw new HttpError(403, 'Sem permissão para remover esta pista.')
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id)
    logAudit(req, 'comment.deleted', 'comment', comment.id, { itemId: Number(req.params.id), byModerator: comment.user_id !== req.user!.id })
    res.json({ message: 'Pista removida.' })
  }),
)

router.patch(
  '/:id/return',
  auth,
  asyncHandler(async (req, res) => {
    const input = returnSchema.parse(req.body ?? {})
    const item = db.prepare('SELECT id, owner_id FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.owner_id !== req.user!.id && !hasPermission(req.user!.role, 'items:return')) throw new HttpError(403, 'Sem permissão.')

    const result = registerReturn(item.id, req.user!.id, input.claimId)
    if (result.selectedClaimantId) {
      notify(result.selectedClaimantId, 'Reivindicação aprovada', `A devolução de "${result.item.title}" foi confirmada.`, 'claim', `/items/${item.id}`)
    }
    for (const claimantId of new Set(result.rejectedClaimants)) {
      notify(
        claimantId,
        'Reivindicação encerrada',
        result.selectedClaimantId
          ? `Outra reivindicação foi selecionada para "${result.item.title}".`
          : `O caso "${result.item.title}" foi encerrado sem vincular uma reivindicação.`,
        'claim',
        `/items/${item.id}`,
      )
    }
    notifyFollowers(item.id, req.user!.id, 'Caso acompanhado resolvido', `A devolução de ${result.item.title} foi registrada.`)
    logAudit(req, 'item.returned', 'item', item.id, { claimId: input.claimId ?? null })
    queueMail(req.user!.email, 'Devolução registrada', `A devolução de "${result.item.title}" foi registrada.`)
    res.json({ message: 'Devolução registrada.' })
  }),
)

const deleteItem = db.transaction((itemId: number) => {
  const openClaimants = db
    .prepare("SELECT DISTINCT claimant_id FROM claims WHERE item_id = ? AND status IN ('pending', 'approved')")
    .all(itemId) as Array<{ claimant_id: number }>
  const followers = db.prepare('SELECT user_id FROM favorites WHERE item_id = ?').all(itemId) as Array<{ user_id: number }>
  // Tabelas dependentes usam ON DELETE CASCADE; o registro de idempotência é mantido para evitar recriação por replay.
  db.prepare('DELETE FROM items WHERE id = ?').run(itemId)
  return { openClaimants: openClaimants.map((row) => row.claimant_id), followers: followers.map((row) => row.user_id) }
})

router.delete(
  '/:id',
  auth,
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as ItemRow | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    const isOwner = item.owner_id === req.user!.id
    const canModerate = hasPermission(req.user!.role, 'items:moderate')
    if (!isOwner && !canModerate) {
      if (item.approval_status !== 'approved') throw new HttpError(404, 'Item não encontrado.')
      throw new HttpError(403, 'Sem permissão para excluir este item.')
    }
    if (item.status === 'returned' && !canModerate) {
      throw new HttpError(409, 'Casos devolvidos são mantidos no histórico e não podem ser excluídos pelo autor.')
    }

    const result = deleteItem(item.id)
    const recipients = new Set([...result.openClaimants, ...result.followers])
    recipients.delete(req.user!.id)
    for (const userId of recipients) {
      notify(userId, 'Caso removido', `O caso "${item.title}" foi removido e não está mais disponível.`, 'item_removed')
    }
    if (!isOwner) {
      notify(item.owner_id, 'Publicação removida', `O item "${item.title}" foi removido pela moderação.`, 'approval')
    }
    logAudit(req, 'item.deleted', 'item', item.id, {
      title: item.title,
      byModerator: !isOwner,
      openClaims: result.openClaimants.length,
    })
    res.json({ message: 'Item excluído.' })
  }),
)

export { router as itemRoutes }
