import 'dotenv/config'
import { isIP } from 'node:net'
import { z } from 'zod'
// Antes de qualquer validação: mensagens de erro do Zod em português claro.
import '../utils/validation-messages.js'
import { durationToMs } from '../utils/duration.js'

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

const retentionDays = (fallback: number) => z.coerce.number().int().min(0).max(3650).default(fallback)

const developmentJwtSecret = 'dev-secret-change-me-please'
const developmentAdminPassword = 'Admin@123'

/**
 * Valores de TRUST_PROXY aceitos pelo Express sem confiar em qualquer cabeçalho X-Forwarded-For:
 * número de saltos (1-10), palavras-chave do proxy-addr ou lista de IPs/CIDRs dos proxies.
 */
export type TrustProxySetting = false | number | string

function parseTrustProxy(raw: string, productionLike: boolean, ctx: z.RefinementCtx): TrustProxySetting {
  const value = raw.trim().toLowerCase()
  if (['', 'false', '0', 'no'].includes(value)) return false
  if (value === 'true' || value === 'yes') {
    if (productionLike) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'TRUST_PROXY=true confia em qualquer X-Forwarded-For. Informe o número de saltos (ex.: 1) ou os IPs/CIDRs do proxy.',
      })
      return false
    }
    // Fora de produção, "true" vira 1 salto: usa o endereço anexado pelo proxy imediato, não o mais à esquerda.
    return 1
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value)
    if (hops < 1 || hops > 10) ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'TRUST_PROXY: use de 1 a 10 saltos.' })
    return hops
  }
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  const keywords = new Set(['loopback', 'linklocal', 'uniquelocal'])
  for (const entry of entries) {
    if (keywords.has(entry)) continue
    const [address, prefix, ...rest] = entry.split('/')
    const family = isIP(address)
    const validPrefix =
      prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= (family === 6 ? 128 : 32))
    if (!family || !validPrefix || rest.length) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'TRUST_PROXY: valor inválido. Use saltos, loopback/linklocal/uniquelocal ou IP/CIDR.' })
    }
  }
  return entries.join(',')
}

function absoluteUrl(value: string) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/** Estimativa de Shannon em bits: barra segredos curtos, repetitivos ou com poucos símbolos. */
export function estimatedEntropyBits(value: string) {
  if (!value) return 0
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let perChar = 0
  for (const count of counts.values()) {
    const p = count / value.length
    perChar -= p * Math.log2(p)
  }
  return perChar * value.length
}

function passwordClasses(value: string) {
  return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z.string().trim().min(1).default('./argos.sqlite'),
  JWT_SECRET: z.string().min(16).optional(),
  JWT_EXPIRES_IN: z.string().trim().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().trim().default('30d'),
  FRONTEND_URL: z.string().trim().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.string().default('false'),
  // lax (padrão) exige frontend e API no mesmo site; none só com HTTPS e verificação de origem.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  API_PUBLIC_URL: z.string().trim().default('http://localhost:3333'),
  MAX_BODY_MB: z.coerce.number().positive().max(20).default(1),
  UPLOAD_DIR: z.string().trim().min(1).default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(5),
  ADMIN_EMAIL: z.string().trim().email().default('admin@argos.local'),
  // Usada só para criar o administrador inicial; em produção não há valor padrão.
  ADMIN_PASSWORD: z.string().min(8).max(120).optional(),
  SMTP_HOST: optionalSecret,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: optionalSecret,
  SMTP_PASS: optionalSecret,
  // true para porta 465 (TLS direto); vazio = automático pela porta.
  SMTP_SECURE: z.enum(['true', 'false', '']).optional(),
  MAIL_FROM: z.string().trim().default('ARGOS <no-reply@argos.local>'),
  // Conta citizen de desenvolvimento, criada apenas quando a senha é definida explicitamente.
  DEV_TEST_USER_EMAIL: z.string().email().default('usuario.teste@argos.local'),
  DEV_TEST_USER_PASSWORD: z.string().min(8).optional(),
  // Prazo do link de confirmação de e-mail do cadastro por senha.
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  // Retenção (dias) de dados operacionais; 0 desativa o expurgo daquela categoria.
  MAIL_OUTBOX_RETENTION_DAYS: retentionDays(30),
  AUTH_TOKEN_RETENTION_DAYS: retentionDays(30),
  ACCESS_REQUEST_RETENTION_DAYS: retentionDays(180),
  // Auditoria é mantida até o responsável aprovar um prazo (0 = sem expurgo automático).
  AUDIT_LOG_RETENTION_DAYS: retentionDays(0),
  // Cópia do SQLite antes de aplicar migrações em um banco existente.
  MIGRATION_BACKUP: z.string().optional(),
  MIGRATION_BACKUP_DIR: z.string().trim().optional(),
  // Somente NODE_ENV=test: expõe o link de e-mails de teste (.test) para os testes HTTP automatizados.
  ENABLE_TEST_MAIL_SINK: booleanFlag,
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

const parsedSchema = envSchema.transform((raw, ctx) => {
  const productionLike = raw.NODE_ENV === 'production' || raw.NODE_ENV === 'staging'
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

  // Segredo do JWT: em produção/homologação precisa ser fornecido e ter alta entropia.
  const jwtSecret = raw.JWT_SECRET ?? (productionLike ? '' : developmentJwtSecret)
  if (productionLike) {
    if (!raw.JWT_SECRET) issue('JWT_SECRET', 'JWT_SECRET é obrigatório. Gere com: openssl rand -base64 48')
    else if (
      raw.JWT_SECRET === developmentJwtSecret ||
      raw.JWT_SECRET.length < 32 ||
      new Set(raw.JWT_SECRET).size < 10 ||
      estimatedEntropyBits(raw.JWT_SECRET) < 128
    ) {
      issue('JWT_SECRET', 'JWT_SECRET fraco: use ao menos 32 caracteres aleatórios (ex.: openssl rand -base64 48).')
    }
  }

  // Senha do administrador inicial: forte quando informada; sem padrão em produção.
  const adminPassword = raw.ADMIN_PASSWORD ?? (productionLike ? undefined : developmentAdminPassword)
  if (productionLike && raw.ADMIN_PASSWORD) {
    const lowered = raw.ADMIN_PASSWORD.toLowerCase()
    if (
      raw.ADMIN_PASSWORD === developmentAdminPassword ||
      raw.ADMIN_PASSWORD.length < 12 ||
      passwordClasses(raw.ADMIN_PASSWORD) < 3 ||
      lowered.includes('argos') ||
      lowered.includes('admin') ||
      lowered.includes('senha') ||
      lowered.includes('password')
    ) {
      issue('ADMIN_PASSWORD', 'ADMIN_PASSWORD fraca: use 12+ caracteres com 3 tipos (maiúsculas, minúsculas, números, símbolos) e sem palavras óbvias.')
    }
  }

  // Durações: formato <número><s|m|h|d> dentro de limites seguros.
  const accessTtl = durationToMs(raw.JWT_EXPIRES_IN)
  if (accessTtl === null || accessTtl < 60_000 || accessTtl > 24 * 3_600_000) {
    issue('JWT_EXPIRES_IN', 'JWT_EXPIRES_IN: use de 1m a 24h no formato 15m, 1h etc.')
  }
  const refreshTtl = durationToMs(raw.REFRESH_TOKEN_EXPIRES_IN)
  if (refreshTtl === null || refreshTtl < 3_600_000 || refreshTtl > 90 * 86_400_000) {
    issue('REFRESH_TOKEN_EXPIRES_IN', 'REFRESH_TOKEN_EXPIRES_IN: use de 1h a 90d no formato 12h, 30d etc.')
  }

  // URLs públicas e origens: absolutas, sem credenciais; HTTPS e host real em produção.
  for (const key of ['FRONTEND_URL', 'API_PUBLIC_URL'] as const) {
    const url = absoluteUrl(raw[key])
    if (!url) issue(key, `${key}: informe uma URL absoluta http(s) sem usuário/senha.`)
    else if (productionLike && (url.protocol !== 'https:' || localHosts.has(url.hostname))) {
      issue(key, `${key}: em produção/homologação use https e o domínio real.`)
    }
  }
  const corsOrigins = raw.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  if (!corsOrigins.length) issue('CORS_ORIGINS', 'CORS_ORIGINS: informe ao menos uma origem.')
  for (const origin of corsOrigins) {
    const url = absoluteUrl(origin)
    if (!url || url.origin !== origin.replace(/\/$/, '')) {
      issue('CORS_ORIGINS', 'CORS_ORIGINS: cada item deve ser uma origem (esquema://host[:porta]), sem caminho nem curinga.')
    } else if (productionLike && (url.protocol !== 'https:' || localHosts.has(url.hostname))) {
      issue('CORS_ORIGINS', 'CORS_ORIGINS: em produção/homologação use apenas origens https reais.')
    }
  }

  const trustProxy = parseTrustProxy(raw.TRUST_PROXY, productionLike, ctx)

  if (raw.COOKIE_SAMESITE === 'none' && !productionLike) {
    issue('COOKIE_SAMESITE', 'COOKIE_SAMESITE=none exige HTTPS (NODE_ENV production ou staging).')
  }

  // E-mail: produção/homologação não pode cair no modo de desenvolvimento (links de senha e confirmação).
  if (productionLike && !raw.SMTP_HOST) issue('SMTP_HOST', 'SMTP_HOST é obrigatório em produção/homologação para enviar links de confirmação e de senha.')
  if (raw.NODE_ENV === 'production') {
    if (!raw.SMTP_USER || !raw.SMTP_PASS) issue('SMTP_USER', 'SMTP_USER e SMTP_PASS são obrigatórios em produção.')
    if (raw.SMTP_SECURE === 'false' && raw.SMTP_PORT === 25) issue('SMTP_PORT', 'SMTP sem TLS na porta 25 não é aceito em produção.')
    if (/@argos\.local>?$/i.test(raw.MAIL_FROM)) issue('MAIL_FROM', 'MAIL_FROM: use um remetente do domínio real.')
  }

  if (raw.ENABLE_TEST_MAIL_SINK && raw.NODE_ENV !== 'test') {
    issue('ENABLE_TEST_MAIL_SINK', 'ENABLE_TEST_MAIL_SINK só pode ser usado com NODE_ENV=test.')
  }

  const migrationBackup =
    raw.MIGRATION_BACKUP === undefined || raw.MIGRATION_BACKUP.trim() === ''
      ? raw.NODE_ENV !== 'test'
      : ['true', '1', 'yes'].includes(raw.MIGRATION_BACKUP.trim().toLowerCase())

  return {
    ...raw,
    JWT_SECRET: jwtSecret,
    ADMIN_PASSWORD: adminPassword,
    TRUST_PROXY: trustProxy,
    MIGRATION_BACKUP: migrationBackup,
    ACCESS_TOKEN_TTL_MS: accessTtl ?? 15 * 60_000,
    REFRESH_TOKEN_TTL_MS: refreshTtl ?? 30 * 86_400_000,
    CORS_ORIGIN_LIST: corsOrigins.map((origin) => origin.replace(/\/$/, '')),
    PRODUCTION_LIKE: productionLike,
  }
})

export type Env = z.infer<typeof parsedSchema>

/** Valida variáveis de ambiente; mensagens citam a variável, nunca o valor. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = parsedSchema.safeParse(source)
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `- ${issue.path.join('.') || 'env'}: ${issue.message}`)
    throw new Error(`Configuração inválida (${source.NODE_ENV ?? 'development'}):\n${[...new Set(problems)].join('\n')}`)
  }
  return result.data
}

export const env = parseEnv(process.env)

export const corsOrigins = env.CORS_ORIGIN_LIST
