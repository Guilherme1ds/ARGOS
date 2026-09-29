import webpush from 'web-push'
import { env } from '../config/env.js'
import { db } from '../db/database.js'

type VapidKeys = { publicKey: string; privateKey: string }

let keys: VapidKeys | null = null

/** Chaves VAPID do .env ou, sem elas, um par gerado uma vez e guardado no banco (as inscrições dependem dele). */
export function vapidKeys(): VapidKeys {
  if (keys) return keys
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  } else {
    const stored = db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_keys'").get() as { value: string } | undefined
    if (stored) {
      keys = JSON.parse(stored.value) as VapidKeys
    } else {
      keys = webpush.generateVAPIDKeys()
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('vapid_keys', ?)").run(JSON.stringify(keys))
    }
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, keys.publicKey, keys.privateKey)
  return keys
}

export function saveSubscription(userId: number, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       user_agent = excluded.user_agent`,
  ).run(userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent ?? null)
}

export function removeSubscription(userId: number, endpoint: string) {
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint).changes
}

/** Envia sem bloquear a requisição; inscrições expiradas (404/410) são descartadas. */
export function sendPushToUser(userId: number, payload: { title: string; body: string; url?: string | null }) {
  const subscriptions = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId) as Array<{
    id: number
    endpoint: string
    p256dh: string
    auth: string
  }>
  if (!subscriptions.length) return
  vapidKeys()
  const message = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? '/notifications' })
  for (const subscription of subscriptions) {
    webpush
      .sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, message, { TTL: 60 * 60 * 24 })
      .catch((error: { statusCode?: number }) => {
        if (error.statusCode === 404 || error.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscription.id)
        } else {
          console.error('[push] Falha ao enviar notificação.', error)
        }
      })
  }
}
