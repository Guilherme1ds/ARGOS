import { expect, test } from '@playwright/test'
import { loginThroughUi, mailLink, password, personContext, seedUser, uniqueEmail } from './support'

test.describe('Cadastro, confirmação de e-mail e sessão', () => {
  test('cadastro só entra depois de confirmar o e-mail @mobile', async ({ browser }) => {
    const context = await personContext(browser)
    const page = await context.newPage()
    const email = uniqueEmail('cadastro')

    await page.goto('/login')
    await page.getByRole('button', { name: 'Cadastro' }).click()
    await page.getByLabel('Nome').fill('Pessoa Cadastro E2E')
    await page.getByLabel('E-mail', { exact: true }).fill(email)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByLabel('Li e aceito o resumo de privacidade vigente.').check()
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByText('Enviamos um link de confirmação para o seu e-mail')).toBeVisible()

    // Antes de confirmar, a senha correta não abre sessão e o app oferece reenvio.
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Confirme seu e-mail')
    await page.getByRole('button', { name: 'Reenviar e-mail de confirmação' }).click()
    await expect(page.getByText('Se houver uma conta aguardando confirmação')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)

    // O link do e-mail tem o token no fragmento; a página o retira da barra de endereço.
    const link = await mailLink(email, 'verification')
    expect(link).toContain('/verify-email#token=')
    await page.goto(link)
    await expect(page).toHaveURL(/\/verify-email$/)
    await page.getByRole('button', { name: 'Confirmar meu e-mail' }).click()
    await expect(page.getByText('E-mail confirmado')).toBeVisible()
    await page.getByRole('link', { name: 'Ir para o login' }).click()

    await loginThroughUi(page, email)
    await expect(page).toHaveURL(/\/dashboard$/)

    // Link de confirmação é de uso único.
    await page.goto(link)
    await page.getByRole('button', { name: 'Confirmar meu e-mail' }).click()
    await expect(page.getByRole('alert')).toContainText('inválido ou expirado')
    await context.close()
  })

  test('rota protegida redireciona ao login e volta ao destino; sessão sobrevive ao recarregar e termina no logout', async ({ browser }) => {
    const person = await seedUser()
    const context = await personContext(browser)
    const page = await context.newPage()

    await page.goto('/my-items')
    await expect(page).toHaveURL(/\/login\?next=%2Fmy-items/)
    await page.getByLabel('E-mail', { exact: true }).fill(person.email)
    await page.getByLabel('Senha', { exact: true }).fill('senha-errada')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Credenciais inválidas')

    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page).toHaveURL(/\/my-items$/)

    // Access token fica só em memória: o recarregamento usa o cookie httpOnly de renovação.
    await page.reload()
    await expect(page).toHaveURL(/\/my-items$/)
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    expect(storage).not.toMatch(/eyJ|token/i)
    const cookies = await context.cookies()
    expect(cookies.find((cookie) => cookie.name === 'argos_refresh')).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api' })

    await page.getByRole('button', { name: 'Sair' }).click()
    await page.goto('/my-items')
    await expect(page).toHaveURL(/\/login\?next=/)
    await context.close()
  })

  test('recuperação de senha por link de uso único', async ({ browser }) => {
    const person = await seedUser()
    const context = await personContext(browser)
    const page = await context.newPage()

    await page.goto('/login')
    await page.getByRole('button', { name: 'Esqueci minha senha' }).click()
    await page.getByLabel('E-mail', { exact: true }).fill(person.email)
    await page.getByRole('button', { name: 'Enviar link' }).click()
    await expect(page.getByText('Se o e-mail estiver cadastrado')).toBeVisible()

    const link = await mailLink(person.email, 'reset')
    await page.goto(link)
    await expect(page).toHaveURL(/\/reset-password$/)
    await page.getByLabel('Nova senha (mínimo 8 caracteres)').fill('Nova#Senha-2026')
    await page.getByLabel('Confirmar nova senha').fill('Outra#Senha-2026')
    await page.getByRole('button', { name: 'Salvar nova senha' }).click()
    await expect(page.getByRole('alert')).toContainText('A confirmação não confere')
    await page.getByLabel('Confirmar nova senha').fill('Nova#Senha-2026')
    await page.getByRole('button', { name: 'Salvar nova senha' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('Senha redefinida')).toBeVisible()

    await loginThroughUi(page, person.email, 'Nova#Senha-2026')
    await expect(page).toHaveURL(/\/dashboard$/)

    // Reabrir o mesmo link não troca a senha de novo.
    await page.goto(link)
    await page.getByLabel('Nova senha (mínimo 8 caracteres)').fill('Terceira#Senha-1')
    await page.getByLabel('Confirmar nova senha').fill('Terceira#Senha-1')
    await page.getByRole('button', { name: 'Salvar nova senha' }).click()
    await expect(page.getByRole('alert')).toContainText('inválido ou expirado')
    await context.close()
  })
})
