import nodemailer from 'nodemailer'
import { env } from '../config/env.js'
import { db } from '../db/database.js'

let transporter: nodemailer.Transporter | null = null
let processing = false
let worker: NodeJS.Timeout | null = null

export function mailConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)
}

function getTransporter() {
  // Gmail (smtp.gmail.com, senha de app), Brevo (smtp-relay.brevo.com) e Resend (smtp.resend.com) usam SMTP padrão.
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  })
  return transporter
}

export async function sendMail(to: string, subject: string, text: string) {
  if (!mailConfigured()) {
    console.log(`[mail:dev] ${to} | ${subject} | ${text}`)
    return
  }
  await getTransporter().sendMail({ from: env.MAIL_FROM, to, subject, text })
}

/** Confere a conexão e a autenticação com o servidor SMTP (usado no teste de e-mail do admin). */
export async function verifyMailTransport() {
  if (!mailConfigured()) return { configured: false as const }
  await getTransporter().verify()
  return { configured: true as const, host: env.SMTP_HOST }
}

export function queueMail(to: string, subject: string, text: string) {
  const result = db
    .prepare('INSERT INTO mail_outbox (to_email, subject, body) VALUES (?, ?, ?)')
    .run(to, subject, text)

  if (env.NODE_ENV !== 'test') setImmediate(() => void processMailOutbox())
  return Number(result.lastInsertRowid)
}

export async function processMailOutbox() {
  if (processing) return
  processing = true
  try {
    const messages = db
      .prepare(
        `SELECT id, to_email, subject, body, attempts
         FROM mail_outbox
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at ASC
         LIMIT 10`,
      )
      .all(Date.now()) as Array<{ id: number; to_email: string; subject: string; body: string; attempts: number }>

    for (const message of messages) {
      try {
        await sendMail(message.to_email, message.subject, message.body)
        db.prepare("UPDATE mail_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?").run(message.id)
      } catch (error) {
        const attempts = message.attempts + 1
        const terminal = attempts >= 5
        const retryDelay = Math.min(60 * 60_000, 2 ** attempts * 60_000)
        db.prepare(
          `UPDATE mail_outbox
           SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?
           WHERE id = ?`,
        ).run(terminal ? 'failed' : 'pending', attempts, Date.now() + retryDelay, String(error).slice(0, 1000), message.id)
      }
    }
  } finally {
    processing = false
  }
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
