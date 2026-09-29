import { Router } from 'express'
import { z } from 'zod'
import { suggestItemFromImage } from '../../integrations/ai.js'
import { auth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler } from '../../utils/http.js'
import { assertOwnedUpload } from '../../utils/uploads.js'

const router = Router()

const describeSchema = z.object({
  imageUrl: z.string().regex(/^\/uploads\/[\w.-]+$/, 'Use uma imagem enviada pelo ARGOS.'),
})

router.post(
  '/describe-item',
  auth,
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = describeSchema.parse(req.body)
    // Só fotos enviadas pela própria conta: evita usar a IA para ler imagens de terceiros.
    assertOwnedUpload(req.user!.id, input.imageUrl)
    const suggestion = await suggestItemFromImage(input.imageUrl)
    logAudit(req, 'ai.item_described', 'upload', input.imageUrl, { category: suggestion.category })
    res.json({ suggestion })
  }),
)

export { router as aiRoutes }
