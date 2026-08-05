import { Router } from 'express'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user!.id)
    res.json({ data: rows })
  }),
)

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user!.id) as {
      total: number
    }
    res.json({ total: row.total })
  }),
)

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL').run(req.user!.id)
    res.json({ message: 'Notificações marcadas como lidas.' })
  }),
)

export { router as notificationRoutes }
