import { db } from '../db/database.js'
import type { Request } from 'express'
import type { Role } from '../db/database.js'
import { env } from '../config/env.js'
import { rolePermissions, type Permission } from '../shared/policies/permissions.js'
import { sendPushToUser } from '../integrations/push.js'
import { queueMail } from './mail.js'

export function logItemHistory(itemId: number, actorId: number | null, action: string, details?: unknown) {
  db.prepare('INSERT INTO item_history (item_id, actor_id, action, details) VALUES (?, ?, ?, ?)').run(
    itemId,
    actorId,
    action,
    details ? JSON.stringify(details) : null,
  )
}

// Eventos que pedem ação da pessoa e merecem e-mail imediato (quando ela não optou pelo resumo diário).
const emailNotificationTypes = new Set(['claim', 'approval', 'item_removed'])

export function notify(userId: number, title: string, body: string, type = 'info', actionUrl?: string) {
  const recipient = db
    .prepare(
      `SELECT users.email, users.status, notification_preferences.in_app_enabled,
              notification_preferences.email_enabled, notification_preferences.digest_enabled
       FROM users LEFT JOIN notification_preferences ON notification_preferences.user_id = users.id
       WHERE users.id = ?`,
    )
    .get(userId) as
    | { email: string; status: string; in_app_enabled: number | null; email_enabled: number | null; digest_enabled: number | null }
    | undefined
  if (!recipient || recipient.status !== 'active') return

  if (recipient.in_app_enabled !== 0) {
    db.prepare('INSERT INTO notifications (user_id, title, body, type, action_url) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      title,
      body,
      type,
      actionUrl ?? null,
    )
    // Push no navegador acompanha os alertas do app (só chega a quem ativou em Configurações).
    sendPushToUser(userId, { title, body, url: actionUrl })
  }

  if (emailNotificationTypes.has(type) && recipient.email_enabled !== 0 && recipient.digest_enabled !== 1) {
    const link = actionUrl ? `\n\nAbra no ARGOS: ${env.FRONTEND_URL.replace(/\/$/, '')}${actionUrl}` : ''
    queueMail(recipient.email, `ARGOS: ${title}`, `${body}${link}`)
  }
}

export function logAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId?: string | number | bigint | null,
  metadata?: unknown,
) {
  db.prepare(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    req.user?.id ?? null,
    action,
    entityType,
    entityId == null ? null : String(entityId),
    metadata ? JSON.stringify(metadata) : null,
    req.ip ?? req.socket.remoteAddress ?? null,
    req.get('user-agent') ?? null,
  )
}

export function notifyFollowers(itemId: number, actorId: number, title: string, body: string) {
  const followers = db.prepare('SELECT user_id FROM favorites WHERE item_id = ? AND user_id <> ?').all(itemId, actorId) as Array<{ user_id: number }>
  for (const follower of followers) notify(follower.user_id, title, body, 'following', `/items/${itemId}`)
}

/** Usuários ativos cujo papel concede a permissão (ex.: moderadores que devem ver denúncias). */
export function activeUserIdsWith(permission: Permission) {
  const roles = (Object.keys(rolePermissions) as Role[]).filter((role) => rolePermissions[role].includes(permission))
  if (!roles.length) return []
  const rows = db
    .prepare(`SELECT id FROM users WHERE status = 'active' AND role IN (${roles.map(() => '?').join(', ')})`)
    .all(...roles) as Array<{ id: number }>
  return rows.map((row) => row.id)
}
