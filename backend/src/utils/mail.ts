import nodemailer from 'nodemailer'
import { env } from '../config/env.js'
import { db } from '../db/database.js'
import { maskEmail } from './pseudonym.js'

type Transporter = ReturnType<typeof nodemailer.createTransport>
export type OutgoingMail = { to: string; subject: string; text: string; sensitive: boolean }

let transporter: Transporter | null = null
let processing = false
let worker: NodeJS.Timeout | null = null

/** Texto gravado no lugar do corpo depois que a mensagem é processada (enviada, expirada ou descartada). */
export const redactedMailBody = '[conteúdo removido após o processamento]'

export function mailConfigured() {
  return Boolean(env.SMTP_HOST)
}

function getTransporter() {
  // Gmail (smtp.gmail.com, senha de app), Brevo (smtp-relay.brevo.com) e Resend (smtp.resend.com) usam SMTP padrão.
  // Sem SMTP_USER/SMTP_PASS (ex.: Mailpit local), conecta sem autenticação; produção exige as duas.
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure,
    // Em produção/homologação a conexão precisa subir para TLS (STARTTLS) antes de autenticar.
    requireTLS: env.PRODUCTION_LIKE && !secure,
    auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  return transporter
}

/** Remove links com token e endereços de mensagens de erro antes de gravá-las ou registrá-las. */
export function redactSecrets(value: string) {
  return value
    .replace(/(token=)[^\s&#"']+/gi, '$1[redigido]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .slice(0, 500)
}

/** Ponto único de envio; substituível nos testes. */
export const mailTransport = {
  async send(message: OutgoingMail) {
    if (!mailConfigured()) {
      // Nunca cai no modo de console fora de desenvolvimento/teste (a configuração também barra no boot).
      if (env.PRODUCTION_LIKE) throw new Error('Transporte de e-mail não configurado.')
      if (env.NODE_ENV === 'development') {
        // Mensagens de autenticação (links de senha e confirmação) nunca têm corpo registrado.
        const detail = message.sensitive ? '(corpo omitido: mensagem de autenticação)' : `| ${message.text}`
        console.log(`[mail:dev] ${maskEmail(message.to)} | ${message.subject} ${detail}`)
      }
      return
    }
    await getTransporter().sendMail({ from: env.MAIL_FROM, to: message.to, subject: message.subject, text: message.text })
  },
}

export async function sendMail(to: string, subject: string, text: string, sensitive = false) {
  await mailTransport.send({ to, subject, text, sensitive })
}

/** Confere a conexão e a autenticação com o servidor SMTP (usado no teste de e-mail do admin). */
export async function verifyMailTransport() {
  if (!mailConfigured()) return { configured: false as const }
  await getTransporter().verify()
  return { configured: true as const, host: env.SMTP_HOST }
}

export type QueueMailOptions = {
  /** Contém link com token: não é registrado em log e só pode ser enviado até `expiresAt`. */
  sensitive?: boolean
  /** Instante (ms) após o qual a mensagem não deve mais ser enviada. */
  expiresAt?: number
}

export function queueMail(to: string, subject: string, text: string, options: QueueMailOptions = {}) {
  const result = db
    .prepare('INSERT INTO mail_outbox (to_email, subject, body, sensitive, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(to, subject, text, options.sensitive ? 1 : 0, options.expiresAt ?? null)

  if (env.NODE_ENV !== 'test') setImmediate(() => void processMailOutbox())
  return Number(result.lastInsertRowid)
}

export async function processMailOutbox(now = () => Date.now()) {
  if (processing) return
  processing = true
  try {
    const messages = db
      .prepare(
        `SELECT id, to_email, subject, body, attempts, sensitive, expires_at
         FROM mail_outbox
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at ASC, id ASC
         LIMIT 10`,
      )
      .all(now()) as Array<{
      id: number
      to_email: string
      subject: string
      body: string
      attempts: number
      sensitive: number
      expires_at: number | null
    }>

    for (const message of messages) {
      if (message.expires_at != null && message.expires_at <= now()) {
        // Link já vencido: enviar só confundiria a pessoa. O corpo é descartado.
        db.prepare("UPDATE mail_outbox SET status = 'expired', body = ?, last_error = NULL WHERE id = ?").run(redactedMailBody, message.id)
        continue
      }
      try {
        await mailTransport.send({ to: message.to_email, subject: message.subject, text: message.body, sensitive: Boolean(message.sensitive) })
        db.prepare("UPDATE mail_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, body = ?, last_error = NULL WHERE id = ?").run(
          redactedMailBody,
          message.id,
        )
      } catch (error) {
        const attempts = message.attempts + 1
        const terminal = attempts >= 5
        const retryDelay = Math.min(60 * 60_000, 2 ** attempts * 60_000)
        const reason = redactSecrets(error instanceof Error ? error.message : String(error))
        db.prepare(
          `UPDATE mail_outbox
           SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, body = CASE WHEN ? THEN ? ELSE body END
           WHERE id = ?`,
        ).run(terminal ? 'failed' : 'pending', attempts, now() + retryDelay, reason, terminal ? 1 : 0, redactedMailBody, message.id)
        console.error(`[mail] Falha ao enviar mensagem #${message.id} (tentativa ${attempts}): ${reason}`)
      }
    }
  } finally {
    processing = false
  }
}

/** Remove registros processados mais antigos que o prazo e garante que nenhum corpo processado sobreviva. */
export function purgeMailOutbox(retentionDays = env.MAIL_OUTBOX_RETENTION_DAYS, now = new Date()) {
  db.prepare("UPDATE mail_outbox SET body = ? WHERE status <> 'pending' AND body <> ?").run(redactedMailBody, redactedMailBody)
  if (retentionDays <= 0) return 0
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
  return db.prepare("DELETE FROM mail_outbox WHERE status <> 'pending' AND created_at < ?").run(cutoff).changes
}

export function startMailWorker() {
  if (env.NODE_ENV === 'test' || worker) return
  worker = setInterval(() => void processMailOutbox(), 60_000)
  worker.unref()
  void processMailOutbox()
}

/** Envia um e-mail por dia com as notificações não lidas de quem ativou o resumo diário. */
export function sendDailyDigests(now = new Date()) {
  const recipients = db
    .prepare(
      `SELECT users.id, users.email, notification_preferences.last_digest_at
       FROM notification_preferences JOIN users ON users.id = notification_preferences.user_id
       WHERE notification_preferences.digest_enabled = 1 AND notification_preferences.email_enabled = 1
         AND users.status = 'active'
         AND (notification_preferences.last_digest_at IS NULL OR notification_preferences.last_digest_at <= datetime(?, '-1 day'))`,
    )
    .all(now.toISOString()) as Array<{ id: number; email: string; last_digest_at: string | null }>

  let sent = 0
  for (const recipient of recipients) {
    const since = recipient.last_digest_at ?? new Date(now.getTime() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
    const unread = db
      .prepare('SELECT title, body FROM notifications WHERE user_id = ? AND read_at IS NULL AND created_at > ? ORDER BY id LIMIT 20')
      .all(recipient.id, since) as Array<{ title: string; body: string }>
    db.prepare("UPDATE notification_preferences SET last_digest_at = datetime(?) WHERE user_id = ?").run(now.toISOString(), recipient.id)
    if (!unread.length) continue
    const lines = unread.map((entry) => `- ${entry.title}: ${entry.body}`).join('\n')
    queueMail(
      recipient.email,
      `ARGOS: resumo com ${unread.length} novidade${unread.length > 1 ? 's' : ''}`,
      `${lines}\n\nVeja tudo em ${env.FRONTEND_URL.replace(/\/$/, '')}/notifications`,
    )
    sent += 1
  }
  return sent
}
