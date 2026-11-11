import { db } from './database.js'

type Effect = () => void

let pendingEffects: Effect[] | null = null

/**
 * Agenda um efeito externo (push, rede, arquivo) para depois do commit da transação em curso.
 * Fora de `atomic`, executa imediatamente.
 */
export function afterCommit(effect: Effect) {
  if (pendingEffects) pendingEffects.push(effect)
  else effect()
}

/**
 * Executa `fn` em transação IMMEDIATE (trava de escrita antes de ler) e só dispara os efeitos
 * agendados com `afterCommit` se a transação for confirmada. Em erro, nada é gravado nem enviado.
 */
export function atomic<T>(fn: () => T): T {
  if (pendingEffects) return fn()
  const effects: Effect[] = []
  pendingEffects = effects
  let result: T
  try {
    result = db.transaction(fn).immediate()
  } finally {
    pendingEffects = null
  }
  for (const effect of effects) {
    try {
      effect()
    } catch (error) {
      console.error('[after-commit] Falha em efeito posterior ao commit.', error instanceof Error ? error.message : 'erro desconhecido')
    }
  }
  return result
}
