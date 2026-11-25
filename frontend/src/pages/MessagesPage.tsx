import { ArrowLeft, Flag, Lock, MessageCircle, Send, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { msg, useI18n } from '../i18n'
import { UploadImage } from '../components/UploadImage'
import { api, apiAssetUrl, apiError, apiErrorCode } from '../services/api'
import type { ChatMessage, Conversation } from '../types/api'
import { formatDateTime, relativeDate } from '../utils/dates'
import { announceChatChanged } from '../utils/notifications'

const pollMs = 5000

const safetyText: Record<NonNullable<ChatMessage['safetyNotice']>, string> = {
  contact_info: msg('Cuidado ao compartilhar contato pessoal. Prefira combinar a entrega pelo ARGOS e em local público ou no espaço institucional.'),
  payment_request: msg('Atenção: pedido de pagamento. O ARGOS não cobra pela devolução. Esta mensagem foi enviada para revisão da moderação.'),
}

/** Junta mensagens novas às da tela sem repetir, em ordem de envio (a consulta pode trazer uma anterior à enviada). */
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

function initials(value: string) {
  return value.replace(/^@/, '').slice(0, 2).toUpperCase() || 'A'
}

export function MessagesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const conversationId = id ? Number(id) : null
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const listEnd = useRef<HTMLDivElement | null>(null)
  const lastId = useRef(0)

  async function loadConversations() {
    const response = await api.get('/conversations')
    setConversations(response.data.data)
  }

  useEffect(() => {
    loadConversations()
      .catch((requestError) => setError(apiError(requestError)))
      .finally(() => setLoading(false))
  }, [])

  // Abre a conversa e consulta mensagens novas periodicamente (só as posteriores à última recebida).
  useEffect(() => {
    if (!conversationId) {
      setActive(null)
      setMessages([])
      return
    }
    let stopped = false
    lastId.current = 0
    setMessages([])
    setError('')
    setNotice('')

    async function poll(initial: boolean) {
      try {
        const response = await api.get(`/conversations/${conversationId}/messages`, { params: initial ? {} : { after: lastId.current } })
        if (stopped) return
        const incoming = response.data.data as ChatMessage[]
        setActive(response.data.conversation)
        if (incoming.length) {
          // O cursor só avança com o que veio da consulta (nunca pela mensagem enviada): assim a mensagem que a
          // outra pessoa mandou um instante antes do envio ainda chega na próxima consulta.
          lastId.current = Math.max(lastId.current, incoming[incoming.length - 1].id)
          setMessages((current) => (initial ? incoming : mergeMessages(current, incoming)))
          announceChatChanged()
          if (!initial) void loadConversations().catch(() => undefined)
        }
      } catch (requestError) {
        if (!stopped && initial) setError(apiError(requestError))
      }
    }

    void poll(true)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll(false)
    }, pollMs)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [conversationId])

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function send(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !conversationId || sending) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      const response = await api.post(`/conversations/${conversationId}/messages`, { body })
      const message = response.data.message as ChatMessage
      setMessages((current) => mergeMessages(current, [message]))
      setDraft('')
      void loadConversations().catch(() => undefined)
    } catch (requestError) {
      // Mensagem bloqueada pela regra continua no campo para a pessoa reescrever.
      setError(apiError(requestError))
      if (apiErrorCode(requestError) === 'conversation_closed') setActive((current) => (current ? { ...current, status: 'closed' } : current))
    } finally {
      setSending(false)
    }
  }

  async function report(message: ChatMessage) {
    if (!conversationId || !window.confirm(t('Denunciar esta mensagem para a moderação?'))) return
    try {
      const response = await api.post(`/conversations/${conversationId}/messages/${message.id}/report`)
      setNotice(t(response.data.message))
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  async function toggleStatus() {
    if (!active) return
    const closing = active.status === 'open'
    if (closing && !window.confirm(t('Encerrar esta conversa? Nenhum dos dois poderá enviar mensagens até ela ser reaberta.'))) return
    try {
      const response = await api.patch(`/conversations/${active.id}`, { status: closing ? 'closed' : 'open' })
      setActive(response.data.conversation)
      setNotice(t(response.data.message))
      void loadConversations().catch(() => undefined)
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  return (
    <section className={`chat-layout ${conversationId ? 'has-thread' : ''}`}>
      <aside className="panel chat-list" aria-label={t('Conversas')}>
        <h2 className="section-title"><MessageCircle size={18} /> {t('Conversas')}</h2>
        {loading && <p className="loading" role="status">{t('Carregando conversas...')}</p>}
        {!loading && !conversations.length && (
          <p className="empty">{t('Nenhuma conversa ainda. Abra um caso e use "Mensagem privada" para falar com quem publicou.')}</p>
        )}
        <ul>
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link to={`/messages/${conversation.id}`} className={conversation.id === conversationId ? 'chat-list-item active' : 'chat-list-item'} aria-current={conversation.id === conversationId ? 'page' : undefined}>
                <span className="profile-avatar mini-avatar">
                  {apiAssetUrl(conversation.counterpart.avatar_url) ? <UploadImage url={conversation.counterpart.avatar_url} /> : <span>{initials(conversation.counterpart.nickname)}</span>}
                </span>
                <span className="chat-list-text">
                  <strong>{conversation.item.title}</strong>
                  <small>@{conversation.counterpart.nickname} · {conversation.role === 'owner' ? t('você publicou') : t('você escreveu')}</small>
                  {conversation.lastMessage && <small className="chat-preview">{conversation.lastMessage.mine ? t('Você: {text}', { text: conversation.lastMessage.body }) : conversation.lastMessage.body}</small>}
                </span>
                <span className="chat-list-meta">
                  {conversation.lastMessageAt && <small>{relativeDate(conversation.lastMessageAt)}</small>}
                  {conversation.unread > 0 && <span className="nav-count" aria-label={t('{count} não lidas', { count: conversation.unread })}>{conversation.unread}</span>}
                  {conversation.status === 'closed' && <Lock size={14} aria-label={t('Encerrada')} />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <div className="panel chat-thread">
        {!conversationId ? (
          <div className="chat-placeholder">
            <MessageCircle size={36} />
            <p>{t('Selecione uma conversa.')}</p>
          </div>
        ) : (
          <>
            <header className="chat-thread-header">
              <button className="ghost light fit chat-back" type="button" onClick={() => navigate('/messages')}><ArrowLeft size={18} /> {t('Conversas')}</button>
              {active && (
                <div>
                  <Link to={`/items/${active.item.id}`}><strong>{active.item.title}</strong></Link>
                  <small>@{active.counterpart.nickname}</small>
                </div>
              )}
              {active && (
                <button className="ghost light fit" type="button" onClick={() => void toggleStatus()} disabled={active.status === 'closed' && !active.closedByMe}>
                  {active.status === 'open' ? t('Encerrar conversa') : t('Reabrir conversa')}
                </button>
              )}
            </header>
            <div className="case-safety-box">
              <ShieldAlert size={18} />
              <p>{t('Conversa privada e moderada. Nunca envie documentos ou pagamentos; combine a entrega em local público ou no espaço institucional. Links e ofensas são bloqueados.')}</p>
            </div>
            <div className="chat-messages" role="log" aria-live="polite" aria-label={t('Mensagens')}>
              {messages.map((message) => (
                <div key={message.id} className={`chat-bubble ${message.mine ? 'mine' : 'theirs'} ${message.removed ? 'removed' : ''}`}>
                  <p>{message.removed ? t(message.body) : message.body}</p>
                  {message.safetyNotice && <small className="chat-safety">{t(safetyText[message.safetyNotice])}</small>}
                  <span className="chat-bubble-meta">
                    <time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time>
                    {!message.mine && !message.removed && (
                      <button className="link-button" type="button" onClick={() => void report(message)} aria-label={t('Denunciar mensagem')}><Flag size={13} /></button>
                    )}
                  </span>
                </div>
              ))}
              {!messages.length && !error && <p className="empty">{t('Nenhuma mensagem ainda. Comece descrevendo o item sem expor dados pessoais.')}</p>}
              <div ref={listEnd} />
            </div>
            {notice && <p className="message success" role="status">{notice}</p>}
            {error && <p className="message error" role="alert">{error}</p>}
            {active?.status === 'closed' ? (
              <p className="privacy-note"><Lock size={14} /> {active.closedByMe ? t('Você encerrou esta conversa. Reabra para continuar.') : t('A outra pessoa encerrou esta conversa.')}</p>
            ) : (
              <form className="chat-composer" onSubmit={send}>
                <textarea
                  aria-label={t('Escreva uma mensagem')}
                  placeholder={t('Escreva uma mensagem')}
                  maxLength={1000}
                  rows={2}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
                <button className="primary" type="submit" disabled={sending || !draft.trim()} aria-label={t('Enviar')}><Send size={18} /></button>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  )
}
