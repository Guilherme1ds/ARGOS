import { Router } from 'express'
import { z } from 'zod'
import { removeSubscription, saveSubscription, sendPushToUser } from '../../integrations/push.js'
import { auth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
router.use(auth)

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine((value) => value.startsWith('https://'), 'Endpoint de push inválido.'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
})

router.post(
  '/subscribe',
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const input = subscriptionSchema.parse(req.body)
    saveSubscription(req.user!.id, input, req.get('user-agent') ?? undefined)
    logAudit(req, 'push.subscribed', 'user', req.user!.id)
    res.status(201).json({ message: 'Notificações no navegador ativadas.' })
  }),
)

router.delete(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const input = z.object({ endpoint: z.string().max(1000) }).parse(req.body ?? {})
    removeSubscription(req.user!.id, input.endpoint)
    logAudit(req, 'push.unsubscribed', 'user', req.user!.id)
    res.json({ message: 'Notificações no navegador desativadas.' })
  }),
)

router.post(
  '/test',
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    sendPushToUser(req.user!.id, { title: 'ARGOS', body: 'Notificações no navegador funcionando.', url: '/notifications' })
    res.json({ message: 'Notificação de teste enviada.' })
  }),
)

export { router as pushRoutes }
