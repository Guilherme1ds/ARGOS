import { Router } from 'express'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'

const router = Router()
router.use(auth)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').all(req.user!.id)
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
    const result = db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL').run(req.user!.id)
    logAudit(req, 'notifications.read_all', 'notification', null, { changed: result.changes })
    res.json({ message: 'Notificações marcadas como lidas.' })
  }),
)

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Notificação não encontrada.')
    // Restringe ao dono: notificação de outra pessoa responde 404 para não revelar que existe.
    const notification = db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(id, req.user!.id)
    if (!notification) throw new HttpError(404, 'Notificação não encontrada.')
    db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ?').run(id)
    res.json({ message: 'Notificação marcada como lida.' })
  }),
)

export { router as notificationRoutes }
