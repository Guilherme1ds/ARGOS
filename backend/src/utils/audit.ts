import { db } from '../db/database.js'
import type { Request } from 'express'

export function logItemHistory(itemId: number, actorId: number | null, action: string, details?: unknown) {
  db.prepare('INSERT INTO item_history (item_id, actor_id, action, details) VALUES (?, ?, ?, ?)').run(
    itemId,
    actorId,
    action,
    details ? JSON.stringify(details) : null,
  )
}

export function notify(userId: number, title: string, body: string, type = 'info', actionUrl?: string) {
  const preferences = db
    .prepare('SELECT in_app_enabled FROM notification_preferences WHERE user_id = ?')
    .get(userId) as { in_app_enabled: number } | undefined
  if (preferences?.in_app_enabled === 0) return
  db.prepare('INSERT INTO notifications (user_id, title, body, type, action_url) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    title,
    body,
    type,
    actionUrl ?? null,
  )
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
