import { Router } from 'express'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { atomic } from '../../db/transaction.js'
import { auth, type AuthUser } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { can, hasAnyScopedPermission, hasPermission } from '../../shared/policies/permissions.js'
import { canOnItem, scopedSpaceIds, spaceScope } from '../../shared/policies/scope.js'
import { logAudit, logItemHistory, notify, notifyFollowers } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { ftsPrefixQuery } from '../../utils/normalization.js'
import { containsPublicSensitiveInfo, publicTextSafetyMessage } from '../../utils/privacy.js'
import { registerReturn } from '../items/items.routes.js'

/**
 * Cadeia de custódia (Sprint 7): cada movimentação física de um item (recebido no espaço, guardado,
 * transferido, entregue, destinado) vira um evento somente-inserção. Cada evento guarda o hash do anterior
 * (`prev_hash`) e o próprio (`hash` = SHA-256 do conteúdo + `prev_hash`), de modo que qualquer alteração ou
 * remoção posterior é detectada por `verifyChain`. Triggers no banco impedem UPDATE/DELETE.
 */
const router = Router()
router.use(auth)

export const custodyEventTypes = ['received', 'stored', 'transferred', 'handed_over', 'disposed', 'note'] as const
export type CustodyEventType = (typeof custodyEventTypes)[number]
export type CustodyState = 'none' | 'in_custody' | 'in_transit' | 'handed_over' | 'disposed'

const genesisHash = '0'.repeat(64)

const safeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !containsPublicSensitiveInfo(value), publicTextSafetyMessage)

const eventSchema = z.object({
  type: z.enum(custodyEventTypes),
  // received: espaço que recebeu; transferred: espaço de destino.
  spaceId: z.number().int().positive().optional(),
  storageLocation: safeText(120).optional(),
  notes: safeText(500).optional(),
  // handed_over: reivindicação da pessoa que retirou o item (obrigatória para itens encontrados ainda abertos).
  claimId: z.number().int().positive().optional(),
})

const panelSchema = z.object({
  state: z.enum(['in_custody', 'in_transit', 'awaiting', 'handed_over', 'disposed', 'overdue', 'all']).default('in_custody'),
  spaceId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

type EventRow = {
  id: number
  item_ref: number
  item_id: number | null
  item_title: string
  sequence: number
  event_type: CustodyEventType
  space_ref: number | null
  space_name: string | null
  storage_location: string | null
  claim_id: number | null
  notes: string | null
  actor_ref: number
  actor_name?: string | null
  occurred_at: string
  prev_hash: string
  hash: string
}

/** Conteúdo canônico do evento: ordem fixa de campos, sem os vínculos que podem virar NULL. */
function eventHash(event: Pick<EventRow, 'item_ref' | 'sequence' | 'event_type' | 'space_ref' | 'storage_location' | 'claim_id' | 'notes' | 'actor_ref' | 'occurred_at' | 'prev_hash'>) {
  const canonical = JSON.stringify([
    event.item_ref,
    event.sequence,
    event.event_type,
    event.space_ref ?? null,
    event.storage_location ?? null,
    event.claim_id ?? null,
    event.notes ?? null,
    event.actor_ref,
    event.occurred_at,
    event.prev_hash,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

/** Recalcula a cadeia do item: sequência contínua, encadeamento e hash de cada evento. */
export function verifyChain(events: EventRow[]) {
  let previous = genesisHash
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1 || event.prev_hash !== previous || eventHash(event) !== event.hash) {
      return { valid: false as const, brokenAt: event.sequence }
    }
    previous = event.hash
  }
  return { valid: true as const, brokenAt: null }
}

export function custodyStateOf(events: Array<Pick<EventRow, 'event_type'>>): CustodyState {
  const last = [...events].reverse().find((event) => event.event_type !== 'note')
  if (!last) return 'none'
  if (last.event_type === 'received' || last.event_type === 'stored') return 'in_custody'
  if (last.event_type === 'transferred') return 'in_transit'
  return last.event_type === 'handed_over' ? 'handed_over' : 'disposed'
}

const allowedNext: Record<CustodyState, CustodyEventType[]> = {
  none: ['received'],
  in_custody: ['stored', 'transferred', 'handed_over', 'disposed', 'note'],
  in_transit: ['received', 'note'],
  handed_over: ['note'],
  disposed: ['note'],
}

function itemEvents(itemId: number) {
  return db
    .prepare(
      `SELECT custody_events.*, users.name AS actor_name
       FROM custody_events LEFT JOIN users ON users.id = custody_events.actor_id
       WHERE custody_events.item_ref = ? ORDER BY custody_events.sequence ASC`,
    )
    .all(itemId) as EventRow[]
}

/** Espaço onde o item está (ou para onde está indo) segundo a trilha. */
function currentSpaceRef(events: EventRow[]) {
  const last = [...events].reverse().find((event) => event.event_type !== 'note' && event.space_ref != null)
  return last?.space_ref ?? null
}

function eventDto(event: EventRow, includeActor: boolean) {
  return {
    id: event.id,
    sequence: event.sequence,
    type: event.event_type,
    spaceId: event.space_ref,
    spaceName: event.space_name,
    storageLocation: event.storage_location,
    claimId: event.claim_id,
    notes: event.notes,
    // Quem publicou vê o que aconteceu com o item, sem o nome de quem operou no espaço.
    actorName: includeActor ? event.actor_name ?? 'Conta removida' : null,
    occurredAt: event.occurred_at,
    hash: event.hash,
    prevHash: event.prev_hash,
  }
}

type ItemRow = { id: number; owner_id: number; space_id: number | null; title: string; type: 'lost' | 'found'; status: string; approval_status: string }

function findItem(id: unknown) {
  const item = db.prepare('SELECT id, owner_id, space_id, title, type, status, approval_status FROM items WHERE id = ?').get(Number(id)) as ItemRow | undefined
  if (!item) throw new HttpError(404, 'Item não encontrado.')
  return item
}

function canManageSpace(user: AuthUser | undefined, spaceId: number | null) {
  if (can(user, 'custody:manage')) return true
  return spaceId != null && can(user, 'custody:manage', spaceScope(spaceId))
}

/**
 * Primeiro recebimento: quem registra passa a tratar o caso (reivindicações, provas privadas e devolução).
 * - Caso ligado a um espaço: só quem gere esse espaço (ou a organização dele) recebe, num espaço da mesma organização.
 * - Caso sem espaço: só item encontrado e publicado (um item perdido não está com ninguém para ser entregue).
 * A administração da plataforma não tem a restrição de espaço. Devolve o motivo da recusa, ou null.
 */
function startCustodyRefusal(user: AuthUser | undefined, item: ItemRow, target?: number | null): HttpError | null {
  const global = can(user, 'custody:manage')
  if (item.space_id != null) {
    if (global) return null
    if (!canManageSpace(user, item.space_id)) {
      return new HttpError(403, 'Este caso está ligado a outro espaço institucional: só quem gere esse espaço pode registrar o recebimento.')
    }
    if (target != null && target !== item.space_id && spaceScope(target)?.organizationId !== spaceScope(item.space_id)?.organizationId) {
      return new HttpError(422, 'Registre o recebimento num espaço da mesma organização do caso.')
    }
    return null
  }
  if (item.type !== 'found' || item.approval_status !== 'approved') {
    return new HttpError(422, 'Sem espaço institucional definido, só casos de item encontrado e publicado entram em custódia.')
  }
  return global || hasAnyScopedPermission(user?.memberships, 'custody:manage') ? null : new HttpError(403, 'Acesso restrito a gestores de espaço.')
}

function activeSpace(spaceId: number) {
  const space = db
    .prepare(
      `SELECT spaces.id, spaces.name, organizations.name AS organization_name FROM spaces
       JOIN organizations ON organizations.id = spaces.organization_id
       WHERE spaces.id = ? AND spaces.status = 'active' AND organizations.status = 'active'`,
    )
    .get(spaceId) as { id: number; name: string; organization_name: string } | undefined
  if (!space) throw new HttpError(422, 'Espaço institucional não encontrado ou inativo.')
  return space
}

// Painel dos gestores: itens sob custódia dos espaços que a conta gere (administração vê todos).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const input = panelSchema.parse(req.query)
    const global = hasPermission(req.user!.role, 'custody:read')
    if (!global && !hasAnyScopedPermission(req.user!.memberships, 'custody:read')) throw new HttpError(403, 'Acesso restrito a gestores de espaço.')
    const spaceIds = global ? null : scopedSpaceIds(req.user!, 'custody:read')
    if (input.spaceId && spaceIds && !spaceIds.includes(input.spaceId)) throw new HttpError(403, 'Você não gere este espaço.')

    // Último evento que muda o estado (anotações não contam) de cada item.
    const base = `
      FROM items
      LEFT JOIN custody_events AS last ON last.item_ref = items.id
        AND last.sequence = (SELECT MAX(sequence) FROM custody_events WHERE item_ref = items.id AND event_type <> 'note')
      LEFT JOIN custody_events AS first ON first.item_ref = items.id AND first.sequence = 1
      LEFT JOIN spaces ON spaces.id = COALESCE(last.space_ref, items.space_id)`
    const scopeClause = (ids: number[] | null) => (ids ? `COALESCE(last.space_ref, items.space_id) IN (${ids.map(() => '?').join(', ') || 'NULL'})` : '1')
    const scopeParams = input.spaceId ? [input.spaceId] : spaceIds ?? []
    const scope = input.spaceId ? 'COALESCE(last.space_ref, items.space_id) = ?' : scopeClause(spaceIds)

    const overdue = `last.event_type IN ('received', 'stored') AND first.occurred_at < datetime('now', '-${env.CUSTODY_OVERDUE_DAYS} days')`
    const stateClauses: Record<typeof input.state, string> = {
      in_custody: "last.event_type IN ('received', 'stored')",
      in_transit: "last.event_type = 'transferred'",
      // Itens encontrados ligados ao espaço que ainda não foram recebidos fisicamente.
      awaiting: "last.id IS NULL AND items.space_id IS NOT NULL AND items.type = 'found' AND items.status <> 'returned'",
      handed_over: "last.event_type = 'handed_over'",
      disposed: "last.event_type = 'disposed'",
      overdue,
      all: '(last.id IS NOT NULL OR items.space_id IS NOT NULL)',
    }
    const clauses = [scope, stateClauses[input.state]]
    const params: unknown[] = [...scopeParams]
    if (input.q) {
      const query = ftsPrefixQuery(input.q)
      clauses.push(query ? 'items.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)' : '0')
      if (query) params.push(query)
    }
    const where = clauses.join(' AND ')
    const total = db.prepare(`SELECT COUNT(*) AS count ${base} WHERE ${where}`).get(...params) as { count: number }
    const rows = db
      .prepare(
        `SELECT items.id, items.title, items.type, items.status, items.category, items.image_url, items.event_date,
                last.event_type AS last_event, last.occurred_at AS last_event_at, last.storage_location,
                first.occurred_at AS custody_since, spaces.id AS space_id, spaces.name AS space_name,
                (SELECT COUNT(*) FROM claims WHERE claims.item_id = items.id AND claims.status IN ('pending', 'approved')) AS open_claims,
                CASE WHEN ${overdue} THEN 1 ELSE 0 END AS overdue
         ${base} WHERE ${where}
         ORDER BY COALESCE(last.occurred_at, items.created_at) DESC, items.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, (input.page - 1) * input.limit) as Array<Record<string, unknown> & { last_event: CustodyEventType | null; overdue: number; image_url: string | null }>

    const summary = db
      .prepare(
        `SELECT
           SUM(CASE WHEN ${stateClauses.in_custody} THEN 1 ELSE 0 END) AS inCustody,
           SUM(CASE WHEN ${stateClauses.in_transit} THEN 1 ELSE 0 END) AS inTransit,
           SUM(CASE WHEN ${stateClauses.awaiting} THEN 1 ELSE 0 END) AS awaiting,
           SUM(CASE WHEN ${stateClauses.handed_over} THEN 1 ELSE 0 END) AS handedOver,
           SUM(CASE WHEN ${stateClauses.disposed} THEN 1 ELSE 0 END) AS disposed,
           SUM(CASE WHEN ${overdue} THEN 1 ELSE 0 END) AS overdue
         ${base} WHERE ${scope}`,
      )
      .get(...scopeParams) as Record<string, number | null>

    const spaces = db
      .prepare(
        `SELECT spaces.id, spaces.name, organizations.name AS organization_name FROM spaces
         JOIN organizations ON organizations.id = spaces.organization_id
         WHERE spaces.status = 'active' ${spaceIds ? `AND spaces.id IN (${spaceIds.map(() => '?').join(', ') || 'NULL'})` : ''}
         ORDER BY organizations.name COLLATE NOCASE, spaces.name COLLATE NOCASE`,
      )
      .all(...(spaceIds ?? [])) as Array<{ id: number; name: string; organization_name: string }>

    res.json({
      data: rows.map((row) => ({
        ...row,
        image_url: row.image_url && /^\/uploads\/[\w.-]+$/.test(row.image_url) ? row.image_url : null,
        state: row.last_event ? custodyStateOf([{ event_type: row.last_event }]) : ('none' as const),
        overdue: Boolean(row.overdue),
      })),
      meta: {
        page: input.page,
        limit: input.limit,
        total: total.count,
        state: input.state,
        overdueDays: env.CUSTODY_OVERDUE_DAYS,
        summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value ?? 0])),
        spaces: spaces.map((space) => ({ id: space.id, name: space.name, organizationName: space.organization_name })),
      },
    })
  }),
)

// Trilha de um item: quem publicou acompanha; gestores do espaço (e a administração) veem quem operou.
router.get(
  '/items/:itemId',
  asyncHandler(async (req, res) => {
    const item = findItem(req.params.itemId)
    const events = itemEvents(item.id)
    const spaceRef = currentSpaceRef(events)
    const state = custodyStateOf(events)
    // Item ainda sem trilha: quem pode registrar o primeiro recebimento (mesma regra do POST) abre a trilha.
    const canReceive = state === 'none' && !startCustodyRefusal(req.user, item)
    const manager = canOnItem(req.user, item, 'custody:read') || (spaceRef != null && can(req.user, 'custody:read', spaceScope(spaceRef))) || canReceive
    if (!manager && item.owner_id !== req.user!.id) throw new HttpError(403, 'Sem permissão para ver a custódia deste item.')

    const canManage = canManageSpace(req.user, spaceRef ?? item.space_id) || canReceive
    if (manager) logAudit(req, 'custody.viewed', 'item', item.id, { events: events.length })
    res.json({
      item: { id: item.id, title: item.title, type: item.type, status: item.status, spaceId: item.space_id },
      state,
      currentSpaceId: spaceRef,
      chain: verifyChain(events),
      nextEvents: canManage ? allowedNext[state] : [],
      data: events.map((event) => eventDto(event, manager)),
    })
  }),
)

router.post(
  '/items/:itemId/events',
  rateLimit(60, 60_000),
  asyncHandler(async (req, res) => {
    const input = eventSchema.parse(req.body)
    const item = findItem(req.params.itemId)
    if (item.approval_status === 'rejected') throw new HttpError(422, 'Este caso foi rejeitado pela moderação e não entra em custódia.')

    const result = atomic(() => {
      const events = itemEvents(item.id)
      const state = custodyStateOf(events)
      const here = currentSpaceRef(events)
      if (!allowedNext[state].includes(input.type)) {
        throw new HttpError(409, 'Este registro não é possível na situação atual do item. Atualize a trilha.', { code: 'custody_invalid_transition', state })
      }

      let spaceRef: number | null = here
      if (input.type === 'received') {
        // Depois de uma transferência, só o destino recebe; no primeiro registro, o espaço é informado (ou o do caso).
        const target = state === 'in_transit' ? here : input.spaceId ?? item.space_id
        if (!target) throw new HttpError(422, 'Informe o espaço que está recebendo o item.')
        if (state === 'in_transit' && input.spaceId && input.spaceId !== here) {
          throw new HttpError(422, 'O item está em trânsito para outro espaço.')
        }
        if (!canManageSpace(req.user, target)) throw new HttpError(403, 'Você não gere o espaço que está recebendo o item.')
        // O primeiro recebimento passa o caso para o espaço: um gestor de outro espaço não pode puxá-lo para si.
        const refusal = state === 'none' ? startCustodyRefusal(req.user, item, target) : null
        if (refusal) throw refusal
        spaceRef = activeSpace(target).id
      } else {
        if (!canManageSpace(req.user, here)) throw new HttpError(403, 'Só quem gere o espaço onde o item está pode registrar este evento.')
        if (input.type === 'stored' && !input.storageLocation) throw new HttpError(422, 'Informe onde o item foi guardado (ex.: armário 2, prateleira B).')
        if (input.type === 'disposed' && !input.notes) throw new HttpError(422, 'Descreva a destinação (ex.: doação, descarte) e o motivo.')
        if (input.type === 'transferred') {
          if (!input.spaceId) throw new HttpError(422, 'Informe o espaço de destino.')
          if (input.spaceId === here) throw new HttpError(422, 'O item já está neste espaço.')
          spaceRef = activeSpace(input.spaceId).id
        }
      }

      // Entrega física encerra o caso: usa a mesma regra da devolução (reivindicação escolhida, demais recusadas).
      let returned: ReturnType<typeof registerReturn> | null = null
      if (input.type === 'handed_over' && item.status !== 'returned') {
        returned = registerReturn(item.id, req.user!.id, input.claimId)
      }

      const spaceName = spaceRef ? (db.prepare('SELECT name FROM spaces WHERE id = ?').get(spaceRef) as { name: string } | undefined)?.name ?? null : null
      const draft = {
        item_ref: item.id,
        sequence: events.length + 1,
        event_type: input.type,
        space_ref: spaceRef,
        storage_location: input.storageLocation || null,
        claim_id: input.claimId ?? null,
        notes: input.notes || null,
        actor_ref: req.user!.id,
        occurred_at: new Date().toISOString(),
        prev_hash: events.length ? events[events.length - 1].hash : genesisHash,
      }
      const hash = eventHash(draft)
      const id = Number(
        db
          .prepare(
            `INSERT INTO custody_events (item_ref, item_id, item_title, sequence, event_type, space_ref, space_id, space_name,
               storage_location, claim_id, notes, actor_ref, actor_id, occurred_at, prev_hash, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            draft.item_ref, item.id, item.title, draft.sequence, draft.event_type, draft.space_ref, draft.space_ref, spaceName,
            draft.storage_location, draft.claim_id, draft.notes, draft.actor_ref, draft.actor_ref, draft.occurred_at, draft.prev_hash, hash,
          ).lastInsertRowid,
      )
      // O caso passa a pertencer ao espaço que tem o item em mãos: é ele quem trata reivindicações e devolução.
      if (input.type === 'received' && spaceRef !== item.space_id) {
        db.prepare('UPDATE items SET space_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(spaceRef, item.id)
      }
      logItemHistory(item.id, req.user!.id, `custody.${input.type}`, { eventId: id, spaceId: spaceRef })
      logAudit(req, `custody.${input.type}`, 'item', item.id, { eventId: id, sequence: draft.sequence, spaceId: spaceRef, hash })

      if (item.owner_id !== req.user!.id && input.type !== 'note') {
        const text: Record<Exclude<CustodyEventType, 'note'>, string> = {
          received: `O item "${item.title}" foi recebido em ${spaceName ?? 'um espaço institucional'}.`,
          stored: `O item "${item.title}" foi guardado em ${spaceName ?? 'um espaço institucional'}.`,
          transferred: `O item "${item.title}" está sendo transferido para ${spaceName ?? 'outro espaço'}.`,
          handed_over: `A entrega do item "${item.title}" foi registrada.`,
          disposed: `O item "${item.title}" recebeu destinação final pelo espaço responsável.`,
        }
        notify(item.owner_id, 'Custódia atualizada', text[input.type], 'custody', `/items/${item.id}`)
      }
      if (returned) {
        if (returned.selectedClaimantId) {
          notify(returned.selectedClaimantId, 'Reivindicação aprovada', `A devolução de "${item.title}" foi confirmada.`, 'claim', `/items/${item.id}`)
        }
        for (const claimantId of new Set(returned.rejectedClaimants)) {
          notify(claimantId, 'Reivindicação encerrada', `Outra reivindicação foi selecionada para "${item.title}".`, 'claim', `/items/${item.id}`)
        }
        notifyFollowers(item.id, req.user!.id, 'Caso acompanhado resolvido', `A devolução de ${item.title} foi registrada.`)
        logAudit(req, 'item.returned', 'item', item.id, { claimId: input.claimId ?? null, via: 'custody' })
      }
      return id
    })

    const events = itemEvents(item.id)
    res.status(201).json({
      id: result,
      message: 'Evento de custódia registrado.',
      state: custodyStateOf(events),
      event: eventDto(events.find((event) => event.id === result)!, true),
    })
  }),
)

export { router as custodyRoutes }
