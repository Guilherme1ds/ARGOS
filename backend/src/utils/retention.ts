import { env } from '../config/env.js'
import { db } from '../db/database.js'
import { purgeMailOutbox } from './mail.js'

function cutoff(days: number, now: Date) {
  return new Date(now.getTime() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
}

export type RetentionReport = {
  mailOutbox: number
  passwordResets: number
  emailVerifications: number
  accessRequests: number
  auditLogs: number
}

/**
 * Expurgo periódico conforme os prazos configurados (ver docs/operacao.md). Dados operacionais saem
 * no prazo; auditoria só é apagada quando AUDIT_LOG_RETENTION_DAYS > 0 (decisão do responsável).
 */
export function runRetentionPurge(now = new Date()): RetentionReport {
  const report: RetentionReport = { mailOutbox: 0, passwordResets: 0, emailVerifications: 0, accessRequests: 0, auditLogs: 0 }
  report.mailOutbox = purgeMailOutbox(env.MAIL_OUTBOX_RETENTION_DAYS, now)

  if (env.AUTH_TOKEN_RETENTION_DAYS > 0) {
    const limit = cutoff(env.AUTH_TOKEN_RETENTION_DAYS, now)
    const limitIso = new Date(now.getTime() - env.AUTH_TOKEN_RETENTION_DAYS * 86_400_000).toISOString()
    // Tokens usados ou vencidos há mais que o prazo; os ainda válidos permanecem.
    report.passwordResets = db
      .prepare('DELETE FROM password_resets WHERE (used_at IS NOT NULL AND used_at < ?) OR expires_at < ?')
      .run(limit, limitIso).changes
    report.emailVerifications = db
      .prepare('DELETE FROM email_verifications WHERE (used_at IS NOT NULL AND used_at < ?) OR expires_at < ?')
      .run(limit, limitIso).changes
  }

  if (env.ACCESS_REQUEST_RETENTION_DAYS > 0) {
    report.accessRequests = db
      .prepare("DELETE FROM access_requests WHERE status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_at < ?")
      .run(cutoff(env.ACCESS_REQUEST_RETENTION_DAYS, now)).changes
  }

  if (env.AUDIT_LOG_RETENTION_DAYS > 0) {
    report.auditLogs = db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff(env.AUDIT_LOG_RETENTION_DAYS, now)).changes
  }
  return report
}
