import { Router, type Request, type Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { currentSchemaVersion } from '../../db/migrations.js'
import { auth } from '../../middleware/auth.js'
import { listAlerts } from '../../observability/alerts.js'
import { minuteSeries, processStats, prometheusText, routeSummary, windowStats } from '../../observability/metrics.js'
import { recentLogProblems, tracingExportEnabled, tracingStats } from '../../observability/telemetry.js'
import { authorize } from '../../shared/policies/permissions.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { mailConfigured } from '../../utils/mail.js'

const router = Router()
router.use(auth, authorize('platform:admin'))

/** Números de negócio e de dependências lidos na hora (consultas agregadas, sem dados pessoais). */
function businessGauges() {
  const itemStatus = db.prepare("SELECT status, COUNT(*) AS total FROM items WHERE approval_status = 'approved' GROUP BY status").all() as Array<{ status: string; total: number }>
  const mail = db.prepare('SELECT status, COUNT(*) AS total FROM mail_outbox GROUP BY status').all() as Array<{ status: string; total: number }>
  const one = (sql: string) => (db.prepare(sql).get() as { total: number }).total
  return {
    items: Object.fromEntries(['lost', 'found', 'claimed', 'returned'].map((status) => [status, itemStatus.find((row) => row.status === status)?.total ?? 0])),
    mail: Object.fromEntries(['pending', 'sent', 'failed', 'expired'].map((status) => [status, mail.find((row) => row.status === status)?.total ?? 0])),
    users: one("SELECT COUNT(*) AS total FROM users WHERE status = 'active'"),
    openReports: one("SELECT COUNT(*) AS total FROM item_reports WHERE status IN ('open', 'in_review')"),
    flaggedMessages: one("SELECT COUNT(*) AS total FROM chat_messages WHERE status = 'flagged'"),
    pendingApproval: one("SELECT COUNT(*) AS total FROM items WHERE approval_status = 'pending'"),
    organizations: one("SELECT COUNT(*) AS total FROM organizations WHERE status = 'active'"),
    firingAlerts: one("SELECT COUNT(*) AS total FROM system_alerts WHERE status = 'firing'"),
  }
}

// Painel de observabilidade da administração: saúde, tráfego, latência, dependências e alertas.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    let database: 'ok' | 'unavailable' = 'ok'
    let gauges: ReturnType<typeof businessGauges> | null = null
    try {
      gauges = businessGauges()
    } catch {
      database = 'unavailable'
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      service: { name: env.OTEL_SERVICE_NAME, environment: env.NODE_ENV, version: process.env.npm_package_version ?? '0.1.0', schemaVersion: database === 'ok' ? currentSchemaVersion(db) : null },
      process: processStats(),
      dependencies: { database, mail: mailConfigured() ? 'configured' : 'not_configured', tracingExport: tracingExportEnabled() ? 'enabled' : 'disabled', metricsEndpoint: env.METRICS_TOKEN ? 'enabled' : 'disabled' },
      traffic: { last5m: windowStats(5), last60m: windowStats(60), series: minuteSeries(60), routes: routeSummary(10) },
      tracing: tracingStats,
      thresholds: { errorRatePercent: env.ALERT_ERROR_RATE_PERCENT, latencyP95Ms: env.ALERT_LATENCY_P95_MS, mailFailures: env.ALERT_MAIL_FAILURES },
      business: gauges,
      alerts: database === 'ok' ? listAlerts(30) : [],
      recentProblems: recentLogProblems().slice(0, 20),
    })
  }),
)

function tokenMatches(header: string | undefined, token: string) {
  const provided = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(token)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

/**
 * `/metrics` no formato Prometheus. Só existe com `METRICS_TOKEN` definido e responde apenas a
 * `Authorization: Bearer <token>`: os números revelam volume de uso e não devem ficar públicos.
 */
export function metricsHandler(req: Request, res: Response) {
  if (!env.METRICS_TOKEN) throw new HttpError(404, 'Recurso não encontrado.')
  if (!tokenMatches(req.header('authorization'), env.METRICS_TOKEN)) {
    res.setHeader('WWW-Authenticate', 'Bearer')
    throw new HttpError(401, 'Token de métricas ausente ou inválido.')
  }
  const gauges = businessGauges()
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.send(
    prometheusText({
      argos_items: Object.entries(gauges.items).map(([status, value]) => ({ help: 'Casos aprovados por status.', value, labels: { status } })),
      argos_mail_outbox: Object.entries(gauges.mail).map(([status, value]) => ({ help: 'Mensagens na fila de e-mail por status.', value, labels: { status } })),
      argos_active_users: [{ help: 'Contas ativas.', value: gauges.users }],
      argos_open_reports: [{ help: 'Denúncias abertas ou em análise.', value: gauges.openReports }],
      argos_flagged_messages: [{ help: 'Mensagens de conversa aguardando moderação.', value: gauges.flaggedMessages }],
      argos_firing_alerts: [{ help: 'Alertas automáticos ativos.', value: gauges.firingAlerts }],
    }),
  )
}

export { router as observabilityRoutes }
