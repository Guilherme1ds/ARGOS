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

const router = Router()

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use datas no formato YYYY-MM-DD.')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'Data inválida.')

const imageUrlSchema = z.union([
  z.literal(''),
  z.string().url(),
  z.string().regex(/^\/uploads\/[\w.-]+$/, 'Use uma imagem enviada pelo ARGOS.'),
])

const itemSchema = z.object({
  type: z.enum(['lost', 'found']),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  category: z.string().min(2).max(80),
  location: z.string().min(2).max(120),
  campusBlock: z.string().max(60).optional(),
  approximatePlace: z.string().max(160).optional(),
  eventDate: dateSchema,
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

type ItemRow = {
  id: number
  owner_id: number
  owner_name?: string
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

function absoluteFileUrl(url?: string | null) {
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  return `${env.API_PUBLIC_URL.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`
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
  rateLimit(60, 60_000),
  asyncHandler(async (req, res) => {
    const input = searchSchema.parse(req.query)
    const { where, params } = buildSearch(input)
    const offset = (input.page - 1) * input.limit
    const total = db.prepare(`SELECT COUNT(*) AS count FROM items WHERE ${where}`).get(...params) as { count: number }
    const items = db
      .prepare(
        `SELECT items.*
         FROM items
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
    const rows = db.prepare('SELECT * FROM items WHERE owner_id = ? ORDER BY created_at DESC').all(req.user!.id) as ItemRow[]
    res.json({ data: rows.map(privateItemDto) })
  }),
)

router.post(
  '/',
  auth,
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const input = itemSchema.parse(req.body)
    if (req.user!.spam_score >= 5) throw new HttpError(403, 'Usuário com restrição anti-spam.')

    const initialStatus = input.type === 'lost' ? 'lost' : 'found'
    const result = db
      .prepare(
        `INSERT INTO items
        (owner_id, type, title, description, category, location, campus_block, approximate_place, event_date, status, approval_status, image_url, contact_preference)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
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
        input.eventDate,
        initialStatus,
        input.imageUrl || null,
        input.contactPreference,
      )
    logItemHistory(Number(result.lastInsertRowid), req.user!.id, 'item.created', { approvalStatus: 'pending' })
    logAudit(req, 'item.created', 'item', result.lastInsertRowid, { approvalStatus: 'pending' })
    res.status(201).json({ id: result.lastInsertRowid, message: 'Item enviado para aprovação.' })
  }),
)

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const item = db
      .prepare(
        `SELECT items.*, users.name AS owner_name
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
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; status: string; approval_status: string }
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
    notify(item.owner_id, 'Nova reivindicação', `O item "${item.title}" recebeu uma reivindicação.`, 'claim')
    res.status(201).json({ id: result.lastInsertRowid, message: 'Reivindicação enviada.' })
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
