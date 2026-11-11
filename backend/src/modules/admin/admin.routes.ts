import { Router } from 'express'
import { z } from 'zod'
import { hashPassword } from '../../utils/password.js'
import { randomBytes } from 'node:crypto'
import { db } from '../../db/database.js'
import { atomic } from '../../db/transaction.js'
import { auth } from '../../middleware/auth.js'
import { isPublishingRestricted, publishingRestrictionScore } from '../../shared/policies/abuse.js'
import { assignableRoles, authorize, hasPermission } from '../../shared/policies/permissions.js'
import { logAudit, logItemHistory, notify } from '../../utils/audit.js'
import { sendMail, verifyMailTransport } from '../../utils/mail.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { assertItemStatusTransition, type ItemStatus, type ItemType } from '../items/item-state.js'
import { refreshItemMatches } from '../items/item-matching.js'
import { ftsPrefixQuery } from '../../utils/normalization.js'

const router = Router()
router.use(auth, authorize('platform:admin'))

const statusSchema = z
  .object({
    approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
    status: z.enum(['lost', 'found', 'claimed', 'returned']).optional(),
    moderationNote: z.string().max(500).optional(),
  })
  .refine((input) => input.approvalStatus || input.status || input.moderationNote !== undefined, {
    message: 'Informe ao menos uma alteração.',
  })

const itemsQuerySchema = z.object({
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  status: z.enum(['lost', 'found', 'claimed', 'returned']).optional(),
  q: z.string().trim().max(120).optional(),
})

// Papéis com nome de escopo (org/espaço/suporte) não são atribuíveis enquanto não houver modelo de tenant.
const roleSchema = z.enum(assignableRoles)

const reportStatuses = ['open', 'in_review', 'resolved', 'dismissed'] as const
type ReportStatus = (typeof reportStatuses)[number]

const reportsQuerySchema = z.object({
  status: z.enum([...reportStatuses, 'active', 'all']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const reportUpdateSchema = z
  .object({
    status: z.enum(reportStatuses).optional(),
    // "me" assume a denúncia; null libera; número atribui a outro administrador.
    assignee: z.union([z.literal('me'), z.null(), z.number().int().positive()]).optional(),
    resolutionNote: z.string().trim().max(500).optional(),
    // Controle de concorrência otimista: o status que a tela exibia.
    expectedStatus: z.enum(reportStatuses).optional(),
  })
  .refine((input) => input.status || input.assignee !== undefined || input.resolutionNote !== undefined, {
    message: 'Informe ao menos uma alteração.',
  })

const reportTransitions: Record<ReportStatus, ReportStatus[]> = {
  open: ['in_review', 'resolved', 'dismissed'],
  in_review: ['open', 'resolved', 'dismissed'],
  resolved: ['open'],
  dismissed: ['open'],
}

function temporaryPassword() {
  return `Argos-${randomBytes(9).toString('base64url')}`
}

router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const input = itemsQuerySchema.parse(req.query)
    const clauses: string[] = []
    const params: unknown[] = []

    if (input.approvalStatus) {
      clauses.push('items.approval_status = ?')
      params.push(input.approvalStatus)
    }
    if (input.status) {
      clauses.push('items.status = ?')
      params.push(input.status)
    }
    if (input.q) {
      const query = ftsPrefixQuery(input.q)
      const ownerQuery = `%${input.q.toLowerCase()}%`
      clauses.push(query ? '(items.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?) OR LOWER(users.name) LIKE ?)' : 'LOWER(users.name) LIKE ?')
      if (query) params.push(query)
      params.push(ownerQuery)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db
      .prepare(
        `SELECT items.*, users.name AS owner_name, users.email AS owner_email
         FROM items JOIN users ON users.id = items.owner_id
         ${where}
         ORDER BY items.created_at DESC`,
      )
      .all(...params)
    logAudit(req, 'admin.items_listed', 'item', null, input)
    res.json({ data: rows })
  }),
)

router.patch(
  '/items/:id/status',
  asyncHandler(async (req, res) => {
    const input = statusSchema.parse(req.body)
    // Tudo é validado e gravado na mesma transação; a notificação entra junto e o push só sai após o commit.
    const result = atomic(() => {
      const item = db.prepare('SELECT id, owner_id, title, type, status, approval_status FROM items WHERE id = ?').get(req.params.id) as
        | { id: number; owner_id: number; title: string; type: ItemType; status: ItemStatus; approval_status: string }
        | undefined
      if (!item) throw new HttpError(404, 'Item não encontrado.')
      if (input.status) assertItemStatusTransition(item.type, item.status, input.status)

      db.prepare(
        `UPDATE items
         SET approval_status = COALESCE(?, approval_status), status = COALESCE(?, status),
             moderation_note = COALESCE(?, moderation_note), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(input.approvalStatus ?? null, input.status ?? null, input.moderationNote ?? null, item.id)
      logItemHistory(item.id, req.user!.id, 'admin.status_changed', input)
      logAudit(req, 'admin.item_status_changed', 'item', item.id, {
        ...input,
        previous: { status: item.status, approvalStatus: item.approval_status },
      })
      const approvalChanged = Boolean(input.approvalStatus && input.approvalStatus !== item.approval_status)
      if (approvalChanged) {
        notify(item.owner_id, 'Publicação revisada', `O item "${item.title}" foi marcado como ${input.approvalStatus}.`, 'approval')
      }
      return { itemId: item.id, becameApproved: approvalChanged && input.approvalStatus === 'approved' }
    })

    if (result.becameApproved) {
      try {
        refreshItemMatches(result.itemId)
      } catch (error) {
        console.error('[item-matching] Falha ao recalcular correspondências.', error instanceof Error ? error.message : error)
      }
    }
    res.json({ message: 'Status atualizado.' })
  }),
)

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, name, email, role, status, spam_score, email_verified_at, created_at,
                CASE WHEN spam_score >= ? THEN 1 ELSE 0 END AS publishing_restricted
         FROM users ORDER BY created_at DESC`,
      )
      .all(publishingRestrictionScore) as Array<Record<string, unknown> & { publishing_restricted: number }>
    res.json({
      data: rows.map((row) => ({ ...row, publishing_restricted: Boolean(row.publishing_restricted) })),
      meta: { publishingRestrictionScore, spamScoreMode: 'manual' },
    })
  }),
)

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      role: roleSchema.optional(),
      status: z.enum(['pending', 'active', 'blocked']).optional(),
      spamScore: z.number().int().min(0).max(10).optional(),
    })
    const input = schema.parse(req.body)
    const target = db.prepare('SELECT id, role, status, spam_score FROM users WHERE id = ?').get(req.params.id) as
      | { id: number; role: string; status: string; spam_score: number }
      | undefined
    if (!target) throw new HttpError(404, 'Usuário não encontrado.')
    if (target.id === req.user!.id && ((input.role && input.role !== 'admin') || (input.status && input.status !== 'active'))) {
      throw new HttpError(422, 'Você não pode remover o próprio acesso administrativo.')
    }

    atomic(() => {
      db.prepare(
        `UPDATE users
         SET role = COALESCE(?, role), status = COALESCE(?, status), spam_score = COALESCE(?, spam_score), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(input.role ?? null, input.status ?? null, input.spamScore ?? null, target.id)
      // Contas bloqueadas ou pendentes perdem as sessões persistentes imediatamente.
      if (input.status && input.status !== 'active') {
        db.prepare('UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(target.id)
      }
      logAudit(req, 'admin.user_updated', 'user', target.id, input)
      if (input.spamScore !== undefined && input.spamScore !== target.spam_score) {
        // Restrição anti-spam é decisão manual: fica registrada com valor anterior e novo.
        logAudit(req, 'admin.user_restriction_changed', 'user', target.id, {
          from: target.spam_score,
          to: input.spamScore,
          publishingRestricted: isPublishingRestricted(input.spamScore),
        })
      }
    })
    res.json({ message: 'Usuário atualizado.' })
  }),
)

router.get(
  '/access-requests',
  asyncHandler(async (_req, res) => {
    const rows = db.prepare('SELECT * FROM access_requests ORDER BY created_at DESC').all()
    res.json({ data: rows })
  }),
)

router.patch(
  '/access-requests/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(['approved', 'rejected']),
      role: roleSchema.default('citizen'),
    })
    const input = schema.parse(req.body)
    const request = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(req.params.id) as
      | { id: number; name: string; email: string; status: string }
      | undefined
    if (!request) throw new HttpError(404, 'Solicitação não encontrada.')

    // O hash da senha temporária é calculado antes da transação (fora da thread principal); dentro dela não há espera.
    const candidatePassword = input.status === 'approved' ? temporaryPassword() : null
    const candidateHash = candidatePassword ? await hashPassword(candidatePassword) : null
    let generatedPassword: string | null = null
    atomic(() => {
      // Só pedidos pendentes são avaliados: rejeitar depois de aprovar deixaria a conta ativa com o pedido "rejeitado".
      const changed = db
        .prepare("UPDATE access_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
        .run(input.status, req.user!.id, request.id).changes
      if (!changed) throw new HttpError(409, 'Esta solicitação já foi avaliada. Atualize a lista.', { currentStatus: request.status })
      if (input.status === 'approved' && candidatePassword && candidateHash) {
        const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(request.email)
        if (!exists) {
          generatedPassword = candidatePassword
          // Aprovação institucional: a administração validou a pessoa e entrega a senha temporária por outro canal.
          db.prepare('INSERT INTO users (name, email, password_hash, role, status, email_verified_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(
            request.name,
            request.email,
            candidateHash,
            input.role,
            'active',
          )
        }
      }
      logAudit(req, 'admin.access_request_reviewed', 'access_request', request.id, {
        status: input.status,
        role: input.role,
        userCreated: Boolean(generatedPassword),
      })
    })
    res.json({
      message: 'Solicitação revisada.',
      temporaryPassword: generatedPassword,
    })
  }),
)

type ReportRow = {
  id: number
  item_id: number | null
  item_title: string
  reason: string
  status: ReportStatus
  reporter_id: number | null
  reporter_name: string | null
  assigned_to: number | null
  assignee_name: string | null
  resolution_note: string | null
  resolved_by: number | null
  resolver_name: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

const reportSelect = `
  SELECT item_reports.id, item_reports.item_id, item_reports.item_title, item_reports.reason, item_reports.status,
         item_reports.reporter_id, reporter.name AS reporter_name,
         item_reports.assigned_to, assignee.name AS assignee_name,
         item_reports.resolution_note, item_reports.resolved_by, resolver.name AS resolver_name,
         item_reports.resolved_at, item_reports.created_at, item_reports.updated_at
  FROM item_reports
  LEFT JOIN users AS reporter ON reporter.id = item_reports.reporter_id
  LEFT JOIN users AS assignee ON assignee.id = item_reports.assigned_to
  LEFT JOIN users AS resolver ON resolver.id = item_reports.resolved_by`

// Fila de denúncias: paginada, filtrável por estado, com responsável e resolução auditados.
router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const input = reportsQuerySchema.parse(req.query)
    const where =
      input.status === 'all' ? '' : input.status === 'active' ? "WHERE item_reports.status IN ('open', 'in_review')" : 'WHERE item_reports.status = ?'
    const params = input.status === 'all' || input.status === 'active' ? [] : [input.status]
    const total = db.prepare(`SELECT COUNT(*) AS count FROM item_reports ${where}`).get(...params) as { count: number }
    const rows = db
      .prepare(`${reportSelect} ${where} ORDER BY item_reports.created_at DESC, item_reports.id DESC LIMIT ? OFFSET ?`)
      .all(...params, input.limit, (input.page - 1) * input.limit) as ReportRow[]
    const counts = db.prepare('SELECT status, COUNT(*) AS count FROM item_reports GROUP BY status').all() as Array<{ status: ReportStatus; count: number }>
    res.json({
      data: rows,
      meta: {
        page: input.page,
        limit: input.limit,
        total: total.count,
        status: input.status,
        counts: Object.fromEntries(reportStatuses.map((status) => [status, counts.find((row) => row.status === status)?.count ?? 0])),
      },
    })
  }),
)

router.patch(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const input = reportUpdateSchema.parse(req.body)
    const updated = atomic(() => {
      const report = db.prepare('SELECT * FROM item_reports WHERE id = ?').get(req.params.id) as
        | { id: number; status: ReportStatus; assigned_to: number | null }
        | undefined
      if (!report) throw new HttpError(404, 'Denúncia não encontrada.')
      if (input.expectedStatus && input.expectedStatus !== report.status) {
        throw new HttpError(409, 'Esta denúncia foi alterada por outra pessoa. Atualize a fila.', { currentStatus: report.status })
      }
      const nextStatus = input.status ?? report.status
      if (nextStatus !== report.status && !reportTransitions[report.status].includes(nextStatus)) {
        throw new HttpError(422, `Transição de denúncia inválida: ${report.status} -> ${nextStatus}.`)
      }

      let assignee = report.assigned_to
      if (input.assignee === 'me') assignee = req.user!.id
      else if (input.assignee === null) assignee = null
      else if (typeof input.assignee === 'number') {
        const target = db.prepare("SELECT id, role FROM users WHERE id = ? AND status = 'active'").get(input.assignee) as
          | { id: number; role: Parameters<typeof hasPermission>[0] }
          | undefined
        if (!target || !hasPermission(target.role, 'platform:admin')) throw new HttpError(422, 'Responsável deve ser um administrador ativo.')
        assignee = target.id
      }
      // Assumir uma denúncia aberta a coloca em análise.
      const status: ReportStatus = input.assignee === 'me' && !input.status && report.status === 'open' ? 'in_review' : nextStatus
      const closing = status === 'resolved' || status === 'dismissed'

      // Atualização condicional: se outra requisição mudou o status entre a leitura e a escrita, nada é gravado.
      const changes = db
        .prepare(
          `UPDATE item_reports
           SET status = ?, assigned_to = ?, resolution_note = COALESCE(?, resolution_note),
               resolved_by = CASE WHEN ? THEN ? ELSE NULL END,
               resolved_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = ?`,
        )
        .run(status, assignee, input.resolutionNote ?? null, closing ? 1 : 0, req.user!.id, closing ? 1 : 0, report.id, report.status).changes
      if (!changes) throw new HttpError(409, 'Esta denúncia foi alterada por outra pessoa. Atualize a fila.')
      logAudit(req, 'moderation.report_updated', 'item_report', report.id, {
        from: { status: report.status, assignee: report.assigned_to },
        to: { status, assignee },
        resolutionNote: input.resolutionNote ?? undefined,
      })
      return db.prepare(`${reportSelect} WHERE item_reports.id = ?`).get(report.id) as ReportRow
    })
    res.json({ message: 'Denúncia atualizada.', report: updated })
  }),
)

// Confere a conexão SMTP e envia um e-mail real para o próprio administrador.
router.post(
  '/mail-test',
  asyncHandler(async (req, res) => {
    let status: Awaited<ReturnType<typeof verifyMailTransport>>
    try {
      status = await verifyMailTransport()
      if (status.configured) await sendMail(req.user!.email, 'ARGOS: teste de e-mail', 'Se você recebeu esta mensagem, o envio de e-mails do ARGOS está funcionando.')
    } catch (error) {
      console.error('[mail] Falha no teste de e-mail.', error instanceof Error ? error.message : 'erro desconhecido')
      throw new HttpError(502, 'O servidor de e-mail recusou a conexão. Confira SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS.')
    }
    logAudit(req, 'admin.mail_tested', 'user', req.user!.id, { configured: status.configured })
    res.json(
      status.configured
        ? { configured: true, message: 'E-mail de teste enviado para o administrador.' }
        : { configured: false, message: 'SMTP não configurado: os e-mails não são enviados neste ambiente de desenvolvimento.' },
    )
  }),
)

export { router as adminRoutes }
