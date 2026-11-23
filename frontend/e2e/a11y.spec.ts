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

// O axe não mede contraste sobre fundo translúcido ou gradiente (o painel é rgba sobre o gradiente da página):
// o caso fica "incompleto", não vira violação. Aqui o menor contraste entre o texto de erro e a superfície do tema.
async function errorTextContrast(page: Page) {
  return page.evaluate(() => {
    const channels = (color: string) => {
      const probe = document.createElement('canvas').getContext('2d')!
      probe.fillStyle = color
      const hex = probe.fillStyle.replace('#', '')
      return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16))
    }
    const luminance = (color: string) => {
      const [r, g, b] = channels(color).map((value) => {
        const channel = value / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    const ratios = [...document.querySelectorAll('.field-error')].map((element) => {
      const [light, dark] = [luminance(getComputedStyle(element).color), luminance(surface)].sort((a, b) => b - a)
      return (light + 0.05) / (dark + 0.05)
    })
    return Math.min(...ratios)
  })
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
    ['/messages', 'mensagens'],
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
      // O contraste dos erros de campo e da mensagem de erro só é avaliado com eles na tela.
      await page.goto('/items/new')
      await page.getByRole('button', { name: 'Publicar item' }).click()
      await expect(page.locator('.field-error').first()).toBeVisible()
      await audit(page, `${scheme}-publicar-com-erros`)
      expect(await errorTextContrast(page), `${scheme}: contraste do texto de erro`).toBeGreaterThanOrEqual(4.5)

      const adminContext = await personContext(browser)
      const adminPage = await adminContext.newPage()
      await adminPage.emulateMedia({ colorScheme: scheme })
      await loginThroughUi(adminPage, adminEmail, adminPassword, '/admin')
      await expect(adminPage.getByRole('heading', { name: 'Fila de denúncias' })).toBeVisible()
      await audit(adminPage, `${scheme}-administracao`)
      for (const [path, label] of [['/organizations', 'organizacoes'], ['/custody', 'custodia'], ['/admin/observability', 'saude-do-sistema']] as const) {
        await adminPage.goto(path)
        await audit(adminPage, `${scheme}-${label}`)
      }
      await adminContext.close()
      await context.close()
    })
  })
}
