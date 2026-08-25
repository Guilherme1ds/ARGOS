import { db } from '../db/database.js'
import { HttpError } from './http.js'

export function assertOwnedUpload(userId: number, url: string | null | undefined) {
  if (!url) return
  const upload = db.prepare('SELECT id FROM uploads WHERE user_id = ? AND url = ?').get(userId, url)
  if (!upload) throw new HttpError(422, 'Use uma imagem enviada pela sua conta no ARGOS.')
}
