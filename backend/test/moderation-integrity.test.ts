import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { bearer, startHarness, type Harness } from './support/harness.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness('moderation')
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => h.cleanup())

const count = (sql: string, ...params: unknown[]) => (h.db.prepare(sql).get(...params) as { total: number }).total

describe('FUNC-01 administrative item updates are atomic', () => {
  it('leaves approval, history, audit and notifications untouched when the combined payload is invalid', async () => {
    const owner = await h.register('atomic-owner@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Garrafa da moderação' })
    const before = {
      item: h.db.prepare('SELECT approval_status, status, updated_at FROM items WHERE id = ?').get(itemId),
      history: count('SELECT COUNT(*) AS total FROM item_history WHERE item_id = ?', itemId),
      notifications: count('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?', owner.id),
      mails: count('SELECT COUNT(*) AS total FROM mail_outbox WHERE to_email = ?', 'atomic-owner@example.com'),
      audit: count("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'admin.item_status_changed'"),
    }

    // Item "encontrado" não pode ir direto para "devolvido": a aprovação junto também não pode ser gravada.
    await request(h.app).patch(`/api/v1/admin/items/${itemId}/status`).set(bearer(h.admin.token))
      .send({ approvalStatus: 'rejected', status: 'returned', moderationNote: 'Revisado' }).expect(422)
    await request(h.app).patch(`/api/v1/admin/items/${itemId}/status`).set(bearer(h.admin.token)).send({}).expect(422)

    expect(h.db.prepare('SELECT approval_status, status, updated_at FROM items WHERE id = ?').get(itemId)).toEqual(before.item)
    expect(count('SELECT COUNT(*) AS total FROM item_history WHERE item_id = ?', itemId)).toBe(before.history)
    expect(count('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?', owner.id)).toBe(before.notifications)
    expect(count('SELECT COUNT(*) AS total FROM mail_outbox WHERE to_email = ?', 'atomic-owner@example.com')).toBe(before.mails)
    expect(count("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'admin.item_status_changed'")).toBe(before.audit)

    await request(h.app).patch(`/api/v1/admin/items/${itemId}/status`).set(bearer(h.admin.token))
      .send({ approvalStatus: 'rejected', status: 'claimed', moderationNote: 'Revisado' }).expect(200)
    expect(h.db.prepare('SELECT approval_status, status, moderation_note FROM items WHERE id = ?').get(itemId)).toEqual({
      approval_status: 'rejected', status: 'claimed', moderation_note: 'Revisado',
    })
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'approval'", owner.id)).toBe(1)
  })

  it('rolls back the data and sends no push when a write fails inside the transaction', async () => {
    const webpush = (await import('web-push')).default
    const push = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} })
    const owner = await h.register('rollback-owner@example.com')
    await request(h.app).post('/api/v1/push/subscribe').set(bearer(owner.token))
      .send({ endpoint: 'https://push.example.com/sub/rollback', keys: { p256dh: 'BPx'.padEnd(87, 'a'), auth: 'auth-secret-2' } }).expect(201)
    const itemId = await h.createItem(owner.token, { title: 'Mochila da falha simulada' })
    const notificationsBefore = count('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?', owner.id)

    // Falha forçada no meio da transação (depois do UPDATE e antes do commit).
    h.db.exec(`CREATE TRIGGER fail_admin_history BEFORE INSERT ON item_history
      WHEN NEW.action = 'admin.status_changed' BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`)
    try {
      const failed = await request(h.app).patch(`/api/v1/admin/items/${itemId}/status`).set(bearer(h.admin.token)).send({ approvalStatus: 'rejected' }).expect(500)
      expect(JSON.stringify(failed.body)).not.toMatch(/falha simulada|SQLITE/)
    } finally {
      h.db.exec('DROP TRIGGER fail_admin_history')
    }
    expect(h.db.prepare('SELECT approval_status FROM items WHERE id = ?').get(itemId)).toEqual({ approval_status: 'approved' })
    expect(count('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?', owner.id)).toBe(notificationsBefore)
    expect(push).not.toHaveBeenCalled()

    await request(h.app).patch(`/api/v1/admin/items/${itemId}/status`).set(bearer(h.admin.token)).send({ approvalStatus: 'rejected' }).expect(200)
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('validates each concurrent change against the state left by the previous one', async () => {
    const owner = await h.register('concurrent-admin@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Relógio concorrente' })
    const [claimed, returned] = await Promise.all([
      request(h.app).patch(`/api/v1/admin/items/${itemId}/status`).set(bearer(h.admin.token)).send({ status: 'claimed' }),
      request(h.app).patch(`/api/v1/admin/items/${itemId}/status`).set(bearer(h.admin.token)).send({ status: 'returned' }),
    ])
    expect(claimed.status).toBe(200)
    const final = (h.db.prepare('SELECT status FROM items WHERE id = ?').get(itemId) as { status: string }).status
    // found -> returned só é válido depois de claimed; o resultado precisa ser coerente com as respostas.
    if (returned.status === 200) expect(final).toBe('returned')
    else {
      expect(returned.status).toBe(422)
      expect(final).toBe('claimed')
    }
  })
})

describe('FUNC-02 matches follow item edits without duplicate alerts', () => {
  it('creates, updates, removes and restores a match while notifying each pair only once', async () => {
    const lostOwner = await h.register('match-lost@example.com')
    const foundOwner = await h.register('match-found@example.com')
    const lostId = await h.createItem(lostOwner.token, {
      type: 'lost', title: 'Mochila azul marinho', description: 'Mochila azul marinho com chaveiro de coruja.', category: 'Bolsas', location: 'Biblioteca',
    })
    const foundId = await h.createItem(foundOwner.token, {
      type: 'found', title: 'Calculadora científica', description: 'Calculadora deixada em cima da mesa.', category: 'Eletrônicos', location: 'Ginásio',
    })
    const matches = async () => (await request(h.app).get(`/api/v1/items/${lostId}/matches`).set(bearer(lostOwner.token)).expect(200)).body.data as Array<{ id: number; score: number; reasons: string[] }>
    const alerts = () => count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'match'", lostOwner.id)
    expect(await matches()).toEqual([])

    await request(h.app).patch(`/api/v1/items/${foundId}`).set(bearer(foundOwner.token))
      .send({ category: 'Bolsas', title: 'Mochila azul encontrada', location: 'Ginásio' }).expect(200)
    const created = await matches()
    expect(created.map((match) => match.id)).toEqual([foundId])
    expect(alerts()).toBe(1)

    await request(h.app).patch(`/api/v1/items/${foundId}`).set(bearer(foundOwner.token))
      .send({ location: 'Biblioteca', description: 'Mochila azul marinho com chaveiro de coruja na alça.' }).expect(200)
    const updated = await matches()
    expect(updated[0].score).toBeGreaterThan(created[0].score)
    expect(updated[0].reasons).toContain('mesmo local')
    expect(alerts()).toBe(1)

    await request(h.app).patch(`/api/v1/items/${foundId}`).set(bearer(foundOwner.token)).send({ category: 'Documentos' }).expect(200)
    expect(await matches()).toEqual([])

    await request(h.app).patch(`/api/v1/items/${foundId}`).set(bearer(foundOwner.token)).send({ category: 'Bolsas' }).expect(200)
    expect((await matches()).map((match) => match.id)).toEqual([foundId])
    expect(alerts()).toBe(1)
    expect(count("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'match'", foundOwner.id)).toBe(1)
  })
})

describe('ABUSE-01 publishing restriction is manual, audited and reversible', () => {
  it('blocks publishing only after an administrator raises the score and records the change', async () => {
    const person = await h.register('restricted@example.com')
    await h.createItem(person.token, { title: 'Antes da restrição' })
    const users = await request(h.app).get('/api/v1/admin/users').set(bearer(h.admin.token)).expect(200)
    expect(users.body.meta).toEqual({ publishingRestrictionScore: 5, spamScoreMode: 'manual' })

    await request(h.app).patch(`/api/v1/admin/users/${person.id}`).set(bearer(h.admin.token)).send({ spamScore: 5 }).expect(200)
    const blocked = await request(h.app).post('/api/v1/items').set(bearer(person.token))
      .send({ type: 'found', title: 'Depois da restrição', description: 'Item que não deve ser publicado.', category: 'Outros', location: 'Pátio' }).expect(403)
    expect(blocked.body.details).toEqual({ code: 'publishing_restricted' })
    const audit = h.db.prepare("SELECT actor_id, metadata FROM audit_logs WHERE action = 'admin.user_restriction_changed' AND entity_id = ?").get(String(person.id)) as { actor_id: number; metadata: string }
    expect(audit.actor_id).toBe(h.admin.id)
    expect(JSON.parse(audit.metadata)).toEqual({ from: 0, to: 5, publishingRestricted: true })

    await request(h.app).patch(`/api/v1/admin/users/${person.id}`).set(bearer(h.admin.token)).send({ spamScore: 0 }).expect(200)
    await h.createItem(person.token, { title: 'Restrição removida' })
    // Nada além da administração altera a pontuação: publicar e comentar não muda o valor.
    expect(h.db.prepare('SELECT spam_score FROM users WHERE id = ?').get(person.id)).toEqual({ spam_score: 0 })
  })
})

describe('MOD-01 reports form a paginated queue with assignment and resolution', () => {
  it('keeps more than 20 reports reachable, deduplicates open reports and survives item deletion', async () => {
    const owner = await h.register('reported-owner@example.com')
    const reporters = await Promise.all([1, 2, 3, 4, 5].map((index) => h.register(`reporter${index}@example.com`)))
    const items: number[] = []
    for (let index = 0; index < 5; index += 1) items.push(await h.createItem(owner.token, { title: `Caso denunciado ${index}` }))
    for (const reporter of reporters) {
      for (const itemId of items) {
        await request(h.app).post(`/api/v1/items/${itemId}/report`).set(bearer(reporter.token)).send({ reason: 'Conteúdo suspeito.' }).expect(201)
      }
    }
    await request(h.app).post(`/api/v1/items/${items[0]}/report`).set(bearer(reporters[0].token)).send({ reason: 'De novo.' }).expect(200)

    const page = (number: number) => request(h.app).get('/api/v1/admin/reports').query({ page: number, limit: 10 }).set(bearer(h.admin.token)).expect(200)
    const first = await page(1)
    expect(first.body.meta).toMatchObject({ total: 25, page: 1, limit: 10, status: 'active' })
    expect((await page(3)).body.data).toHaveLength(5)
    const ids = new Set([...(await page(1)).body.data, ...(await page(2)).body.data, ...(await page(3)).body.data].map((row: { id: number }) => row.id))
    expect(ids.size).toBe(25)
    // A trilha de auditoria continua registrando cada denúncia nova.
    expect(count("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'item.reported'")).toBe(25)

    await request(h.app).delete(`/api/v1/items/${items[4]}`).set(bearer(owner.token)).expect(200)
    const all = await request(h.app).get('/api/v1/admin/reports').query({ status: 'all', limit: 100 }).set(bearer(h.admin.token)).expect(200)
    const orphaned = all.body.data.filter((row: { item_id: number | null; item_title: string }) => row.item_title === 'Caso denunciado 4')
    expect(orphaned).toHaveLength(5)
    expect(orphaned.every((row: { item_id: number | null }) => row.item_id === null)).toBe(true)
  })

  it('assigns, resolves, reopens and audits reports, rejecting conflicting concurrent resolutions', async () => {
    const owner = await h.register('queue-owner@example.com')
    const reporter = await h.register('queue-reporter@example.com')
    const itemId = await h.createItem(owner.token, { title: 'Caso para resolver' })
    const created = await request(h.app).post(`/api/v1/items/${itemId}/report`).set(bearer(reporter.token)).send({ reason: 'Parece anúncio de venda.' }).expect(201)
    const reportId = created.body.id as number

    const secondAdmin = await h.register('second-admin@example.com')
    h.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(secondAdmin.id)

    await request(h.app).patch(`/api/v1/admin/reports/${reportId}`).set(bearer(reporter.token)).send({ status: 'resolved' }).expect(403)
    const taken = await request(h.app).patch(`/api/v1/admin/reports/${reportId}`).set(bearer(h.admin.token)).send({ assignee: 'me' }).expect(200)
    expect(taken.body.report).toMatchObject({ status: 'in_review', assigned_to: h.admin.id })
    await request(h.app).patch(`/api/v1/admin/reports/${reportId}`).set(bearer(h.admin.token)).send({ assignee: reporter.id }).expect(422)

    const [one, two] = await Promise.all([
      request(h.app).patch(`/api/v1/admin/reports/${reportId}`).set(bearer(h.admin.token)).send({ status: 'resolved', expectedStatus: 'in_review', resolutionNote: 'Removido o anúncio.' }),
      request(h.app).patch(`/api/v1/admin/reports/${reportId}`).set(bearer(secondAdmin.token)).send({ status: 'dismissed', expectedStatus: 'in_review' }),
    ])
    expect([one.status, two.status].sort()).toEqual([200, 409])
    const winner = one.status === 200 ? one : two
    expect(['resolved', 'dismissed']).toContain(winner.body.report.status)
    expect(winner.body.report.resolved_by).toEqual(expect.any(Number))
    expect(winner.body.report.resolved_at).toEqual(expect.any(String))

    await request(h.app).patch(`/api/v1/admin/reports/${reportId}`).set(bearer(h.admin.token))
      .send({ status: winner.body.report.status === 'resolved' ? 'dismissed' : 'resolved' }).expect(422)
    const reopened = await request(h.app).patch(`/api/v1/admin/reports/${reportId}`).set(bearer(h.admin.token)).send({ status: 'open', assignee: null }).expect(200)
    expect(reopened.body.report).toMatchObject({ status: 'open', assigned_to: null, resolved_at: null })
    expect(count("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'moderation.report_updated' AND entity_id = ?", String(reportId))).toBe(3)

    // Duplicata permitida de novo quando a denúncia anterior foi encerrada.
    await request(h.app).patch(`/api/v1/admin/reports/${reportId}`).set(bearer(h.admin.token)).send({ status: 'dismissed' }).expect(200)
    await request(h.app).post(`/api/v1/items/${itemId}/report`).set(bearer(reporter.token)).send({ reason: 'Voltou a aparecer.' }).expect(201)
    const closed = await request(h.app).get('/api/v1/admin/reports').query({ status: 'dismissed' }).set(bearer(h.admin.token)).expect(200)
    expect(closed.body.data.some((row: { id: number }) => row.id === reportId)).toBe(true)
  })
})

describe('SEC-05 administrative CSV neutralizes spreadsheet formulas', () => {
  it('prefixes formula triggers in free-text cells and keeps quoting/delimiters intact', async () => {
    const { spreadsheetSafeText, itemsCsv } = await import('../src/modules/reports/reports.routes.js')
    const dangerous = ['=HYPERLINK("http://x","clique")', '+SUM(1;2)', '-2+3', '@cmd', '\t=1', '\r=1', '\n=1', ' =1', ' =1', '＝1+1', '＋1', '－1', '＠SUM(1)', '﹦1', '−1', '\u0000=1']
    for (const value of dangerous) expect(spreadsheetSafeText(value)).toBe(`'${value}`)
    for (const value of ['Mochila azul', 'Bloco C - 2º andar', '12-03', 'E-mail?', '', 'a=b']) expect(spreadsheetSafeText(value)).toBe(value)

    const csv = itemsCsv([{ id: 7, type: 'found', title: '=1+1', category: 'Outros, "aspas"; ponto', location: '@Bloco', event_date: '2026-10-01', status: 'found', approval_status: 'approved', created_at: '2026-10-01 10:00:00' }])
    const [header, line] = csv.split('\r\n')
    expect(header).toBe('id,type,title,category,location,event_date,status,approval_status,created_at')
    expect(line).toBe(`"7","found","'=1+1","Outros, ""aspas""; ponto","'@Bloco","2026-10-01","found","approved","2026-10-01 10:00:00"`)
  })

  it('applies the protection to user content exported through the API', async () => {
    const owner = await h.register('csv-owner@example.com')
    await h.createItem(owner.token, { title: '=HYPERLINK("http://example.test")', category: '+Categoria', location: '@Local' })
    await h.createItem(owner.token, { title: '－Variante Unicode', category: 'Outros', location: 'Pátio, bloco "B"' })
    const response = await request(h.app).get('/api/v1/reports/items.csv').set(bearer(h.admin.token)).expect(200)
    expect(response.headers['content-type']).toMatch(/text\/csv/)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.text).toContain(`"'=HYPERLINK(""http://example.test"")","'+Categoria","'@Local"`)
    expect(response.text).toContain(`"'－Variante Unicode","Outros","Pátio, bloco ""B"""`)
    for (const line of response.text.split('\r\n').slice(1)) {
      for (const cell of line.match(/"(?:[^"]|"")*"/g) ?? []) expect(cell).not.toMatch(/^"[=+\-@＝＋－＠]/)
    }
  })
})
