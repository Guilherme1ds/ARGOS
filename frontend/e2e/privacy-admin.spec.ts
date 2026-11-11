import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { adminEmail, adminPassword, authed, loginThroughUi, password, personContext, seedItem, seedUser } from './support'

test.describe('Privacidade: resumo, exportação e exclusão', () => {
  test('mostra a versão vigente, exporta os dados e exclui a conta', async ({ browser }) => {
    const person = await seedUser()
    const context = await personContext(browser)
    const page = await context.newPage()
    await loginThroughUi(page, person.email, undefined, '/privacy')

    await expect(page.getByRole('heading', { level: 2, name: 'Resumo de privacidade' })).toBeVisible()
    await expect(page.getByText('Você aceitou a versão vigente')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Por quanto tempo guardamos' })).toBeVisible()
    await expect(page.getByText(/Excluir conta/).first()).toBeVisible()

    await page.goto('/settings')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Baixar' }).click()
    const download = await downloadPromise
    const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'))
    expect(exported.profile.email).toBe(person.email)
    expect(JSON.stringify(exported)).not.toMatch(/password_hash|token_hash/)

    await page.getByRole('button', { name: 'Excluir', exact: true }).click()
    await page.getByRole('alertdialog').getByLabel('Senha').fill(password)
    await page.getByRole('button', { name: 'Excluir minha conta' }).click()
    await expect(page).toHaveURL(/\/login\?conta=excluida/)
    await expect(page.getByText('Conta excluída')).toBeVisible()

    await page.getByLabel('E-mail', { exact: true }).fill(person.email)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Credenciais inválidas')
    await context.close()
  })
})

test.describe('Moderação e exportação administrativa', () => {
  test('denúncia entra na fila, é assumida e resolvida; CSV neutraliza fórmulas', async ({ browser }) => {
    const owner = await seedUser()
    const reporter = await seedUser()
    const title = `=HYPERLINK("http://exemplo.test") ${Date.now().toString(36)}`
    const itemId = await seedItem(owner.token, { title })
    const client = await authed(reporter.token)
    expect((await client.post(`items/${itemId}/report`, { data: { reason: 'Conteúdo de teste suspeito.' } })).status()).toBe(201)
    await client.dispose()

    const context = await personContext(browser)
    const page = await context.newPage()
    await loginThroughUi(page, adminEmail, adminPassword, '/admin')
    await expect(page.getByRole('heading', { name: 'Fila de denúncias' })).toBeVisible()
    const row = page.locator('.report-queue > div').filter({ hasText: title })
    await expect(row).toContainText('Conteúdo de teste suspeito.')
    await expect(row).toContainText('Aberta')

    await row.getByRole('button', { name: 'Assumir' }).click()
    await expect(page.getByText('Denúncia assumida.')).toBeVisible()
    await expect(row).toContainText('Em análise')

    page.once('dialog', (dialog) => void dialog.accept('Título corrigido pela moderação.'))
    await row.getByRole('button', { name: 'Resolver' }).click()
    await expect(page.getByText('Denúncia resolvida.')).toBeVisible()
    await expect(page.locator('.report-queue > div').filter({ hasText: title })).toHaveCount(0)
    await page.getByLabel('Filtrar denúncias por estado').selectOption('resolved')
    const resolved = page.locator('.report-queue > div').filter({ hasText: title })
    await expect(resolved).toContainText('Resolução: Título corrigido pela moderação.')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV' }).click()
    const csv = readFileSync((await (await downloadPromise).path())!, 'utf8')
    expect(csv.split('\r\n')[0]).toBe('id,type,title,category,location,event_date,status,approval_status,created_at')
    expect(csv).toContain(`"'=HYPERLINK(""http://exemplo.test"")`)
    await context.close()
  })

  test('administração aplica e remove a restrição manual de publicação', async ({ browser }) => {
    const person = await seedUser(undefined, `Restrita ${Date.now().toString(36)}`)
    const context = await personContext(browser)
    const page = await context.newPage()
    await loginThroughUi(page, adminEmail, adminPassword, '/admin')
    await expect(page.getByText('não há detecção automática')).toBeVisible()

    await page.getByRole('button', { name: `Restringir publicações de ${person.name}` }).click()
    await expect(page.getByText(`Publicações restringidas para ${person.name}.`)).toBeVisible()
    const blocked = await authed(person.token)
    const attempt = await blocked.post('items', {
      data: { type: 'found', title: 'Bloqueado', description: 'Não deve publicar durante a restrição.', category: 'Outros', location: 'Pátio' },
    })
    expect(attempt.status()).toBe(403)
    await blocked.dispose()

    await page.getByRole('button', { name: `Remover restrição de ${person.name}` }).click()
    await expect(page.getByText(`Restrição removida de ${person.name}.`)).toBeVisible()
    await seedItem(person.token)
    await context.close()
  })
})
