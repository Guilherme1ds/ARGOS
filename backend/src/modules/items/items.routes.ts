import { Router } from 'express'
import { z } from 'zod'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { logItemHistory, notify } from '../../utils/audit.js'
import { sendMail } from '../../utils/mail.js'

const router = Router()

const itemSchema = z.object({
  type: z.enum(['lost', 'found']),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  category: z.string().min(2).max(80),
  location: z.string().min(2).max(120),
  campusBlock: z.string().max(60).optional(),
  approximatePlace: z.string().max(160).optional(),
  eventDate: z.string().min(8).max(30),
  imageUrl: z.string().url().optional().or(z.literal('')),
  contactPreference: z.enum(['in_app', 'email']).default('in_app'),
})

const searchSchema = z.object({
  q: z.string().optional(),
  type: z.enum(['lost', 'found']).optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  status: z.enum(['lost', 'found', 'claimed', 'returned']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
})

const claimSchema = z.object({
  message: z.string().min(10).max(1000),
  proofDetails: z.string().min(10).max(1000),
})

function buildSearch(input: z.infer<typeof searchSchema>) {
  const clauses = ["items.approval_status = 'approved'"]
  const params: unknown[] = []

  if (input.q) {
    clauses.push('(items.title LIKE ? OR items.description LIKE ? OR items.category LIKE ?)')
    params.push(`%${input.q}%`, `%${input.q}%`, `%${input.q}%`)
  }
  if (input.type) {
    clauses.push('items.type = ?')
    params.push(input.type)
  }
  if (input.category) {
    clauses.push('items.category = ?')
    params.push(input.category)
  }
  if (input.location) {
    clauses.push('(items.location LIKE ? OR items.campus_block LIKE ? OR items.approximate_place LIKE ?)')
    params.push(`%${input.location}%`, `%${input.location}%`, `%${input.location}%`)
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

  return { where: clauses.join(' AND '), params }
}

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const input = searchSchema.parse(req.query)
    const { where, params } = buildSearch(input)
    const offset = (input.page - 1) * input.limit
    const items = db
      .prepare(
        `SELECT items.*, users.name AS owner_name
         FROM items JOIN users ON users.id = items.owner_id
         WHERE ${where}
         ORDER BY items.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, offset)
    res.json({ data: items, page: input.page, limit: input.limit })
  }),
)

router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const rows = db.prepare('SELECT * FROM items WHERE owner_id = ? ORDER BY created_at DESC').all(req.user!.id)
    res.json({ data: rows })
  }),
)

router.post(
  '/',
  auth,
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
    res.status(201).json({ id: result.lastInsertRowid, message: 'Item enviado para aprovação.' })
  }),
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = db
      .prepare(
        `SELECT items.*, users.name AS owner_name
         FROM items JOIN users ON users.id = items.owner_id
         WHERE items.id = ?`,
      )
      .get(req.params.id)
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    const history = db.prepare('SELECT * FROM item_history WHERE item_id = ? ORDER BY created_at DESC').all(req.params.id)
    res.json({ item, history })
  }),
)

router.patch(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as { owner_id: number } | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.owner_id !== req.user!.id && req.user!.role !== 'admin') throw new HttpError(403, 'Sem permissão para editar.')
    const input = itemSchema.partial().parse(req.body)
    const current = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as Record<string, unknown>
    const next = { ...current, ...input }
    db.prepare(
      `UPDATE items SET title = ?, description = ?, category = ?, location = ?, campus_block = ?, approximate_place = ?,
       event_date = ?, image_url = ?, contact_preference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(
      next.title,
      next.description,
      next.category,
      next.location,
      input.campusBlock ?? current.campus_block,
      input.approximatePlace ?? current.approximate_place,
      next.eventDate ?? current.event_date,
      input.imageUrl ?? current.image_url,
      next.contactPreference ?? current.contact_preference,
      req.params.id,
    )
    logItemHistory(Number(req.params.id), req.user!.id, 'item.updated', input)
    res.json({ message: 'Item atualizado.' })
  }),
)

router.post(
  '/:id/claim',
  auth,
  asyncHandler(async (req, res) => {
    const input = claimSchema.parse(req.body)
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; status: string }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')
    if (item.owner_id === req.user!.id) throw new HttpError(422, 'Você não pode reivindicar seu próprio item.')
    if (item.status === 'returned') throw new HttpError(422, 'Item já entregue.')

    const result = db
      .prepare('INSERT INTO claims (item_id, claimant_id, message, proof_details) VALUES (?, ?, ?, ?)')
      .run(item.id, req.user!.id, input.message, input.proofDetails)
    db.prepare("UPDATE items SET status = 'claimed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.id)
    logItemHistory(item.id, req.user!.id, 'claim.created', { claimId: result.lastInsertRowid })
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
    if (item.owner_id !== req.user!.id && req.user!.role !== 'admin') throw new HttpError(403, 'Sem permissão.')
    db.prepare("UPDATE items SET status = 'returned', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(item.id)
    db.prepare("UPDATE claims SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE item_id = ? AND status = 'pending'").run(
      item.id,
    )
    logItemHistory(item.id, req.user!.id, 'item.returned')
    await sendMail(req.user!.email, 'Devolução registrada', `A devolução de "${item.title}" foi registrada.`)
    res.json({ message: 'Devolução registrada.' })
  }),
)

export { router as itemRoutes }
