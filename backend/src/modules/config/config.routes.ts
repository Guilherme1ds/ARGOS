import { Router } from 'express'
import { env } from '../../config/env.js'
import { aiEnabled } from '../../integrations/ai.js'
import { captchaEnabled } from '../../integrations/captcha.js'
import { googleEnabled } from '../../integrations/google.js'
import { vapidKeys } from '../../integrations/push.js'
import { translationProvider } from '../../integrations/translation.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()

// Diz ao frontend quais integrações estão ligadas; só expõe valores públicos (nunca segredos).
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json({
      map: { center: [env.MAP_CENTER_LAT, env.MAP_CENTER_LNG], zoom: env.MAP_ZOOM },
      ai: aiEnabled(),
      translation: translationProvider(),
      googleClientId: googleEnabled() ? env.GOOGLE_CLIENT_ID : null,
      turnstileSiteKey: captchaEnabled() ? env.TURNSTILE_SITE_KEY : null,
      push: { publicKey: vapidKeys().publicKey },
    })
  }),
)

export { router as configRoutes }
