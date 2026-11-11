import { expect, test, type Page } from '@playwright/test'
import { adminEmail, adminPassword, authed, loginThroughUi, password, personContext, seedItem, seedUser, uniqueEmail } from './support'

// Jornadas do fechamento (11/2026): busca por Enter, falha de rede explicada, foco em diálogos,
// estado real de "Acompanhar", aviso perto da ação, rascunho após sessão perdida, abas por teclado,
// solicitação de acesso sem senha e desbloqueio pela administração.

async function focusIsInsideDialog(page: Page) {
  return page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
}

test.describe('Consulta pública', () => {
  test('Enter busca; sem conexão a tela explica e permite tentar de novo; o modal prende e devolve o foco', async ({ browser }) => {
    const owner = await seedUser()
    const stamp = Date.now().toString(36)
    await seedItem(owner.token, { type: 'lost', title: `Guarda-chuva ${stamp}` })
    await seedItem(owner.token, { title: `Caderno ${stamp}` })
    const context = await personContext(browser)
    const page = await context.newPage()
    await page.goto('/items')

    const search = page.getByLabel('Buscar por título, descrição ou categoria')
    await search.fill(`Guarda-chuva ${stamp}`)
    await search.press('Enter')
    const cards = page.locator('.market-card')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText(`Guarda-chuva ${stamp}`)

    // Diálogo: foco entra no botão Fechar, Tab circula só dentro dele e Escape devolve o foco ao cartão.
    await cards.first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Fechar' })).toBeFocused()
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press('Tab')
      expect(await focusIsInsideDialog(page)).toBe(true)
    }
    await page.keyboard.press('Shift+Tab')
    expect(await focusIsInsideDialog(page)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(cards.first()).toBeFocused()

    // Rede fora do ar: mensagem para pessoas (sem endereço técnico) e ação de tentar de novo, sem fingir lista vazia.
    await context.route('**/api/items/search**', (route) => route.abort('connectionrefused'))
    await page.getByRole('button', { name: 'Buscar', exact: true }).click()
    const failure = page.getByRole('alert').filter({ hasText: 'Não foi possível carregar os casos' })
    await expect(failure).toContainText('Sem conexão com o ARGOS')
    await expect(page.getByText('localhost')).toHaveCount(0)
    await expect(page.getByText('Nenhum item aprovado encontrado')).toHaveCount(0)
    await context.unroute('**/api/items/search**')
    await failure.getByRole('button', { name: 'Tentar novamente' }).click()
    await expect(cards).toHaveCount(1)
    await context.close()
  })
})

test.describe('Mural', () => {
  test('mostra o acompanhamento real e o aviso aparece perto de quem rolou a tela @mobile', async ({ browser }) => {
    const owner = await seedUser()
    const person = await seedUser()
    const title = `Garrafa acompanhada ${Date.now().toString(36)}`
    const itemId = await seedItem(owner.token, { title })
    const client = await authed(person.token)
    expect((await client.post(`items/${itemId}/follow`)).status()).toBe(201)
    await client.dispose()

    const context = await personContext(browser)
    const page = await context.newPage()
    await loginThroughUi(page, person.email, password, '/')
    const post = page.locator('article.ig-post', { hasText: title })
    const following = post.getByRole('button', { name: 'Acompanhando' })
    await expect(following).toHaveAttribute('aria-pressed', 'true')

    await following.click()
    const notice = page.getByRole('status').filter({ hasText: 'Caso removido dos acompanhamentos.' })
    await expect(notice).toBeVisible()
    // O aviso fica dentro da área visível, não no topo da página.
    const box = await notice.boundingBox()
    const viewport = page.viewportSize()!
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
    await expect(post.getByRole('button', { name: 'Acompanhar caso' })).toHaveAttribute('aria-pressed', 'false')
    await context.close()
  })
})

test.describe('Publicação', () => {
  test('rascunho sobrevive à sessão perdida e some no logout', async ({ browser }) => {
    const person = await seedUser()
    const context = await personContext(browser)
    const page = await context.newPage()
    await loginThroughUi(page, person.email, password, '/items/new')
    const title = `Rascunho mochila ${Date.now().toString(36)}`
    await page.getByLabel('Título').fill(title)
    await page.getByLabel('Descrição detalhada').fill('Mochila preta com chaveiro de coruja, deixada na cantina.')

    // Sessão perdida (cookie de renovação apagado) e página recarregada: a rota protegida pede login.
    await context.clearCookies()
    await page.reload()
    await expect(page).toHaveURL(/\/login\?next=%2Fitems%2Fnew/)
    await loginThroughUi(page, person.email, password, '/items/new')
    await expect(page.getByText('Rascunho recuperado desta aba')).toBeVisible()
    await expect(page.getByLabel('Título')).toHaveValue(title)
    await expect(page.getByLabel('Descrição detalhada')).toHaveValue(/chaveiro de coruja/)

    // Validação: o foco vai para o primeiro campo com problema e o erro fica associado a ele.
    await page.getByLabel('Título').fill('ab')
    await page.getByRole('button', { name: 'Publicar item' }).click()
    await expect(page.getByLabel('Título')).toBeFocused()
    await expect(page.getByLabel('Título')).toHaveAccessibleDescription(/pelo menos 3 caracteres/)

    // Computador compartilhado: depois do logout o rascunho não volta.
    await page.getByRole('button', { name: 'Sair' }).click()
    await expect(page.getByRole('button', { name: 'Entrar' }).first()).toBeVisible()
    await loginThroughUi(page, person.email, password, '/items/new')
    await expect(page.getByRole('heading', { name: 'Publicar item', level: 2 })).toBeVisible()
    await expect(page.getByLabel('Descrição detalhada')).toHaveValue('')
    await expect(page.getByLabel('Título')).toHaveValue('')
    await expect(page.getByText('Rascunho recuperado desta aba')).toHaveCount(0)
    await context.close()
  })
})

test.describe('Meus itens', () => {
  test('abas seguem o padrão de teclado', async ({ browser }) => {
    const person = await seedUser()
    const context = await personContext(browser)
    const page = await context.newPage()
    await loginThroughUi(page, person.email, password, '/my-items')
    const published = page.getByRole('tab', { name: /Publicados/ })
    await published.focus()
    await page.keyboard.press('ArrowRight')
    const following = page.getByRole('tab', { name: /Acompanhando/ })
    await expect(following).toHaveAttribute('aria-selected', 'true')
    await expect(following).toBeFocused()
    await expect(page).toHaveURL(/tab=following/)
    await page.keyboard.press('End')
    await expect(page.getByRole('tab', { name: /Minhas reivindicações/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toContainText('Você ainda não enviou reivindicações.')
    await context.close()
  })
})

test.describe('Acesso institucional e administração', () => {
  test('solicitação sem senha, aprovação única, bloqueio explicado e desbloqueio', async ({ browser }) => {
    const stamp = Date.now().toString(36)
    const name = `Pessoa Acesso ${stamp}`
    const email = uniqueEmail('acesso')
    const context = await personContext(browser)
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByRole('button', { name: 'Acesso', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Solicitar acesso' })).toBeVisible()
    await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0)
    await page.getByLabel('Nome').fill(name)
    await page.getByLabel('E-mail', { exact: true }).fill(email)
    await page.getByLabel('Justificativa de acesso').fill('Equipe da biblioteca central.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Se a administração aprovar')

    const adminContext = await personContext(browser)
    const adminPage = await adminContext.newPage()
    await loginThroughUi(adminPage, adminEmail, adminPassword, '/admin')
    await adminPage.getByRole('button', { name: `Aprovar ${name}` }).click()
    const approval = adminPage.getByRole('status').filter({ hasText: 'Senha temporária' })
    await expect(approval).toBeVisible()
    const temporary = /Senha temporária: ([\w-]+)\./.exec((await approval.textContent()) ?? '')?.[1]
    expect(temporary).toBeTruthy()
    // Pedido avaliado não oferece aprovar/rejeitar de novo.
    await expect(adminPage.getByRole('button', { name: `Aprovar ${name}` })).toHaveCount(0)
    await expect(adminPage.getByRole('button', { name: `Rejeitar ${name}` })).toHaveCount(0)

    // A administração bloqueia; a pessoa entende o motivo ao tentar entrar.
    adminPage.once('dialog', (dialog) => void dialog.accept())
    await adminPage.getByRole('button', { name: `Bloquear ${name}` }).click()
    await expect(adminPage.getByText('Usuário bloqueado e sessões encerradas.')).toBeVisible()
    await page.goto('/login')
    await page.getByLabel('E-mail', { exact: true }).fill(email)
    await page.getByLabel('Senha', { exact: true }).fill(temporary!)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('bloqueada ou aguardando aprovação')

    // Desbloqueio devolve o acesso.
    adminPage.once('dialog', (dialog) => void dialog.accept())
    await adminPage.getByRole('button', { name: `Desbloquear ${name}` }).click()
    await expect(adminPage.getByText('Usuário desbloqueado.')).toBeVisible()
    await loginThroughUi(page, email, temporary!)
    await adminContext.close()
    await context.close()
  })
})
