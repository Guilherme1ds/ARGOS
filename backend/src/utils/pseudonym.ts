import { createHmac } from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Identificador estável e não reversível para um e-mail em trilhas de auditoria (ex.: login falho).
 * Permite correlacionar tentativas sem guardar o endereço; muda se JWT_SECRET for trocado.
 */
export function pseudonymizeEmail(email: string) {
  const digest = createHmac('sha256', `audit-pseudonym:${env.JWT_SECRET}`).update(email.trim().toLowerCase()).digest('hex')
  return `email:${digest.slice(0, 24)}`
}

/** Mostra só o necessário para depurar envio local: primeira letra e domínio. */
export function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 1)}***@${domain}`
}
