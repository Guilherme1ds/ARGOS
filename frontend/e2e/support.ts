import { expect, request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const apiBase = `http://localhost:${process.env.E2E_API_PORT ?? '3401'}/api/v1`
export const adminEmail = 'admin@argos.test'
export const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'E2E-Admin#Password-1'
export const password = 'E2E-Senha#2026'

let counter = 0

/** E-mail único no domínio reservado .test (o único aceito pela caixa de teste da API). */
export function uniqueEmail(prefix: string) {
  counter += 1
  return `${prefix}.${Date.now().toString(36)}${counter}@argos.test`
}

/** Cada pessoa simulada tem um IP próprio: os limites de requisição da API são por IP/conta. */
export function uniqueIp() {
  counter += 1
  return `198.18.${Math.floor(counter / 250) % 250}.${(counter % 250) + 1}`
}

/** PNG 1x1 válido para upload. */
export const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSJgAAAG0ARHcak2KAAAAAElFTkSuQmCC', 'base64')

/** Contexto de navegador isolado (cookies próprios), sem acesso à internet externa (mapas etc.). */
export async function personContext(browser: Browser, ip = uniqueIp()): Promise<BrowserContext> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': ip } })
  await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort())
  return context
}

export async function apiClient(ip = uniqueIp()) {
  return playwrightRequest.newContext({ baseURL: `${apiBase}/`, extraHTTPHeaders: { 'X-Forwarded-For': ip } })
}

/** Busca o link enviado (confirmação ou redefinição) na caixa de teste da API descartável. */
export async function mailLink(email: string, kind: 'verification' | 'reset') {
  const client = await apiClient()
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await client.get('__test__/mail/latest', { params: { to: email, kind } })
      if (response.ok()) return (await response.json()).link as string
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`Nenhum e-mail de ${kind} para ${email}`)
  } finally {
    await client.dispose()
  }
}

/** Cria e confirma uma conta pela API (atalho para as jornadas que não testam o cadastro). */
export async function seedUser(email = uniqueEmail('pessoa'), name = 'Pessoa E2E') {
  const client = await apiClient()
  try {
    const created = await client.post('auth/register', { data: { name, email, password, privacyTermsAccepted: true } })
    expect(created.status()).toBe(201)
    const token = (await mailLink(email, 'verification')).split('#token=')[1]
    expect((await client.post('auth/verify-email', { data: { token } })).status()).toBe(200)
    const login = await client.post('auth/login', { data: { email, password } })
    expect(login.status()).toBe(200)
    const body = await login.json()
    return { email, name, token: body.token as string, id: body.user.id as number }
  } finally {
    await client.dispose()
  }
}

export async function apiLogin(email: string, secret: string) {
  const client = await apiClient()
  try {
    const login = await client.post('auth/login', { data: { email, password: secret } })
    expect(login.status()).toBe(200)
    return (await login.json()).token as string
  } finally {
    await client.dispose()
  }
}

export async function authed(token: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: `${apiBase}/`,
    extraHTTPHeaders: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': uniqueIp() },
  })
}

export async function seedItem(token: string, overrides: Record<string, unknown> = {}) {
  const client = await authed(token)
  try {
    const response = await client.post('items', {
      data: {
        type: 'found',
        title: `Mochila E2E ${Date.now().toString(36)}`,
        description: 'Mochila encontrada no corredor principal durante o teste.',
        category: 'Bolsas e mochilas',
        location: 'Bloco B',
        ...overrides,
      },
    })
    expect(response.status()).toBe(201)
    return Number((await response.json()).id)
  } finally {
    await client.dispose()
  }
}

export async function loginThroughUi(page: Page, email: string, secret = password, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(secret)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
