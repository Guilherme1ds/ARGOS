import { Building2, CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n'
import { api, apiError, apiErrorCode, takeLinkToken } from '../services/api'
import type { InviteStatus, ScopedRole } from '../types/api'
import { formatDateTime } from '../utils/dates'
import { roleLabel } from '../utils/labels'

type Preview = { organizationName: string; spaceName: string | null; role: ScopedRole; status: InviteStatus; emailHint: string; expiresAt: string }

// O token fica guardado na aba enquanto a pessoa entra ou cria a conta (o link do e-mail traz #token=...).
const storageKey = 'argos.pendingInvite'

function readToken() {
  const fromLink = takeLinkToken()
  try {
    if (fromLink) sessionStorage.setItem(storageKey, fromLink)
    return fromLink || sessionStorage.getItem(storageKey) || ''
  } catch {
    return fromLink
  }
}

function forgetToken() {
  try {
    sessionStorage.removeItem(storageKey)
  } catch {
    /* sem armazenamento: nada a limpar */
  }
}

export function InvitePage() {
  const { user, checkingSession, reloadUser } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [token] = useState(readToken)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!token) {
      setError(t('Link de convite inválido. Abra o link exatamente como chegou no e-mail.'))
      return
    }
    api
      .post('/organizations/invites/preview', { token })
      .then((response) => setPreview(response.data.invite))
      .catch((requestError) => setError(apiError(requestError)))
  }, [token])

  async function accept() {
    setAccepting(true)
    setError('')
    try {
      await api.post('/organizations/invites/accept', { token })
      forgetToken()
      await reloadUser()
      setAccepted(true)
    } catch (requestError) {
      const code = apiErrorCode(requestError)
      if (code === 'invite_used' || code === 'invite_revoked' || code === 'invite_expired') forgetToken()
      setError(apiError(requestError))
    } finally {
      setAccepting(false)
    }
  }

  const usable = preview?.status === 'pending'

  return (
    <section className="panel invite-panel">
      <h2><Building2 size={22} /> {t('Convite de gestão')}</h2>
      {error && <p className="message error" role="alert">{error}</p>}
      {preview && (
        <div className="stack">
          <p>
            {preview.spaceName
              ? t('Você foi convidado(a) para gerir o espaço {space}, da organização {organization}.', { space: preview.spaceName, organization: preview.organizationName })
              : t('Você foi convidado(a) para administrar a organização {organization}.', { organization: preview.organizationName })}
          </p>
          <p className="privacy-note">
            {t('Papel: {role}. Convite enviado para {email}.', { role: t(roleLabel[preview.role]), email: preview.emailHint })}{' '}
            {usable && t('Expira em {date}.', { date: formatDateTime(preview.expiresAt) })}
          </p>
          {preview.status === 'accepted' && <p className="message error" role="alert">{t('Este convite já foi aceito.')}</p>}
          {preview.status === 'revoked' && <p className="message error" role="alert">{t('Este convite foi cancelado. Peça um novo convite.')}</p>}
          {preview.status === 'expired' && <p className="message error" role="alert">{t('Este convite expirou. Peça um novo convite.')}</p>}

          {accepted ? (
            <div className="stack">
              <p className="message success" role="status"><CheckCircle2 size={18} /> {t('Convite aceito. Você já pode gerir este espaço.')}</p>
              <div className="actions">
                <button className="primary" type="button" onClick={() => navigate('/custody')}>{t('Abrir painel de custódia')}</button>
                <Link className="ghost light" to="/organizations">{t('Ver organização')}</Link>
              </div>
            </div>
          ) : usable && !checkingSession && !user ? (
            <div className="stack">
              <p>{t('Entre ou crie sua conta com o e-mail convidado para aceitar.')}</p>
              <Link className="primary fit" to={`/login?next=${encodeURIComponent('/invite')}`}>{t('Entrar para aceitar')}</Link>
            </div>
          ) : usable && user ? (
            <div className="stack">
              <p className="privacy-note">{t('Você está conectado(a) como {email}.', { email: user.email })}</p>
              <button className="primary fit" type="button" onClick={() => void accept()} disabled={accepting}>
                {accepting ? t('Aceitando...') : t('Aceitar convite')}
              </button>
            </div>
          ) : null}
        </div>
      )}
      {!preview && !error && <p className="loading" role="status">{t('Carregando convite...')}</p>}
    </section>
  )
}
