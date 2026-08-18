import { CheckCheck, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiError } from '../services/api'
import type { Notification } from '../types/api'

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/notifications')
      setNotifications(response.data.data)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  async function markAllAsRead() {
    setMessage('')
    try {
      await api.post('/notifications/read-all')
      setMessage('Notificações marcadas como lidas.')
      await load()
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <section className="stack">
      <div className="admin-header">
        <h2>Notificações</h2>
        <div className="actions">
          <button className="ghost light" onClick={load} disabled={loading}><RefreshCw size={18} /> Atualizar</button>
          <button className="primary" onClick={markAllAsRead} disabled={loading || notifications.every((item) => item.read_at)}>
            <CheckCheck size={18} /> Marcar lidas
          </button>
        </div>
      </div>
      {error && <p className="message error">{error}</p>}
      {message && <p className="message success">{message}</p>}
      <div className="panel">
        {loading ? (
          <div className="stack">
            {Array.from({ length: 4 }).map((_, index) => <div className="notification-row skeleton-card" key={index} />)}
          </div>
        ) : notifications.length ? (
          <div className="notification-list">
            {notifications.map((notification) => {
              const content = (
                <>
                  <span className={`dot ${notification.read_at ? 'read' : 'unread'}`} />
                  <div>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <small>{notification.created_at}</small>
                  </div>
                </>
              )

              return notification.action_url ? (
                <Link className="notification-row" to={notification.action_url} key={notification.id}>{content}</Link>
              ) : (
                <div className="notification-row" key={notification.id}>{content}</div>
              )
            })}
          </div>
        ) : (
          <p className="empty">Nenhuma notificação por enquanto.</p>
        )}
      </div>
    </section>
  )
}
