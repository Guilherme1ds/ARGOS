import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { adminEmail, adminPassword, loginThroughUi, personContext, seedItem, seedUser } from './support'

// Auditoria automática (axe-core, WCAG 2.1 A/AA + boas práticas). Falha em violações "critical", "serious" e
// "moderate"; as de impacto menor ficam anexadas ao relatório do teste para revisão manual.
async function audit(page: Page, label: string) {
  await page.waitForLoadState('networkidle')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze()
  const blocking = results.violations.filter((violation) => ['critical', 'serious', 'moderate'].includes(violation.impact ?? ''))
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }))
  await test.info().attach(`axe-${label}.json`, { body: JSON.stringify(summary, null, 2), contentType: 'application/json' })
  expect(blocking.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(', ')}`), label).toEqual([])
}

const publicPages = (itemId: number) =>
  [
    ['/', 'mural'],
    ['/login', 'login'],
    ['/items', 'consulta'],
    [`/items/${itemId}`, 'detalhe'],
    ['/map', 'mapa'],
    ['/privacy', 'privacidade'],
    ['/help', 'como-funciona'],
    ['/verify-email', 'confirmar-email'],
    ['/reset-password', 'nova-senha'],
  ] as const

const signedInPages = (itemId: number) =>
  [
    ['/', 'mural-autenticado'],
    ['/items/new', 'publicar'],
    [`/items/${itemId}`, 'detalhe-dono'],
    [`/items/${itemId}/edit`, 'editar'],
    ['/my-items', 'meus-itens'],
    ['/notifications', 'notificacoes'],
    ['/profile', 'perfil'],
    ['/dashboard', 'painel'],
    ['/settings', 'configuracoes'],
  ] as const

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Acessibilidade automática (tema ${scheme === 'light' ? 'claro' : 'escuro'})`, () => {
    test('páginas públicas', async ({ browser }) => {
      const owner = await seedUser()
      const itemId = await seedItem(owner.token)
      const context = await personContext(browser)
      const page = await context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      for (const [path, label] of publicPages(itemId)) {
        await page.goto(path)
        await audit(page, `${scheme}-${label}`)
      }
      await context.close()
    })

    test('páginas autenticadas e administração', async ({ browser }) => {
      const person = await seedUser()
      const itemId = await seedItem(person.token)
      const context = await personContext(browser)
      const page = await context.newPage()
      await page.emulateMedia({ colorScheme: scheme })
      await loginThroughUi(page, person.email, undefined, '/items/new')
      for (const [path, label] of signedInPages(itemId)) {
        await page.goto(path)
        await audit(page, `${scheme}-${label}`)
      }

      const adminContext = await personContext(browser)
      const adminPage = await adminContext.newPage()
      await adminPage.emulateMedia({ colorScheme: scheme })
      await loginThroughUi(adminPage, adminEmail, adminPassword, '/admin')
      await expect(adminPage.getByRole('heading', { name: 'Fila de denúncias' })).toBeVisible()
      await audit(adminPage, `${scheme}-administracao`)
      await adminContext.close()
      await context.close()
    })
  })
}
