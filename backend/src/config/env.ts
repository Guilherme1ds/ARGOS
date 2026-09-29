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

// Chaves de integrações são opcionais: vazio ou ausente desliga o recurso.
const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)

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
  // true para porta 465 (TLS direto); vazio = automático pela porta.
  SMTP_SECURE: z.enum(['true', 'false', '']).optional(),
  MAIL_FROM: z.string().default('ARGOS <no-reply@argos.local>'),
  // Conta citizen de desenvolvimento, criada apenas quando a senha é definida explicitamente.
  DEV_TEST_USER_EMAIL: z.string().email().default('usuario.teste@argos.local'),
  DEV_TEST_USER_PASSWORD: z.string().min(8).optional(),
  // IA com visão (Claude API): sugere título, categoria e descrição a partir da foto.
  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_MODEL: z.string().trim().default('claude-opus-5'),
  // Tradução do conteúdo das publicações: DeepL (preferido) ou LibreTranslate.
  DEEPL_API_KEY: optionalSecret,
  LIBRETRANSLATE_URL: optionalSecret,
  LIBRETRANSLATE_API_KEY: optionalSecret,
  // Login com Google (Google Identity Services).
  GOOGLE_CLIENT_ID: optionalSecret,
  // CAPTCHA Cloudflare Turnstile no cadastro e na recuperação de senha.
  TURNSTILE_SITE_KEY: optionalSecret,
  TURNSTILE_SECRET_KEY: optionalSecret,
  // Web Push: sem chaves, o servidor gera um par VAPID e guarda no banco.
  VAPID_PUBLIC_KEY: optionalSecret,
  VAPID_PRIVATE_KEY: optionalSecret,
  VAPID_SUBJECT: z.string().trim().default('mailto:admin@argos.local'),
  // Centro padrão do mapa (campus).
  MAP_CENTER_LAT: z.coerce.number().min(-90).max(90).default(-23.5505),
  MAP_CENTER_LNG: z.coerce.number().min(-180).max(180).default(-46.6333),
  MAP_ZOOM: z.coerce.number().int().min(3).max(19).default(16),
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
