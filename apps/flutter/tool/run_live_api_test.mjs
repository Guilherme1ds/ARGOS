// Roda test/live_api_test.dart contra uma API ARGOS descartável e encerra tudo no final.
// Banco e uploads ficam numa pasta temporária exclusiva (removida só ela), integrações externas vazias,
// .env local ignorado e a caixa de teste de e-mails ligada (somente NODE_ENV=test, loopback, .test).
// Uso, em apps/flutter:
//   node tool/run_live_api_test.mjs                      → test/live_api_test.dart (HTTP, sem aparelho)
//   node tool/run_live_api_test.mjs --device emulator-5554 → integration_test no Android (API em 10.0.2.2)
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const flutterDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const backendDir = resolve(flutterDir, '..', '..', 'backend')
const port = process.env.ARGOS_LIVE_PORT ?? '3334'
if (!/^\d{2,5}$/.test(port)) throw new Error('ARGOS_LIVE_PORT inválida.')
const tempRoot = resolve(tmpdir())
const root = mkdtempSync(join(tempRoot, 'argos-mobile-test-'))
writeFileSync(join(root, 'empty.env'), '')

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
  cwd: backendDir,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: port,
    DOTENV_CONFIG_PATH: join(root, 'empty.env'),
    DATABASE_URL: join(root, 'argos.sqlite'),
    UPLOAD_DIR: join(root, 'uploads'),
    JWT_SECRET: randomBytes(32).toString('base64url'),
    ADMIN_PASSWORD: randomBytes(18).toString('base64url'),
    API_PUBLIC_URL: `http://localhost:${port}`,
    FRONTEND_URL: 'http://localhost:5173',
    ENABLE_TEST_MAIL_SINK: 'true',
    TRUST_PROXY: 'false',
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
  },
})

async function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${port}/health/ready`)
      if (response.ok) return
    } catch {
      // ainda subindo
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error('API descartável não ficou pronta.')
}

function runFlutter() {
  return new Promise((done) => {
    // Comando fixo (porta e aparelho validados); no Windows o flutter é um .bat e precisa do shell.
    const deviceIndex = process.argv.indexOf('--device')
    const device = deviceIndex >= 0 ? process.argv[deviceIndex + 1] ?? '' : ''
    if (device && !/^[\w.:-]{1,64}$/.test(device)) throw new Error('Identificador de aparelho inválido.')
    const command = device
      ? `flutter test integration_test/mobile_journey_test.dart -d ${device} --dart-define=ARGOS_TEST_API=http://10.0.2.2:${port}/api/v1`
      : `flutter test --dart-define=ARGOS_RUN_LIVE_TESTS=true --dart-define=ARGOS_TEST_API=http://localhost:${port}/api/v1 test/live_api_test.dart`
    const child = spawn(command, { cwd: flutterDir, stdio: 'inherit', shell: true })
    child.on('exit', (code) => done(code ?? 1))
  })
}

let exitCode = 1
try {
  await waitForReady()
  exitCode = await runFlutter()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
} finally {
  server.kill()
  await new Promise((done) => setTimeout(done, 1000))
  const absolute = resolve(root)
  if (absolute.startsWith(tempRoot + sep) && absolute.slice(tempRoot.length + 1).startsWith('argos-mobile-test-') && existsSync(absolute)) {
    rmSync(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
}
process.exit(exitCode)
