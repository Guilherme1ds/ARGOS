import { Router } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
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
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, allowedMimeTypes.includes(file.mimetype))
  },
})

function detectImageMime(buffer: Buffer) {
  const header = buffer.subarray(0, 16)
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg'
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

async function sanitizeImage(buffer: Buffer, mimeType: string) {
  const pipeline = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
  if (mimeType === 'image/jpeg') return pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
  if (mimeType === 'image/png') return pipeline.png({ compressionLevel: 9 }).toBuffer()
  return pipeline.webp({ quality: 88 }).toBuffer()
}

router.post(
  '/',
  auth,
  rateLimit(20, 60_000),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(422, 'Arquivo de imagem obrigatório.')

    const detectedMime = detectImageMime(req.file.buffer)
    if (!detectedMime || detectedMime !== req.file.mimetype) {
      throw new HttpError(422, 'Arquivo recusado: o conteúdo não corresponde ao tipo de imagem informado.')
    }

    let sanitized: Buffer
    try {
      // A recodificação aplica a orientação e descarta EXIF, GPS e demais metadados.
      sanitized = await sanitizeImage(req.file.buffer, detectedMime)
    } catch {
      throw new HttpError(422, 'Arquivo recusado: imagem inválida ou corrompida.')
    }

    const extension = detectedMime === 'image/jpeg' ? '.jpg' : detectedMime === 'image/png' ? '.png' : '.webp'
    const filename = `${Date.now()}-${nanoid(8)}${extension}`
    const outputPath = join(uploadDir, filename)
    const url = `/uploads/${filename}`
    const checksum = createHash('sha256').update(sanitized).digest('hex')

    await writeFile(outputPath, sanitized)
    try {
      const result = db
        .prepare('INSERT INTO uploads (user_id, filename, original_name, mime_type, size, checksum, url) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(req.user!.id, filename, req.file.originalname, detectedMime, sanitized.length, checksum, url)
      logAudit(req, 'upload.created', 'upload', result.lastInsertRowid, {
        mimeType: detectedMime,
        originalSize: req.file.size,
        sanitizedSize: sanitized.length,
      })
      res.status(201).json({ id: result.lastInsertRowid, url })
    } catch (error) {
      await unlink(outputPath).catch(() => undefined)
      throw error
    }
  }),
)

export { router as uploadRoutes }
