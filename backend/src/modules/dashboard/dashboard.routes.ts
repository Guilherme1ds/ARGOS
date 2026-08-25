import { Router } from 'express'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { hasPermission } from '../../shared/policies/permissions.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationScope = hasPermission(req.user!.role, 'reports:read_org')
    const where = organizationScope ? '' : 'WHERE owner_id = ?'
    const params = organizationScope ? [] : [req.user!.id]
    const metrics = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost,
           SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) AS found,
           SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
           SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned,
           SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) AS pendingApproval
         FROM items ${where}`,
      )
      .get(...params) as Record<'lost' | 'found' | 'claimed' | 'returned' | 'pendingApproval', number | null>
    const recent = db
      .prepare(
        `SELECT id, type, title, category, location, event_date, status, approval_status, image_url, created_at
         FROM items ${where}
         ORDER BY created_at DESC
         LIMIT 8`,
      )
      .all(...params)

    res.json({
      scope: organizationScope ? 'organization' : 'personal',
      metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value ?? 0])),
      recent,
    })
  }),
)

export { router as dashboardRoutes }
