import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { corsOrigins, env } from './config/env.js'
import { db, migrate } from './db/database.js'
import { currentSchemaVersion } from './db/migrations.js'
import { adminRoutes } from './modules/admin/admin.routes.js'
import { aiRoutes } from './modules/ai/ai.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { auditRoutes } from './modules/audit/audit.routes.js'
import { configRoutes } from './modules/config/config.routes.js'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js'
import { itemRoutes } from './modules/items/items.routes.js'
import { notificationRoutes } from './modules/notifications/notifications.routes.js'
import { organizationRoutes, spaceRoutes } from './modules/organizations/organizations.routes.js'
import { pushRoutes } from './modules/push/push.routes.js'
import { privacyRoutes } from './modules/privacy/privacy.routes.js'
import { chatRoutes } from './modules/chat/chat.routes.js'
import { custodyRoutes } from './modules/custody/custody.routes.js'
import { metricsHandler, observabilityRoutes } from './modules/observability/observability.routes.js'
import { startAlertEvaluator } from './observability/alerts.js'
import { markRoutePrefix, resumeTrace, telemetryMiddleware } from './observability/metrics.js'
import { reportRoutes } from './modules/reports/reports.routes.js'
import { savedSearchRoutes } from './modules/saved-searches/saved-searches.routes.js'
import { uploadRoutes } from './modules/uploads/uploads.routes.js'
import { testMailRoutes } from './modules/testing/test-mail.routes.js'
import { errorHandler, notFoundHandler } from './utils/http.js'
import { startMailWorker } from './utils/mail.js'
import { startUploadCleanup } from './utils/orphan-uploads.js'
import { thumbnailFallback } from './utils/upload-files.js'
import { mountWebsite, type Website } from './web/site.js'

migrate()
startMailWorker()
if (env.NODE_ENV !== 'test') {
  startUploadCleanup()
  startAlertEvaluator()
}

export const app = express()

app.set('trust proxy', env.TRUST_PROXY)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use((req, res, next) => {
  // O ID vindo do cliente vai para logs e respostas: aceita só um formato curto e seguro.
  const incomingId = req.header('x-request-id')
  const requestId = incomingId && /^[\w.:-]{1,128}$/.test(incomingId) ? incomingId : randomUUID()
  req.requestId = requestId
  res.setHeader('x-request-id', requestId)
  next()
})
// Rastreamento, métricas e log estruturado de cada requisição (substitui o log de acesso em texto).
app.use(telemetryMiddleware)
app.use((req, res, next) => {
  const originalJson = res.json.bind(res)
  res.json = (body: unknown) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && !('requestId' in body)) {
      return originalJson({ ...body, requestId: req.requestId })
    }
    return originalJson(body)
  }
  next()
})
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin) || env.NODE_ENV === 'development'),
    credentials: true,
  }),
)
app.use(express.json({ limit: `${env.MAX_BODY_MB}mb` }))
app.use(resumeTrace)
app.use('/uploads', thumbnailFallback(resolve(env.UPLOAD_DIR)))
app.use(
  '/uploads',
  express.static(resolve(env.UPLOAD_DIR), {
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
      // Fotos de casos não entram na busca de imagens (a prévia de link compartilhado continua funcionando).
      res.setHeader('X-Robots-Tag', 'noindex')
    },
  }),
)

app.get(['/health/live', '/api/health'], (_req, res) => {
  res.json({ status: 'ok', service: 'ARGOS API', timestamp: new Date().toISOString() })
})

app.get('/health/ready', (_req, res) => {
  try {
    db.prepare('SELECT 1').get()
    res.json({
      status: 'ready',
      database: 'ok',
      schemaVersion: currentSchemaVersion(db),
      version: process.env.npm_package_version ?? '0.1.0',
    })
  } catch {
    res.status(503).json({ status: 'not_ready', database: 'unavailable' })
  }
})

// Métricas no formato Prometheus, protegidas por METRICS_TOKEN (ver modules/observability).
app.get('/metrics', metricsHandler)

/** Roteadores montados em /api e /api/v1 (o teste de contrato compara esta lista com o OpenAPI). */
export const apiRoutes = [
  ['/auth', authRoutes],
  ['/items', itemRoutes],
  ['/uploads', uploadRoutes],
  ['/admin', adminRoutes],
  ['/notifications', notificationRoutes],
  ['/dashboard', dashboardRoutes],
  ['/reports', reportRoutes],
  ['/saved-searches', savedSearchRoutes],
  ['/privacy', privacyRoutes],
  ['/audit-logs', auditRoutes],
  ['/config', configRoutes],
  ['/ai', aiRoutes],
  ['/push', pushRoutes],
  ['/organizations', organizationRoutes],
  ['/spaces', spaceRoutes],
  ['/conversations', chatRoutes],
  ['/custody', custodyRoutes],
  ['/observability', observabilityRoutes],
] as const

for (const [path, routes] of apiRoutes) {
  app.use(`/api${path}`, markRoutePrefix, routes)
  app.use(`/api/v1${path}`, markRoutePrefix, routes)
}

// Só em testes automatizados com banco descartável (ver modules/testing/test-mail.routes.ts).
if (env.NODE_ENV === 'test' && env.ENABLE_TEST_MAIL_SINK) {
  app.use('/api/v1/__test__/mail', testMailRoutes)
}

// Rotas desconhecidas da API respondem JSON em vez da página HTML padrão do Express.
app.use(['/api', '/health'], notFoundHandler)

// Com WEB_DIST_DIR, a API também serve a web (um serviço só no mesmo domínio; ver docs/publicar-no-ar.md).
export const website: Website | null = env.WEB_DIST_DIR ? mountWebsite(app, env.WEB_DIST_DIR) : null

app.use(errorHandler)
