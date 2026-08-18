import { Router } from 'express'
import { z } from 'zod'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { authorize } from '../../shared/policies/permissions.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
router.use(auth, authorize('platform:admin'))

const querySchema = z.object({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const input = querySchema.parse(req.query)
    const clauses: string[] = []
    const params: unknown[] = []

    if (input.action) {
      clauses.push('audit_logs.action = ?')
      params.push(input.action)
    }
    if (input.entityType) {
      clauses.push('audit_logs.entity_type = ?')
      params.push(input.entityType)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const offset = (input.page - 1) * input.limit
    const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get(...params) as { count: number }
    const rows = db
      .prepare(
        `SELECT audit_logs.id, audit_logs.actor_id, users.name AS actor_name, audit_logs.action,
                audit_logs.entity_type, audit_logs.entity_id, audit_logs.metadata,
                audit_logs.ip_address, audit_logs.user_agent, audit_logs.created_at
         FROM audit_logs
         LEFT JOIN users ON users.id = audit_logs.actor_id
         ${where}
         ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, offset)

    logAudit(req, 'audit_logs.viewed', 'audit_log', null, {
      action: input.action,
      entityType: input.entityType,
      page: input.page,
      limit: input.limit,
    })
    res.json({ data: rows, meta: { page: input.page, limit: input.limit, total: total.count } })
  }),
)

export { router as auditRoutes }
