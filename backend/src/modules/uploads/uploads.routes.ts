import { Router } from 'express'
import multer from 'multer'
import { mkdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { nanoid } from 'nanoid'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
const uploadDir = resolve(env.UPLOAD_DIR)
mkdirSync(uploadDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${nanoid(8)}${extname(file.originalname)}`),
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
  },
})

router.post(
  '/',
  auth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(422).json({ message: 'Arquivo de imagem obrigatório.' })
    const url = `/uploads/${req.file.filename}`
    const result = db
      .prepare('INSERT INTO uploads (user_id, filename, original_name, mime_type, size, url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user!.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url)
    res.status(201).json({ id: result.lastInsertRowid, url })
  }),
)

export { router as uploadRoutes }
