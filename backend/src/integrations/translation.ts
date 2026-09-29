import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { db } from '../db/database.js'
import { HttpError } from '../utils/http.js'

export const translationLanguages = ['pt-BR', 'en-US', 'es-ES'] as const
export type TranslationLanguage = (typeof translationLanguages)[number]

const deeplTargets: Record<TranslationLanguage, string> = { 'pt-BR': 'PT-BR', 'en-US': 'EN-US', 'es-ES': 'ES' }
const libreTargets: Record<TranslationLanguage, string> = { 'pt-BR': 'pt', 'en-US': 'en', 'es-ES': 'es' }

export function translationProvider() {
  if (env.DEEPL_API_KEY) return 'deepl' as const
  if (env.LIBRETRANSLATE_URL) return 'libretranslate' as const
  return null
}

async function translateWithDeepl(texts: string[], target: TranslationLanguage) {
  // Chaves do plano gratuito terminam em ":fx" e usam outro domínio.
  const host = env.DEEPL_API_KEY!.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
  const response = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, target_lang: deeplTargets[target] }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`DeepL respondeu ${response.status}`)
  const data = (await response.json()) as { translations: Array<{ text: string }> }
  return data.translations.map((entry) => entry.text)
}

async function translateWithLibre(texts: string[], target: TranslationLanguage) {
  const response = await fetch(`${env.LIBRETRANSLATE_URL!.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'auto', target: libreTargets[target], format: 'text', api_key: env.LIBRETRANSLATE_API_KEY }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`LibreTranslate respondeu ${response.status}`)
  const data = (await response.json()) as { translatedText: string[] | string }
  return Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText]
}

/** Traduz título e descrição de um item, com cache por idioma invalidado quando o texto muda. */
export async function translateItem(item: { id: number; title: string; description: string }, target: TranslationLanguage) {
  const provider = translationProvider()
  if (!provider) throw new HttpError(503, 'Tradução automática não está configurada neste servidor.')

  const sourceHash = createHash('sha256').update(`${item.title}\n${item.description}`).digest('hex')
  const cached = db
    .prepare('SELECT title, description, provider FROM item_translations WHERE item_id = ? AND language = ? AND source_hash = ?')
    .get(item.id, target, sourceHash) as { title: string; description: string; provider: string } | undefined
  if (cached) return { ...cached, language: target, cached: true }

  let translated: string[]
  try {
    translated = provider === 'deepl' ? await translateWithDeepl([item.title, item.description], target) : await translateWithLibre([item.title, item.description], target)
  } catch (error) {
    console.error('[translation] Falha no provedor de tradução.', error)
    throw new HttpError(502, 'O serviço de tradução não respondeu. Tente novamente em instantes.')
  }
  const [title, description] = translated
  if (!title || !description) throw new HttpError(502, 'O serviço de tradução não respondeu. Tente novamente em instantes.')

  db.prepare(
    `INSERT INTO item_translations (item_id, language, source_hash, title, description, provider)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id, language) DO UPDATE SET
       source_hash = excluded.source_hash, title = excluded.title, description = excluded.description,
       provider = excluded.provider, created_at = CURRENT_TIMESTAMP`,
  ).run(item.id, target, sourceHash, title, description, provider)
  return { title, description, provider, language: target, cached: false }
}
