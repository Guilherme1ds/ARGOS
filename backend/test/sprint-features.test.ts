import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { bearer, startHarness, today, type Harness } from './support/harness.js'

// Sprints 5 a 8: multi-organização e RBAC, chat moderado, custódia, busca avançada, retenção e observabilidade.
const metricsToken = 'metrics-token-for-tests-0123456789'
const inviteSubject = 'Convite para gerir um espaço no ARGOS'
let h: Harness

beforeAll(async () => {
  h = await startHarness('sprints', { METRICS_TOKEN: metricsToken, CHAT_MUTE_STRIKES: '3', AUTO_HIDE_REPORT_THRESHOLD: '3' })
})

afterAll(() => h.cleanup())

const app = () => h.app
const count = (sql: string, ...params: unknown[]) => (h.db.prepare(sql).get(...params) as { total: number }).total

async function createOrganization(name: string, spaces: string[]) {
  const org = await request(app()).post('/api/v1/organizations').set(bearer(h.admin.token)).send({ name }).expect(201)
  const spaceIds: number[] = []
  for (const space of spaces) {
    const created = await request(app()).post(`/api/v1/organizations/${org.body.id}/spaces`).set(bearer(h.admin.token)).send({ name: space }).expect(201)
    spaceIds.push(created.body.id)
  }
  return { id: org.body.id as number, spaceIds }
}

/** Convida pelo admin, cria a conta convidada e aceita: devolve a sessão do novo gestor. */
async function inviteManager(organizationId: number, email: string, role: 'org_admin' | 'space_manager', spaceId?: number) {
  await request(app()).post(`/api/v1/organizations/${organizationId}/invites`).set(bearer(h.admin.token)).send({ email, role, spaceId }).expect(201)
  const token = h.latestToken(email, inviteSubject)!
  const session = await h.register(email)
  await request(app()).post('/api/v1/organizations/invites/accept').set(bearer(session.token)).send({ token }).expect(200)
  return session
}

describe('Sprint 5 - organizations, spaces, invites and scoped RBAC', () => {
  it('creates organizations and spaces, lists active spaces publicly and keeps names unique', async () => {
    const org = await createOrganization('Campus Centro', ['Biblioteca', 'Secretaria'])
    await request(app()).post('/api/v1/organizations').set(bearer(h.admin.token)).send({ name: 'campus centro' }).expect(409)
    await request(app()).post(`/api/v1/organizations/${org.id}/spaces`).set(bearer(h.admin.token)).send({ name: 'BIBLIOTECA' }).expect(409)
    const citizen = await h.register('org-citizen@example.com')
    await request(app()).post('/api/v1/organizations').set(bearer(citizen.token)).send({ name: 'Invasão' }).expect(403)
    expect((await request(app()).get('/api/v1/organizations').set(bearer(citizen.token)).expect(200)).body.data).toEqual([])

    const spaces = await request(app()).get('/api/v1/spaces').expect(200)
    expect(spaces.body.data.map((space: { name: string }) => space.name)).toEqual(expect.arrayContaining(['Biblioteca', 'Secretaria']))
    await request(app()).patch(`/api/v1/organizations/${org.id}/spaces/${org.spaceIds[1]}`).set(bearer(h.admin.token)).send({ status: 'archived' }).expect(200)
    const afterArchive = await request(app()).get('/api/v1/spaces').expect(200)
    expect(afterArchive.body.data.some((space: { id: number }) => space.id === org.spaceIds[1])).toBe(false)
  })

  it('accepts invites only for the invited e-mail, once, before expiring, and exposes memberships', async () => {
    const org = await createOrganization('Campus Norte', ['Achados Norte'])
    await request(app()).post(`/api/v1/organizations/${org.id}/invites`).set(bearer(h.admin.token)).send({ email: 'gestor.norte@example.com', role: 'space_manager' }).expect(422)
    await request(app()).post(`/api/v1/organizations/${org.id}/invites`).set(bearer(h.admin.token))
      .send({ email: 'gestor.norte@example.com', role: 'space_manager', spaceId: org.spaceIds[0] }).expect(201)
    const token = h.latestToken('gestor.norte@example.com', inviteSubject)!
    expect(h.db.prepare('SELECT token_hash FROM manager_invites WHERE email = ?').get('gestor.norte@example.com')).not.toMatchObject({ token_hash: token })

    const preview = await request(app()).post('/api/v1/organizations/invites/preview').send({ token }).expect(200)
    expect(preview.body.invite).toMatchObject({ organizationName: 'Campus Norte', spaceName: 'Achados Norte', role: 'space_manager', status: 'pending' })
    expect(preview.body.invite.emailHint).not.toContain('gestor.norte')

    const intruder = await h.register('intruso.norte@example.com')
    const mismatch = await request(app()).post('/api/v1/organizations/invites/accept').set(bearer(intruder.token)).send({ token }).expect(403)
    expect(mismatch.body.details.code).toBe('invite_email_mismatch')

    const manager = await h.register('gestor.norte@example.com')
    await request(app()).post('/api/v1/organizations/invites/accept').set(bearer(manager.token)).send({ token }).expect(200)
    const reused = await request(app()).post('/api/v1/organizations/invites/accept').set(bearer(manager.token)).send({ token }).expect(409)
    expect(reused.body.details.code).toBe('invite_used')
    const me = await request(app()).get('/api/v1/auth/me').set(bearer(manager.token)).expect(200)
    expect(me.body.user.memberships).toEqual([expect.objectContaining({ organizationId: org.id, spaceId: org.spaceIds[0], role: 'space_manager', spaceName: 'Achados Norte' })])

    await request(app()).post(`/api/v1/organizations/${org.id}/invites`).set(bearer(h.admin.token)).send({ email: 'late@example.com', role: 'org_admin' }).expect(201)
    const lateToken = h.latestToken('late@example.com', inviteSubject)!
    h.db.prepare("UPDATE manager_invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'late@example.com'").run()
    const late = await h.register('late@example.com')
    const expired = await request(app()).post('/api/v1/organizations/invites/accept').set(bearer(late.token)).send({ token: lateToken }).expect(410)
    expect(expired.body.details.code).toBe('invite_expired')
  })

  it('limits space managers to their own space and lets org admins manage the organization', async () => {
    const org = await createOrganization('Campus Sul', ['Portaria Sul', 'Ginásio Sul'])
    const managerA = await inviteManager(org.id, 'gestor.portaria@example.com', 'space_manager', org.spaceIds[0])
    const orgAdmin = await inviteManager(org.id, 'admin.sul@example.com', 'org_admin')
    const owner = await h.register('dono.sul@example.com')
    const claimant = await h.register('reivindica.sul@example.com')
    const inA = await h.createItem(owner.token, { title: 'Mochila azul da portaria', spaceId: org.spaceIds[0] })
    const inB = await h.createItem(owner.token, { title: 'Mochila verde do ginásio', spaceId: org.spaceIds[1] })
    const claimA = await request(app()).post(`/api/v1/items/${inA}/claim`).set(bearer(claimant.token))
      .send({ message: 'Acredito que esta mochila é minha.', proofDetails: 'Tem um chaveiro de gato no zíper.' }).expect(201)
    await request(app()).post(`/api/v1/items/${inB}/claim`).set(bearer(claimant.token))
      .send({ message: 'Acredito que esta mochila é minha.', proofDetails: 'Tem um chaveiro de gato no zíper.' }).expect(201)

    const detail = await request(app()).get(`/api/v1/items/${inA}`).set(bearer(managerA.token)).expect(200)
    expect(detail.body.capabilities).toMatchObject({ readClaims: true, return: true, custody: true, manageCustody: true })
    expect(detail.body.item).toMatchObject({ space_id: org.spaceIds[0], space_name: 'Portaria Sul', organization_name: 'Campus Sul' })
    await request(app()).get(`/api/v1/items/${inA}/claims`).set(bearer(managerA.token)).expect(200)
    await request(app()).get(`/api/v1/items/${inB}/claims`).set(bearer(managerA.token)).expect(403)
    await request(app()).patch(`/api/v1/items/${inB}/return`).set(bearer(managerA.token)).send({}).expect(403)
    // Papel de escopo não abre o painel global nem a troca de espaço do caso.
    await request(app()).get('/api/v1/admin/items').set(bearer(managerA.token)).expect(403)
    await request(app()).patch(`/api/v1/items/${inA}`).set(bearer(managerA.token)).send({ spaceId: org.spaceIds[1] }).expect(403)
    await request(app()).patch(`/api/v1/items/${inA}/return`).set(bearer(managerA.token)).send({ claimId: claimA.body.id }).expect(200)

    // O administrador da organização alcança todos os espaços dela e gere espaços e convites, mas não arquiva a organização.
    await request(app()).get(`/api/v1/items/${inB}/claims`).set(bearer(orgAdmin.token)).expect(200)
    await request(app()).post(`/api/v1/organizations/${org.id}/spaces`).set(bearer(orgAdmin.token)).send({ name: 'Cantina Sul' }).expect(201)
    await request(app()).post(`/api/v1/organizations/${org.id}/spaces`).set(bearer(managerA.token)).send({ name: 'Não pode' }).expect(403)
    await request(app()).patch(`/api/v1/organizations/${org.id}`).set(bearer(orgAdmin.token)).send({ status: 'archived' }).expect(403)
    const detailOrg = await request(app()).get(`/api/v1/organizations/${org.id}`).set(bearer(orgAdmin.token)).expect(200)
    expect(detailOrg.body.members.map((member: { email: string }) => member.email)).toEqual(expect.arrayContaining(['gestor.portaria@example.com', 'admin.sul@example.com']))
    const managerView = await request(app()).get(`/api/v1/organizations/${org.id}`).set(bearer(managerA.token)).expect(200)
    expect(managerView.body.members).toEqual([])
    expect(managerView.body.spaces.map((space: { id: number }) => space.id)).toEqual([org.spaceIds[0]])

    // Remover o vínculo vale na próxima requisição; o último administrador da organização não sai sozinho.
    const member = detailOrg.body.members.find((entry: { email: string }) => entry.email === 'gestor.portaria@example.com')
    await request(app()).delete(`/api/v1/organizations/${org.id}/members/${member.id}`).set(bearer(orgAdmin.token)).expect(200)
    await request(app()).get(`/api/v1/items/${inA}/claims`).set(bearer(managerA.token)).expect(403)
    const self = detailOrg.body.members.find((entry: { email: string }) => entry.email === 'admin.sul@example.com')
    await request(app()).delete(`/api/v1/organizations/${org.id}/members/${self.id}`).set(bearer(orgAdmin.token)).expect(422)
  })

  it('moderators moderate content and the report queue without account administration', async () => {
    const moderator = await h.register('moderadora@example.com')
    h.db.prepare("UPDATE users SET role = 'moderator' WHERE id = ?").run(moderator.id)
    const owner = await h.register('dono.moderado@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Caderno moderado' })
    await request(app()).get('/api/v1/admin/items').set(bearer(moderator.token)).expect(200)
    const listed = await request(app()).get('/api/v1/admin/items').set(bearer(moderator.token)).expect(200)
    expect(listed.body.data[0]).not.toHaveProperty('owner_email')
    await request(app()).patch(`/api/v1/admin/items/${itemId}/status`).set(bearer(moderator.token)).send({ approvalStatus: 'rejected' }).expect(200)
    await request(app()).get('/api/v1/admin/reports').set(bearer(moderator.token)).expect(200)
    await request(app()).get('/api/v1/admin/users').set(bearer(moderator.token)).expect(403)
    await request(app()).patch(`/api/v1/admin/users/${owner.id}`).set(bearer(moderator.token)).send({ status: 'blocked' }).expect(403)
    await request(app()).get('/api/v1/reports/items.csv').set(bearer(moderator.token)).expect(403)
  })
})

describe('Sprint 6 - secure chat and automatic moderation', () => {
  it('keeps conversations private between the two parties and tracks unread messages', async () => {
    const owner = await h.register('chat.dono@example.com')
    const visitor = await h.register('chat.visitante@example.com')
    const stranger = await h.register('chat.estranho@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Fone branco no auditório' })

    await request(app()).post('/api/v1/conversations').set(bearer(owner.token)).send({ itemId }).expect(422)
    const started = await request(app()).post('/api/v1/conversations').set(bearer(visitor.token)).send({ itemId }).expect(201)
    const again = await request(app()).post('/api/v1/conversations').set(bearer(visitor.token)).send({ itemId }).expect(200)
    expect(again.body.id).toBe(started.body.id)
    expect(JSON.stringify(started.body)).not.toContain('chat.dono@example.com')

    const id = started.body.id
    await request(app()).post(`/api/v1/conversations/${id}/messages`).set(bearer(visitor.token)).send({ body: 'Oi! Acho que esse fone é meu.' }).expect(201)
    expect((await request(app()).get('/api/v1/conversations/unread-count').set(bearer(owner.token)).expect(200)).body.total).toBe(1)
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'chat' AND read_at IS NULL", owner.id)).toBe(1)
    await request(app()).post(`/api/v1/conversations/${id}/messages`).set(bearer(visitor.token)).send({ body: 'Ele tem uma marca de caneta.' }).expect(201)
    // Um aviso por conversa enquanto houver mensagem não lida.
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'chat'", owner.id)).toBe(1)

    const thread = await request(app()).get(`/api/v1/conversations/${id}/messages`).set(bearer(owner.token)).expect(200)
    expect(thread.body.data.map((message: { body: string; mine: boolean }) => [message.mine, message.body])).toEqual([
      [false, 'Oi! Acho que esse fone é meu.'],
      [false, 'Ele tem uma marca de caneta.'],
    ])
    expect((await request(app()).get('/api/v1/conversations/unread-count').set(bearer(owner.token)).expect(200)).body.total).toBe(0)
    const latest = thread.body.data[1].id
    await request(app()).post(`/api/v1/conversations/${id}/messages`).set(bearer(owner.token)).send({ body: 'Pode retirar na secretaria.' }).expect(201)
    const polled = await request(app()).get(`/api/v1/conversations/${id}/messages`).query({ after: latest }).set(bearer(visitor.token)).expect(200)
    expect(polled.body.data).toHaveLength(1)

    await request(app()).get(`/api/v1/conversations/${id}/messages`).set(bearer(stranger.token)).expect(404)
    await request(app()).post(`/api/v1/conversations/${id}/messages`).set(bearer(stranger.token)).send({ body: 'Oi' }).expect(404)

    await request(app()).patch(`/api/v1/conversations/${id}`).set(bearer(owner.token)).send({ status: 'closed' }).expect(200)
    const closed = await request(app()).post(`/api/v1/conversations/${id}/messages`).set(bearer(visitor.token)).send({ body: 'Ainda está aí?' }).expect(409)
    expect(closed.body.details.code).toBe('conversation_closed')
    await request(app()).patch(`/api/v1/conversations/${id}`).set(bearer(visitor.token)).send({ status: 'open' }).expect(403)
    await request(app()).patch(`/api/v1/conversations/${id}`).set(bearer(owner.token)).send({ status: 'open' }).expect(200)
  })

  it('delivers a message that arrived just before the reader sent one, and sending does not mark it as read', async () => {
    const owner = await h.register('corrida.dono@example.com')
    const visitor = await h.register('corrida.visitante@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Caderno verde no laboratório' })
    const id = (await request(app()).post('/api/v1/conversations').set(bearer(visitor.token)).send({ itemId }).expect(201)).body.id
    const send = (token: string, body: string) => request(app()).post(`/api/v1/conversations/${id}/messages`).set(bearer(token)).send({ body }).expect(201)
    const unread = async (token: string) => (await request(app()).get('/api/v1/conversations/unread-count').set(bearer(token)).expect(200)).body.total

    await send(visitor.token, 'Oi, acho que o caderno é meu.')
    await request(app()).get(`/api/v1/conversations/${id}/messages`).set(bearer(owner.token)).expect(200)
    // Entre duas consultas do dono: a outra pessoa escreve e, um instante depois, o dono envia a própria mensagem.
    const incoming = (await send(visitor.token, 'Ele tem um adesivo na capa.')).body.message
    const mine = (await send(owner.token, 'Pode descrever melhor?')).body.message
    expect(await unread(owner.token)).toBe(1)

    // Cliente que avançou o cursor pela mensagem enviada (web e app até 23/11) ainda recebe a anterior, sem repetir a própria.
    const polled = await request(app()).get(`/api/v1/conversations/${id}/messages`).query({ after: mine.id }).set(bearer(owner.token)).expect(200)
    expect(polled.body.data.map((message: { id: number }) => message.id)).toEqual([incoming.id])
    expect(await unread(owner.token)).toBe(0)
    const again = await request(app()).get(`/api/v1/conversations/${id}/messages`).query({ after: mine.id }).set(bearer(owner.token)).expect(200)
    expect(again.body.data).toEqual([])
  })

  it('blocks, flags or warns messages by rule and sends flagged ones to the moderation queue', async () => {
    const owner = await h.register('regra.dono@example.com')
    const visitor = await h.register('regra.visitante@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Carteira marrom na quadra' })
    const id = (await request(app()).post('/api/v1/conversations').set(bearer(visitor.token)).send({ itemId }).expect(201)).body.id
    const send = (body: string, token = visitor.token) => request(app()).post(`/api/v1/conversations/${id}/messages`).set(bearer(token)).send({ body })

    const offensive = await send('Seu idiota, devolve logo').expect(422)
    expect(offensive.body.details).toMatchObject({ code: 'content_blocked', rule: 'offensive_language' })
    expect((await send('Veja a foto em https://exemplo.com/foto').expect(422)).body.details.rule).toBe('external_link')
    expect(count('SELECT COUNT(*) AS total FROM chat_messages WHERE conversation_id = ?', id)).toBe(0)

    const contact = await send('Meu e-mail é pessoa@example.com se preferir.', owner.token).expect(201)
    expect(contact.body.message.safetyNotice).toBe('contact_info')
    const payment = await send('Só devolvo se você mandar um pix de 50 reais.', owner.token).expect(201)
    expect(payment.body.message.safetyNotice).toBe('payment_request')

    const report = await request(app()).post(`/api/v1/conversations/${id}/messages/${contact.body.message.id}/report`).set(bearer(visitor.token)).expect(201)
    expect(report.body.message).toBeTruthy()
    await request(app()).post(`/api/v1/conversations/${id}/messages/${contact.body.message.id}/report`).set(bearer(owner.token)).expect(422)

    await request(app()).get('/api/v1/conversations/moderation/flagged').set(bearer(owner.token)).expect(403)
    const queue = await request(app()).get('/api/v1/conversations/moderation/flagged').set(bearer(h.admin.token)).expect(200)
    const flaggedIds = queue.body.data.map((row: { id: number }) => row.id)
    expect(flaggedIds).toEqual(expect.arrayContaining([contact.body.message.id, payment.body.message.id]))

    await request(app()).patch(`/api/v1/conversations/moderation/messages/${payment.body.message.id}`).set(bearer(h.admin.token)).send({ action: 'remove' }).expect(200)
    await request(app()).patch(`/api/v1/conversations/moderation/messages/${payment.body.message.id}`).set(bearer(h.admin.token)).send({ action: 'remove' }).expect(409)
    await request(app()).patch(`/api/v1/conversations/moderation/messages/${contact.body.message.id}`).set(bearer(h.admin.token)).send({ action: 'dismiss' }).expect(200)
    const seen = await request(app()).get(`/api/v1/conversations/${id}/messages`).set(bearer(visitor.token)).expect(200)
    const removed = seen.body.data.find((message: { id: number }) => message.id === payment.body.message.id)
    expect(removed).toMatchObject({ removed: true, body: 'Mensagem removida pela moderação.' })
  })

  it('does not block everyday lost-and-found vocabulary and catches links without http or www', async () => {
    const { evaluateText } = await import('../src/shared/policies/moderation.js')
    const verdict = (text: string, context: 'chat' | 'comment' | 'item') => {
      const result = evaluateText(text, context)
      return result.action === 'allow' ? 'allow' : `${result.action}:${result.rule}`
    }

    // Objetos cujo nome também é ofensa: publicam e conversam normalmente.
    expect(verdict('Piranha de cabelo rosa', 'item')).toBe('allow')
    expect(verdict('Macaco hidráulico do carro', 'item')).toBe('allow')
    expect(verdict('Vi uma piranha de cabelo igual na cantina.', 'comment')).toBe('allow')
    expect(verdict('Achei sua piranha de cabelo na biblioteca.', 'chat')).toBe('allow')
    expect(verdict('Seu macaco do carro está na portaria.', 'chat')).toBe('allow')
    // Dirigida à pessoa, a palavra vai para revisão (entregue, sem contar como bloqueio); ofensa clara segue bloqueada.
    expect(verdict('Você é uma piranha', 'chat')).toBe('flag:offensive_language')
    expect(verdict('seu macaco', 'chat')).toBe('flag:offensive_language')
    expect(verdict('Seu idiota', 'chat')).toBe('block:offensive_language')

    // A rotina de achados e perdidos não é pedido de pagamento...
    for (const text of [
      'Encontrei seu cartão de crédito na biblioteca.',
      'O item está no depósito do bloco B.',
      'Vamos fazer a transferência para a portaria amanhã.',
      'Cheguei adiantado, estou na recepção.',
    ]) expect(verdict(text, 'chat'), text).toBe('allow')
    // ...e a cobrança continua indo para revisão.
    for (const text of [
      'Faz um pix de 50 reais que eu devolvo.',
      'Me manda R$ 30 pela entrega.',
      'Transfere pra minha conta antes.',
      'Deposita na minha conta e eu levo.',
      'Qual o número do seu cartão?',
    ]) expect(verdict(text, 'chat'), text).toBe('flag:payment_request')

    // Links sem http/www também são barrados; ponto sem espaço antes de "Com" não vira link.
    for (const text of ['Acesse golpe.com agora', 'Veja em site.com.br', 'Me chama no wa.me/5511999999999', 'bit.ly/abc123', 'https://exemplo.com/foto', 'www.golpe.com']) {
      expect(verdict(text, 'chat'), text).toBe('block:external_link')
      expect(verdict(text, 'comment'), text).toBe('block:external_link')
    }
    for (const text of ['Ok.Com certeza, amanhã às 14h.', 'Ok.Combinado, te encontro lá.', 'Certo.Informo quando chegar.']) {
      expect(verdict(text, 'chat'), text).toBe('allow')
    }
    expect(verdict('Meu e-mail é ana@exemplo.com', 'chat')).toBe('warn:contact_info')

    // Pela API: o objeto é publicado sem contar bloqueio; a palavra dirigida à pessoa é entregue e vai para a fila.
    const author = await h.register('vocabulario.autor@example.com')
    const visitor = await h.register('vocabulario.visitante@example.com')
    const itemId = await h.createItem(author.token, { title: 'Piranha de cabelo rosa', description: 'Piranha de cabelo rosa encontrada no banheiro do bloco B.' })
    expect(count("SELECT COUNT(*) AS total FROM moderation_events WHERE user_id = ? AND action = 'blocked'", author.id)).toBe(0)
    const conversation = (await request(app()).post('/api/v1/conversations').set(bearer(visitor.token)).send({ itemId }).expect(201)).body.id
    const sent = await request(app()).post(`/api/v1/conversations/${conversation}/messages`).set(bearer(visitor.token)).send({ body: 'Você é uma piranha' }).expect(201)
    expect(h.db.prepare('SELECT status, moderation_rule FROM chat_messages WHERE id = ?').get(sent.body.message.id)).toEqual({ status: 'flagged', moderation_rule: 'offensive_language' })
    expect(count("SELECT COUNT(*) AS total FROM moderation_events WHERE user_id = ? AND action = 'blocked'", visitor.id)).toBe(0)
  })

  it('mutes an account after repeated blocks and auto-hides cases reported by several people', async () => {
    const owner = await h.register('mute.dono@example.com')
    const abuser = await h.register('mute.abuso@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Óculos de grau na cantina' })
    const id = (await request(app()).post('/api/v1/conversations').set(bearer(abuser.token)).send({ itemId }).expect(201)).body.id
    const send = (body: string) => request(app()).post(`/api/v1/conversations/${id}/messages`).set(bearer(abuser.token)).send({ body })
    await send('Você é um idiota').expect(422)
    await send('Acesse www.golpe.com').expect(422)
    const third = await send('Meu CPF é 123.456.789-09').expect(422)
    expect(third.body.details.mutedUntil).toEqual(expect.any(String))
    const muted = await send('Agora uma mensagem educada.').expect(403)
    expect(muted.body.details.code).toBe('chat_muted')
    // Silêncio vale também para pistas públicas.
    await request(app()).post(`/api/v1/items/${itemId}/comments`).set(bearer(abuser.token)).send({ body: 'Vi perto da porta.' }).expect(403)
    expect(count("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'moderation.auto_muted' AND entity_id = ?", String(abuser.id))).toBe(1)

    const offensiveItem = await request(app()).post('/api/v1/items').set(bearer(owner.token))
      .send({ type: 'found', title: 'Achei a carteira do idiota', description: 'Carteira encontrada no corredor principal.', category: 'Documentos', location: 'Bloco A', eventDate: today() })
      .expect(422)
    expect(offensiveItem.body.details.rule).toBe('offensive_language')

    const reported = await h.createItem(owner.token, { title: 'Caso muito denunciado', description: 'Descrição suficiente do caso denunciado.' })
    for (const index of [1, 2, 3]) {
      const reporter = await h.register(`denunciante${index}@example.com`)
      await request(app()).post(`/api/v1/items/${reported}/report`).set(bearer(reporter.token)).send({ reason: 'Parece golpe.' }).expect(201)
      const state = h.db.prepare('SELECT approval_status FROM items WHERE id = ?').get(reported) as { approval_status: string }
      expect(state.approval_status).toBe(index < 3 ? 'approved' : 'pending')
    }
    await request(app()).get(`/api/v1/items/${reported}`).expect(404)
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND title = 'Publicação em revisão'", owner.id)).toBe(1)
  })
})

describe('Sprint 7 - custody chain and advanced search', () => {
  it('records an append-only, hash-chained custody trail across spaces until hand-over', async () => {
    const org = await createOrganization('Campus Leste', ['Recepção Leste', 'Depósito Leste'])
    const reception = await inviteManager(org.id, 'recepcao.leste@example.com', 'space_manager', org.spaceIds[0])
    const storage = await inviteManager(org.id, 'deposito.leste@example.com', 'space_manager', org.spaceIds[1])
    const finder = await h.register('achou.leste@example.com')
    const claimant = await h.register('dona.leste@example.com')
    const itemId = await h.createItem(finder.token, { title: 'Guarda-chuva vermelho', spaceId: org.spaceIds[0] })
    const claim = await request(app()).post(`/api/v1/items/${itemId}/claim`).set(bearer(claimant.token))
      .send({ message: 'Este guarda-chuva é meu, perdi ontem.', proofDetails: 'Tem uma fita amarela no cabo.' }).expect(201)
    const event = (token: string, body: Record<string, unknown>) => request(app()).post(`/api/v1/custody/items/${itemId}/events`).set(bearer(token)).send(body)

    await event(storage.token, { type: 'received' }).expect(403)
    await event(finder.token, { type: 'received' }).expect(403)
    expect((await event(reception.token, { type: 'received' }).expect(201)).body.state).toBe('in_custody')
    await event(reception.token, { type: 'received' }).expect(409)
    await event(reception.token, { type: 'stored' }).expect(422)
    await event(reception.token, { type: 'stored', storageLocation: 'Armário 2' }).expect(201)
    await event(storage.token, { type: 'stored', storageLocation: 'Prateleira B' }).expect(403)
    expect((await event(reception.token, { type: 'transferred', spaceId: org.spaceIds[1] }).expect(201)).body.state).toBe('in_transit')
    await event(reception.token, { type: 'received' }).expect(403)
    await event(storage.token, { type: 'received' }).expect(201)
    expect((h.db.prepare('SELECT space_id FROM items WHERE id = ?').get(itemId) as { space_id: number }).space_id).toBe(org.spaceIds[1])
    const handed = await event(storage.token, { type: 'handed_over', claimId: claim.body.id, notes: 'Documento conferido no balcão.' }).expect(201)
    expect(handed.body.state).toBe('handed_over')
    expect((h.db.prepare('SELECT status FROM items WHERE id = ?').get(itemId) as { status: string }).status).toBe('returned')
    await event(storage.token, { type: 'stored', storageLocation: 'Outro' }).expect(409)

    const chain = await request(app()).get(`/api/v1/custody/items/${itemId}`).set(bearer(h.admin.token)).expect(200)
    expect(chain.body.chain).toEqual({ valid: true, brokenAt: null })
    expect(chain.body.data.map((entry: { type: string }) => entry.type)).toEqual(['received', 'stored', 'transferred', 'received', 'handed_over'])
    expect(chain.body.data[1].prevHash).toBe(chain.body.data[0].hash)
    expect(chain.body.data[0].actorName).toBeTruthy()
    // Quem publicou acompanha a trilha sem ver quem operou no espaço.
    const ownerView = await request(app()).get(`/api/v1/custody/items/${itemId}`).set(bearer(finder.token)).expect(200)
    expect(ownerView.body.data.every((entry: { actorName: string | null }) => entry.actorName === null)).toBe(true)
    expect(ownerView.body.nextEvents).toEqual([])
    await request(app()).get(`/api/v1/custody/items/${itemId}`).set(bearer(claimant.token)).expect(403)

    // O banco recusa alteração e remoção; a verificação detecta adulteração de uma cópia.
    expect(() => h.db.prepare("UPDATE custody_events SET notes = 'adulterado' WHERE item_ref = ?").run(itemId)).toThrow(/não pode ser alterada/)
    expect(() => h.db.prepare('DELETE FROM custody_events WHERE item_ref = ?').run(itemId)).toThrow(/não pode ser apagada/)
    const { verifyChain } = await import('../src/modules/custody/custody.routes.js')
    const rows = h.db.prepare('SELECT * FROM custody_events WHERE item_ref = ? ORDER BY sequence').all(itemId) as Array<Record<string, unknown>>
    expect(verifyChain(rows as never).valid).toBe(true)
    expect(verifyChain(rows.map((row, index) => (index === 2 ? { ...row, storage_location: 'Outro lugar' } : row)) as never)).toEqual({ valid: false, brokenAt: 3 })

    const panel = await request(app()).get('/api/v1/custody').query({ state: 'handed_over' }).set(bearer(storage.token)).expect(200)
    expect(panel.body.data.map((row: { id: number }) => row.id)).toContain(itemId)
    expect(panel.body.meta.summary.handedOver).toBeGreaterThanOrEqual(1)
    const otherPanel = await request(app()).get('/api/v1/custody').query({ state: 'all' }).set(bearer(reception.token)).expect(200)
    expect(otherPanel.body.data.map((row: { id: number }) => row.id)).not.toContain(itemId)
    await request(app()).get('/api/v1/custody').query({ spaceId: org.spaceIds[1] }).set(bearer(reception.token)).expect(403)
    await request(app()).get('/api/v1/custody').set(bearer(claimant.token)).expect(403)
  })

  it('keeps the first custody receipt with the case space: other spaces and organizations cannot take the case over', async () => {
    const orgA = await createOrganization('Campus Oeste', ['Biblioteca Oeste', 'Portaria Oeste'])
    const orgB = await createOrganization('Campus Distante', ['Achados Distante'])
    const gateManager = await inviteManager(orgA.id, 'portaria.oeste@example.com', 'space_manager', orgA.spaceIds[1])
    const orgAdminA = await inviteManager(orgA.id, 'admin.oeste@example.com', 'org_admin')
    const foreignManager = await inviteManager(orgB.id, 'gestor.distante@example.com', 'space_manager', orgB.spaceIds[0])
    // Gere a biblioteca (Org A) e um espaço da Org B: não pode levar o caso para a outra organização.
    const dualManager = await inviteManager(orgA.id, 'duplo.oeste@example.com', 'space_manager', orgA.spaceIds[0])
    await request(app()).post(`/api/v1/organizations/${orgB.id}/invites`).set(bearer(h.admin.token))
      .send({ email: 'duplo.oeste@example.com', role: 'space_manager', spaceId: orgB.spaceIds[0] }).expect(201)
    await request(app()).post('/api/v1/organizations/invites/accept').set(bearer(dualManager.token))
      .send({ token: h.latestToken('duplo.oeste@example.com', inviteSubject) }).expect(200)

    const owner = await h.register('dono.oeste@example.com')
    const claimant = await h.register('reivindica.oeste@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Mochila cinza da biblioteca', spaceId: orgA.spaceIds[0] })
    await request(app()).post(`/api/v1/items/${itemId}/claim`).set(bearer(claimant.token))
      .send({ message: 'Acredito que esta mochila é minha.', proofDetails: 'Tem um adesivo de gato por dentro.' }).expect(201)
    const receive = (token: string, spaceId?: number, id = itemId) =>
      request(app()).post(`/api/v1/custody/items/${id}/events`).set(bearer(token)).send({ type: 'received', spaceId })
    const caseSpace = () => (h.db.prepare('SELECT space_id FROM items WHERE id = ?').get(itemId) as { space_id: number }).space_id

    // Gestor de outra organização ou de outro espaço não abre a trilha nem puxa o caso para o próprio espaço.
    await request(app()).get(`/api/v1/custody/items/${itemId}`).set(bearer(foreignManager.token)).expect(403)
    await receive(foreignManager.token, orgB.spaceIds[0]).expect(403)
    await receive(gateManager.token, orgA.spaceIds[1]).expect(403)
    await receive(dualManager.token, orgB.spaceIds[0]).expect(422)
    expect(caseSpace()).toBe(orgA.spaceIds[0])
    await request(app()).get(`/api/v1/items/${itemId}/claims`).set(bearer(foreignManager.token)).expect(403)
    await request(app()).get(`/api/v1/items/${itemId}/claims`).set(bearer(gateManager.token)).expect(403)

    // Quem administra a organização do caso recebe em outro espaço dela; o caso passa para esse espaço.
    expect((await receive(orgAdminA.token, orgA.spaceIds[1]).expect(201)).body.state).toBe('in_custody')
    expect(caseSpace()).toBe(orgA.spaceIds[1])

    // Sem espaço definido: item perdido não entra em custódia; item encontrado pode ser recebido por um gestor.
    // Termos fora do dicionário de sinônimos: o teste da busca conta casos do banco compartilhado.
    const lostId = await h.createItem(owner.token, { type: 'lost', title: 'Calculadora perdida no pátio', description: 'Perdi minha calculadora cinza ontem à tarde no pátio.' })
    await receive(foreignManager.token, orgB.spaceIds[0], lostId).expect(422)
    const foundId = await h.createItem(owner.token, { title: 'Garrafa sem espaço definido' })
    expect((await request(app()).get(`/api/v1/custody/items/${foundId}`).set(bearer(foreignManager.token)).expect(200)).body.nextEvents).toEqual(['received'])
    await receive(foreignManager.token, orgB.spaceIds[0], foundId).expect(201)
  })

  it('closes the case on a final disposal and lets the space reopen it when the disposal was a mistake', async () => {
    const org = await createOrganization('Campus Serra', ['Depósito Serra', 'Portaria Serra'])
    const manager = await inviteManager(org.id, 'deposito.serra@example.com', 'space_manager', org.spaceIds[0])
    const finder = await h.register('achou.serra@example.com')
    const claimant = await h.register('reivindica.serra@example.com')
    const follower = await h.register('acompanha.serra@example.com')
    const latecomer = await h.register('atrasado.serra@example.com')
    // Termos fora do dicionário de sinônimos: o teste da busca conta casos do banco compartilhado.
    const itemId = await h.createItem(finder.token, { title: 'Régua de alumínio esquecida', description: 'Régua de alumínio esquecida na sala de desenho.', spaceId: org.spaceIds[0] })
    const claim = await request(app()).post(`/api/v1/items/${itemId}/claim`).set(bearer(claimant.token))
      .send({ message: 'Acredito que esta régua é minha.', proofDetails: 'Tem meu nome gravado no verso.' }).expect(201)
    await request(app()).post(`/api/v1/items/${itemId}/follow`).set(bearer(follower.token)).expect(201)
    const event = (body: Record<string, unknown>) => request(app()).post(`/api/v1/custody/items/${itemId}/events`).set(bearer(manager.token)).send(body)
    await event({ type: 'received' }).expect(201)
    await event({ type: 'disposed' }).expect(422)
    expect((await event({ type: 'disposed', notes: 'Doado após 90 dias sem retirada.' }).expect(201)).body.state).toBe('disposed')

    // O caso fica encerrado: reivindicação aberta recusada, status sem "reivindicado" e avisos para quem dependia dele.
    const row = h.db.prepare('SELECT status, archived_at FROM items WHERE id = ?').get(itemId) as { status: string; archived_at: string | null }
    expect(row.status).toBe('found')
    expect(row.archived_at).toBeTruthy()
    expect((h.db.prepare('SELECT status FROM claims WHERE id = ?').get(claim.body.id) as { status: string }).status).toBe('rejected')
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND title = 'Reivindicação encerrada'", claimant.id)).toBe(1)
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND title = 'Caso acompanhado encerrado'", follower.id)).toBe(1)

    // Não aceita mais reivindicação, conversa nem devolução, e sai da busca; a página continua acessível com o aviso.
    const late = await request(app()).post(`/api/v1/items/${itemId}/claim`).set(bearer(latecomer.token))
      .send({ message: 'Acredito que esta régua é minha.', proofDetails: 'Tem uma marca no canto.' }).expect(409)
    expect(late.body.details.code).toBe('item_archived')
    await request(app()).post('/api/v1/conversations').set(bearer(latecomer.token)).send({ itemId }).expect(422)
    await request(app()).patch(`/api/v1/items/${itemId}/return`).set(bearer(finder.token)).send({ claimId: claim.body.id }).expect(409)
    const search = await request(app()).get('/api/v1/items/search').query({ q: 'régua alumínio' }).expect(200)
    expect(search.body.data.map((entry: { id: number }) => entry.id)).not.toContain(itemId)
    const detail = await request(app()).get(`/api/v1/items/${itemId}`).set(bearer(latecomer.token)).expect(200)
    expect(detail.body.item.archived_at).toBeTruthy()
    expect(detail.body.capabilities).toMatchObject({ claim: false, return: false })

    // Engano: quem gere o espaço reabre o caso no mesmo espaço, com motivo; a trilha guarda a destinação e a reabertura.
    expect((await request(app()).get(`/api/v1/custody/items/${itemId}`).set(bearer(manager.token)).expect(200)).body.nextEvents).toEqual(['note', 'received'])
    await event({ type: 'received' }).expect(422)
    await event({ type: 'received', notes: 'Registro feito por engano.', spaceId: org.spaceIds[1] }).expect(422)
    await request(app()).post(`/api/v1/custody/items/${itemId}/events`).set(bearer(claimant.token)).send({ type: 'received', notes: 'Quero reabrir.' }).expect(403)
    expect((await event({ type: 'received', notes: 'Destinação registrada por engano; o item continua no armário.' }).expect(201)).body.state).toBe('in_custody')

    // O caso volta: a reivindicação recusada pela destinação volta para análise e quem dependia do caso é avisado.
    expect(h.db.prepare('SELECT status, archived_at FROM items WHERE id = ?').get(itemId)).toEqual({ status: 'claimed', archived_at: null })
    expect((h.db.prepare('SELECT status FROM claims WHERE id = ?').get(claim.body.id) as { status: string }).status).toBe('pending')
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND title = 'Reivindicação reaberta'", claimant.id)).toBe(1)
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND title = 'Caso acompanhado reaberto'", follower.id)).toBe(1)
    const again = await request(app()).get('/api/v1/items/search').query({ q: 'régua alumínio' }).expect(200)
    expect(again.body.data.map((entry: { id: number }) => entry.id)).toContain(itemId)
    expect((await request(app()).get(`/api/v1/items/${itemId}`).set(bearer(latecomer.token)).expect(200)).body.capabilities.claim).toBe(true)
    await request(app()).post(`/api/v1/items/${itemId}/claim`).set(bearer(latecomer.token))
      .send({ message: 'Acredito que esta régua é minha.', proofDetails: 'Tem uma marca no canto.' }).expect(201)
    const trail = await request(app()).get(`/api/v1/custody/items/${itemId}`).set(bearer(h.admin.token)).expect(200)
    expect(trail.body.chain).toEqual({ valid: true, brokenAt: null })
    expect(trail.body.data.map((entry: { type: string }) => entry.type)).toEqual(['received', 'disposed', 'received'])
  })

  it('undoes a return registered by mistake, from the case page or from the custody trail', async () => {
    const org = await createOrganization('Campus Vale', ['Balcão Vale', 'Arquivo Vale'])
    const manager = await inviteManager(org.id, 'balcao.vale@example.com', 'space_manager', org.spaceIds[0])
    const finder = await h.register('achou.vale@example.com')
    const chosen = await h.register('escolhida.vale@example.com')
    const other = await h.register('outra.vale@example.com')
    const follower = await h.register('acompanha.vale@example.com')
    const stranger = await h.register('estranha.vale@example.com')
    const claimOf = (itemId: number, token: string, proofDetails: string) =>
      request(app()).post(`/api/v1/items/${itemId}/claim`).set(bearer(token)).send({ message: 'Acredito que este objeto é meu.', proofDetails })
    const reopen = (itemId: number, token: string, body: Record<string, unknown> = { reason: 'Devolução registrada por engano: a pessoa não retirou.' }) =>
      request(app()).patch(`/api/v1/items/${itemId}/reopen`).set(bearer(token)).send(body)
    const claimStatus = (id: number) => (h.db.prepare('SELECT status FROM claims WHERE id = ?').get(id) as { status: string }).status
    const itemStatus = (id: number) => (h.db.prepare('SELECT status FROM items WHERE id = ?').get(id) as { status: string }).status
    const notified = (userId: number, title: string) => count('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND title = ?', userId, title)

    // 1. Sem custódia: quem registrou a devolução (o autor) desfaz pela tela do caso, com motivo.
    // Termos fora do dicionário de sinônimos: o teste da busca conta casos do banco compartilhado.
    const itemId = await h.createItem(finder.token, { title: 'Grampeador azul do laboratório', description: 'Grampeador azul esquecido na bancada do laboratório.' })
    const chosenClaim = (await claimOf(itemId, chosen.token, 'Tem minhas iniciais embaixo.').expect(201)).body.id as number
    const otherClaim = (await claimOf(itemId, other.token, 'Tem um adesivo vermelho.').expect(201)).body.id as number
    await request(app()).post(`/api/v1/items/${itemId}/follow`).set(bearer(follower.token)).expect(201)
    await request(app()).patch(`/api/v1/items/${itemId}/return`).set(bearer(finder.token)).send({ claimId: chosenClaim }).expect(200)
    expect([itemStatus(itemId), claimStatus(chosenClaim), claimStatus(otherClaim)]).toEqual(['returned', 'approved', 'rejected'])
    expect((await request(app()).get(`/api/v1/items/${itemId}`).set(bearer(finder.token)).expect(200)).body.capabilities).toMatchObject({ reopen: true, reopenInCustody: false, return: false })
    expect((await request(app()).get(`/api/v1/items/${itemId}`).set(bearer(stranger.token)).expect(200)).body.capabilities.reopen).toBe(false)

    await reopen(itemId, stranger.token).expect(403)
    await reopen(itemId, finder.token, {}).expect(422)
    await reopen(itemId, finder.token, { reason: 'Engano.' }).expect(422)
    await reopen(itemId, finder.token).expect(200)

    // As duas reivindicações voltam para análise; quem dependia do caso é avisado e o caso volta a aceitar tudo.
    expect([itemStatus(itemId), claimStatus(chosenClaim), claimStatus(otherClaim)]).toEqual(['claimed', 'pending', 'pending'])
    expect([notified(chosen.id, 'Reivindicação reaberta'), notified(other.id, 'Reivindicação reaberta'), notified(follower.id, 'Caso acompanhado reaberto')]).toEqual([1, 1, 1])
    expect(count("SELECT COUNT(*) AS total FROM item_history WHERE item_id = ? AND action = 'item.return_undone'", itemId)).toBe(1)
    expect((await reopen(itemId, finder.token).expect(409)).body.details.code).toBe('item_not_returned')
    expect((await request(app()).get(`/api/v1/items/${itemId}`).set(bearer(stranger.token)).expect(200)).body.capabilities.claim).toBe(true)
    await request(app()).post('/api/v1/conversations').set(bearer(stranger.token)).send({ itemId }).expect(201)
    // A devolução certa pode ser registrada em seguida, escolhendo a outra reivindicação.
    await request(app()).patch(`/api/v1/items/${itemId}/return`).set(bearer(finder.token)).send({ claimId: otherClaim }).expect(200)
    expect([claimStatus(chosenClaim), claimStatus(otherClaim)]).toEqual(['rejected', 'approved'])

    // 2. Entrega registrada na custódia: a reabertura é um novo recebimento, feito por quem gere o espaço.
    const custodyItem = await h.createItem(finder.token, { title: 'Transferidor de acrílico', description: 'Transferidor de acrílico deixado na sala 12.', spaceId: org.spaceIds[0] })
    const custodyClaim = (await claimOf(custodyItem, stranger.token, 'Tem uma lasca na borda.').expect(201)).body.id as number
    const event = (body: Record<string, unknown>) => request(app()).post(`/api/v1/custody/items/${custodyItem}/events`).set(bearer(manager.token)).send(body)
    await event({ type: 'received' }).expect(201)
    await event({ type: 'handed_over', claimId: custodyClaim }).expect(201)
    expect(itemStatus(custodyItem)).toBe('returned')
    expect((await request(app()).get(`/api/v1/items/${custodyItem}`).set(bearer(finder.token)).expect(200)).body.capabilities).toMatchObject({ reopen: false, reopenInCustody: false })
    expect((await request(app()).get(`/api/v1/items/${custodyItem}`).set(bearer(manager.token)).expect(200)).body.capabilities).toMatchObject({ reopen: false, reopenInCustody: true })
    expect((await reopen(custodyItem, finder.token).expect(409)).body.details.code).toBe('custody_reopen_required')
    expect((await reopen(custodyItem, manager.token).expect(409)).body.details.code).toBe('custody_reopen_required')

    expect((await request(app()).get(`/api/v1/custody/items/${custodyItem}`).set(bearer(manager.token)).expect(200)).body.nextEvents).toEqual(['note', 'received'])
    await event({ type: 'received' }).expect(422)
    await event({ type: 'received', notes: 'Entrega registrada por engano.', spaceId: org.spaceIds[1] }).expect(422)
    expect((await event({ type: 'received', notes: 'Entrega registrada por engano; o item voltou ao balcão.' }).expect(201)).body.state).toBe('in_custody')
    expect([itemStatus(custodyItem), claimStatus(custodyClaim)]).toEqual(['claimed', 'pending'])
    expect(notified(stranger.id, 'Reivindicação reaberta')).toBe(1)
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND title = 'Custódia atualizada' AND body LIKE '%foi reaberto%'", finder.id)).toBe(1)
    const trail = await request(app()).get(`/api/v1/custody/items/${custodyItem}`).set(bearer(h.admin.token)).expect(200)
    expect(trail.body.chain).toEqual({ valid: true, brokenAt: null })
    expect(trail.body.data.map((entry: { type: string }) => entry.type)).toEqual(['received', 'handed_over', 'received'])
    // E a entrega certa volta a ser possível.
    await event({ type: 'handed_over', claimId: custodyClaim }).expect(201)
    expect(itemStatus(custodyItem)).toBe('returned')

    // 3. Conta de quem publicou excluída (ou bloqueada): o caso devolvido fica só no histórico.
    const gone = await h.register('sumiu.vale@example.com')
    const goneItem = await h.createItem(gone.token, { type: 'lost', title: 'Esquadro de madeira perdido', description: 'Perdi um esquadro de madeira no corredor.' })
    await request(app()).patch(`/api/v1/items/${goneItem}/return`).set(bearer(gone.token)).send({}).expect(200)
    h.db.prepare("UPDATE users SET status = 'blocked' WHERE id = ?").run(gone.id)
    expect((await reopen(goneItem, h.admin.token).expect(409)).body.details.code).toBe('owner_inactive')
    expect(itemStatus(goneItem)).toBe('returned')
  })

  it('expands synonyms, ranks by relevance and returns facets that ignore their own filter', async () => {
    const author = await h.register('busca.autor@example.com')
    const strong = await h.createItem(author.token, { title: 'Smartphone preto com capinha', description: 'Encontrado na arquibancada do ginásio.', category: 'Eletrônicos' })
    const weak = await h.createItem(author.token, { type: 'lost', title: 'Estojo esquecido', description: 'Estojo com um carregador de smartphone dentro.', category: 'Outros' })

    const search = await request(app()).get('/api/v1/items/search').query({ q: 'celular', facets: 'true' }).expect(200)
    const ids = search.body.data.map((item: { id: number }) => item.id)
    expect(ids).toEqual(expect.arrayContaining([strong, weak]))
    expect(ids.indexOf(strong)).toBeLessThan(ids.indexOf(weak))
    expect(search.body.meta.sort).toBe('relevance')
    expect(search.body.meta.synonyms).toEqual(expect.arrayContaining(['smartphone']))

    const filtered = await request(app()).get('/api/v1/items/search').query({ q: 'celular', type: 'found', facets: 'true' }).expect(200)
    expect(filtered.body.data.map((item: { id: number }) => item.id)).toEqual([strong])
    const typeFacet = Object.fromEntries(filtered.body.meta.facets.type.map((entry: { value: string; count: number }) => [entry.value, entry.count]))
    expect(typeFacet).toMatchObject({ found: 1, lost: 1 })
    expect(filtered.body.meta.facets.hasImage).toEqual([{ value: 'false', label: 'false', count: 1 }])
    // Plural simples e ordenação explícita continuam valendo.
    expect((await request(app()).get('/api/v1/items/search').query({ q: 'estojos' }).expect(200)).body.data.map((item: { id: number }) => item.id)).toContain(weak)
    expect((await request(app()).get('/api/v1/items/search').query({ q: 'celular', sort: 'oldest' }).expect(200)).body.meta.sort).toBe('oldest')
    expect((await request(app()).get('/api/v1/items/search').expect(200)).body.meta.sort).toBe('newest')

    await request(app()).post('/api/v1/admin/synonyms').set(bearer(author.token)).send({ terms: ['jaleco', 'avental'] }).expect(403)
    await request(app()).post('/api/v1/admin/synonyms').set(bearer(h.admin.token)).send({ terms: ['Jaleco', 'jaleco'] }).expect(422)
    await request(app()).post('/api/v1/admin/synonyms').set(bearer(h.admin.token)).send({ terms: ['Jaleco', 'Avental'] }).expect(201)
    const apron = await h.createItem(author.token, { title: 'Avental branco do laboratório', description: 'Avental esquecido na bancada 3.' })
    expect((await request(app()).get('/api/v1/items/search').query({ q: 'jaleco' }).expect(200)).body.data.map((item: { id: number }) => item.id)).toContain(apron)
  })
})

describe('Sprint 8 - retention, observability and alerts', () => {
  it('purges unverified accounts, redacts closed claim proofs and old read notifications, and records the run', async () => {
    const stale = await h.registerUnverified('nunca.confirmou@example.com')
    h.db.prepare("UPDATE users SET created_at = datetime('now', '-40 days') WHERE id = ?").run(stale.id)
    const recent = await h.registerUnverified('confirma.depois@example.com')

    const owner = await h.register('retencao.dono@example.com')
    const claimant = await h.register('retencao.claim@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Pendrive retido' })
    const claim = await request(app()).post(`/api/v1/items/${itemId}/claim`).set(bearer(claimant.token))
      .send({ message: 'Este pendrive é meu de verdade.', proofDetails: 'Tem a pasta TCC-final dentro.' }).expect(201)
    await request(app()).delete(`/api/v1/items/${itemId}/claim`).set(bearer(claimant.token)).expect(200)
    h.db.prepare("UPDATE claims SET updated_at = datetime('now', '-200 days') WHERE id = ?").run(claim.body.id)
    h.db.prepare("UPDATE notifications SET read_at = datetime('now', '-200 days') WHERE user_id = ?").run(owner.id)

    await request(app()).post('/api/v1/admin/retention/run').set(bearer(owner.token)).expect(403)
    const run = await request(app()).post('/api/v1/admin/retention/run').set(bearer(h.admin.token)).expect(200)
    expect(run.body.report).toMatchObject({ unverifiedAccounts: 1, claimProofs: 1 })
    expect(run.body.report.notifications).toBeGreaterThanOrEqual(1)
    expect(h.db.prepare('SELECT id FROM users WHERE id = ?').get(stale.id)).toBeUndefined()
    expect(h.db.prepare('SELECT id FROM users WHERE id = ?').get(recent.id)).toBeTruthy()
    expect(h.db.prepare('SELECT proof_details FROM claims WHERE id = ?').get(claim.body.id)).toEqual({ proof_details: '[removido após o prazo de retenção]' })
    expect(count('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?', owner.id)).toBe(0)

    const status = await request(app()).get('/api/v1/admin/retention').set(bearer(h.admin.token)).expect(200)
    expect(status.body.lastRun).toMatchObject({ trigger: 'manual' })
    expect(status.body.runs[0]).toMatchObject({ trigger: 'manual', report: expect.objectContaining({ unverifiedAccounts: 1 }) })
    expect(status.body.rules.map((rule: { data: string }) => rule.data)).toEqual(expect.arrayContaining(['Provas e mensagens de reivindicações já encerradas']))
  })

  it('propagates W3C trace context, protects /metrics and serves the admin observability panel', async () => {
    const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const traced = await request(app()).get('/api/v1/items/search').set('traceparent', incoming).expect(200)
    expect(traced.headers.traceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/)
    expect(traced.headers.traceparent).not.toBe(incoming)
    const fresh = await request(app()).get('/api/health').set('traceparent', 'lixo').expect(200)
    expect(fresh.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)

    await request(app()).get('/metrics').expect(401)
    await request(app()).get('/metrics').set('Authorization', 'Bearer errado').expect(401)
    const metrics = await request(app()).get('/metrics').set('Authorization', `Bearer ${metricsToken}`).expect(200)
    expect(metrics.text).toContain('argos_http_requests_total{method="GET",route="/api/v1/items/search",status="200"}')
    expect(metrics.text).toContain('argos_http_request_duration_seconds_bucket')
    expect(metrics.text).toMatch(/argos_items\{status="found"\} \d+/)

    const citizen = await h.register('observa.cidadao@example.com')
    await request(app()).get('/api/v1/observability').set(bearer(citizen.token)).expect(403)
    const panel = await request(app()).get('/api/v1/observability').set(bearer(h.admin.token)).expect(200)
    expect(panel.body.dependencies.database).toBe('ok')
    expect(panel.body.traffic.last60m.requests).toBeGreaterThan(0)
    expect(panel.body.traffic.series).toHaveLength(60)
    expect(panel.body.service.schemaVersion).toBe(8)
  })

  it('opens an alert once, notifies administrators and resolves it when the rule normalizes', async () => {
    const { applyAlertReadings } = await import('../src/observability/alerts.js')
    const reading = { key: 'http_error_rate', severity: 'critical' as const, title: 'Taxa de erros da API acima do limite', detail: '30 de 100 falharam.', value: 30, threshold: 5 }
    const before = count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'alert'", h.admin.id)
    expect(applyAlertReadings([{ ...reading, firing: true }])).toEqual({ opened: ['http_error_rate'], resolved: [] })
    expect(applyAlertReadings([{ ...reading, firing: true, value: 40 }])).toEqual({ opened: [], resolved: [] })
    expect(count("SELECT COUNT(*) AS total FROM system_alerts WHERE alert_key = 'http_error_rate'")).toBe(1)
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'alert'", h.admin.id)).toBe(before + 1)
    expect(count("SELECT COUNT(*) AS total FROM mail_outbox WHERE subject LIKE 'ARGOS: Alerta:%'")).toBeGreaterThanOrEqual(1)
    expect(applyAlertReadings([{ ...reading, firing: false }])).toEqual({ opened: [], resolved: ['http_error_rate'] })
    const panel = await request(app()).get('/api/v1/observability').set(bearer(h.admin.token)).expect(200)
    expect(panel.body.alerts[0]).toMatchObject({ alert_key: 'http_error_rate', status: 'resolved', value: 40 })
  })
})
