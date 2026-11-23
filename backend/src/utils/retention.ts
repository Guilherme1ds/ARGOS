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
  unverifiedAccounts: number
  claimProofs: number
  notifications: number
  conversations: number
  moderationEvents: number
  expiredInvites: number
}

export const redactedClaimText = '[removido após o prazo de retenção]'

type RunOptions = { trigger?: 'schedule' | 'manual'; actorId?: number | null }

/**
 * Rotina automática de retenção e eliminação (Sprint 8, ver docs/operacao.md). Roda de hora em hora e sob
 * demanda pela administração. Cada categoria tem prazo próprio em dias (0 desliga aquela categoria):
 * - dados operacionais (e-mails, tokens, solicitações de acesso, convites vencidos);
 * - dados pessoais com prazo: contas nunca confirmadas e sem atividade, provas de reivindicações encerradas,
 *   notificações lidas, conversas de casos encerrados e o registro das decisões automáticas de moderação;
 * - auditoria só é apagada quando AUDIT_LOG_RETENTION_DAYS > 0 (decisão do responsável).
 * A execução fica registrada em `retention_runs` quando remove algo ou quando é manual.
 */
export function runRetentionPurge(now = new Date(), options: RunOptions = {}): RetentionReport {
  const startedAt = new Date().toISOString()
  const report: RetentionReport = {
    mailOutbox: 0,
    passwordResets: 0,
    emailVerifications: 0,
    accessRequests: 0,
    auditLogs: 0,
    unverifiedAccounts: 0,
    claimProofs: 0,
    notifications: 0,
    conversations: 0,
    moderationEvents: 0,
    expiredInvites: 0,
  }
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
    // Convites de gestor vencidos, cancelados ou já usados guardam o e-mail convidado: saem no mesmo prazo.
    report.expiredInvites = db
      .prepare("DELETE FROM manager_invites WHERE (status <> 'pending' AND created_at < ?) OR expires_at < ?")
      .run(limit, limitIso).changes
  }

  if (env.ACCESS_REQUEST_RETENTION_DAYS > 0) {
    report.accessRequests = db
      .prepare("DELETE FROM access_requests WHERE status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_at < ?")
      .run(cutoff(env.ACCESS_REQUEST_RETENTION_DAYS, now)).changes
  }

  if (env.UNVERIFIED_ACCOUNT_RETENTION_DAYS > 0) {
    // Cadastro que nunca confirmou o e-mail não consegue entrar: sem nenhuma atividade ligada, a conta é eliminada.
    // Contas anonimizadas (bloqueadas) e contas com casos, reivindicações, fotos ou vínculos ficam de fora.
    const candidates = db
      .prepare(
        `SELECT id FROM users
         WHERE email_verified_at IS NULL AND google_sub IS NULL AND status = 'active' AND role IN ('citizen', 'user')
           AND created_at < ?
           AND NOT EXISTS (SELECT 1 FROM items WHERE items.owner_id = users.id)
           AND NOT EXISTS (SELECT 1 FROM claims WHERE claims.claimant_id = users.id)
           AND NOT EXISTS (SELECT 1 FROM comments WHERE comments.user_id = users.id)
           AND NOT EXISTS (SELECT 1 FROM uploads WHERE uploads.user_id = users.id)
           AND NOT EXISTS (SELECT 1 FROM item_history WHERE item_history.actor_id = users.id)
           AND NOT EXISTS (SELECT 1 FROM organization_members WHERE organization_members.user_id = users.id)
         LIMIT 500`,
      )
      .all(cutoff(env.UNVERIFIED_ACCOUNT_RETENTION_DAYS, now)) as Array<{ id: number }>
    const remove = db.prepare('DELETE FROM users WHERE id = ?')
    for (const candidate of candidates) {
      try {
        report.unverifiedAccounts += remove.run(candidate.id).changes
      } catch {
        // Algum vínculo não previsto impede a remoção: a conta fica para análise manual, sem interromper a rotina.
      }
    }
  }

  if (env.CLAIM_PROOF_RETENTION_DAYS > 0) {
    // Provas de propriedade só servem enquanto a reivindicação está em análise; encerrada, o texto sai no prazo.
    report.claimProofs = db
      .prepare(
        `UPDATE claims SET message = ?, proof_details = ?, proof_redacted_at = CURRENT_TIMESTAMP
         WHERE proof_redacted_at IS NULL AND updated_at < ?
           AND (status IN ('rejected', 'withdrawn')
             OR (status = 'approved' AND EXISTS (SELECT 1 FROM items WHERE items.id = claims.item_id AND items.status = 'returned')))`,
      )
      .run(redactedClaimText, redactedClaimText, cutoff(env.CLAIM_PROOF_RETENTION_DAYS, now)).changes
  }

  if (env.NOTIFICATION_RETENTION_DAYS > 0) {
    report.notifications = db
      .prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?')
      .run(cutoff(env.NOTIFICATION_RETENTION_DAYS, now)).changes
  }

  if (env.CHAT_RETENTION_DAYS > 0) {
    // Conversas encerradas ou de casos já devolvidos, sem movimento há mais que o prazo (as mensagens saem em cascata).
    report.conversations = db
      .prepare(
        `DELETE FROM conversations
         WHERE COALESCE(last_message_at, updated_at) < ? AND updated_at < ?
           AND (status = 'closed' OR EXISTS (SELECT 1 FROM items WHERE items.id = conversations.item_id AND items.status = 'returned'))`,
      )
      .run(cutoff(env.CHAT_RETENTION_DAYS, now), cutoff(env.CHAT_RETENTION_DAYS, now)).changes
  }

  if (env.MODERATION_EVENT_RETENTION_DAYS > 0) {
    report.moderationEvents = db
      .prepare('DELETE FROM moderation_events WHERE created_at < ?')
      .run(cutoff(env.MODERATION_EVENT_RETENTION_DAYS, now)).changes
  }

  if (env.AUDIT_LOG_RETENTION_DAYS > 0) {
    report.auditLogs = db.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff(env.AUDIT_LOG_RETENTION_DAYS, now)).changes
  }

  const total = Object.values(report).reduce((sum, value) => sum + value, 0)
  const trigger = options.trigger ?? 'schedule'
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('retention_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify({ at: new Date().toISOString(), trigger, total }),
  )
  if (total > 0 || trigger === 'manual') {
    db.prepare('INSERT INTO retention_runs (trigger, actor_id, report, total, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      trigger,
      options.actorId ?? null,
      JSON.stringify(report),
      total,
      startedAt,
      new Date().toISOString(),
    )
    // O histórico da própria rotina também tem limite: ficam as 500 execuções mais recentes.
    db.prepare('DELETE FROM retention_runs WHERE id NOT IN (SELECT id FROM retention_runs ORDER BY id DESC LIMIT 500)').run()
  }
  return report
}

export type RetentionRun = { id: number; trigger: 'schedule' | 'manual'; report: RetentionReport; total: number; started_at: string; finished_at: string; actor_name: string | null }

export function retentionStatus(limit = 20) {
  const last = db.prepare("SELECT value FROM app_settings WHERE key = 'retention_last_run'").get() as { value: string } | undefined
  const runs = db
    .prepare(
      `SELECT retention_runs.id, retention_runs.trigger, retention_runs.report, retention_runs.total, retention_runs.started_at,
              retention_runs.finished_at, users.name AS actor_name
       FROM retention_runs LEFT JOIN users ON users.id = retention_runs.actor_id
       ORDER BY retention_runs.id DESC LIMIT ?`,
    )
    .all(limit) as Array<Omit<RetentionRun, 'report'> & { report: string }>
  return {
    lastRun: last ? (JSON.parse(last.value) as { at: string; trigger: 'schedule' | 'manual'; total: number }) : null,
    runs: runs.map((run) => ({ ...run, report: JSON.parse(run.report) as RetentionReport })),
  }
}
