import 'dotenv/config'
import { z } from 'zod'

// z.coerce.boolean() trata qualquer string não vazia como true, inclusive "false".
const booleanFlag = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no', '']))
  .default('false')
  .transform((value) => value === 'true' || value === '1' || value === 'yes')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().default('./argos.sqlite'),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-me-please'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: booleanFlag,
  API_PUBLIC_URL: z.string().default('http://localhost:3333'),
  MAX_BODY_MB: z.coerce.number().positive().default(1),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(5),
  ADMIN_EMAIL: z.string().email().default('admin@argos.local'),
  ADMIN_PASSWORD: z.string().min(8).default('Admin@123'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('ARGOS <no-reply@argos.local>'),
  // Conta citizen de desenvolvimento, criada apenas quando a senha é definida explicitamente.
  DEV_TEST_USER_EMAIL: z.string().email().default('usuario.teste@argos.local'),
  DEV_TEST_USER_PASSWORD: z.string().min(8).optional(),
})

const parsed = envSchema.parse(process.env)

if (parsed.NODE_ENV === 'production') {
  const unsafeDefaults = [
    parsed.JWT_SECRET === 'dev-secret-change-me-please' && 'JWT_SECRET',
    parsed.ADMIN_PASSWORD === 'Admin@123' && 'ADMIN_PASSWORD',
    parsed.CORS_ORIGINS === 'http://localhost:5173' && 'CORS_ORIGINS',
    parsed.API_PUBLIC_URL === 'http://localhost:3333' && 'API_PUBLIC_URL',
  ].filter(Boolean)

  if (unsafeDefaults.length) {
    throw new Error(`Defina valores seguros para producao: ${unsafeDefaults.join(', ')}.`)
  }
}

export const env = parsed

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
