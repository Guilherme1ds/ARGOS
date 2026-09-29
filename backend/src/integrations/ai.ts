import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { z } from 'zod'
import { env } from '../config/env.js'
import { HttpError } from '../utils/http.js'

// Categorias sugeridas no formulário web; a IA escolhe uma delas.
export const itemCategories = ['Documentos', 'Chaves', 'Eletrônicos', 'Bolsas e mochilas', 'Vestuário', 'Materiais escolares', 'Outros'] as const

const suggestionSchema = z.object({
  title: z.string().trim().min(3).max(120),
  category: z.enum(itemCategories),
  description: z.string().trim().min(10).max(2000),
  color: z.string().trim().max(60),
  distinctiveFeatures: z.array(z.string().trim().max(120)).max(8),
})

export type ItemSuggestion = z.infer<typeof suggestionSchema>

// JSON Schema equivalente, exigido pela saída estruturada da API.
const outputSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Título curto do objeto, em português, sem dados pessoais.' },
    category: { type: 'string', enum: [...itemCategories] },
    description: { type: 'string', description: 'Descrição pública em português com 2 a 4 frases.' },
    color: { type: 'string', description: 'Cor predominante em português.' },
    distinctiveFeatures: { type: 'array', items: { type: 'string' }, description: 'Marcas visíveis que ajudam a reconhecer o objeto.' },
  },
  required: ['title', 'category', 'description', 'color', 'distinctiveFeatures'],
  additionalProperties: false,
} as const

const systemPrompt = `Você ajuda a cadastrar objetos perdidos ou encontrados em um campus escolar.
Descreva apenas o objeto da foto, em português do Brasil, de forma objetiva, para uma publicação pública.
Nunca transcreva nomes, números de documentos, telefones, e-mails, placas ou outros dados pessoais visíveis:
se houver algum, diga apenas que o objeto tem uma identificação, sem reproduzi-la.
Se a foto não mostrar um objeto identificável, use a categoria "Outros" e explique na descrição o que dá para ver.`

const mediaTypes = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as const

let client: Anthropic | null = null

export function aiEnabled() {
  return Boolean(env.ANTHROPIC_API_KEY)
}

function getClient() {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Sugestões com IA não estão configuradas neste servidor.')
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 })
  return client
}

/** Lê uma imagem já enviada (e sanitizada) pelo upload do ARGOS e pede sugestões ao Claude. */
export async function suggestItemFromImage(uploadUrl: string): Promise<ItemSuggestion> {
  const filename = basename(uploadUrl)
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase() as keyof typeof mediaTypes
  const mediaType = mediaTypes[extension]
  if (!mediaType) throw new HttpError(422, 'Use uma imagem JPEG, PNG ou WebP.')
  const image = await readFile(resolve(env.UPLOAD_DIR, filename))

  const response = await getClient().beta.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    // Recusa do classificador de segurança: a API tenta de novo no modelo recomendado.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: systemPrompt,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: outputSchema } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
          { type: 'text', text: 'Sugira título, categoria e descrição para publicar este objeto no ARGOS.' },
        ],
      },
    ],
  })

  if (response.stop_reason === 'refusal') throw new HttpError(422, 'A IA não conseguiu analisar esta foto. Preencha os campos manualmente.')
  const text = response.content.find((block) => block.type === 'text')
  if (!text || text.type !== 'text') throw new HttpError(502, 'A IA não retornou sugestões. Tente novamente.')

  let json: unknown = null
  try {
    json = JSON.parse(text.text)
  } catch {
    // Tratado abaixo como resposta inválida.
  }
  const parsed = suggestionSchema.safeParse(json)
  if (!parsed.success) throw new HttpError(502, 'A IA não retornou sugestões. Tente novamente.')
  return parsed.data
}
