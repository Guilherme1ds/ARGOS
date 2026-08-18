import { Router } from 'express'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { authorize } from '../../shared/policies/permissions.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
router.use(auth, authorize('reports:export_org'))

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

router.get(
  '/items.csv',
  asyncHandler(async (req, res) => {
    const rows = db.prepare('SELECT id, type, title, category, location, event_date, status, approval_status, created_at FROM items').all() as
      Record<string, unknown>[]
    const headers = ['id', 'type', 'title', 'category', 'location', 'event_date', 'status', 'approval_status', 'created_at']
    const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n')
    res.header('Content-Type', 'text/csv; charset=utf-8')
    res.attachment('argos-itens.csv')
    logAudit(req, 'reports.items_exported', 'report', 'items.csv', { rows: rows.length })
    res.send(csv)
  }),
)

export { router as reportRoutes }
