import { expect, test, type Page } from '@playwright/test'
import { authed, loginThroughUi, personContext, pngBytes, seedItem, seedUser } from './support'

async function fillItemForm(page: Page, title: string) {
  await page.getByLabel('Tipo').selectOption('found')
  await page.getByLabel('Título').fill(title)
  await page.getByLabel('Categoria').selectOption({ index: 1 })
  await page.getByLabel('Campus ou local').fill('Bloco C')
  await page.getByLabel('Descrição detalhada').fill('Item encontrado perto da cantina durante o teste E2E.')
}

test.describe('Publicação, busca e foto', () => {
  test('publica sem foto e com foto, e mostra o erro de uma imagem inválida @mobile', async ({ browser }) => {
    const person = await seedUser()
    const context = await personContext(browser)
    const page = await context.newPage()
    await loginThroughUi(page, person.email, undefined, '/items/new')
    await expect(page).toHaveURL(/\/items\/new$/)

    const plainTitle = `Garrafa sem foto ${Date.now().toString(36)}`
    await fillItemForm(page, plainTitle)
    await page.getByRole('button', { name: 'Publicar item' }).click()
    await expect(page).toHaveURL(/\/items\/\d+$/)
    await expect(page.getByRole('heading', { name: plainTitle })).toBeVisible()

    // Arquivo com extensão de imagem e conteúdo falso: o servidor recusa e o formulário continua preenchido.
    await page.goto('/items/new')
    const brokenTitle = `Foto inválida ${Date.now().toString(36)}`
    await fillItemForm(page, brokenTitle)
    await page.getByLabel('Foto do item').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('não é imagem') })
    await page.getByRole('button', { name: 'Publicar item' }).click()
    await expect(page.getByRole('alert')).toContainText('Arquivo recusado')
    await expect(page).toHaveURL(/\/items\/new$/)
    await expect(page.getByLabel('Título')).toHaveValue(brokenTitle)

    const photoTitle = `Mochila com foto ${Date.now().toString(36)}`
    await page.getByLabel('Título').fill(photoTitle)
    await page.getByLabel('Foto do item').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: pngBytes })
    await page.getByRole('button', { name: 'Publicar item' }).click()
    await expect(page).toHaveURL(/\/items\/\d+$/)
    await expect(page.getByRole('img', { name: photoTitle })).toBeVisible()

    // Busca pública (sem sessão) encontra o item publicado.
    const anonymous = await personContext(browser)
    const visitor = await anonymous.newPage()
    await visitor.goto('/items')
    await visitor.getByLabel('Buscar por título, descrição ou categoria').fill(photoTitle)
    await expect(visitor.getByText(photoTitle).first()).toBeVisible()
    await anonymous.close()
    await context.close()
  })
})

test.describe('Reivindicação privada, pistas, acompanhamento e devolução', () => {
  test('pessoa reivindica com provas privadas e o responsável registra a devolução @mobile', async ({ browser }) => {
    const owner = await seedUser(undefined, 'Responsavel E2E')
    const claimant = await seedUser(undefined, 'Reivindicante E2E')
    const title = `Carteira marrom ${Date.now().toString(36)}`
    const itemId = await seedItem(owner.token, { title })
    const proof = 'Tem minha carteirinha de estudante número interno 77.'

    const claimantContext = await personContext(browser)
    const page = await claimantContext.newPage()
    await loginThroughUi(page, claimant.email, undefined, `/items/${itemId}`)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()

    await page.getByRole('button', { name: 'Acompanhar' }).click()
    await expect(page.getByRole('button', { name: 'Acompanhando' })).toBeVisible()

    await page.getByLabel('Pista ou pergunta pública').fill('Vi uma parecida perto da biblioteca.')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByText('Vi uma parecida perto da biblioteca.')).toBeVisible()

    await page.getByLabel('Mensagem para o responsável').fill('Acredito que esta carteira é minha, perdi ontem.')
    await page.getByLabel('Provas privadas de posse').fill(proof)
    await page.getByRole('button', { name: 'Enviar com segurança' }).click()
    await expect(page.getByText('Sua reivindicação foi enviada')).toBeVisible()

    // A prova não aparece para visitantes.
    const visitorContext = await personContext(browser)
    const visitor = await visitorContext.newPage()
    await visitor.goto(`/items/${itemId}`)
    await expect(visitor.getByRole('heading', { name: title })).toBeVisible()
    await expect(visitor.getByText(proof)).toHaveCount(0)
    await visitorContext.close()

    const ownerContext = await personContext(browser)
    const ownerPage = await ownerContext.newPage()
    await loginThroughUi(ownerPage, owner.email, undefined, `/items/${itemId}`)
    await ownerPage.getByLabel('Reivindicação do proprietário').selectOption({ label: 'Reivindicante E2E' })
    ownerPage.once('dialog', (dialog) => void dialog.accept())
    await ownerPage.getByRole('button', { name: 'Confirmar devolução' }).click()
    await expect(ownerPage.getByText('Este caso já foi marcado como devolvido.')).toBeVisible()

    // Quem reivindicou recebe a notificação da devolução.
    await page.goto('/notifications')
    await expect(page.getByText('Reivindicação aprovada').first()).toBeVisible()
    await claimantContext.close()
    await ownerContext.close()
  })

  test('erro de permissão do servidor aparece sem quebrar a tela', async ({ browser }) => {
    const owner = await seedUser()
    const other = await seedUser()
    const itemId = await seedItem(owner.token)
    const client = await authed(other.token)
    expect((await client.patch(`items/${itemId}`, { data: { title: 'Tentativa indevida' } })).status()).toBe(403)
    await client.dispose()

    const context = await personContext(browser)
    const page = await context.newPage()
    await loginThroughUi(page, other.email, undefined, `/items/${itemId}/edit`)
    await expect(page.getByText(/não tem permissão|Sem permissão/)).toBeVisible()
    await context.close()
  })
})
