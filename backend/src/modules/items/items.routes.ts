import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { auth, optionalAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { hasPermission } from '../../shared/policies/permissions.js'
import { logAudit, logItemHistory, notify } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { sendMail } from '../../utils/mail.js'
import { containsPublicSensitiveInfo, publicTextSafetyMessage } from '../../utils/privacy.js'

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

const postingDateSchema = dateSchema.refine((value) => value <= todayIsoDate(), 'A data da publicacao nao pode ser futura.')

const imageUrlSchema = z.union([
  z.literal(''),
  z.string().url(),
  z.string().regex(/^\/uploads\/[\w.-]+$/, 'Use uma imagem enviada pelo ARGOS.'),
])

function publicText(schema: z.ZodString) {
  return schema.superRefine((value, ctx) => {
    if (containsPublicSensitiveInfo(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: publicTextSafetyMessage })
    }
  })
}

const itemSchema = z.object({
  type: z.enum(['lost', 'found']),
  title: publicText(z.string().trim().min(3).max(120)),
  description: publicText(z.string().trim().min(10).max(2000)),
  category: z.string().trim().min(2).max(80),
  location: publicText(z.string().trim().min(2).max(120)),
  campusBlock: publicText(z.string().trim().max(60)).optional(),
  approximatePlace: publicText(z.string().trim().max(160)).optional(),
  eventDate: postingDateSchema.optional(),
  imageUrl: imageUrlSchema.optional(),
  contactPreference: z.enum(['in_app', 'email']).default('in_app'),
})

const searchSchema = z
  .object({
    q: z.string().trim().optional(),
    type: z.enum(['lost', 'found']).optional(),
    category: z.string().trim().optional(),
    location: z.string().trim().optional(),
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
  message: z.string().min(10).max(1000),
  proofDetails: z.string().min(10).max(1000),
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
  location: string
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
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  return `${env.API_PUBLIC_URL.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`
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

function commentsCount(itemId: number) {
  return (db.prepare('SELECT COUNT(*) AS count FROM comments WHERE item_id = ?').get(itemId) as { count: number }).count
}

function latestComments(itemId: number) {
  const rows = db
    .prepare(
      `SELECT comments.*, users.name AS author_name,
              users.nickname AS author_nickname, users.avatar_url AS author_avatar_url
       FROM comments
       JOIN users ON users.id = comments.user_id
       WHERE comments.item_id = ?
       ORDER BY comments.created_at DESC
       LIMIT 2`,
    )
    .all(itemId) as CommentRow[]

  return rows.reverse().map(publicCommentDto)
}

function publicItemDto(row: ItemRow) {
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
    comments_count: commentsCount(row.id),
    latest_comments: latestComments(row.id),
  }
}

function privateItemDto(row: ItemRow) {
  return {
    ...publicItemDto(row),
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
    const query = `%${input.q.toLowerCase()}%`
    clauses.push('(LOWER(items.title) LIKE ? OR LOWER(items.description) LIKE ? OR LOWER(items.category) LIKE ?)')
    params.push(query, query, query)
  }
  if (input.type) {
    clauses.push('items.type = ?')
    params.push(input.type)
  }
  if (input.category) {
    clauses.push('LOWER(items.category) = LOWER(?)')
    params.push(input.category)
  }
  if (input.location) {
    const location = `%${input.location.toLowerCase()}%`
    clauses.push('(LOWER(items.location) LIKE ? OR LOWER(items.campus_block) LIKE ? OR LOWER(items.approximate_place) LIKE ?)')
    params.push(location, location, location)
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

    res.json({
      data: items.map(publicItemDto),
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
    res.json({ data: rows.map(privateItemDto) })
  }),
)

router.post(
  '/',
  auth,
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const input = itemSchema.parse(req.body)
    if (!hasPermission(req.user!.role, 'items:create')) throw new HttpError(403, 'Sem permissão para publicar itens.')
    if (req.user!.spam_score >= 5) throw new HttpError(403, 'Usuário com restrição anti-spam.')

    const initialStatus = input.type === 'lost' ? 'lost' : 'found'
    const postingDate = todayIsoDate()
    const result = db
      .prepare(
        `INSERT INTO items
        (owner_id, type, title, description, category, location, campus_block, approximate_place, event_date, status, approval_status, image_url, contact_preference)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
      )
      .run(
        req.user!.id,
        input.type,
        input.title,
        input.description,
        input.category,
        input.location,
        input.campusBlock ?? null,
        input.approximatePlace ?? null,
        postingDate,
        initialStatus,
        input.imageUrl || null,
        input.contactPreference,
      )
    logItemHistory(Number(result.lastInsertRowid), req.user!.id, 'item.created', { approvalStatus: 'approved', eventDate: postingDate })
    logAudit(req, 'item.created', 'item', result.lastInsertRowid, { approvalStatus: 'approved', eventDate: postingDate })
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

    res.json({ item: canViewPrivate ? privateItemDto(item) : publicItemDto(item), history })
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

    const input = itemSchema.partial().parse(req.body)
    const next = { ...item, ...input }
    db.prepare(
      `UPDATE items SET title = ?, description = ?, category = ?, location = ?, campus_block = ?, approximate_place = ?,
       event_date = ?, image_url = ?, contact_preference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(
      next.title,
      next.description,
      next.category,
      next.location,
      input.campusBlock ?? item.campus_block,
      input.approximatePlace ?? item.approximate_place,
      next.eventDate ?? item.event_date,
      input.imageUrl ?? item.image_url,
      next.contactPreference ?? item.contact_preference,
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

    const result = db
      .prepare('INSERT INTO claims (item_id, claimant_id, message, proof_details) VALUES (?, ?, ?, ?)')
      .run(item.id, req.user!.id, input.message, input.proofDetails)
    db.prepare("UPDATE items SET status = 'claimed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.id)
    logItemHistory(item.id, req.user!.id, 'claim.created', { claimId: result.lastInsertRowid })
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
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.owner_id !== req.user!.id && !hasPermission(req.user!.role, 'items:return')) throw new HttpError(403, 'Sem permissão.')
    db.prepare("UPDATE items SET status = 'returned', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.id)
    db.prepare("UPDATE claims SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND status = 'pending'").run(
      item.id,
    )
    logItemHistory(item.id, req.user!.id, 'item.returned')
    logAudit(req, 'item.returned', 'item', item.id)
    await sendMail(req.user!.email, 'Devolução registrada', `A devolução de "${item.title}" foi registrada.`)
    res.json({ message: 'Devolução registrada.' })
  }),
)

export { router as itemRoutes }
