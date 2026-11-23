import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'

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
})
