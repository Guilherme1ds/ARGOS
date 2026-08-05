import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db, type DbUser } from '../../db/database.js'
import { auth, signToken } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { sendMail } from '../../utils/mail.js'

const router = Router()

const registerSchema = z.object({
  name: z.string().min(3).max(120),
  email: z.string().email().max(160),
  password: z.string().min(8).max(120),
  requestAccess: z.boolean().optional(),
  reason: z.string().max(500).optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

function publicUser(user: DbUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    spamScore: user.spam_score,
  }
}

router.post(
  '/register',
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email)
    if (existing) throw new HttpError(409, 'E-mail já cadastrado.')

    if (input.requestAccess) {
      db.prepare('INSERT INTO access_requests (name, email, reason) VALUES (?, ?, ?)').run(
        input.name,
        input.email,
        input.reason ?? null,
      )
      return res.status(202).json({ message: 'Solicitação de acesso enviada para aprovação.' })
    }

    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
      .run(input.name, input.email, await bcrypt.hash(input.password, 12), 'user', 'active')

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as DbUser
    await sendMail(user.email, 'Bem-vindo ao ARGOS', 'Sua conta foi criada com sucesso.')
    res.status(201).json({ user: publicUser(user), token: signToken(user) })
  }),
)

router.post(
  '/login',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email) as DbUser | undefined
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      throw new HttpError(401, 'Credenciais inválidas.')
    }
    if (user.status !== 'active') throw new HttpError(403, 'Usuário pendente ou bloqueado.')
    res.json({ user: publicUser(user), token: signToken(user) })
  }),
)

router.get(
  '/me',
  auth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user })
  }),
)

export { router as authRoutes }
