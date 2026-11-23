import { db } from '../../db/database.js'
import { normalizeKey } from '../../utils/normalization.js'

/**
 * Dicionário de sinônimos da busca (Sprint 7). Cada grupo reúne termos equivalentes ("celular", "telefone",
 * "smartphone"); buscar um deles encontra casos descritos com qualquer outro. Os termos ficam normalizados
 * (sem acento, minúsculos) e podem ter mais de uma palavra ("guarda chuva").
 */
export type SynonymGroup = { id: number; terms: string[]; created_at: string; updated_at: string }

let cache: Map<string, string[]> | null = null

export function invalidateSynonyms() {
  cache = null
}

export function listSynonymGroups(): SynonymGroup[] {
  const rows = db.prepare('SELECT id, terms, created_at, updated_at FROM search_synonym_groups ORDER BY terms COLLATE NOCASE').all() as Array<{
    id: number
    terms: string
    created_at: string
    updated_at: string
  }>
  return rows.map((row) => ({ ...row, terms: JSON.parse(row.terms) as string[] }))
}

/** termo normalizado -> demais termos dos grupos em que ele aparece. */
function synonymIndex() {
  if (cache) return cache
  const index = new Map<string, string[]>()
  for (const group of listSynonymGroups()) {
    for (const term of group.terms) {
      const others = group.terms.filter((other) => other !== term)
      index.set(term, [...new Set([...(index.get(term) ?? []), ...others])])
    }
  }
  cache = index
  return index
}

/** Normaliza, remove vazios e duplicados; devolve os termos prontos para gravar. */
export function normalizeSynonymTerms(terms: string[]) {
  return [...new Set(terms.map((term) => normalizeKey(term)).filter((term) => term.length >= 2))]
}

function quote(term: string) {
  return `"${term.replaceAll('"', '""')}"*`
}

/** Plural simples do português: "chaves" também procura "chave"; "celulares", "celular". */
function singularForms(token: string) {
  const forms: string[] = []
  if (token.length > 3 && token.endsWith('s')) forms.push(token.slice(0, -1))
  if (token.length > 4 && token.endsWith('es')) forms.push(token.slice(0, -2))
  return forms
}

/**
 * Termos da busca agrupados: cada grupo traz o termo digitado (e o singular simples) e seus sinônimos.
 * Duas palavras seguidas que formam um termo do dicionário ("guarda chuva") viram um grupo só.
 */
export function queryTermGroups(value: string, maxTokens = 12) {
  const tokens = normalizeKey(value).split(' ').filter(Boolean).slice(0, maxTokens)
  const index = synonymIndex()
  const groups: Array<{ terms: string[]; synonyms: string[] }> = []
  for (let position = 0; position < tokens.length; position += 1) {
    const token = tokens[position]
    const pair = position + 1 < tokens.length ? `${token} ${tokens[position + 1]}` : null
    let term = token
    if (pair && index.has(pair)) {
      term = pair
      position += 1
    }
    const lookups = [term, ...(term === token ? singularForms(token) : [])]
    const synonyms = new Set<string>()
    for (const lookup of lookups) for (const synonym of index.get(lookup) ?? []) synonyms.add(synonym)
    for (const lookup of lookups) synonyms.delete(lookup)
    groups.push({ terms: lookups, synonyms: [...synonyms] })
  }
  return groups
}

export type ExpandedQuery = {
  /** Expressão FTS5: grupos (termo OU sinônimos) unidos por AND; vazio quando não há termo pesquisável. */
  match: string
  /** Sinônimos acrescentados à busca, para a interface explicar o resultado. */
  synonyms: string[]
}

/**
 * Monta a consulta FTS5 com prefixo e sinônimos. Cada palavra digitada vira um grupo
 * `("celular"* OR "telefone"* OR "smartphone"*)`; duas palavras seguidas que formam um termo do
 * dicionário ("guarda chuva") são tratadas como um termo só.
 */
export function expandSearchQuery(value: string, maxTokens = 12): ExpandedQuery {
  const groups = queryTermGroups(value, maxTokens)
  const match = groups.map((group) => {
    const alternatives = [...new Set([...group.terms, ...group.synonyms])].map(quote)
    return alternatives.length > 1 ? `(${alternatives.join(' OR ')})` : alternatives[0]
  })
  return { match: match.join(' AND '), synonyms: [...new Set(groups.flatMap((group) => group.synonyms))] }
}
