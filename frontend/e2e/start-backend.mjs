// Sobe uma API ARGOS descartável para o E2E: banco e uploads em pasta temporária exclusiva,
// integrações externas vazias e o .env local ignorado. Remove só a pasta que criou ao encerrar.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const backendDir = resolve(fileURLToPath(new URL('../../backend', import.meta.url)))
const tempRoot = resolve(tmpdir())
// No Windows o Playwright encerra a árvore de processos à força e o handler de saída não roda:
// cada execução registra a pasta que criou e a próxima remove as anteriores (somente as registradas).
const registryPath = join(tempRoot, 'argos-e2e-dirs.json')

function ownTempDir(path) {
  const absolute = resolve(path)
  return absolute.startsWith(tempRoot + sep) && absolute.slice(tempRoot.length + 1).startsWith('argos-e2e-') && !absolute.slice(tempRoot.length + 1).includes(sep)
}

function readRegistry() {
  try {
    const entries = JSON.parse(readFileSync(registryPath, 'utf8'))
    return Array.isArray(entries) ? entries.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const leftovers = readRegistry().filter((path) => {
  if (!ownTempDir(path) || !existsSync(path)) return false
  try {
    rmSync(path, { recursive: true, force: true })
    return false
  } catch {
    return true // ainda em uso por outra execução: tenta de novo na próxima
  }
})

const root = mkdtempSync(join(tempRoot, 'argos-e2e-'))
writeFileSync(registryPath, JSON.stringify([...leftovers, root]))
const emptyEnv = join(root, 'empty.env')
writeFileSync(emptyEnv, '')

const port = process.env.E2E_API_PORT ?? '3401'
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:4173'
const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: port,
  DOTENV_CONFIG_PATH: emptyEnv,
  DATABASE_URL: join(root, 'argos.sqlite'),
  UPLOAD_DIR: join(root, 'uploads'),
  JWT_SECRET: randomBytes(32).toString('base64url'),
  ADMIN_EMAIL: 'admin@argos.test',
  ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin#Password-1',
  API_PUBLIC_URL: `http://localhost:${port}`,
  FRONTEND_URL: webOrigin,
  CORS_ORIGINS: webOrigin,
  // A borda do teste é o proxy do Vite (1 salto); cada contexto do navegador usa um X-Forwarded-For próprio.
  TRUST_PROXY: '1',
  ENABLE_TEST_MAIL_SINK: 'true',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  ANTHROPIC_API_KEY: '',
  DEEPL_API_KEY: '',
  LIBRETRANSLATE_URL: '',
  GOOGLE_CLIENT_ID: '',
  TURNSTILE_SITE_KEY: '',
  TURNSTILE_SECRET_KEY: '',
  VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',
}

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: backendDir, env, stdio: 'inherit' })

function cleanup() {
  if (!ownTempDir(root) || !existsSync(root)) return
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    writeFileSync(registryPath, JSON.stringify(readRegistry().filter((entry) => entry !== root)))
  } catch {
    // Windows pode manter o SQLite aberto por instantes; a próxima execução remove a pasta registrada.
  }
}

function stop(signal) {
  if (!server.killed) server.kill(signal)
}

server.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(signal))
process.on('exit', () => stop('SIGTERM'))
