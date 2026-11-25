import { expect, test } from '@playwright/test'
import { adminEmail, adminPassword, apiBase, authed, loginThroughUi, mailLink, password, personContext, seedItem, seedUser, uniqueEmail } from './support'

// Sprints 5 a 7 pela interface: organização e espaço, convite de gestor, conversa privada e custódia.
test.describe('Gestão institucional, conversa e custódia', () => {
  test('admin cria organização e espaço e convida; gestor aceita; partes conversam; gestor registra a custódia', async ({ browser }) => {
    // Jornada longa com quatro pessoas (quatro sessões de navegador).
    test.setTimeout(180_000)
    const suffix = Date.now().toString(36)
    const managerEmail = uniqueEmail('gestor')

    // 1. Administração cria a organização, o espaço e envia o convite pelo modal.
    const adminContext = await personContext(browser)
    const admin = await adminContext.newPage()
    await loginThroughUi(admin, adminEmail, adminPassword, '/organizations')
    await admin.getByLabel('Nome', { exact: true }).fill(`Campus E2E ${suffix}`)
    await admin.getByRole('button', { name: 'Criar organização' }).click()
    await expect(admin.getByRole('status').filter({ hasText: 'Organização criada.' })).toBeVisible()
    await admin.getByLabel('Nome do espaço', { exact: true }).fill(`Biblioteca ${suffix}`)
    await admin.getByRole('button', { name: 'Adicionar espaço' }).click()
    await expect(admin.getByRole('status').filter({ hasText: 'Espaço criado.' })).toBeVisible()
    await admin.getByRole('button', { name: 'Convidar gestor', exact: true }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('E-mail', { exact: true }).fill(managerEmail)
    await dialog.getByRole('combobox', { name: 'Espaço' }).selectOption({ label: `Biblioteca ${suffix}` })
    await dialog.getByRole('button', { name: 'Enviar convite' }).click()
    await expect(admin.getByRole('dialog')).toHaveCount(0)
    await expect(admin.getByText(managerEmail).first()).toBeVisible()

    // 2. A pessoa convidada abre o link, entra e aceita.
    await seedUser(managerEmail, 'Gestora E2E')
    const inviteLink = await mailLink(managerEmail, 'invite')
    const managerContext = await personContext(browser)
    const manager = await managerContext.newPage()
    await manager.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ''))
    await expect(manager.getByText(`Você foi convidado(a) para gerir o espaço Biblioteca ${suffix}`, { exact: false })).toBeVisible()
    await manager.getByRole('link', { name: 'Entrar para aceitar' }).click()
    await manager.getByLabel('E-mail', { exact: true }).fill(managerEmail)
    await manager.getByLabel('Senha', { exact: true }).fill(password)
    await manager.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(manager).toHaveURL(/\/invite$/)
    await manager.getByRole('button', { name: 'Aceitar convite' }).click()
    await expect(manager.getByText('Convite aceito. Você já pode gerir este espaço.')).toBeVisible()
    await expect(manager.getByRole('link', { name: 'Custódia' })).toBeVisible()

    // 3. Quem achou publica ligado ao espaço; outra pessoa abre uma conversa privada.
    const finder = await seedUser(uniqueEmail('achou'), 'Quem Achou')
    const spaces = await (await authed(finder.token)).get(`${apiBase}/spaces`)
    const space = (await spaces.json()).data.find((entry: { name: string }) => entry.name === `Biblioteca ${suffix}`)
    const itemId = await seedItem(finder.token, { title: `Guarda-chuva azul ${suffix}`, spaceId: space.id })
    const visitor = await seedUser(uniqueEmail('dona'), 'Dona do Item')
    const visitorContext = await personContext(browser)
    const visitorPage = await visitorContext.newPage()
    await loginThroughUi(visitorPage, visitor.email, undefined, `/items/${itemId}`)
    await expect(visitorPage.getByText(`Biblioteca ${suffix}`).first()).toBeVisible()
    await visitorPage.getByRole('button', { name: 'Mensagem privada' }).click()
    await expect(visitorPage).toHaveURL(/\/messages\/\d+$/)
    await visitorPage.getByLabel('Escreva uma mensagem').fill('Oi! Acho que esse guarda-chuva é meu, tem uma fita no cabo.')
    await visitorPage.getByLabel('Escreva uma mensagem').press('Enter')
    await expect(visitorPage.getByRole('log').getByText('Acho que esse guarda-chuva é meu')).toBeVisible()
    // Regra automática: link externo é bloqueado e o texto fica no campo para reescrever.
    await visitorPage.getByLabel('Escreva uma mensagem').fill('Veja a foto em https://exemplo.com/foto')
    await visitorPage.getByRole('button', { name: 'Enviar' }).click()
    await expect(visitorPage.getByRole('alert')).toContainText('Links externos não são permitidos')
    await expect(visitorPage.getByLabel('Escreva uma mensagem')).toHaveValue(/exemplo\.com/)

    const finderContext = await personContext(browser)
    const finderPage = await finderContext.newPage()
    await loginThroughUi(finderPage, finder.email, undefined, '/messages')
    await expect(finderPage.getByRole('navigation').getByRole('link', { name: /Mensagens/ })).toContainText('1')
    await finderPage.getByRole('link', { name: new RegExp(`Guarda-chuva azul ${suffix}`) }).click()
    await expect(finderPage.getByRole('log').getByText('Acho que esse guarda-chuva é meu')).toBeVisible()

    // 4. A gestora registra o recebimento no espaço; a trilha fica íntegra e o painel mostra o item.
    await manager.goto(`/items/${itemId}`)
    const custody = manager.locator('.custody-panel')
    await expect(custody.getByText('Sem registro de custódia')).toBeVisible()
    await custody.getByRole('button', { name: 'Registrar evento' }).click()
    await expect(custody.getByText('Trilha íntegra (1 registros)')).toBeVisible()
    await custody.getByRole('combobox', { name: 'Registrar' }).selectOption({ label: 'Guardado' })
    await custody.getByLabel('Onde foi guardado').fill('Armário 2')
    await custody.getByRole('button', { name: 'Registrar evento' }).click()
    await expect(custody.getByText('Trilha íntegra (2 registros)')).toBeVisible()
    await manager.goto('/custody')
    await expect(manager.getByRole('link', { name: `Guarda-chuva azul ${suffix}` })).toBeVisible()
    await expect(manager.getByText('Armário 2')).toBeVisible()

    // 5. A destinação final encerra o caso; registrada por engano, a gestora reabre pela custódia.
    await manager.goto(`/items/${itemId}`)
    await custody.getByRole('combobox', { name: 'Registrar' }).selectOption({ label: 'Destinação final' })
    await custody.getByLabel('Destinação e motivo').fill('Doado após 90 dias sem retirada.')
    await custody.getByRole('button', { name: 'Registrar evento' }).click()
    await expect(custody.getByText('Trilha íntegra (3 registros)')).toBeVisible()
    const action = manager.locator('.case-action-panel')
    await expect(action.getByText('recebeu destinação final pelo espaço responsável', { exact: false })).toBeVisible()
    await expect(action.getByText('Registrado por engano? Reabra o caso na seção Custódia.', { exact: false })).toBeVisible()
    await expect(manager.locator('.case-detail-heading .case-status')).toHaveText('Encerrado')
    // Quem visita vê o aviso no lugar do formulário de reivindicação.
    await visitorPage.goto(`/items/${itemId}`)
    await expect(visitorPage.locator('.case-action-panel').getByText('não aceita mais reivindicações', { exact: false })).toBeVisible()
    await expect(visitorPage.getByLabel('Mensagem para o responsável')).toHaveCount(0)

    await custody.getByRole('combobox', { name: 'Registrar' }).selectOption({ label: 'Reabrir caso (desfazer destinação)' })
    await custody.getByLabel('Motivo da reabertura').fill('Destinação registrada por engano; o item continua no armário 2.')
    await custody.getByRole('button', { name: 'Registrar evento' }).click()
    await expect(custody.getByText('Trilha íntegra (4 registros)')).toBeVisible()
    await expect(custody.getByText('Caso reaberto')).toBeVisible()
    await expect(action.getByText('recebeu destinação final pelo espaço responsável', { exact: false })).toHaveCount(0)
    await visitorPage.reload()
    await expect(visitorPage.getByLabel('Mensagem para o responsável')).toBeVisible()

    for (const context of [adminContext, managerContext, visitorContext, finderContext]) await context.close()
  })
})
