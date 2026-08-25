import { db } from '../../db/database.js'
import { notify } from '../../utils/audit.js'
import { normalizeKey } from '../../utils/normalization.js'

type MatchableItem = {
  id: number
  owner_id: number
  type: 'lost' | 'found'
  title: string
  description: string
  category_key: string
  location_key: string
  campus_block: string | null
  approximate_place: string | null
  event_date: string
  status: 'lost' | 'found' | 'claimed' | 'returned'
  approval_status: 'pending' | 'approved' | 'rejected'
  image_url: string | null
  image_checksum: string | null
}

type SavedSearchQuery = {
  q?: string
  type?: 'lost' | 'found'
  category?: string
  location?: string
  status?: MatchableItem['status']
  from?: string
  to?: string
  hasImage?: boolean | 'true' | 'false'
}

function tokens(value: string | null | undefined) {
  return new Set(normalizeKey(value).split(' ').filter((token) => token.length > 2))
}

function overlapCount(left: Set<string>, right: Set<string>) {
  let count = 0
  for (const value of left) if (right.has(value)) count += 1
  return count
}

function scoreMatch(source: MatchableItem, candidate: MatchableItem) {
  let score = 35
  const reasons = ['mesma categoria']
  const dateDistance = Math.abs(
    Math.round((new Date(`${source.event_date}T00:00:00Z`).getTime() - new Date(`${candidate.event_date}T00:00:00Z`).getTime()) / 86_400_000),
  )
  if (dateDistance <= 2) {
    score += 30
    reasons.push('data muito próxima')
  } else if (dateDistance <= 7) {
    score += 20
    reasons.push('data próxima')
  } else {
    score += 10
    reasons.push('data no intervalo')
  }

  if (source.location_key && source.location_key === candidate.location_key) {
    score += 20
    reasons.push('mesmo local')
  } else if (overlapCount(tokens(source.location_key), tokens(candidate.location_key)) > 0) {
    score += 10
    reasons.push('local semelhante')
  }

  if (source.campus_block && normalizeKey(source.campus_block) === normalizeKey(candidate.campus_block)) {
    score += 15
    reasons.push('mesmo bloco ou setor')
  }

  const textOverlap = overlapCount(
    tokens(`${source.title} ${source.description}`),
    tokens(`${candidate.title} ${candidate.description}`),
  )
  if (textOverlap >= 3) {
    score += 20
    reasons.push('descrição muito semelhante')
  } else if (textOverlap > 0) {
    score += 10
    reasons.push('descrição semelhante')
  }

  if (source.image_checksum && source.image_checksum === candidate.image_checksum) {
    score += 25
    reasons.push('mesma imagem sanitizada')
  }

  return { score: Math.min(score, 100), reasons }
}

export function discoverItemMatches(itemId: number) {
  const source = db
    .prepare('SELECT items.*, uploads.checksum AS image_checksum FROM items LEFT JOIN uploads ON uploads.url = items.image_url WHERE items.id = ?')
    .get(itemId) as MatchableItem | undefined
  if (!source || source.approval_status !== 'approved' || source.status === 'returned') return []

  const candidates = db
    .prepare(
      `SELECT items.*, uploads.checksum AS image_checksum
       FROM items LEFT JOIN uploads ON uploads.url = items.image_url
       WHERE items.id <> ? AND items.type <> ? AND items.approval_status = 'approved' AND items.status <> 'returned'
         AND items.category_key = ? AND ABS(julianday(items.event_date) - julianday(?)) <= 30
       ORDER BY ABS(julianday(items.event_date) - julianday(?)) ASC
       LIMIT 100`,
    )
    .all(source.id, source.type, source.category_key, source.event_date, source.event_date) as MatchableItem[]

  const matches: Array<{ itemId: number; score: number; reasons: string[] }> = []
  for (const candidate of candidates) {
    const match = scoreMatch(source, candidate)
    if (match.score < 55) continue
    const firstId = Math.min(source.id, candidate.id)
    const secondId = Math.max(source.id, candidate.id)
    const result = db
      .prepare('INSERT OR IGNORE INTO item_matches (item_id, matched_item_id, score, reasons) VALUES (?, ?, ?, ?)')
      .run(firstId, secondId, match.score, JSON.stringify(match.reasons))
    matches.push({ itemId: candidate.id, ...match })

    if (result.changes > 0 && source.owner_id !== candidate.owner_id) {
      notify(source.owner_id, 'Possível correspondência', `Encontramos um caso compatível com "${source.title}".`, 'match', `/items/${candidate.id}`)
      notify(candidate.owner_id, 'Possível correspondência', `Surgiu um caso compatível com "${candidate.title}".`, 'match', `/items/${source.id}`)
    }
  }
  return matches
}

function itemMatchesSavedSearch(item: MatchableItem, query: SavedSearchQuery) {
  if (query.type && item.type !== query.type) return false
  if (query.status && item.status !== query.status) return false
  if (query.category && item.category_key !== normalizeKey(query.category)) return false
  const locationHaystack = normalizeKey(`${item.location_key} ${item.campus_block ?? ''} ${item.approximate_place ?? ''}`)
  if (query.location && !locationHaystack.includes(normalizeKey(query.location))) return false
  if (query.from && item.event_date < query.from) return false
  if (query.to && item.event_date > query.to) return false
  const hasImage = Boolean(item.image_url)
  if (query.hasImage !== undefined && hasImage !== (query.hasImage === true || query.hasImage === 'true')) return false
  if (query.q) {
    const haystack = normalizeKey(
      `${item.title} ${item.description} ${item.category_key} ${locationHaystack}`,
    )
    const queryTokens = normalizeKey(query.q).split(' ').filter(Boolean)
    if (!queryTokens.every((token) => haystack.includes(token))) return false
  }
  return true
}

export function notifySavedSearches(itemId: number) {
  const item = db
    .prepare('SELECT items.*, uploads.checksum AS image_checksum FROM items LEFT JOIN uploads ON uploads.url = items.image_url WHERE items.id = ?')
    .get(itemId) as MatchableItem | undefined
  if (!item || item.approval_status !== 'approved') return
  const searches = db
    .prepare('SELECT id, user_id, name, query_json FROM saved_searches WHERE enabled = 1 AND user_id <> ?')
    .all(item.owner_id) as Array<{ id: number; user_id: number; name: string; query_json: string }>

  for (const search of searches) {
    let query: SavedSearchQuery
    try {
      query = JSON.parse(search.query_json) as SavedSearchQuery
    } catch {
      continue
    }
    if (!itemMatchesSavedSearch(item, query)) continue
    const result = db
      .prepare('INSERT OR IGNORE INTO saved_search_matches (saved_search_id, item_id) VALUES (?, ?)')
      .run(search.id, item.id)
    if (result.changes > 0) {
      notify(search.user_id, 'Novo item na pesquisa salva', `"${item.title}" corresponde à pesquisa "${search.name}".`, 'saved_search', `/items/${item.id}`)
    }
  }
}
