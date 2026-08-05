import { Router } from 'express'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const metrics = {
      lost: (db.prepare("SELECT COUNT(*) AS total FROM items WHERE status = 'lost'").get() as { total: number }).total,
      found: (db.prepare("SELECT COUNT(*) AS total FROM items WHERE status = 'found'").get() as { total: number }).total,
      claimed: (db.prepare("SELECT COUNT(*) AS total FROM items WHERE status = 'claimed'").get() as { total: number }).total,
      returned: (db.prepare("SELECT COUNT(*) AS total FROM items WHERE status = 'returned'").get() as { total: number }).total,
      pendingApproval: (db.prepare("SELECT COUNT(*) AS total FROM items WHERE approval_status = 'pending'").get() as { total: number })
        .total,
    }
    const recent = db.prepare('SELECT * FROM items ORDER BY created_at DESC LIMIT 8').all()
    res.json({ metrics, recent })
  }),
)

export { router as dashboardRoutes }
