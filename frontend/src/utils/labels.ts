import { msg } from '../i18n'

// Textos em português marcados com msg(); traduza ao exibir com t(label).
export const statusLabel = {
  lost: msg('Perdido'),
  found: msg('Encontrado'),
  claimed: msg('Em análise'),
  returned: msg('Devolvido'),
}

export const approvalLabel = {
  pending: msg('Pendente'),
  approved: msg('Aprovado'),
  rejected: msg('Rejeitado'),
}

export const historyActionLabel: Record<string, string> = {
  'item.created': msg('Caso publicado'),
  'item.updated': msg('Caso editado'),
  'claim.created': msg('Reivindicação recebida'),
  'item.returned': msg('Devolução registrada'),
  'admin.status_changed': msg('Status alterado pela moderação'),
  'claim.rejected': msg('Reivindicação recusada'),
  'claim.withdrawn': msg('Reivindicação cancelada'),
  'item.reopened': msg('Caso reaberto'),
}

export const claimStatusLabel = {
  pending: msg('Pendente'),
  approved: msg('Aprovada'),
  rejected: msg('Não aceita'),
  withdrawn: msg('Cancelada'),
}
