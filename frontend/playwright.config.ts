import { defineConfig, devices } from '@playwright/test'

// E2E da web contra uma API descartável (e2e/start-backend.mjs) e o build de produção servido pelo Vite preview.
// Navegador: Chromium do Playwright por padrão; PW_CHANNEL=msedge ou chrome usa o navegador instalado.
const apiPort = process.env.E2E_API_PORT ?? '3401'
const webPort = process.env.E2E_WEB_PORT ?? '4173'
const channel = process.env.PW_CHANNEL || undefined

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // A API de teste é compartilhada; uma execução por vez mantém o estado previsível.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${webPort}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 }, channel } },
    // Jornadas marcadas com @mobile também rodam em tela estreita (360 px) com toque.
    { name: 'mobile-360', grep: /@mobile/, use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, channel } },
  ],
  webServer: [
    {
      command: 'node e2e/start-backend.mjs',
      url: `http://localhost:${apiPort}/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { E2E_API_PORT: apiPort, E2E_WEB_ORIGIN: `http://localhost:${webPort}` },
    },
    {
      command: `npx vite build && npx vite preview --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_PROXY_TARGET: `http://localhost:${apiPort}` },
    },
  ],
})
