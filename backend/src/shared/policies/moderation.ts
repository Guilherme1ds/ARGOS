import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { activeUserIdsWith, notify } from '../../utils/audit.js'
import { HttpError } from '../../utils/http.js'
import { normalizeKey } from '../../utils/normalization.js'

/**
 * Regras AUTOMÁTICAS de moderação (Sprint 6). Valem para textos enviados por pessoas:
 * - `chat`: mensagens privadas entre quem publicou o caso e quem se interessou;
 * - `comment`: pistas públicas;
 * - `item`: título e descrição de uma publicação.
 *
 * Decisões possíveis: bloquear (o texto não é gravado), sinalizar (entregue e enviado à fila da moderação),
 * avisar (entregue com um lembrete de segurança) ou permitir. Toda decisão diferente de "permitir" é
 * registrada em `moderation_events`; bloqueios repetidos silenciam a conta por tempo limitado.
 * A restrição de PUBLICAÇÃO (`users.spam_score`) continua manual (ver abuse.ts).
 */
export type ModerationContext = 'chat' | 'comment' | 'item'
export type ModerationRule =
  | 'offensive_language'
  | 'external_link'
  | 'sensitive_document'
  | 'payment_request'
  | 'contact_info'
  | 'repeated_message'
  | 'user_report'

export type ModerationVerdict =
  | { action: 'allow' }
  | { action: 'warn' | 'flag'; rule: ModerationRule }
  | { action: 'block'; rule: ModerationRule; message: string }

export const moderationMessages: Record<Exclude<ModerationRule, 'payment_request' | 'contact_info' | 'user_report'>, string> = {
  offensive_language: 'A mensagem contém linguagem ofensiva e não foi enviada. Reescreva com respeito.',
  external_link: 'Links externos não são permitidos aqui. Descreva a informação em texto.',
  sensitive_document: 'Não envie número de documento ou de cartão. Combine a conferência pessoalmente, no local de entrega.',
  repeated_message: 'Você já enviou esta mensagem. Aguarde a resposta antes de repetir.',
}

export const chatMutedMessage = 'Suas pistas e mensagens estão pausadas temporariamente por causa de envios bloqueados pelas regras do ARGOS.'

// Lista curta e conservadora, comparada por palavra inteira (sem acento) para não barrar palavras inocentes.
const offensiveTerms = new Set([
  'idiota', 'imbecil', 'babaca', 'otario', 'otaria', 'burro', 'burra', 'retardado', 'retardada', 'lixo humano',
  'vagabundo', 'vagabunda', 'desgracado', 'desgracada', 'fdp', 'filho da puta', 'filha da puta', 'puta', 'puto',
  'merda', 'porra', 'caralho', 'cuzao', 'arrombado', 'arrombada', 'viado', 'bicha', 'macaco', 'macaca', 'vadia',
  'piranha', 'corno', 'nojento', 'nojenta', 'escroto', 'escrota', 'vai se foder', 'vai tomar no cu', 'te mato', 'vou te matar',
])

const linkPattern = /(?:https?:\/\/|www\.)\S+|[\w-]+\.(?:com|net|org|io|app|xyz|info|biz)(?:\.[a-z]{2})?/i
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const emailPatternGlobal = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const phonePattern = /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}\b/
const cpfPattern = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/
// Pedido de dinheiro antes da entrega é o golpe mais comum em achados e perdidos: vai para revisão humana.
const paymentPattern = /\b(pix|deposit\w*|transferencia|transfere|pagamento|pague|pagar|paga|taxa|boleto|adiantad\w*|cartao de credito)\b/

function longDigitSequence(value: string) {
  // 13+ dígitos seguidos (com espaços/pontos): cartão; CPF formatado é tratado à parte.
  return (value.match(/\d[\d\s.-]{11,}\d/g) ?? []).some((match) => match.replace(/\D/g, '').length >= 13)
}

function hasOffensiveTerm(normalized: string) {
  const padded = ` ${normalized} `
  for (const term of offensiveTerms) if (padded.includes(` ${term} `)) return true
  return false
}

/** Avalia um texto conforme o contexto. Função pura: não grava nada. */
export function evaluateText(text: string, context: ModerationContext): ModerationVerdict {
  const normalized = normalizeKey(text)
  if (hasOffensiveTerm(normalized)) return { action: 'block', rule: 'offensive_language', message: moderationMessages.offensive_language }
  if (context === 'item') return { action: 'allow' }

  // Um e-mail casa com o padrão de domínio; ele é tratado adiante como dado de contato.
  if (linkPattern.test(text.replace(emailPatternGlobal, ' '))) {
    return { action: 'block', rule: 'external_link', message: moderationMessages.external_link }
  }
  if (context === 'chat') {
    if (cpfPattern.test(text) || longDigitSequence(text)) {
      return { action: 'block', rule: 'sensitive_document', message: moderationMessages.sensitive_document }
    }
    if (paymentPattern.test(normalized)) return { action: 'flag', rule: 'payment_request' }
    if (emailPattern.test(text) || phonePattern.test(text)) return { action: 'warn', rule: 'contact_info' }
  }
  return { action: 'allow' }
}

export function recordModerationEvent(
  userId: number | null,
  context: ModerationContext | 'report',
  rule: string,
  action: 'blocked' | 'flagged' | 'warned' | 'hidden' | 'muted',
  entityType?: string,
  entityId?: number | string | null,
) {
  db.prepare('INSERT INTO moderation_events (user_id, context, rule, action, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    userId,
    context,
    rule,
    action,
    entityType ?? null,
    entityId == null ? null : String(entityId),
  )
}

function sqliteTime(date: Date) {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

/** Data (ISO) até quando a conta está silenciada, ou null. */
export function mutedUntil(userId: number, now = new Date()) {
  const row = db.prepare('SELECT chat_muted_until FROM users WHERE id = ?').get(userId) as { chat_muted_until: string | null } | undefined
  if (!row?.chat_muted_until) return null
  return new Date(row.chat_muted_until).getTime() > now.getTime() ? row.chat_muted_until : null
}

export function assertNotMuted(userId: number) {
  const until = mutedUntil(userId)
  if (until) throw new HttpError(403, chatMutedMessage, { code: 'chat_muted', until })
}

/**
 * Registra um bloqueio e aplica a regra de reincidência: `CHAT_MUTE_STRIKES` bloqueios em 24 h silenciam
 * pistas e conversas da conta por `CHAT_MUTE_HOURS`. A moderação é avisada para revisar o caso.
 */
export function registerBlock(userId: number, context: ModerationContext, rule: ModerationRule, now = new Date()) {
  recordModerationEvent(userId, context, rule, 'blocked')
  const since = sqliteTime(new Date(now.getTime() - 86_400_000))
  const recent = db
    .prepare("SELECT COUNT(*) AS total FROM moderation_events WHERE user_id = ? AND action = 'blocked' AND created_at >= ?")
    .get(userId, since) as { total: number }
  if (recent.total < env.CHAT_MUTE_STRIKES || mutedUntil(userId, now)) return null

  const until = new Date(now.getTime() + env.CHAT_MUTE_HOURS * 3_600_000).toISOString()
  db.prepare('UPDATE users SET chat_muted_until = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(until, userId)
  recordModerationEvent(userId, context, 'repeated_blocks', 'muted', 'user', userId)
  db.prepare("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES (NULL, 'moderation.auto_muted', 'user', ?, ?)").run(
    String(userId),
    JSON.stringify({ blocks: recent.total, hours: env.CHAT_MUTE_HOURS, until }),
  )
  notify(userId, 'Envios pausados', `${chatMutedMessage} A pausa termina em ${env.CHAT_MUTE_HOURS} horas.`, 'moderation')
  for (const moderatorId of activeUserIdsWith('chat:moderate')) {
    if (moderatorId !== userId) {
      notify(moderatorId, 'Conta silenciada automaticamente', `Uma conta teve ${recent.total} envios bloqueados em 24 horas e foi silenciada.`, 'moderation', '/admin')
    }
  }
  return until
}

/**
 * Aplica as regras a um texto de `userId`: lança 422 quando bloqueado (e conta a reincidência) e devolve
 * o veredito nos demais casos, para quem chamou gravar a sinalização ou o aviso junto do conteúdo.
 */
export function moderateOrThrow(userId: number, text: string, context: ModerationContext): Exclude<ModerationVerdict, { action: 'block' }> {
  const verdict = evaluateText(text, context)
  if (verdict.action !== 'block') return verdict
  const until = registerBlock(userId, context, verdict.rule)
  throw new HttpError(422, verdict.message, { code: 'content_blocked', rule: verdict.rule, ...(until ? { mutedUntil: until } : {}) })
}

/**
 * Regra automática de denúncias: quando `AUTO_HIDE_REPORT_THRESHOLD` pessoas diferentes têm denúncia aberta
 * sobre o mesmo caso, ele sai da busca (volta a "pendente") até a moderação revisar. Devolve true se ocultou.
 */
export function autoHideReportedItem(itemId: number) {
  if (env.AUTO_HIDE_REPORT_THRESHOLD <= 0) return false
  const item = db.prepare('SELECT id, owner_id, title, approval_status FROM items WHERE id = ?').get(itemId) as
    | { id: number; owner_id: number; title: string; approval_status: string }
    | undefined
  if (!item || item.approval_status !== 'approved') return false
  const reporters = db
    .prepare("SELECT COUNT(DISTINCT reporter_id) AS total FROM item_reports WHERE item_id = ? AND status IN ('open', 'in_review') AND reporter_id IS NOT NULL")
    .get(itemId) as { total: number }
  if (reporters.total < env.AUTO_HIDE_REPORT_THRESHOLD) return false

  const note = `Ocultado automaticamente após ${reporters.total} denúncias; aguardando revisão da moderação.`
  db.prepare("UPDATE items SET approval_status = 'pending', moderation_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(note, item.id)
  db.prepare("INSERT INTO item_history (item_id, actor_id, action, details) VALUES (?, NULL, 'moderation.auto_hidden', ?)").run(
    item.id,
    JSON.stringify({ reporters: reporters.total, threshold: env.AUTO_HIDE_REPORT_THRESHOLD }),
  )
  db.prepare("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES (NULL, 'moderation.auto_hidden', 'item', ?, ?)").run(
    String(item.id),
    JSON.stringify({ reporters: reporters.total, threshold: env.AUTO_HIDE_REPORT_THRESHOLD }),
  )
  recordModerationEvent(item.owner_id, 'report', 'report_threshold', 'hidden', 'item', item.id)
  notify(
    item.owner_id,
    'Publicação em revisão',
    `O item "${item.title}" recebeu várias denúncias e ficou oculto até a moderação revisar.`,
    'approval',
    `/items/${item.id}`,
  )
  return true
}
