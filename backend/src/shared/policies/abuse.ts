/**
 * A pontuação anti-spam (`users.spam_score`, 0-10) é MANUAL: só a administração a altera, com registro
 * em auditoria. Não há detecção automática. A partir deste valor a conta não publica novos itens.
 */
export const publishingRestrictionScore = 5

export const publishingRestrictedMessage = 'Sua conta está com restrição de publicação aplicada manualmente pela moderação.'

export function isPublishingRestricted(spamScore: number | null | undefined) {
  return (spamScore ?? 0) >= publishingRestrictionScore
}
