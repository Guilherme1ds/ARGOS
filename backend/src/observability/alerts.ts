import { env } from '../config/env.js'
import { db } from '../db/database.js'
import { activeUserIdsWith, notify } from '../utils/audit.js'
import { sendMail } from '../utils/mail.js'
import { takeEventLoopDelay, windowStats } from './metrics.js'
import { logger } from './telemetry.js'

/**
 * Alertas automáticos (Sprint 8). A cada minuto as regras abaixo são avaliadas; uma regra que passa a
 * disparar cria um registro em `system_alerts` e avisa a administração (notificação no app e e-mail,
 * conforme as preferências de cada pessoa). Enquanto continua disparando, só `last_seen_at` muda (sem
 * repetir avisos); quando volta ao normal, o alerta é marcado como resolvido.
 *
 * Limite conhecido: se o processo inteiro cair, ele não consegue avisar. Para isso existe a verificação
 * externa de `/health/ready` (docs/operacao.md, seção 6).
 */
export type AlertSeverity = 'warning' | 'critical'
export type AlertReading = { key: string; severity: AlertSeverity; title: string; detail: string; value: number; threshold: number; firing: boolean }

const minimumRequests = 20
let databaseDownSince: number | null = null
let databaseMailSentAt = 0

function sqliteTime(date: Date) {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

/** Leituras atuais de cada regra (função sem efeitos além de zerar o histograma do laço de eventos). */
export function readAlertRules(now = new Date()): AlertReading[] {
  const window = windowStats(5, now.getTime())
  const readings: AlertReading[] = []

  if (env.ALERT_ERROR_RATE_PERCENT > 0) {
    readings.push({
      key: 'http_error_rate',
      severity: 'critical',
      title: 'Taxa de erros da API acima do limite',
      detail: `${window.errors5xx} de ${window.requests} requisições falharam (5xx) nos últimos 5 minutos.`,
      value: window.errorRatePercent,
      threshold: env.ALERT_ERROR_RATE_PERCENT,
      firing: window.requests >= minimumRequests && window.errorRatePercent > env.ALERT_ERROR_RATE_PERCENT,
    })
  }
  if (env.ALERT_LATENCY_P95_MS > 0) {
    readings.push({
      key: 'http_latency_p95',
      severity: 'warning',
      title: 'API lenta',
      detail: `95% das requisições dos últimos 5 minutos levaram até ${window.p95Ms} ms.`,
      value: window.p95Ms,
      threshold: env.ALERT_LATENCY_P95_MS,
      firing: window.requests >= minimumRequests && window.p95Ms > env.ALERT_LATENCY_P95_MS,
    })
  }

  const loopDelay = Math.round(takeEventLoopDelay())
  readings.push({
    key: 'event_loop_blocked',
    severity: 'warning',
    title: 'Servidor sobrecarregado',
    detail: `O laço de eventos atrasou até ${loopDelay} ms no último minuto; as respostas ficam lentas para todos.`,
    value: loopDelay,
    threshold: 1000,
    firing: loopDelay > 1000,
  })

  if (env.ALERT_MAIL_FAILURES > 0) {
    const failed = db
      .prepare("SELECT COUNT(*) AS total FROM mail_outbox WHERE status = 'failed' AND created_at >= ?")
      .get(sqliteTime(new Date(now.getTime() - 86_400_000))) as { total: number }
    readings.push({
      key: 'mail_failures',
      severity: 'warning',
      title: 'E-mails não estão sendo entregues',
      detail: `${failed.total} e-mails falharam definitivamente nas últimas 24 horas. Confira o SMTP em Administração > Testar e-mail.`,
      value: failed.total,
      threshold: env.ALERT_MAIL_FAILURES,
      firing: failed.total >= env.ALERT_MAIL_FAILURES,
    })
  }
  const stuck = db
    .prepare("SELECT COUNT(*) AS total FROM mail_outbox WHERE status = 'pending' AND created_at < ?")
    .get(sqliteTime(new Date(now.getTime() - 30 * 60_000))) as { total: number }
  readings.push({
    key: 'mail_queue_stuck',
    severity: 'warning',
    title: 'Fila de e-mails parada',
    detail: `${stuck.total} e-mails aguardam envio há mais de 30 minutos.`,
    value: stuck.total,
    threshold: 1,
    firing: stuck.total >= 1,
  })
  return readings
}

type AlertRow = {
  id: number
  alert_key: string
  severity: AlertSeverity
  title: string
  detail: string
  status: 'firing' | 'resolved'
  value: number | null
  threshold: number | null
  fired_at: string
  last_seen_at: string
  resolved_at: string | null
}

/** Aplica as leituras: abre alertas novos (avisando a administração), atualiza os ativos e resolve os normalizados. */
export function applyAlertReadings(readings: AlertReading[]) {
  const opened: string[] = []
  const resolved: string[] = []
  for (const reading of readings) {
    const firing = db.prepare("SELECT id FROM system_alerts WHERE alert_key = ? AND status = 'firing'").get(reading.key) as { id: number } | undefined
    if (reading.firing && !firing) {
      db.prepare('INSERT INTO system_alerts (alert_key, severity, title, detail, value, threshold) VALUES (?, ?, ?, ?, ?, ?)').run(
        reading.key,
        reading.severity,
        reading.title,
        reading.detail,
        reading.value,
        reading.threshold,
      )
      opened.push(reading.key)
      logger.warn('alert.fired', { alert: reading.key, severity: reading.severity, value: reading.value, threshold: reading.threshold })
      for (const adminId of activeUserIdsWith('platform:admin')) {
        notify(adminId, `Alerta: ${reading.title}`, reading.detail, 'alert', '/admin/observability')
      }
    } else if (reading.firing && firing) {
      db.prepare('UPDATE system_alerts SET last_seen_at = CURRENT_TIMESTAMP, value = ?, detail = ? WHERE id = ?').run(reading.value, reading.detail, firing.id)
    } else if (!reading.firing && firing) {
      db.prepare("UPDATE system_alerts SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(firing.id)
      resolved.push(reading.key)
      logger.info('alert.resolved', { alert: reading.key })
    }
  }
  return { opened, resolved }
}

/**
 * Uma rodada de avaliação. Banco indisponível não pode ser registrado no próprio banco: vai para o log e,
 * com SMTP configurado, um e-mail direto ao administrador inicial (no máximo um por hora).
 */
export async function evaluateAlerts(now = new Date()) {
  try {
    db.prepare('SELECT 1').get()
    if (databaseDownSince) logger.info('alert.resolved', { alert: 'database_unavailable', downMs: now.getTime() - databaseDownSince })
    databaseDownSince = null
  } catch (error) {
    databaseDownSince ??= now.getTime()
    logger.error('alert.fired', { alert: 'database_unavailable', severity: 'critical', error })
    if (now.getTime() - databaseMailSentAt > 3_600_000) {
      databaseMailSentAt = now.getTime()
      await sendMail(env.ADMIN_EMAIL, 'ARGOS: banco de dados indisponível', 'A API do ARGOS não conseguiu acessar o banco de dados. Verifique o servidor e o disco.').catch(() => undefined)
    }
    return { opened: ['database_unavailable'], resolved: [] }
  }
  try {
    return applyAlertReadings(readAlertRules(now))
  } catch (error) {
    logger.error('alert.evaluation_failed', { error })
    return { opened: [], resolved: [] }
  }
}

export function listAlerts(limit = 30) {
  return db
    .prepare("SELECT * FROM system_alerts ORDER BY CASE status WHEN 'firing' THEN 0 ELSE 1 END, fired_at DESC, id DESC LIMIT ?")
    .all(limit) as AlertRow[]
}

export function startAlertEvaluator() {
  const timer = setInterval(() => void evaluateAlerts(), 60_000)
  timer.unref()
  return timer
}
