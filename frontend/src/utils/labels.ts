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
  'moderation.auto_hidden': msg('Ocultado automaticamente por denúncias'),
  'custody.received': msg('Recebido no espaço'),
  'custody.stored': msg('Guardado'),
  'custody.transferred': msg('Transferido'),
  'custody.handed_over': msg('Entregue'),
  'custody.disposed': msg('Destinação final'),
  'custody.note': msg('Anotação de custódia'),
}

export const roleLabel: Record<string, string> = {
  user: msg('Usuário'),
  citizen: msg('Cidadão'),
  space_manager: msg('Gestor de espaço'),
  org_admin: msg('Administrador da organização'),
  moderator: msg('Moderador'),
  support: msg('Suporte'),
  admin: msg('Administrador'),
}

export const custodyStateLabel = {
  none: msg('Sem registro de custódia'),
  in_custody: msg('Sob custódia'),
  in_transit: msg('Em trânsito'),
  handed_over: msg('Entregue'),
  disposed: msg('Destinação final'),
}

export const custodyEventLabel = {
  received: msg('Recebido no espaço'),
  stored: msg('Guardado'),
  transferred: msg('Transferido'),
  handed_over: msg('Entregue'),
  disposed: msg('Destinação final'),
  note: msg('Anotação'),
}

export const claimStatusLabel = {
  pending: msg('Pendente'),
  approved: msg('Aprovada'),
  rejected: msg('Não aceita'),
  withdrawn: msg('Cancelada'),
}
