import { api } from './api'

/** Casos que a pessoa acompanha (para os botões "Acompanhar" do mural e da grade mostrarem o estado real). */
export async function fetchFollowedIds() {
  const ids = new Set<number>()
  // Limite de segurança: 20 páginas de 50 casos.
  for (let page = 1; page <= 20; page += 1) {
    const response = await api.get<{ data: Array<{ id: number }>; meta?: { total?: number } }>('/items/following', { params: { page, limit: 50 } })
    for (const row of response.data.data) ids.add(row.id)
    const total = Number(response.data.meta?.total ?? 0)
    if (!response.data.data.length || ids.size >= total) break
  }
  return ids
}
