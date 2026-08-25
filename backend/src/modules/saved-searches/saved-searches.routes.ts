import { Router } from 'express'
import { z } from 'zod'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'

const router = Router()
router.use(auth)

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const querySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    type: z.enum(['lost', 'found']).optional(),
    category: z.string().trim().max(80).optional(),
    location: z.string().trim().max(120).optional(),
    status: z.enum(['lost', 'found', 'claimed', 'returned']).optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    hasImage: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
    sort: z.enum(['newest', 'oldest', 'event_date_desc', 'event_date_asc']).optional(),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, { path: ['from'], message: 'Intervalo de datas inválido.' })

const createSchema = z.object({
  name: z.string().trim().min(3).max(80),
  query: querySchema,
})

function parseStoredQuery(value: string) {
  try {
    return querySchema.parse(JSON.parse(value))
  } catch {
    return {}
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare('SELECT id, name, query_json, enabled, created_at, updated_at FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user!.id) as Array<{ id: number; name: string; query_json: string; enabled: number; created_at: string; updated_at: string }>
    res.json({ data: rows.map(({ query_json, enabled, ...row }) => ({ ...row, query: parseStoredQuery(query_json), enabled: Boolean(enabled) })) })
  }),
)

router.post(
  '/',
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body)
    const count = db.prepare('SELECT COUNT(*) AS total FROM saved_searches WHERE user_id = ?').get(req.user!.id) as { total: number }
    if (count.total >= 20) throw new HttpError(422, 'Você pode manter no máximo 20 pesquisas salvas.')
    const result = db
      .prepare('INSERT INTO saved_searches (user_id, name, query_json) VALUES (?, ?, ?)')
      .run(req.user!.id, input.name, JSON.stringify(input.query))
    logAudit(req, 'saved_search.created', 'saved_search', result.lastInsertRowid)
    res.status(201).json({ id: Number(result.lastInsertRowid), message: 'Pesquisa salva.' })
  }),
)

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = createSchema.partial().extend({ enabled: z.boolean().optional() }).parse(req.body)
    const current = db.prepare('SELECT * FROM saved_searches WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as
      | { id: number; name: string; query_json: string; enabled: number }
      | undefined
    if (!current) throw new HttpError(404, 'Pesquisa salva não encontrada.')
    db.prepare(
      `UPDATE saved_searches SET name = ?, query_json = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).run(
      input.name ?? current.name,
      input.query ? JSON.stringify(input.query) : current.query_json,
      input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
      current.id,
      req.user!.id,
    )
    logAudit(req, 'saved_search.updated', 'saved_search', current.id, input)
    res.json({ message: 'Pesquisa salva atualizada.' })
  }),
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id)
    if (!result.changes) throw new HttpError(404, 'Pesquisa salva não encontrada.')
    logAudit(req, 'saved_search.deleted', 'saved_search', String(req.params.id))
    res.json({ message: 'Pesquisa salva removida.' })
  }),
)

export { router as savedSearchRoutes }
