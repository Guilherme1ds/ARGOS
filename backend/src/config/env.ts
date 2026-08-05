import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().default('./argos.sqlite'),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(5),
  ADMIN_EMAIL: z.string().email().default('admin@argos.local'),
  ADMIN_PASSWORD: z.string().min(8).default('Admin@123'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('ARGOS <no-reply@argos.local>'),
})

export const env = envSchema.parse(process.env)
