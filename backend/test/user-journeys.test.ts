import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { bearer, startHarness, userPassword, type Harness } from './support/harness.js'

// Regressões das correções de fechamento (11/11/2026): edição parcial, solicitação de acesso,
// conta inativa e limites de login compatíveis com NAT.
let h: Harness

beforeAll(async () => {
  h = await startHarness('journeys')
})

afterAll(() => h.cleanup())

describe('edição parcial de item', () => {
  it('não altera a preferência de contato quando o campo não é enviado', async () => {
    const owner = await h.register('partial-owner@example.com')
    const itemId = await h.createItem(owner.token, { contactPreference: 'email' })

    await request(h.app).patch(`/api/v1/items/${itemId}`).set(bearer(owner.token)).send({ title: 'Garrafa térmica azul-marinho' }).expect(200)

    const row = h.db.prepare('SELECT title, contact_preference FROM items WHERE id = ?').get(itemId)
    expect(row).toEqual({ title: 'Garrafa térmica azul-marinho', contact_preference: 'email' })
    const history = h.db
      .prepare("SELECT details FROM item_history WHERE item_id = ? AND action = 'item.updated' ORDER BY id DESC")
      .get(itemId) as { details: string }
    // O histórico registra só o que a pessoa mudou.
    expect(JSON.parse(history.details)).toEqual({ title: 'Garrafa térmica azul-marinho' })
  })
})

describe('solicitação de acesso institucional', () => {
  it('não exige senha e explica o que acontece depois', async () => {
    const response = await request(h.app).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Pessoa sem senha', email: 'no-password@example.com', requestAccess: true, reason: 'Equipe da portaria' })
      .expect(202)
    expect(response.body.message).toMatch(/Esqueci minha senha/)
    expect(h.db.prepare("SELECT status, reason FROM access_requests WHERE email = 'no-password@example.com'").get())
      .toEqual({ status: 'pending', reason: 'Equipe da portaria' })
  })

  it('continua exigindo senha no cadastro comum', async () => {
    const response = await request(h.app).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Sem senha', email: 'register-no-password@example.com', privacyTermsAccepted: true })
      .expect(422)
    expect(response.body.errors.fieldErrors.password).toEqual(['Informe uma senha com pelo menos 8 caracteres.'])
    expect(h.db.prepare("SELECT 1 FROM users WHERE email = 'register-no-password@example.com'").get()).toBeUndefined()
  })

  it('só avalia pedidos pendentes e não reabre nem sobrescreve um pedido aprovado', async () => {
    const email = 'reviewed-once@example.com'
    await request(h.app).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Pessoa original', email, requestAccess: true, reason: 'Motivo original' }).expect(202)
    const pending = h.db.prepare('SELECT id FROM access_requests WHERE email = ?').get(email) as { id: number }

    const approval = await request(h.app).patch(`/api/v1/admin/access-requests/${pending.id}`).set(bearer(h.admin.token))
      .send({ status: 'approved' }).expect(200)
    expect(approval.body.temporaryPassword).toEqual(expect.any(String))

    // Rejeitar depois de aprovar deixaria a conta ativa com um pedido "rejeitado".
    const second = await request(h.app).patch(`/api/v1/admin/access-requests/${pending.id}`).set(bearer(h.admin.token))
      .send({ status: 'rejected' }).expect(409)
    expect(second.body.details).toEqual({ currentStatus: 'approved' })
    expect(h.db.prepare('SELECT status FROM access_requests WHERE id = ?').get(pending.id)).toEqual({ status: 'approved' })
    expect(h.db.prepare("SELECT status FROM users WHERE email = ?").get(email)).toEqual({ status: 'active' })

    // A conta já existe: um novo pedido com o mesmo e-mail é recusado sem alterar o registro.
    await request(h.app).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Outra pessoa', email, requestAccess: true, reason: 'Sobrescrever' }).expect(409)
    expect(h.db.prepare('SELECT name, reason FROM access_requests WHERE id = ?').get(pending.id)).toEqual({ name: 'Pessoa original', reason: 'Motivo original' })

    // Pedido aprovado cuja conta foi removida da tabela de usuários continua não sendo reaberto.
    h.db.prepare("UPDATE users SET email = 'renamed-reviewed@example.com' WHERE email = ?").run(email)
    await request(h.app).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Outra pessoa', email, requestAccess: true, reason: 'Sobrescrever' }).expect(409)
    expect(h.db.prepare('SELECT name, status FROM access_requests WHERE id = ?').get(pending.id)).toEqual({ name: 'Pessoa original', status: 'approved' })
  })

  it('um pedido rejeitado volta a pendente quando a pessoa pede de novo', async () => {
    const email = 'rejected-then-again@example.com'
    await request(h.app).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Pessoa', email, requestAccess: true }).expect(202)
    const pending = h.db.prepare('SELECT id FROM access_requests WHERE email = ?').get(email) as { id: number }
    await request(h.app).patch(`/api/v1/admin/access-requests/${pending.id}`).set(bearer(h.admin.token)).send({ status: 'rejected' }).expect(200)
    await request(h.app).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Pessoa', email, requestAccess: true, reason: 'Novo pedido com mais detalhes' }).expect(202)
    expect(h.db.prepare('SELECT status, reviewed_at, reason FROM access_requests WHERE id = ?').get(pending.id))
      .toEqual({ status: 'pending', reviewed_at: null, reason: 'Novo pedido com mais detalhes' })
  })
})

describe('conta inativa', () => {
  it('explica o bloqueio com código estável em vez de credenciais inválidas', async () => {
    const person = await h.register('inactive-person@example.com')
    await request(h.app).patch(`/api/v1/admin/users/${person.id}`).set(bearer(h.admin.token)).send({ status: 'blocked' }).expect(200)
    const login = await request(h.app).post('/api/v1/auth/login').set('X-Forwarded-For', h.nextIp())
      .send({ email: 'inactive-person@example.com', password: userPassword }).expect(403)
    expect(login.body.details).toEqual({ code: 'account_inactive' })
    expect(login.body.message).toMatch(/bloqueada ou aguardando aprovação/)
    // Senha errada continua sem revelar o estado da conta.
    await request(h.app).post('/api/v1/auth/login').set('X-Forwarded-For', h.nextIp())
      .send({ email: 'inactive-person@example.com', password: 'Senha-Errada#1' }).expect(401)

    // Desbloquear devolve o acesso.
    await request(h.app).patch(`/api/v1/admin/users/${person.id}`).set(bearer(h.admin.token)).send({ status: 'active' }).expect(200)
    await h.login('inactive-person@example.com')
  })
})

describe('exclusão de conta avisa quem dependia dos casos', () => {
  it('quem reivindicou ou acompanha um caso aberto e quem recebeu a solicitação da pessoa são notificados', async () => {
    const leaving = await h.register('leaving-owner@example.com')
    const claimant = await h.register('leaving-claimant@example.com')
    const follower = await h.register('leaving-follower@example.com')
    const otherOwner = await h.register('leaving-other-owner@example.com')
    const openItem = await h.createItem(leaving.token, { title: 'Estojo azul de quem saiu' })
    const returnedItem = await h.createItem(leaving.token, { type: 'lost', title: 'Caso já devolvido de quem saiu' })
    const otherItem = await h.createItem(otherOwner.token, { title: 'Carteira marrom do vizinho' })

    await request(h.app).post(`/api/v1/items/${openItem}/claim`).set(bearer(claimant.token))
      .send({ message: 'Acho que o estojo é meu.', proofDetails: 'Tem meu nome por dentro.' }).expect(201)
    await request(h.app).post(`/api/v1/items/${openItem}/follow`).set(bearer(follower.token)).expect(201)
    await request(h.app).post(`/api/v1/items/${returnedItem}/follow`).set(bearer(follower.token)).expect(201)
    await request(h.app).patch(`/api/v1/items/${returnedItem}/return`).set(bearer(leaving.token)).send({}).expect(200)
    await request(h.app).post(`/api/v1/items/${otherItem}/claim`).set(bearer(leaving.token))
      .send({ message: 'Perdi uma carteira assim.', proofDetails: 'Tem um cartão da biblioteca.' }).expect(201)

    const before = (userId: number, title: string) =>
      (h.db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND title = ?').get(userId, title) as { total: number }).total
    expect(before(claimant.id, 'Caso removido')).toBe(0)

    await request(h.app).delete('/api/v1/auth/me').set(bearer(leaving.token)).send({ password: userPassword }).expect(200)

    const removed = (userId: number) =>
      h.db.prepare("SELECT body FROM notifications WHERE user_id = ? AND title = 'Caso removido' ORDER BY id").all(userId) as Array<{ body: string }>
    expect(removed(claimant.id).map((row) => row.body)).toEqual(['O caso "Estojo azul de quem saiu" foi removido e não está mais disponível.'])
    // O caso devolvido continua no histórico: quem acompanha não recebe aviso de remoção por ele.
    expect(removed(follower.id).map((row) => row.body)).toEqual(['O caso "Estojo azul de quem saiu" foi removido e não está mais disponível.'])
    const withdrawn = h.db
      .prepare("SELECT body, action_url FROM notifications WHERE user_id = ? AND title = 'Reivindicação cancelada'")
      .all(otherOwner.id) as Array<{ body: string; action_url: string }>
    expect(withdrawn).toEqual([{ body: 'Uma reivindicação sobre "Carteira marrom do vizinho" foi retirada porque a conta de quem enviou foi excluída.', action_url: `/items/${otherItem}` }])
    expect(h.db.prepare('SELECT status FROM items WHERE id = ?').get(otherItem)).toEqual({ status: 'found' })
  })
})

describe('mensagens de validação', () => {
  it('chegam em português claro, sem o texto técnico padrão do Zod', async () => {
    const person = await h.register('validation-person@example.com')
    const profile = await request(h.app).patch('/api/v1/auth/me').set(bearer(person.token)).send({ name: 'ab', theme: 'neon' }).expect(422)
    expect(profile.body.errors.fieldErrors).toEqual({ name: ['Use pelo menos 3 caracteres.'], theme: ['Escolha uma das opções disponíveis.'] })

    const login = await request(h.app).post('/api/v1/auth/login').set('X-Forwarded-For', h.nextIp()).send({ email: 'sem-arroba', password: '' }).expect(422)
    expect(login.body.errors.fieldErrors).toEqual({ email: ['Informe um e-mail válido.'], password: ['Campo obrigatório.'] })

    const itemId = await h.createItem(person.token)
    const longClue = await request(h.app).post(`/api/v1/items/${itemId}/comments`).set(bearer(person.token)).send({ body: 'x'.repeat(501) }).expect(422)
    expect(longClue.body.errors.fieldErrors.body).toEqual(['Use no máximo 500 caracteres.'])
    const missing = await request(h.app).post(`/api/v1/items/${itemId}/claim`).set(bearer(h.admin.token)).send({}).expect(422)
    expect(missing.body.errors.fieldErrors).toEqual({ message: ['Campo obrigatório.'], proofDetails: ['Campo obrigatório.'] })
    // Mensagens próprias do schema continuam valendo.
    const nickname = await request(h.app).patch('/api/v1/auth/me').set(bearer(person.token)).send({ nickname: 'A B' }).expect(422)
    expect(nickname.body.errors.fieldErrors.nickname).toEqual(['Use 3 a 40 caracteres: letras minúsculas, números, ponto ou sublinhado.'])
  })
})

describe('senhas fora da thread principal', () => {
  it('o pool gera e confere hashes compatíveis com os já gravados pelo bcryptjs', async () => {
    const bcrypt = (await import('bcryptjs')).default
    const { hashPassword, verifyPassword, passwordWorkerPoolSize } = await import('../src/utils/password.js')
    expect(passwordWorkerPoolSize).toBeGreaterThanOrEqual(1)
    const legacy = bcrypt.hashSync('Senha-Antiga#1', 10)
    expect(await verifyPassword('Senha-Antiga#1', legacy)).toBe(true)
    expect(await verifyPassword('outra', legacy)).toBe(false)
    const hashes = await Promise.all(Array.from({ length: 6 }, (_, index) => hashPassword(`Senha-${index}#2026`, 10)))
    expect(hashes.every((hash) => /^\$2[ab]\$10\$/.test(hash))).toBe(true)
    expect(bcrypt.compareSync('Senha-3#2026', hashes[3])).toBe(true)
  })

  it('uma rajada de logins não trava as outras requisições', async () => {
    const people = [] as Array<{ email: string }>
    for (let index = 0; index < 6; index += 1) {
      const email = `burst-${index}@example.com`
      await h.register(email)
      people.push({ email })
    }
    let finished = false
    const logins = Promise.all(
      people.map((person) => request(h.app).post('/api/v1/auth/login').set('X-Forwarded-For', h.nextIp()).send({ email: person.email, password: userPassword })),
    ).finally(() => {
      finished = true
    })
    // Sonda a API durante toda a rajada; vale a pior latência.
    const latencies: number[] = []
    while (!finished) {
      const probeStarted = performance.now()
      await request(h.app).get('/health/live').expect(200)
      latencies.push(performance.now() - probeStarted)
    }
    const responses = await logins
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(latencies.length).toBeGreaterThan(3)
    // Com o hash na thread principal, cada sonda esperava blocos de ~100 ms de bcrypt por login em andamento.
    expect(Math.max(...latencies)).toBeLessThan(150)
  })
})

describe('limite de login', () => {
  it('limita tentativas por conta sem bloquear outras pessoas do mesmo IP (NAT)', async () => {
    await h.register('nat-target@example.com')
    await h.register('nat-colleague@example.com')
    const sharedIp = '198.18.200.7'
    let last: request.Response | undefined
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = await request(h.app).post('/api/v1/auth/login').set('X-Forwarded-For', sharedIp)
        .send({ email: 'nat-target@example.com', password: `Errada#${attempt}` })
    }
    expect(last!.status).toBe(429)
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0)

    // Outra pessoa atrás do mesmo IP continua entrando.
    await request(h.app).post('/api/v1/auth/login').set('X-Forwarded-For', sharedIp)
      .send({ email: 'nat-colleague@example.com', password: userPassword }).expect(200)
  })

  it('mantém um teto por IP somando todas as contas', async () => {
    const { loginIpLimitPerMinute } = await import('../src/modules/auth/auth.routes.js')
    const ip = '198.18.201.9'
    const statuses: number[] = []
    // Corpos inválidos (sem senha) não passam pelo bcrypt, mas contam no limite por IP.
    for (let attempt = 0; attempt <= loginIpLimitPerMinute; attempt += 1) {
      const response = await request(h.app).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: `ceiling${attempt}@example.com` })
      statuses.push(response.status)
    }
    expect(statuses.slice(0, loginIpLimitPerMinute).every((status) => status === 422)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
  })
})
