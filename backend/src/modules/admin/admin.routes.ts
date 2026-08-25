import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { authorize } from '../../shared/policies/permissions.js'
import { logAudit, logItemHistory, notify } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { assertItemStatusTransition, type ItemStatus, type ItemType } from '../items/item-state.js'
import { ftsPrefixQuery } from '../../utils/normalization.js'

const router = Router()
router.use(auth, authorize('platform:admin'))

const statusSchema = z.object({
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  status: z.enum(['lost', 'found', 'claimed', 'returned']).optional(),
  moderationNote: z.string().max(500).optional(),
})

const itemsQuerySchema = z.object({
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  status: z.enum(['lost', 'found', 'claimed', 'returned']).optional(),
  q: z.string().trim().max(120).optional(),
})

const roleSchema = z.enum(['citizen', 'space_manager', 'org_admin', 'support', 'admin'])

function temporaryPassword() {
  return `Argos-${randomBytes(9).toString('base64url')}`
}

router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const input = itemsQuerySchema.parse(req.query)
    const clauses: string[] = []
    const params: unknown[] = []

    if (input.approvalStatus) {
      clauses.push('items.approval_status = ?')
      params.push(input.approvalStatus)
    }
    if (input.status) {
      clauses.push('items.status = ?')
      params.push(input.status)
    }
    if (input.q) {
      const query = ftsPrefixQuery(input.q)
      const ownerQuery = `%${input.q.toLowerCase()}%`
      clauses.push(query ? '(items.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?) OR LOWER(users.name) LIKE ?)' : 'LOWER(users.name) LIKE ?')
      if (query) params.push(query)
      params.push(ownerQuery)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db
      .prepare(
        `SELECT items.*, users.name AS owner_name, users.email AS owner_email
         FROM items JOIN users ON users.id = items.owner_id
         ${where}
         ORDER BY items.created_at DESC`,
      )
      .all(...params)
    logAudit(req, 'admin.items_listed', 'item', null, input)
    res.json({ data: rows })
  }),
)

router.patch(
  '/items/:id/status',
  asyncHandler(async (req, res) => {
    const input = statusSchema.parse(req.body)
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string; type: ItemType; status: ItemStatus }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')

    if (input.approvalStatus) {
      db.prepare('UPDATE items SET approval_status = ?, moderation_note = COALESCE(?, moderation_note), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        input.approvalStatus,
        input.moderationNote ?? null,
        item.id,
      )
      notify(item.owner_id, 'Publicação revisada', `O item "${item.title}" foi marcado como ${input.approvalStatus}.`, 'approval')
    }
    if (input.status) {
      assertItemStatusTransition(item.type, item.status, input.status)
      db.prepare('UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(input.status, item.id)
    }

    logItemHistory(item.id, req.user!.id, 'admin.status_changed', input)
    logAudit(req, 'admin.item_status_changed', 'item', item.id, input)
    res.json({ message: 'Status atualizado.' })
  }),
)

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const rows = db.prepare('SELECT id, name, email, role, status, spam_score, created_at FROM users ORDER BY created_at DESC').all()
    res.json({ data: rows })
  }),
)

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      role: roleSchema.optional(),
      status: z.enum(['pending', 'active', 'blocked']).optional(),
      spamScore: z.number().int().min(0).max(10).optional(),
    })
    const input = schema.parse(req.body)
    db.prepare(
      `UPDATE users
       SET role = COALESCE(?, role), status = COALESCE(?, status), spam_score = COALESCE(?, spam_score), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(input.role ?? null, input.status ?? null, input.spamScore ?? null, req.params.id)
    logAudit(req, 'admin.user_updated', 'user', String(req.params.id), input)
    res.json({ message: 'Usuário atualizado.' })
  }),
)

router.get(
  '/access-requests',
  asyncHandler(async (_req, res) => {
    const rows = db.prepare('SELECT * FROM access_requests ORDER BY created_at DESC').all()
    res.json({ data: rows })
  }),
)

router.patch(
  '/access-requests/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(['approved', 'rejected']),
      role: roleSchema.default('citizen'),
    })
    const input = schema.parse(req.body)
    const request = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(req.params.id) as
      | { id: number; name: string; email: string }
      | undefined
    if (!request) throw new HttpError(404, 'Solicitação não encontrada.')

    db.prepare('UPDATE access_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      input.status,
      req.user!.id,
      request.id,
    )

    let generatedPassword: string | null = null
    if (input.status === 'approved') {
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(request.email)
      if (!exists) {
        generatedPassword = temporaryPassword()
        db.prepare('INSERT INTO users (name, email, password_hash, role, status, email_verified_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(
          request.name,
          request.email,
          bcrypt.hashSync(generatedPassword, 12),
          input.role,
          'active',
        )
      }
    }

    logAudit(req, 'admin.access_request_reviewed', 'access_request', request.id, {
      status: input.status,
      role: input.role,
      userCreated: Boolean(generatedPassword),
    })
    res.json({
      message: 'Solicitação revisada.',
      temporaryPassword: generatedPassword,
    })
  }),
)

export { router as adminRoutes }
