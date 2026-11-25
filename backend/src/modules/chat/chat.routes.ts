import { Router } from 'express'
import { z } from 'zod'
import { db } from '../../db/database.js'
import { atomic } from '../../db/transaction.js'
import { auth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { assertNotMuted, moderateOrThrow, moderationMessages, recordModerationEvent, registerBlock } from '../../shared/policies/moderation.js'
import { authorize, hasPermission } from '../../shared/policies/permissions.js'
import { activeUserIdsWith, logAudit, notify } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { normalizeKey } from '../../utils/normalization.js'
import { publicNickname } from '../../utils/public-profile.js'

/**
 * Chat seguro por caso (Sprint 6): uma conversa privada entre quem publicou e cada pessoa interessada.
 * As mensagens ficam no banco, passam pelas regras automáticas (shared/policies/moderation.ts) e só são
 * lidas pela moderação quando sinalizadas (pela regra ou por denúncia de quem recebeu).
 * A entrega é por consulta periódica (`after`), sem conexão permanente.
 */
const router = Router()
router.use(auth)

const startSchema = z.object({ itemId: z.number().int().positive() })
const messageSchema = z.object({ body: z.string().trim().min(1).max(1000) })
const listSchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
const reviewSchema = z.object({ action: z.enum(['remove', 'dismiss']) })
const statusSchema = z.object({ status: z.enum(['open', 'closed']) })
const flaggedSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

type ConversationRow = {
  id: number
  item_id: number
  owner_id: number
  participant_id: number
  status: 'open' | 'closed'
  closed_by: number | null
  owner_last_read_id: number
  participant_last_read_id: number
  last_message_at: string | null
  created_at: string
  item_title: string
  item_status: string
  item_type: string
  item_image_url: string | null
  other_id: number
  other_name: string
  other_nickname: string | null
  other_avatar_url: string | null
}

type MessageRow = {
  id: number
  conversation_id: number
  sender_id: number
  body: string
  status: 'visible' | 'flagged' | 'removed'
  moderation_rule: string | null
  created_at: string
}

const removedBody = 'Mensagem removida pela moderação.'

function uploadUrl(url?: string | null) {
  return url && /^\/uploads\/[\w.-]+$/.test(url) ? url : null
}

const conversationSelect = `
  SELECT conversations.*, items.title AS item_title, items.status AS item_status, items.type AS item_type,
         items.image_url AS item_image_url, other.id AS other_id, other.name AS other_name,
         other.nickname AS other_nickname, other.avatar_url AS other_avatar_url
  FROM conversations
  JOIN items ON items.id = conversations.item_id
  JOIN users AS other ON other.id = CASE WHEN conversations.owner_id = @me THEN conversations.participant_id ELSE conversations.owner_id END`

function conversationDto(row: ConversationRow, me: number, extra: { unread?: number; lastMessage?: MessageRow | null } = {}) {
  const lastReadId = row.owner_id === me ? row.owner_last_read_id : row.participant_last_read_id
  return {
    id: row.id,
    status: row.status,
    closedByMe: row.status === 'closed' && row.closed_by === me,
    role: row.owner_id === me ? ('owner' as const) : ('participant' as const),
    item: { id: row.item_id, title: row.item_title, type: row.item_type, status: row.item_status, image_url: uploadUrl(row.item_image_url) },
    // A outra parte aparece só pelo apelido público: e-mail e telefone nunca entram na conversa.
    counterpart: {
      nickname: publicNickname({ id: row.other_id, name: row.other_name, nickname: row.other_nickname }),
      avatar_url: uploadUrl(row.other_avatar_url),
    },
    lastReadId,
    unread: extra.unread ?? 0,
    lastMessage: extra.lastMessage ? messageDto(extra.lastMessage, me) : null,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  }
}

function messageDto(row: MessageRow, me: number) {
  const removed = row.status === 'removed'
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    mine: row.sender_id === me,
    body: removed ? removedBody : row.body,
    removed,
    // Lembrete de segurança exibido junto da mensagem (dados de contato ou pedido de pagamento).
    safetyNotice: !removed && (row.moderation_rule === 'contact_info' || row.moderation_rule === 'payment_request') ? row.moderation_rule : null,
    created_at: row.created_at,
  }
}

function findConversation(id: unknown, me: number) {
  const conversationId = Number(id)
  const row = Number.isInteger(conversationId)
    ? (db
        .prepare(`${conversationSelect} WHERE conversations.id = @id AND (conversations.owner_id = @me OR conversations.participant_id = @me)`)
        .get({ id: conversationId, me }) as ConversationRow | undefined)
    : undefined
  // Conversa de outras pessoas responde 404 para não revelar que existe.
  if (!row) throw new HttpError(404, 'Conversa não encontrada.')
  return row
}

function unreadCount(conversation: Pick<ConversationRow, 'id' | 'owner_id' | 'owner_last_read_id' | 'participant_last_read_id'>, me: number) {
  const lastReadId = conversation.owner_id === me ? conversation.owner_last_read_id : conversation.participant_last_read_id
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM chat_messages WHERE conversation_id = ? AND id > ? AND sender_id <> ? AND status <> 'removed'")
    .get(conversation.id, lastReadId, me) as { total: number }
  return row.total
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = req.user!.id
    const rows = db
      .prepare(
        `${conversationSelect}
         WHERE conversations.owner_id = @me OR conversations.participant_id = @me
         ORDER BY COALESCE(conversations.last_message_at, conversations.created_at) DESC, conversations.id DESC
         LIMIT 100`,
      )
      .all({ me }) as ConversationRow[]
    const lastMessage = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
    res.json({
      data: rows.map((row) =>
        conversationDto(row, me, { unread: unreadCount(row, me), lastMessage: (lastMessage.get(row.id) as MessageRow | undefined) ?? null }),
      ),
    })
  }),
)

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const me = req.user!.id
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM chat_messages
         JOIN conversations ON conversations.id = chat_messages.conversation_id
         WHERE chat_messages.sender_id <> @me AND chat_messages.status <> 'removed'
           AND ((conversations.owner_id = @me AND chat_messages.id > conversations.owner_last_read_id)
             OR (conversations.participant_id = @me AND chat_messages.id > conversations.participant_last_read_id))`,
      )
      .get({ me }) as { total: number }
    res.json({ total: row.total })
  }),
)

// Abre (ou reaproveita) a conversa com quem publicou o caso.
router.post(
  '/',
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const input = startSchema.parse(req.body)
    const me = req.user!.id
    if (!hasPermission(req.user!.role, 'chat:send')) throw new HttpError(403, 'Sem permissão para enviar mensagens.')
    const item = db.prepare('SELECT id, owner_id, status, approval_status, archived_at FROM items WHERE id = ?').get(input.itemId) as
      | { id: number; owner_id: number; status: string; approval_status: string; archived_at: string | null }
      | undefined
    if (!item || item.approval_status !== 'approved') throw new HttpError(404, 'Item não encontrado.')
    if (item.owner_id === me) throw new HttpError(422, 'As conversas deste caso aparecem em Mensagens quando alguém escrever para você.')

    const existing = db.prepare('SELECT id FROM conversations WHERE item_id = ? AND participant_id = ?').get(item.id, me) as { id: number } | undefined
    if (existing) return res.status(200).json({ id: existing.id, conversation: conversationDto(findConversation(existing.id, me), me) })

    if (item.status === 'returned' || item.archived_at) throw new HttpError(422, 'Este caso já foi encerrado e não aceita novas conversas.')
    assertNotMuted(me)
    const id = Number(db.prepare('INSERT INTO conversations (item_id, owner_id, participant_id) VALUES (?, ?, ?)').run(item.id, item.owner_id, me).lastInsertRowid)
    logAudit(req, 'chat.conversation_started', 'conversation', id, { itemId: item.id })
    res.status(201).json({ id, conversation: conversationDto(findConversation(id, me), me) })
  }),
)

// Moderação: só mensagens sinalizadas (regra automática ou denúncia) chegam a quem modera.
router.get(
  '/moderation/flagged',
  authorize('chat:moderate'),
  asyncHandler(async (req, res) => {
    const input = flaggedSchema.parse(req.query)
    const total = db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE status = 'flagged'").get() as { count: number }
    const rows = db
      .prepare(
        `SELECT chat_messages.id, chat_messages.conversation_id, chat_messages.body, chat_messages.moderation_rule,
                chat_messages.created_at, chat_messages.sender_id, sender.name AS sender_name,
                chat_messages.reported_by IS NOT NULL AS reported, items.id AS item_id, items.title AS item_title
         FROM chat_messages
         JOIN conversations ON conversations.id = chat_messages.conversation_id
         JOIN items ON items.id = conversations.item_id
         JOIN users AS sender ON sender.id = chat_messages.sender_id
         WHERE chat_messages.status = 'flagged'
         ORDER BY chat_messages.id DESC LIMIT ? OFFSET ?`,
      )
      .all(input.limit, (input.page - 1) * input.limit) as Array<Record<string, unknown> & { reported: number }>
    logAudit(req, 'chat.flagged_viewed', 'chat_message', null, { count: rows.length })
    res.json({
      data: rows.map((row) => ({ ...row, reported: Boolean(row.reported) })),
      meta: { page: input.page, limit: input.limit, total: total.count },
    })
  }),
)

router.patch(
  '/moderation/messages/:messageId',
  authorize('chat:moderate'),
  asyncHandler(async (req, res) => {
    const input = reviewSchema.parse(req.body)
    const message = db.prepare('SELECT id, sender_id, conversation_id, status FROM chat_messages WHERE id = ?').get(Number(req.params.messageId)) as
      | { id: number; sender_id: number; conversation_id: number; status: string }
      | undefined
    if (!message) throw new HttpError(404, 'Mensagem não encontrada.')
    if (message.status !== 'flagged') throw new HttpError(409, 'Esta mensagem já foi revisada.')
    atomic(() => {
      const changed = db
        .prepare(
          `UPDATE chat_messages SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
           moderation_rule = CASE WHEN ? THEN moderation_rule ELSE NULL END WHERE id = ? AND status = 'flagged'`,
        )
        .run(input.action === 'remove' ? 'removed' : 'visible', req.user!.id, input.action === 'remove' ? 1 : 0, message.id).changes
      if (!changed) throw new HttpError(409, 'Esta mensagem já foi revisada.')
      logAudit(req, input.action === 'remove' ? 'chat.message_removed' : 'chat.flag_dismissed', 'chat_message', message.id, {
        conversationId: message.conversation_id,
      })
      if (input.action === 'remove') {
        // Remoção pela moderação conta para a regra de reincidência, como um bloqueio automático.
        registerBlock(message.sender_id, 'chat', 'user_report')
        notify(message.sender_id, 'Mensagem removida', 'Uma mensagem sua foi removida pela moderação por violar as regras do ARGOS.', 'moderation')
      }
    })
    res.json({ message: input.action === 'remove' ? 'Mensagem removida.' : 'Sinalização descartada.' })
  }),
)

router.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const me = req.user!.id
    const input = listSchema.parse(req.query)
    const conversation = findConversation(req.params.id, me)
    const lastReadId = conversation.owner_id === me ? conversation.owner_last_read_id : conversation.participant_last_read_id
    // Sem `after`, devolve as mensagens mais recentes; com `after`, só as novas (consulta periódica).
    // Também voltam as mensagens recebidas que nunca foram entregues (id entre o marcador de leitura e `after`):
    // um cliente que avançou o cursor pela própria mensagem enviada não perde a que chegou um instante antes.
    const rows = (
      input.after
        ? db
            .prepare('SELECT * FROM chat_messages WHERE conversation_id = ? AND (id > ? OR (id > ? AND sender_id <> ?)) ORDER BY id ASC LIMIT ?')
            .all(conversation.id, input.after, lastReadId, me, input.limit)
        : db
            .prepare('SELECT * FROM (SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC')
            .all(conversation.id, input.limit)
    ) as MessageRow[]

    // Toda mensagem recebida com id até `newest` foi entregue nesta resposta: o marcador pode avançar até ele.
    const newest = rows.length ? rows[rows.length - 1].id : 0
    const column = conversation.owner_id === me ? 'owner_last_read_id' : 'participant_last_read_id'
    if (newest > lastReadId) {
      db.prepare(`UPDATE conversations SET ${column} = ? WHERE id = ?`).run(newest, conversation.id)
      db.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND type = 'chat' AND action_url = ? AND read_at IS NULL").run(
        me,
        `/messages/${conversation.id}`,
      )
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      conversation: conversationDto(findConversation(conversation.id, me), me),
      data: rows.map((row) => messageDto(row, me)),
    })
  }),
)

router.post(
  '/:id/messages',
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const me = req.user!.id
    const input = messageSchema.parse(req.body)
    const conversation = findConversation(req.params.id, me)
    if (!hasPermission(req.user!.role, 'chat:send')) throw new HttpError(403, 'Sem permissão para enviar mensagens.')
    if (conversation.status === 'closed') throw new HttpError(409, 'Esta conversa foi encerrada.', { code: 'conversation_closed' })
    assertNotMuted(me)

    // Regra de repetição: a mesma mensagem enviada de novo em seguida é barrada (e conta como bloqueio).
    const recent = db
      .prepare("SELECT body FROM chat_messages WHERE conversation_id = ? AND sender_id = ? AND created_at >= datetime('now', '-1 minute') ORDER BY id DESC LIMIT 5")
      .all(conversation.id, me) as Array<{ body: string }>
    const key = normalizeKey(input.body)
    if (recent.filter((entry) => normalizeKey(entry.body) === key).length >= 2) {
      const until = registerBlock(me, 'chat', 'repeated_message')
      throw new HttpError(422, moderationMessages.repeated_message, { code: 'content_blocked', rule: 'repeated_message', ...(until ? { mutedUntil: until } : {}) })
    }
    const verdict = moderateOrThrow(me, input.body, 'chat')
    const flagged = verdict.action === 'flag'
    const rule = verdict.action === 'allow' ? null : verdict.rule
    const recipientId = conversation.owner_id === me ? conversation.participant_id : conversation.owner_id

    const message = atomic(() => {
      const id = Number(
        db
          .prepare('INSERT INTO chat_messages (conversation_id, sender_id, body, status, moderation_rule) VALUES (?, ?, ?, ?, ?)')
          .run(conversation.id, me, input.body, flagged ? 'flagged' : 'visible', rule).lastInsertRowid,
      )
      // O marcador de leitura de quem envia NÃO avança aqui: a outra parte pode ter escrito um instante antes e essa
      // mensagem ainda não foi entregue. As próprias mensagens nunca contam como não lidas (ver unreadCount).
      db.prepare('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversation.id)
      if (rule) recordModerationEvent(me, 'chat', rule, flagged ? 'flagged' : 'warned', 'chat_message', id)
      if (flagged) {
        for (const moderatorId of activeUserIdsWith('chat:moderate')) {
          if (moderatorId !== me && moderatorId !== recipientId) {
            notify(moderatorId, 'Mensagem para revisar', 'Uma mensagem de conversa foi sinalizada pelas regras automáticas.', 'moderation', '/admin')
          }
        }
      }
      // Um aviso por conversa enquanto houver mensagens não lidas (sem um alerta a cada mensagem).
      const actionUrl = `/messages/${conversation.id}`
      const pending = db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND type = 'chat' AND action_url = ? AND read_at IS NULL").get(recipientId, actionUrl)
      if (!pending) notify(recipientId, 'Nova mensagem', `Você recebeu uma mensagem sobre "${conversation.item_title}".`, 'chat', actionUrl)
      return db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as MessageRow
    })
    res.status(201).json({ message: messageDto(message, me) })
  }),
)

// Quem recebeu denuncia a mensagem: ela vai para a fila da moderação.
router.post(
  '/:id/messages/:messageId/report',
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const me = req.user!.id
    const conversation = findConversation(req.params.id, me)
    const message = db.prepare('SELECT id, sender_id, status FROM chat_messages WHERE id = ? AND conversation_id = ?').get(Number(req.params.messageId), conversation.id) as
      | { id: number; sender_id: number; status: string }
      | undefined
    if (!message || message.status === 'removed') throw new HttpError(404, 'Mensagem não encontrada.')
    if (message.sender_id === me) throw new HttpError(422, 'Você não pode denunciar a própria mensagem.')
    if (message.status === 'flagged') return res.json({ message: 'Esta mensagem já está em análise pela moderação.' })

    atomic(() => {
      db.prepare("UPDATE chat_messages SET status = 'flagged', moderation_rule = COALESCE(moderation_rule, 'user_report'), reported_by = ? WHERE id = ?").run(me, message.id)
      recordModerationEvent(message.sender_id, 'chat', 'user_report', 'flagged', 'chat_message', message.id)
      logAudit(req, 'chat.message_reported', 'chat_message', message.id, { conversationId: conversation.id })
      for (const moderatorId of activeUserIdsWith('chat:moderate')) {
        if (moderatorId !== me && moderatorId !== message.sender_id) {
          notify(moderatorId, 'Mensagem denunciada', 'Uma mensagem de conversa foi denunciada por quem a recebeu.', 'moderation', '/admin')
        }
      }
    })
    res.status(201).json({ message: 'Denúncia enviada para a moderação.' })
  }),
)

// Encerrar silencia a conversa para os dois lados; só quem encerrou pode reabrir.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const me = req.user!.id
    const input = statusSchema.parse(req.body)
    const conversation = findConversation(req.params.id, me)
    if (input.status === 'open' && conversation.status === 'closed' && conversation.closed_by !== me) {
      throw new HttpError(403, 'Só quem encerrou a conversa pode reabri-la.')
    }
    if (input.status !== conversation.status) {
      db.prepare('UPDATE conversations SET status = ?, closed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        input.status,
        input.status === 'closed' ? me : null,
        conversation.id,
      )
      logAudit(req, input.status === 'closed' ? 'chat.conversation_closed' : 'chat.conversation_reopened', 'conversation', conversation.id)
    }
    res.json({ message: input.status === 'closed' ? 'Conversa encerrada.' : 'Conversa reaberta.', conversation: conversationDto(findConversation(conversation.id, me), me) })
  }),
)

export { router as chatRoutes }
