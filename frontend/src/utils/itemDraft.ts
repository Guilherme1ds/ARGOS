/**
 * Rascunho do formulário de publicação guardado na aba (sessionStorage), separado por conta.
 * Cobre sessão expirada (a rota protegida leva ao login e volta) e recarregamento acidental.
 * Guarda só os textos públicos do caso e a marcação do mapa; a foto nunca é armazenada.
 * O logout e a exclusão de conta removem os rascunhos (computador compartilhado).
 */
const prefix = 'argos.itemDraft.'
const maxAgeMs = 24 * 60 * 60 * 1000
const textFields = ['type', 'title', 'description', 'category', 'location', 'campusBlock', 'approximatePlace', 'eventDate'] as const

type DraftForm = Partial<Record<(typeof textFields)[number], string>>
type DraftPosition = { latitude: number; longitude: number } | null
export type ItemDraft = { form: DraftForm; position: DraftPosition }

export function itemDraftKey(userId: number) {
  return `${prefix}${userId}`
}

export function readItemDraft(key: string): ItemDraft | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: number; form?: Record<string, unknown>; position?: unknown }
    if (!parsed.savedAt || Date.now() - parsed.savedAt > maxAgeMs || !parsed.form) {
      sessionStorage.removeItem(key)
      return null
    }
    const form: DraftForm = {}
    for (const field of textFields) {
      const value = parsed.form[field]
      if (typeof value === 'string') form[field] = value.slice(0, 2000)
    }
    const position = parsed.position as DraftPosition
    const validPosition =
      position && typeof position.latitude === 'number' && typeof position.longitude === 'number' ? { latitude: position.latitude, longitude: position.longitude } : null
    // Sem nada escrito, não há o que recuperar.
    if (!Object.values(form).some((value) => value && value.trim()) && !validPosition) return null
    return { form, position: validPosition }
  } catch {
    return null
  }
}

export function saveItemDraft(key: string, draft: { form: DraftForm; position: DraftPosition }) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), form: draft.form, position: draft.position }))
  } catch {
    // Sem armazenamento disponível: o formulário continua funcionando, só sem rascunho.
  }
}

export function clearItemDraft(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Ignorado: armazenamento indisponível.
  }
}

export function clearAllItemDrafts(exceptUserId?: number) {
  try {
    const keep = exceptUserId === undefined ? null : itemDraftKey(exceptUserId)
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix) && key !== keep) sessionStorage.removeItem(key)
  } catch {
    // Ignorado: armazenamento indisponível.
  }
}
