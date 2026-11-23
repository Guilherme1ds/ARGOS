import { Archive, Building2, MailPlus, MapPin, Plus, RotateCcw, Trash2, UserMinus, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { msg, useI18n } from '../i18n'
import { api, apiError } from '../services/api'
import type { Invite, Organization, OrganizationDetail, ScopedRole, Space } from '../types/api'
import { formatDate, formatDateTime } from '../utils/dates'
import { roleLabel } from '../utils/labels'
import { hasPermission } from '../utils/permissions'
import { useDialogFocus } from '../utils/useDialogFocus'

const inviteStatusLabel: Record<Invite['status'], string> = {
  pending: msg('Pendente'),
  accepted: msg('Aceito'),
  revoked: msg('Cancelado'),
  expired: msg('Expirado'),
}

const emptySpace = { name: '', address: '', description: '' }

export function OrganizationsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const canCreate = hasPermission(user, 'orgs:manage')
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<OrganizationDetail | null>(null)
  const [newOrganization, setNewOrganization] = useState({ name: '', description: '', contactEmail: '' })
  const [newSpace, setNewSpace] = useState(emptySpace)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invite, setInvite] = useState<{ email: string; role: ScopedRole; spaceId: string }>({ email: '', role: 'space_manager', spaceId: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogFocus(inviteOpen, dialogRef)

  async function loadOrganizations(keep = selectedId) {
    const response = await api.get('/organizations')
    const list = response.data.data as Organization[]
    setOrganizations(list)
    const next = keep && list.some((entry) => entry.id === keep) ? keep : list[0]?.id ?? null
    setSelectedId(next)
    return next
  }

  async function loadDetail(id: number | null) {
    if (!id) {
      setDetail(null)
      return
    }
    const response = await api.get(`/organizations/${id}`)
    setDetail(response.data)
  }

  async function refresh(keep = selectedId) {
    setError('')
    try {
      const id = await loadOrganizations(keep)
      await loadDetail(id)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function run(key: string, action: () => Promise<string>, keep = selectedId) {
    if (busy) return
    setBusy(key)
    setMessage('')
    setError('')
    try {
      const text = await action()
      await refresh(keep)
      setMessage(text)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setBusy('')
    }
  }

  function selectOrganization(id: number) {
    setSelectedId(id)
    setMessage('')
    setError('')
    void loadDetail(id).catch((requestError) => setError(apiError(requestError)))
  }

  function createOrganization(event: FormEvent) {
    event.preventDefault()
    void run('create-org', async () => {
      const response = await api.post('/organizations', newOrganization)
      setNewOrganization({ name: '', description: '', contactEmail: '' })
      setSelectedId(response.data.id)
      return t('Organização criada.')
    })
  }

  function createSpace(event: FormEvent) {
    event.preventDefault()
    if (!detail) return
    void run('create-space', async () => {
      await api.post(`/organizations/${detail.organization.id}/spaces`, newSpace)
      setNewSpace(emptySpace)
      return t('Espaço criado.')
    })
  }

  function toggleSpace(space: Space) {
    if (!detail) return
    const archiving = space.status === 'active'
    if (archiving && !window.confirm(t('Arquivar o espaço {name}? Ele some das listas e os gestores dele deixam de atuar.', { name: space.name }))) return
    void run(`space-${space.id}`, async () => {
      await api.patch(`/organizations/${detail.organization.id}/spaces/${space.id}`, { status: archiving ? 'archived' : 'active' })
      return archiving ? t('Espaço arquivado.') : t('Espaço reativado.')
    })
  }

  function removeSpace(space: Space) {
    if (!detail || !window.confirm(t('Excluir o espaço {name}? Com casos ligados, ele é apenas arquivado.', { name: space.name }))) return
    void run(`space-${space.id}`, async () => {
      const response = await api.delete(`/organizations/${detail.organization.id}/spaces/${space.id}`)
      return response.data.archived ? t('Espaço arquivado: os casos ligados a ele foram mantidos.') : t('Espaço excluído.')
    })
  }

  function openInvite(spaceId?: number) {
    setInvite({ email: '', role: spaceId ? 'space_manager' : detail?.spaces.some((space) => space.status === 'active') ? 'space_manager' : 'org_admin', spaceId: spaceId ? String(spaceId) : '' })
    setInviteOpen(true)
  }

  function sendInvite(event: FormEvent) {
    event.preventDefault()
    if (!detail) return
    void run('invite', async () => {
      await api.post(`/organizations/${detail.organization.id}/invites`, {
        email: invite.email,
        role: invite.role,
        spaceId: invite.role === 'space_manager' && invite.spaceId ? Number(invite.spaceId) : undefined,
      })
      setInviteOpen(false)
      return t('Convite enviado para {email}. O link vale por 7 dias.', { email: invite.email })
    })
  }

  function revokeInvite(entry: Invite) {
    if (!detail || !window.confirm(t('Cancelar o convite de {email}?', { email: entry.email }))) return
    void run(`invite-${entry.id}`, async () => {
      await api.delete(`/organizations/${detail.organization.id}/invites/${entry.id}`)
      return t('Convite cancelado.')
    })
  }

  function removeMember(memberId: number, name: string) {
    if (!detail || !window.confirm(t('Remover o acesso de gestão de {name}?', { name }))) return
    void run(`member-${memberId}`, async () => {
      await api.delete(`/organizations/${detail.organization.id}/members/${memberId}`)
      return t('Vínculo removido.')
    })
  }

  function toggleOrganization() {
    if (!detail) return
    const archiving = detail.organization.status === 'active'
    if (archiving && !window.confirm(t('Arquivar a organização {name}? Todos os vínculos de gestão dela deixam de valer.', { name: detail.organization.name }))) return
    void run('org-status', async () => {
      await api.patch(`/organizations/${detail.organization.id}`, { status: archiving ? 'archived' : 'active' })
      return archiving ? t('Organização arquivada.') : t('Organização reativada.')
    })
  }

  useEffect(() => {
    if (!inviteOpen) return
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setInviteOpen(false)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inviteOpen])

  const canManage = Boolean(detail?.organization.canManage)
  const activeSpaces = detail?.spaces.filter((space) => space.status === 'active') ?? []

  return (
    <section className="stack">
      {message && <p className="message success" role="status">{message}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      {loading && <p className="loading" role="status">{t('Carregando organizações...')}</p>}

      <div className="org-layout">
        <div className="panel org-list">
          <h2 className="section-title"><Building2 size={18} /> {t('Organizações')}</h2>
          {organizations.length ? (
            <ul>
              {organizations.map((organization) => (
                <li key={organization.id}>
                  <button type="button" className={organization.id === selectedId ? 'org-item active' : 'org-item'} aria-current={organization.id === selectedId} onClick={() => selectOrganization(organization.id)}>
                    <strong>{organization.name}</strong>
                    <small>
                      {t('{count} espaços', { count: organization.spacesCount })}
                      {organization.status === 'archived' && <> · {t('arquivada')}</>}
                      {organization.myRoles?.length ? <> · {organization.myRoles.map((role) => t(roleLabel[role])).join(', ')}</> : null}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            !loading && <p className="empty">{canCreate ? t('Nenhuma organização cadastrada ainda.') : t('Você ainda não gere nenhuma organização. Peça um convite à administração.')}</p>
          )}
          {canCreate && (
            <form className="stack compact-form" onSubmit={createOrganization}>
              <h3>{t('Nova organização')}</h3>
              <label><span>{t('Nome')}</span><input required minLength={3} maxLength={120} value={newOrganization.name} onChange={(event) => setNewOrganization({ ...newOrganization, name: event.target.value })} /></label>
              <label><span>{t('Descrição (opcional)')}</span><input maxLength={500} value={newOrganization.description} onChange={(event) => setNewOrganization({ ...newOrganization, description: event.target.value })} /></label>
              <label><span>{t('E-mail institucional (opcional)')}</span><input type="email" maxLength={160} value={newOrganization.contactEmail} onChange={(event) => setNewOrganization({ ...newOrganization, contactEmail: event.target.value })} /></label>
              <button className="primary" type="submit" disabled={busy === 'create-org'}><Plus size={18} /> {t('Criar organização')}</button>
            </form>
          )}
        </div>

        {detail && (
          <div className="stack org-detail">
            <div className="panel">
              <div className="admin-header">
                <div>
                  <h2 className="section-title">{detail.organization.name}</h2>
                  {detail.organization.description && <p>{detail.organization.description}</p>}
                  <small className="privacy-note">
                    {detail.organization.status === 'archived' ? t('Organização arquivada: vínculos e convites não valem.') : t('Criada em {date}', { date: formatDate(detail.organization.createdAt) })}
                  </small>
                </div>
                <div className="actions">
                  {canManage && detail.organization.status === 'active' && (
                    <button className="primary" type="button" onClick={() => openInvite()}><MailPlus size={18} /> {t('Convidar gestor')}</button>
                  )}
                  {canCreate && (
                    <button className="ghost light" type="button" onClick={toggleOrganization} disabled={busy === 'org-status'}>
                      {detail.organization.status === 'active' ? <><Archive size={16} /> {t('Arquivar')}</> : <><RotateCcw size={16} /> {t('Reativar')}</>}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <h3><MapPin size={18} /> {t('Espaços institucionais')}</h3>
              <p className="privacy-note">{t('Cada espaço (biblioteca, portaria, secretaria) recebe e guarda itens. Quem publica um caso pode ligá-lo a um espaço; os gestores dele tratam reivindicações, devolução e custódia.')}</p>
              <div className="table">
                {detail.spaces.map((space) => (
                  <div key={space.id}>
                    <strong>{space.name}</strong>
                    <span>
                      {space.address || t('Sem endereço')} · {t('{count} casos', { count: space.itemsCount })}
                      {space.status === 'archived' && <> · {t('arquivado')}</>}
                    </span>
                    {canManage && (
                      <span className="actions">
                        {space.status === 'active' && (
                          <button className="ghost light" type="button" onClick={() => openInvite(space.id)}><MailPlus size={16} /> {t('Convidar')}</button>
                        )}
                        <button className="ghost light" type="button" disabled={busy === `space-${space.id}`} onClick={() => toggleSpace(space)}>
                          {space.status === 'active' ? t('Arquivar') : t('Reativar')}
                        </button>
                        <button className="ghost light danger-text" type="button" disabled={busy === `space-${space.id}`} onClick={() => removeSpace(space)} aria-label={t('Excluir {name}', { name: space.name })}><Trash2 size={16} /></button>
                      </span>
                    )}
                  </div>
                ))}
                {!detail.spaces.length && <p className="empty">{t('Nenhum espaço cadastrado.')}</p>}
              </div>
              {canManage && (
                <form className="toolbar compact-toolbar" onSubmit={createSpace}>
                  <input required minLength={2} maxLength={120} placeholder={t('Nome do espaço')} aria-label={t('Nome do espaço')} value={newSpace.name} onChange={(event) => setNewSpace({ ...newSpace, name: event.target.value })} />
                  <input maxLength={200} placeholder={t('Endereço ou referência (opcional)')} aria-label={t('Endereço ou referência')} value={newSpace.address} onChange={(event) => setNewSpace({ ...newSpace, address: event.target.value })} />
                  <button className="primary" type="submit" disabled={busy === 'create-space'}><Plus size={18} /> {t('Adicionar espaço')}</button>
                </form>
              )}
            </div>

            {canManage && (
              <>
                <div className="panel">
                  <h3>{t('Gestores')}</h3>
                  <div className="table">
                    {detail.members.map((member) => (
                      <div key={member.id}>
                        <strong>{member.name}</strong>
                        <span>{member.email} · {t(roleLabel[member.role])}{member.spaceName && <> · {member.spaceName}</>}</span>
                        <button className="ghost light" type="button" disabled={busy === `member-${member.id}`} onClick={() => removeMember(member.id, member.name)}>
                          <UserMinus size={16} /> {t('Remover')}
                        </button>
                      </div>
                    ))}
                    {!detail.members.length && <p className="empty">{t('Nenhum gestor ainda. Use "Convidar gestor".')}</p>}
                  </div>
                </div>

                <div className="panel">
                  <h3>{t('Convites')}</h3>
                  <div className="table">
                    {detail.invites.map((entry) => (
                      <div key={entry.id}>
                        <strong>{entry.email}</strong>
                        <span>
                          {t(roleLabel[entry.role])}{entry.spaceName && <> · {entry.spaceName}</>} · {t(inviteStatusLabel[entry.status])} ·{' '}
                          {entry.status === 'accepted' && entry.acceptedAt ? t('aceito em {date}', { date: formatDateTime(entry.acceptedAt) }) : t('expira em {date}', { date: formatDateTime(entry.expiresAt) })}
                        </span>
                        {entry.status === 'pending' && (
                          <button className="ghost light" type="button" disabled={busy === `invite-${entry.id}`} onClick={() => revokeInvite(entry)}><X size={16} /> {t('Cancelar')}</button>
                        )}
                      </div>
                    ))}
                    {!detail.invites.length && <p className="empty">{t('Nenhum convite enviado.')}</p>}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {inviteOpen && detail && (
        <div className="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && setInviteOpen(false)}>
          <div className="panel dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title" ref={dialogRef}>
            <h3 id="invite-title">{t('Convidar gestor para {name}', { name: detail.organization.name })}</h3>
            <p className="privacy-note">{t('A pessoa recebe um link por e-mail, válido por 7 dias e de uso único. Ela entra (ou cria a conta) com este e-mail para aceitar.')}</p>
            <form className="stack" onSubmit={sendInvite}>
              <label><span>{t('E-mail')}</span><input type="email" required maxLength={160} autoFocus value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label>
              <label>
                <span>{t('Papel')}</span>
                <select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as ScopedRole })}>
                  <option value="space_manager" disabled={!activeSpaces.length}>{t('Gestor de espaço')}</option>
                  <option value="org_admin">{t('Administrador da organização')}</option>
                </select>
              </label>
              {invite.role === 'space_manager' && (
                <label>
                  <span>{t('Espaço')}</span>
                  <select required value={invite.spaceId} onChange={(event) => setInvite({ ...invite, spaceId: event.target.value })}>
                    <option value="">{t('Selecione o espaço')}</option>
                    {activeSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
              )}
              <p className="privacy-note">
                {invite.role === 'org_admin'
                  ? t('Administra todos os espaços da organização: cria espaços, convida e remove gestores, trata casos e custódia.')
                  : t('Trata reivindicações, devolução e custódia dos casos deste espaço.')}
              </p>
              <div className="confirm-actions">
                <button className="primary" type="submit" disabled={busy === 'invite'}><MailPlus size={18} /> {busy === 'invite' ? t('Enviando...') : t('Enviar convite')}</button>
                <button className="ghost light" type="button" onClick={() => setInviteOpen(false)}>{t('Cancelar')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
