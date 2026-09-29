import { existsSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { db } from '../db/database.js'
import { env } from '../config/env.js'
import { sendDailyDigests } from './mail.js'

// Drafts expire after seven days. Keep uploads for eight days to allow safe recovery.
export function cleanOrphanUploads() {
  const root = resolve(env.UPLOAD_DIR)
  return db.transaction(() => {
    const candidates = db.prepare(`SELECT id, filename FROM uploads
      WHERE created_at < datetime('now', '-8 days')
        AND NOT EXISTS (SELECT 1 FROM items WHERE items.image_url = uploads.url)
        AND NOT EXISTS (SELECT 1 FROM users WHERE users.avatar_url = uploads.url)
      LIMIT 50`).all() as Array<{ id: number; filename: string }>
    let removed = 0
    for (const upload of candidates) {
      const target = resolve(root, upload.filename)
      if (!/^[\w.-]+$/.test(upload.filename) || dirname(target) !== root) continue
      if (existsSync(target)) unlinkSync(target)
      db.prepare('DELETE FROM uploads WHERE id = ?').run(upload.id)
      removed++
    }
    return removed
  })()
}

// Revogados ainda válidos ficam para detectar reuso; só os expirados há mais de um dia são descartados.
export function purgeStaleRefreshTokens() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  return db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(cutoff).changes
}

export function startUploadCleanup() {
  const sweep = () => {
    try { cleanOrphanUploads() } catch { console.error('[uploads] Falha na limpeza de arquivos expirados.') }
    try { purgeStaleRefreshTokens() } catch { console.error('[auth] Falha na limpeza de sessões expiradas.') }
    try { sendDailyDigests() } catch { console.error('[mail] Falha ao gerar resumos diários.') }
  }
  const timer = setInterval(sweep, 60 * 60 * 1000)
  timer.unref()
  return timer
}
