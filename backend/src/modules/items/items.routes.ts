import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { auth, optionalAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { hasPermission } from '../../shared/policies/permissions.js'
import { logAudit, logItemHistory, notify } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { queueMail } from '../../utils/mail.js'
import { ftsPrefixQuery, normalizeKey } from '../../utils/normalization.js'
import { containsPublicSensitiveInfo, publicTextSafetyMessage } from '../../utils/privacy.js'
import { assertOwnedUpload } from '../../utils/uploads.js'
import { discoverItemMatches, notifySavedSearches } from './item-matching.js'

const router = Router()
const publicSearchLimit = env.NODE_ENV === 'development' ? rateLimit(600, 60_000) : rateLimit(60, 60_000)

function todayIsoDate(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use datas no formato YYYY-MM-DD.')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'Data inválida.')

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
})

const createItemSchema = baseItemSchema.extend({
  eventDate: eventDateSchema.default(() => todayIsoDate()),
})

const updateItemSchema = baseItemSchema.partial().extend({
  eventDate: eventDateSchema.optional(),
})

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
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(50).default(20),
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

function publicNickname(input: { id: number; name?: string | null; nickname?: string | null }) {
  if (input.nickname?.trim()) return input.nickname.trim()

  const fallback = (input.name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 28)

  return fallback || `usuario.${input.id}`
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
         ORDER BY ${sortSql(input.sort)}
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

    const initialStatus = input.type === 'lost' ? 'lost' : 'found'
    const result = db
      .prepare(
        `INSERT INTO items
        (owner_id, type, title, description, category, category_key, location, location_key, campus_block,
         approximate_place, event_date, status, approval_status, image_url, contact_preference)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
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
      )
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
    res.json({ item: canViewPrivate ? privateItemDto(item, comments) : publicItemDto(item, comments), history })
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

    const rows = db
      .prepare(
        `SELECT comments.*, users.name AS author_name,
                users.nickname AS author_nickname, users.avatar_url AS author_avatar_url
         FROM comments
         JOIN users ON users.id = comments.user_id
         WHERE comments.item_id = ?
         ORDER BY comments.created_at ASC`,
      )
      .all(item.id) as CommentRow[]

    res.json({ data: rows.map(publicCommentDto) })
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
      notify(item.owner_id, 'Nova pista pública', `O item "${item.title}" recebeu uma pista pública.`, 'clue')
    }
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
      notify(item.owner_id, 'Item sinalizado', `O item "${item.title}" recebeu uma sinalização.`, 'report')
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
    if (input.imageUrl !== undefined) assertOwnedUpload(req.user!.id, input.imageUrl)

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
    }
    db.prepare(
      `UPDATE items SET title = ?, description = ?, category = ?, category_key = ?, location = ?, location_key = ?,
       campus_block = ?, approximate_place = ?, event_date = ?, image_url = ?, contact_preference = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
    )
    res.status(201).json({ id: result.lastInsertRowid, message: isFoundItem ? 'Reivindicação enviada.' : 'Informação enviada.' })
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
      notify(result.selectedClaimantId, 'Reivindicação aprovada', `A devolução de "${result.item.title}" foi confirmada.`, 'claim')
    }
    for (const claimantId of new Set(result.rejectedClaimants)) {
      notify(
        claimantId,
        'Reivindicação encerrada',
        result.selectedClaimantId
          ? `Outra reivindicação foi selecionada para "${result.item.title}".`
          : `O caso "${result.item.title}" foi encerrado sem vincular uma reivindicação.`,
        'claim',
      )
    }
    logAudit(req, 'item.returned', 'item', item.id, { claimId: input.claimId ?? null })
    queueMail(req.user!.email, 'Devolução registrada', `A devolução de "${result.item.title}" foi registrada.`)
    res.json({ message: 'Devolução registrada.' })
  }),
)

export { router as itemRoutes }
