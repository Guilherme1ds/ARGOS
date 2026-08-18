import { Router } from 'express'
import multer from 'multer'
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { nanoid } from 'nanoid'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'

const router = Router()
const uploadDir = resolve(env.UPLOAD_DIR)
mkdirSync(uploadDir, { recursive: true })

const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp']

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${nanoid(8)}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, allowedMimeTypes.includes(file.mimetype))
  },
})

function detectImageMime(path: string) {
  const header = readFileSync(path).subarray(0, 16)
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg'
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

router.post(
  '/',
  auth,
  rateLimit(20, 60_000),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Arquivo de imagem obrigatório.')

    const detectedMime = detectImageMime(req.file.path)
    if (!detectedMime || detectedMime !== req.file.mimetype) {
      unlinkSync(req.file.path)
      throw new HttpError(422, 'Arquivo recusado: o conteúdo não corresponde ao tipo de imagem informado.')
    }

    const url = `/uploads/${req.file.filename}`
    const result = db
      .prepare('INSERT INTO uploads (user_id, filename, original_name, mime_type, size, url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user!.id, req.file.filename, req.file.originalname, detectedMime, req.file.size, url)
    logAudit(req, 'upload.created', 'upload', result.lastInsertRowid, {
      mimeType: detectedMime,
      size: req.file.size,
    })
    res.status(201).json({ id: result.lastInsertRowid, url })
  }),
)

export { router as uploadRoutes }
