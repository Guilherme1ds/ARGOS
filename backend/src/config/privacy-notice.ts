import { env } from './env.js'

/**
 * Fonte única do resumo de privacidade exibido na web e no app. A versão é definida aqui, no servidor:
 * o aceite gravado sempre usa esta versão. Qualquer mudança de texto exige nova versão e revisão
 * do responsável pela privacidade (o texto não substitui o aviso jurídico oficial).
 */
export const privacyNotice = {
  version: '2026-11-05',
  controller: 'ARGOS',
  purposes: [
    'Cadastro e autenticação',
    'Publicação e busca de itens perdidos ou encontrados',
    'Reivindicação e validação de propriedade',
    'Comunicações operacionais e notificações',
    'Auditoria, segurança e prevenção a fraude',
  ],
  publicDataPolicy:
    'A busca pública mostra apenas dados minimizados do item. E-mail, evidências, histórico interno e dados sensíveis ficam restritos a usuários autorizados.',
  // Cada direito aponta para a ação real disponível no produto.
  // Exportação, exclusão e preferências de notificação existem na web; o app mostra o mesmo texto.
  userRights: [
    'Acesso e portabilidade: baixe seus dados na web, em Configurações > Exportar meus dados.',
    'Correção: edite seus dados no Perfil (web ou app).',
    'Revogação do consentimento e exclusão: use Excluir conta nas Configurações da web; dados que precisam ser mantidos ficam anonimizados.',
    'Notificações por e-mail e no navegador podem ser desligadas a qualquer momento nas Configurações da web.',
  ],
  externalProcessors:
    'Sugestão por IA (foto) e tradução só enviam conteúdo a provedores externos quando você aciona esses recursos e eles estão habilitados no servidor.',
} as const

export type RetentionRule = {
  data: string
  /** Prazo em dias aplicado pelo expurgo automático; null quando a regra é descrita em `note`. */
  days: number | null
  note: string | null
}

/** Prazos efetivamente aplicados pelo servidor (0 na configuração = mantido até decisão do responsável). */
export function retentionSummary(): RetentionRule[] {
  const configured = (data: string, value: number, keptNote: string): RetentionRule =>
    value > 0 ? { data, days: value, note: null } : { data, days: null, note: keptNote }
  return [
    { data: 'Corpo dos e-mails (links de confirmação e de senha)', days: null, note: 'Apagado logo após o envio ou a expiração do link' },
    configured('Registro de e-mails enviados (destinatário e assunto)', env.MAIL_OUTBOX_RETENTION_DAYS, 'Mantido até definição de prazo pelo responsável'),
    configured('Links de confirmação de e-mail e de redefinição de senha usados ou expirados', env.AUTH_TOKEN_RETENTION_DAYS, 'Mantido até definição de prazo pelo responsável'),
    configured('Solicitações de acesso já avaliadas', env.ACCESS_REQUEST_RETENTION_DAYS, 'Mantido até definição de prazo pelo responsável'),
    configured('Trilha de auditoria e segurança (pseudonimizada após exclusão de conta)', env.AUDIT_LOG_RETENTION_DAYS, 'Mantido até definição de prazo pelo responsável'),
    { data: 'Registro de aceite e revogação do aviso de privacidade', days: null, note: 'Mantido como prova, inclusive após a exclusão da conta' },
  ]
}
