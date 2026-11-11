import { z } from 'zod'
import type { $ZodRawIssue } from 'zod/v4/core'

/**
 * Mensagens de validação em português claro. O padrão do Zod é inglês técnico ("Too small: expected string to
 * have >=3 characters"), e essas mensagens chegam à pessoa nos formulários da web e do app. Mensagens definidas
 * no próprio schema (ex.: `.min(3, '...')` ou `refine`) continuam valendo: este mapa só cobre as demais.
 * Os textos com número seguem padrões fixos que a web traduz (frontend/src/services/api.ts).
 */
export function friendlyValidationMessage(issue: $ZodRawIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined || issue.input === null ? 'Campo obrigatório.' : 'Valor em formato inválido.'
    case 'too_small': {
      const min = Number(issue.minimum)
      if (issue.origin === 'string') return min <= 1 ? 'Campo obrigatório.' : `Use pelo menos ${min} caracteres.`
      if (issue.origin === 'array' || issue.origin === 'set') return `Selecione pelo menos ${min} itens.`
      return issue.inclusive === false ? `Use um valor maior que ${min}.` : `O valor mínimo é ${min}.`
    }
    case 'too_big': {
      const max = Number(issue.maximum)
      if (issue.origin === 'string') return `Use no máximo ${max} caracteres.`
      if (issue.origin === 'array' || issue.origin === 'set') return `Selecione no máximo ${max} itens.`
      return issue.inclusive === false ? `Use um valor menor que ${max}.` : `O valor máximo é ${max}.`
    }
    case 'invalid_format':
      if (issue.format === 'email') return 'Informe um e-mail válido.'
      if (issue.format === 'url') return 'Informe um endereço válido (http ou https).'
      return 'Formato inválido.'
    case 'invalid_value':
      return 'Escolha uma das opções disponíveis.'
    default:
      return 'Valor inválido.'
  }
}

z.config({ customError: friendlyValidationMessage })
