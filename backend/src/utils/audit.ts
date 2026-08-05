import { db } from '../db/database.js'

export function logItemHistory(itemId: number, actorId: number | null, action: string, details?: unknown) {
  db.prepare('INSERT INTO item_history (item_id, actor_id, action, details) VALUES (?, ?, ?, ?)').run(
    itemId,
    actorId,
    action,
    details ? JSON.stringify(details) : null,
  )
}

export function notify(userId: number, title: string, body: string, type = 'info') {
  db.prepare('INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)').run(userId, title, body, type)
}
