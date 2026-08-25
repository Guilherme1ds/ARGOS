export const publicTextSafetyMessage =
  'Não publique e-mail, telefone, documento completo ou provas sensíveis em campos públicos. Use o fluxo privado de reivindicação.'

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const phonePattern = /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}/
const cpfPattern = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/

function hasDocumentLikeSequence(value: string) {
  const matches = value.match(/\d[\d\s.-]{9,}\d/g) ?? []
  return matches.some((match) => match.replace(/\D/g, '').length >= 11)
}

export function containsPublicSensitiveInfo(value: string | null | undefined) {
  if (!value) return false
  return emailPattern.test(value) || phonePattern.test(value) || cpfPattern.test(value) || hasDocumentLikeSequence(value)
}
