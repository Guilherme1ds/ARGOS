import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'

// Variável cujo nome termina em KEY/SECRET/PASS/PASSWORD/TOKEN (prazos como REFRESH_TOKEN_EXPIRES_IN ficam de fora).
const secretName = /(?:^|_)(?:KEY|SECRET|PASS|PASSWORD|TOKEN)$/
// Únicos valores aceitos nos exemplos: vazio ou marcador evidente, recusado pela API em produção.
const placeholder = /^(?:|<[^>]+>|change-me-in-production)$/

/** Nomes (nunca valores) das variáveis secretas preenchidas num arquivo .env. */
function filledSecrets(text: string) {
  return Object.entries(parse(text))
    .filter(([name, value]) => secretName.test(name) && !placeholder.test(value.trim()))
    .map(([name]) => name)
}

// Copiar .env.example para .env (passo do README) precisa subir a API sem ajuste manual em desenvolvimento.
describe('.env.example', () => {
  it('parses in development and test exactly as shipped', async () => {
    process.env.NODE_ENV = 'test'
    const { parseEnv } = await import('../src/config/env.js')
    const example = parse(readFileSync(new URL('../.env.example', import.meta.url)))
    for (const mode of ['development', 'test']) {
      const parsed = parseEnv({ ...example, NODE_ENV: mode })
      expect(parsed.DEV_TEST_USER_PASSWORD).toBeUndefined()
    }
  })

  // Uma chave DeepL real foi versionada em backend/.env.example (commit 5ea4299) num repositório público.
  it('ships no secret values in any .env.example of the repository', () => {
    expect(filledSecrets('DEEPL_API_KEY=abc123:fx\nJWT_SECRET=change-me-in-production\nREFRESH_TOKEN_EXPIRES_IN=30d\nSMTP_PASS=')).toEqual(['DEEPL_API_KEY'])
    for (const file of ['../.env.example', '../../deploy/.env.example', '../../frontend/.env.example']) {
      expect(filledSecrets(readFileSync(new URL(file, import.meta.url), 'utf8')), `${file}: deixe o valor vazio; o segredo vai no .env local ou no cofre`).toEqual([])
    }
  })
})
