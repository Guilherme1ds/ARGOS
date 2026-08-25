import nodemailer from 'nodemailer'
import { env } from '../config/env.js'
import { db } from '../db/database.js'

let transporter: nodemailer.Transporter | null = null
let processing = false
let worker: NodeJS.Timeout | null = null

export async function sendMail(to: string, subject: string, text: string) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    console.log(`[mail:dev] ${to} | ${subject} | ${text}`)
    return
  }

  transporter ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })

  await transporter.sendMail({ from: env.MAIL_FROM, to, subject, text })
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
