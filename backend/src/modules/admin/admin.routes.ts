import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '../../db/database.js'
import { admin, auth } from '../../middleware/auth.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { logItemHistory, notify } from '../../utils/audit.js'

const router = Router()
router.use(auth, admin)

const statusSchema = z.object({
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  status: z.enum(['lost', 'found', 'claimed', 'returned']).optional(),
  moderationNote: z.string().max(500).optional(),
})

router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const approval = typeof req.query.approvalStatus === 'string' ? req.query.approvalStatus : undefined
    const where = approval ? 'WHERE items.approval_status = ?' : ''
    const params = approval ? [approval] : []
    const rows = db
      .prepare(
        `SELECT items.*, users.name AS owner_name, users.email AS owner_email
         FROM items JOIN users ON users.id = items.owner_id
         ${where}
         ORDER BY items.created_at DESC`,
      )
      .all(...params)
    res.json({ data: rows })
  }),
)

router.patch(
  '/items/:id/status',
  asyncHandler(async (req, res) => {
    const input = statusSchema.parse(req.body)
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as
      | { id: number; owner_id: number; title: string }
      | undefined
    if (!item) throw new HttpError(404, 'Item não encontrado.')

    if (input.approvalStatus) {
      db.prepare('UPDATE items SET approval_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        input.approvalStatus,
        item.id,
      )
      notify(item.owner_id, 'Publicação revisada', `O item "${item.title}" foi marcado como ${input.approvalStatus}.`, 'approval')
    }
    if (input.status) {
      db.prepare('UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(input.status, item.id)
    }

    logItemHistory(item.id, req.user!.id, 'admin.status_changed', input)
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
      role: z.enum(['user', 'admin']).optional(),
      status: z.enum(['pending', 'active', 'blocked']).optional(),
      spamScore: z.number().int().min(0).max(10).optional(),
    })
    const input = schema.parse(req.body)
    db.prepare(
      `UPDATE users
       SET role = COALESCE(?, role), status = COALESCE(?, status), spam_score = COALESCE(?, spam_score), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(input.role ?? null, input.status ?? null, input.spamScore ?? null, req.params.id)
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
      temporaryPassword: z.string().min(8).optional(),
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

    if (input.status === 'approved') {
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(request.email)
      if (!exists) {
        db.prepare('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)').run(
          request.name,
          request.email,
          bcrypt.hashSync(input.temporaryPassword ?? 'Argos@123', 12),
          'user',
          'active',
        )
      }
    }
    res.json({ message: 'Solicitação revisada.' })
  }),
)

export { router as adminRoutes }
