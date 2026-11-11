import { beforeAll, describe, expect, it } from 'vitest'

// Valores fictícios gerados só para o teste; nenhum é usado fora deste arquivo.
const strongSecret = 'u7Q2pX9vLr4mZt8KcW1sYb6NhD3fJg5aE0oRiTqP'
const strongAdmin = 'Campus#Lost-and-Found-2026'

let parseEnv: typeof import('../src/config/env.js').parseEnv
let estimatedEntropyBits: typeof import('../src/config/env.js').estimatedEntropyBits

function production(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: strongSecret,
    ADMIN_PASSWORD: strongAdmin,
    FRONTEND_URL: 'https://argos.campus.example',
    API_PUBLIC_URL: 'https://argos.campus.example',
    CORS_ORIGINS: 'https://argos.campus.example',
    SMTP_HOST: 'smtp.campus.example',
    SMTP_USER: 'argos',
    SMTP_PASS: 'smtp-password-from-secret-store',
    MAIL_FROM: 'ARGOS <no-reply@campus.example>',
    TRUST_PROXY: '1',
    ...overrides,
  } as NodeJS.ProcessEnv
}

function failure(source: NodeJS.ProcessEnv) {
  try {
    parseEnv(source)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('parseEnv deveria ter falhado')
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  ;({ parseEnv, estimatedEntropyBits } = await import('../src/config/env.js'))
})

describe('SEC-04 production configuration guards', () => {
  it('accepts a complete, strong production configuration', () => {
    const env = parseEnv(production())
    expect(env.PRODUCTION_LIKE).toBe(true)
    expect(env.TRUST_PROXY).toBe(1)
    expect(env.ACCESS_TOKEN_TTL_MS).toBe(15 * 60_000)
    expect(env.REFRESH_TOKEN_TTL_MS).toBe(30 * 86_400_000)
  })

  it('rejects missing, default and low-entropy JWT secrets without echoing the value', () => {
    expect(failure(production({ JWT_SECRET: undefined }))).toMatch(/JWT_SECRET/)
    expect(failure(production({ JWT_SECRET: 'dev-secret-change-me-please' }))).toMatch(/JWT_SECRET/)
    const repeated = 'a'.repeat(64)
    const message = failure(production({ JWT_SECRET: repeated }))
    expect(message).toMatch(/JWT_SECRET fraco/)
    expect(message).not.toContain(repeated)
    expect(failure(production({ JWT_SECRET: 'abcdabcdabcdabcdabcdabcdabcdabcd' }))).toMatch(/JWT_SECRET fraco/)
    expect(estimatedEntropyBits(strongSecret)).toBeGreaterThan(128)
  })

  it('rejects weak or default bootstrap admin passwords and has no default in production', () => {
    for (const weak of ['Admin@123', 'short1!', 'alllowercaseletters', 'Argos@Campus2026', 'Password@2026x']) {
      const message = failure(production({ ADMIN_PASSWORD: weak }))
      expect(message).toMatch(/ADMIN_PASSWORD/)
      expect(message).not.toContain(weak)
    }
    expect(parseEnv(production({ ADMIN_PASSWORD: undefined })).ADMIN_PASSWORD).toBeUndefined()
    expect(parseEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).ADMIN_PASSWORD).toBe('Admin@123')
  })

  it('validates TTL format and bounds instead of silently falling back', () => {
    expect(failure(production({ JWT_EXPIRES_IN: '15 minutes' }))).toMatch(/JWT_EXPIRES_IN/)
    expect(failure(production({ JWT_EXPIRES_IN: '30d' }))).toMatch(/JWT_EXPIRES_IN/)
    expect(failure(production({ REFRESH_TOKEN_EXPIRES_IN: '30x' }))).toMatch(/REFRESH_TOKEN_EXPIRES_IN/)
    expect(failure(production({ REFRESH_TOKEN_EXPIRES_IN: '400d' }))).toMatch(/REFRESH_TOKEN_EXPIRES_IN/)
    expect(parseEnv(production({ JWT_EXPIRES_IN: '1h', REFRESH_TOKEN_EXPIRES_IN: '7d' })).REFRESH_TOKEN_TTL_MS).toBe(7 * 86_400_000)
  })

  it('requires absolute https URLs and real origins in production', () => {
    expect(failure(production({ FRONTEND_URL: 'argos.campus.example' }))).toMatch(/FRONTEND_URL/)
    expect(failure(production({ API_PUBLIC_URL: 'http://argos.campus.example' }))).toMatch(/API_PUBLIC_URL/)
    expect(failure(production({ API_PUBLIC_URL: 'https://localhost:3333' }))).toMatch(/API_PUBLIC_URL/)
    expect(failure(production({ CORS_ORIGINS: '*' }))).toMatch(/CORS_ORIGINS/)
    expect(failure(production({ CORS_ORIGINS: 'https://argos.campus.example/app' }))).toMatch(/CORS_ORIGINS/)
    expect(failure(production({ FRONTEND_URL: 'https://user:pass@argos.campus.example' }))).toMatch(/FRONTEND_URL/)
  })

  it('SEC-01: refuses to start production or staging without a real mail transport', () => {
    expect(failure(production({ SMTP_HOST: undefined }))).toMatch(/SMTP_HOST/)
    expect(failure(production({ SMTP_PASS: undefined }))).toMatch(/SMTP_USER e SMTP_PASS/)
    expect(failure(production({ MAIL_FROM: 'ARGOS <no-reply@argos.local>' }))).toMatch(/MAIL_FROM/)
    expect(failure(production({ NODE_ENV: 'staging', SMTP_HOST: '' }))).toMatch(/SMTP_HOST/)
  })

  it('does not trust arbitrary forwarded headers in production', () => {
    expect(failure(production({ TRUST_PROXY: 'true' }))).toMatch(/TRUST_PROXY/)
    expect(failure(production({ TRUST_PROXY: '99' }))).toMatch(/TRUST_PROXY/)
    expect(failure(production({ TRUST_PROXY: '10.0.0.0/99' }))).toMatch(/TRUST_PROXY/)
    expect(parseEnv(production({ TRUST_PROXY: '10.0.0.0/8, loopback' })).TRUST_PROXY).toBe('10.0.0.0/8,loopback')
    expect(parseEnv(production({ TRUST_PROXY: 'false' })).TRUST_PROXY).toBe(false)
    // Fora de produção, "true" (legado) vira 1 salto em vez de confiar em toda a cadeia.
    expect(parseEnv({ NODE_ENV: 'test', TRUST_PROXY: 'true' } as NodeJS.ProcessEnv).TRUST_PROXY).toBe(1)
  })

  it('OPS-02: allows SameSite=None only over HTTPS and blocks the test mail sink outside tests', () => {
    expect(failure({ NODE_ENV: 'development', COOKIE_SAMESITE: 'none' } as NodeJS.ProcessEnv)).toMatch(/COOKIE_SAMESITE/)
    expect(parseEnv(production({ COOKIE_SAMESITE: 'none' })).COOKIE_SAMESITE).toBe('none')
    expect(failure({ NODE_ENV: 'development', ENABLE_TEST_MAIL_SINK: 'true' } as NodeJS.ProcessEnv)).toMatch(/ENABLE_TEST_MAIL_SINK/)
    expect(failure(production({ ENABLE_TEST_MAIL_SINK: 'true' }))).toMatch(/ENABLE_TEST_MAIL_SINK/)
  })
})
