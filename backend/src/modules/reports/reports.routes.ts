import { Router } from 'express'
import { db } from '../../db/database.js'
import { admin, auth } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
router.use(auth, admin)

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

router.get(
  '/items.csv',
  asyncHandler(async (_req, res) => {
    const rows = db.prepare('SELECT id, type, title, category, location, event_date, status, approval_status, created_at FROM items').all() as
      Record<string, unknown>[]
    const headers = ['id', 'type', 'title', 'category', 'location', 'event_date', 'status', 'approval_status', 'created_at']
    const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n')
    res.header('Content-Type', 'text/csv; charset=utf-8')
    res.attachment('argos-itens.csv')
    res.send(csv)
  }),
)

export { router as reportRoutes }
