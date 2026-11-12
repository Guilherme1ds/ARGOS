import express, { type Express, type Request, type Response } from 'express'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib'
import { env } from '../config/env.js'
import { db } from '../db/database.js'

/**
 * Serve o build da web (frontend/dist) pela própria API: um serviço só, no mesmo domínio, como exige o cookie
 * de sessão (SameSite=Lax). Cuida do que um proxy faria para a SPA: rotas do React com index.html, cache longo
 * dos arquivos com hash, compressão, cabeçalhos de segurança da página, robots.txt, sitemap.xml e as
 * pré-visualizações de link (Open Graph) dos casos públicos.
 */

/** Rotas de frontend/src/App.tsx (um teste compara as duas listas). Outros caminhos recebem a página com 404. */
export const webRoutes = [
  '/',
  '/items',
  '/items/new',
  '/items/:id',
  '/items/:id/edit',
  '/map',
  '/login',
  '/reset-password',
  '/verify-email',
  '/privacy',
  '/help',
  '/dashboard',
  '/my-items',
  '/notifications',
  '/profile',
  '/settings',
  '/admin',
] as const

/** Telas de conta ou de uso único: fora dos buscadores (robots.txt + noindex na página). */
const privateRoutes = ['/items/new', '/dashboard', '/my-items', '/notifications', '/profile', '/settings', '/admin', '/reset-password', '/verify-email']
const sitemapRoutes = ['/', '/items', '/map', '/help', '/privacy']

const siteTitle = 'ARGOS - Achados e perdidos'
const siteDescription =
  'Publique o que você perdeu ou encontrou, busque por local e categoria e devolva objetos com reivindicação protegida.'
const pageTitles: Record<string, string> = {
  '/items': 'Buscar itens perdidos e encontrados',
  '/map': 'Mapa de casos',
  '/help': 'Como funciona',
  '/privacy': 'Resumo de privacidade',
  '/login': 'Entrar',
}

const routeMatchers = webRoutes.map((route) => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}/?$`))
const metaBlock = /<!--argos:meta-->[\s\S]*?<!--\/argos:meta-->/
const compressible = /\.(js|mjs|css|svg|json|txt|map)$/i

const brotliAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

type PageMeta = {
  title: string
  description: string
  path: string | null
  image?: string
  imageAlt?: string
  noindex?: boolean
}

type ItemPreview = {
  id: number
  type: 'lost' | 'found'
  status: 'lost' | 'found' | 'claimed' | 'returned'
  title: string
  description: string
  location: string
  image_url: string | null
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, '')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

/** Texto de uma linha, sem caracteres de controle, cortado em `max` caracteres (sem partir emojis). */
function plain(value: string, max: number) {
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text
}

function isHttps(url: string) {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function originOf(url: string) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** CSP da página: só o que a web usa (mapa do OpenStreetMap; Google e Turnstile quando ligados). */
export function webContentSecurityPolicy() {
  const apiOrigin = originOf(env.API_PUBLIC_URL)
  const extra = apiOrigin && apiOrigin !== originOf(env.FRONTEND_URL) ? ` ${apiOrigin}` : ''
  const directives = [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com",
    `img-src 'self' data: blob: https://tile.openstreetmap.org${extra}`,
    "font-src 'self' data:",
    `connect-src 'self' https://accounts.google.com${extra}`,
    'frame-src https://accounts.google.com https://challenges.cloudflare.com',
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]
  if (isHttps(env.FRONTEND_URL)) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

function knownRoute(path: string) {
  return routeMatchers.some((matcher) => matcher.test(path))
}

function isPrivateRoute(path: string) {
  return privateRoutes.some((route) => path === route || path.startsWith(`${route}/`)) || /^\/items\/[^/]+\/edit\/?$/.test(path)
}

function itemPreview(id: number) {
  try {
    return db
      .prepare(
        `SELECT id, type, status, title, description, location, image_url FROM items
         WHERE id = ? AND approval_status = 'approved'`,
      )
      .get(id) as ItemPreview | undefined
  } catch {
    return undefined
  }
}

function itemMeta(item: ItemPreview): PageMeta {
  const label = item.status === 'returned' ? 'Devolvido' : item.type === 'found' ? 'Encontrado' : 'Perdido'
  const title = `${label}: ${plain(item.title, 90)} · ARGOS`
  const description = plain(`${item.location} · ${item.description}`, 200)
  // Mesma regra do DTO público: só arquivos do diretório de uploads.
  const image = item.image_url && /^\/uploads\/[\w.-]+$/.test(item.image_url) ? `${trimSlash(env.API_PUBLIC_URL)}${item.image_url}` : undefined
  // Casos mudam e somem depois da devolução: o link compartilhado mostra a prévia, mas os buscadores não indexam.
  return { title, description, path: `/items/${item.id}`, image, imageAlt: image ? plain(item.title, 120) : undefined, noindex: true }
}

/** Metadados da página pedida e o status HTTP (404 para rota desconhecida ou caso inexistente/não público). */
function pageFor(path: string): { meta: PageMeta; status: number } {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path
  if (!knownRoute(normalized)) {
    return { meta: { title: `Página não encontrada · ARGOS`, description: siteDescription, path: null, noindex: true }, status: 404 }
  }
  const itemMatch = /^\/items\/([^/]+)$/.exec(normalized)
  if (itemMatch && itemMatch[1] !== 'new') {
    const item = /^\d{1,12}$/.test(itemMatch[1]) ? itemPreview(Number(itemMatch[1])) : undefined
    if (!item) return { meta: { title: `Caso não encontrado · ARGOS`, description: siteDescription, path: null, noindex: true }, status: 404 }
    return { meta: itemMeta(item), status: 200 }
  }
  const pageTitle = pageTitles[normalized]
  return {
    meta: {
      title: pageTitle ? `${pageTitle} · ARGOS` : siteTitle,
      description: siteDescription,
      path: normalized,
      noindex: isPrivateRoute(normalized),
    },
    status: 200,
  }
}

export function renderMeta(meta: PageMeta) {
  const base = trimSlash(env.FRONTEND_URL)
  const image = meta.image ?? `${base}/icons/og-image.png`
  const url = meta.path === null ? null : `${base}${meta.path === '/' ? '/' : meta.path}`
  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    meta.noindex || env.NODE_ENV === 'staging' ? '<meta name="robots" content="noindex" />' : '',
    url ? `<link rel="canonical" href="${escapeHtml(url)}" />` : '',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="ARGOS" />',
    '<meta property="og:locale" content="pt_BR" />',
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    url ? `<meta property="og:url" content="${escapeHtml(url)}" />` : '',
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    meta.imageAlt ? `<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt)}" />` : '',
    '<meta name="twitter:card" content="summary_large_image" />',
  ]
    .filter(Boolean)
    .join('\n    ')
}

function robotsTxt() {
  if (env.NODE_ENV === 'staging') return 'User-agent: *\nDisallow: /\n'
  const lines = ['User-agent: *', ...privateRoutes.map((route) => `Disallow: ${route}`), 'Disallow: /items/*/edit', 'Disallow: /api/', '']
  lines.push(`Sitemap: ${trimSlash(env.FRONTEND_URL)}/sitemap.xml`, '')
  return lines.join('\n')
}

function sitemapXml() {
  const base = trimSlash(env.FRONTEND_URL)
  const urls = sitemapRoutes.map((route) => `  <url><loc>${escapeHtml(`${base}${route}`)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Codificação aceita pelo cliente, preferindo brotli; ignora as marcadas com q=0. */
function preferredEncoding(header: string | undefined): 'br' | 'gzip' | null {
  const accepted = new Set<string>()
  for (const part of (header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    const quality = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean)
    if (name && (quality === undefined || Number(quality) > 0)) accepted.add(name)
  }
  if (accepted.has('br')) return 'br'
  if (accepted.has('gzip') || accepted.has('*')) return 'gzip'
  return null
}

function setPageHeaders(res: Response) {
  res.setHeader('Content-Security-Policy', webContentSecurityPolicy())
  // O login com Google abre uma janela que precisa falar com a página.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  // Os servidores de mapa do OpenStreetMap exigem a origem no Referer.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Cache-Control', 'no-cache')
  if (env.NODE_ENV === 'staging') res.setHeader('X-Robots-Tag', 'noindex, nofollow')
}

export type Website = { ready: Promise<void> }

export function mountWebsite(app: Express, distDir: string): Website {
  const root = resolve(distDir)
  const indexPath = join(root, 'index.html')
  if (!existsSync(indexPath)) {
    throw new Error(`WEB_DIST_DIR: index.html não encontrado em ${root}. Rode o build da web (npm run build --prefix frontend).`)
  }
  const template = readFileSync(indexPath, 'utf8')
  if (!metaBlock.test(template)) {
    console.warn('[web] index.html sem o bloco <!--argos:meta-->: títulos e prévias de link ficam com o texto padrão.')
  }
  const assetsDir = join(root, 'assets')

  // Arquivos com hash nunca mudam: comprime uma vez, em segundo plano (pool do libuv), e guarda em memória.
  const compressed = new Map<string, { br: Buffer; gzip: Buffer }>()
  const ready = (async () => {
    if (!existsSync(assetsDir)) return
    for (const name of readdirSync(assetsDir)) {
      const path = join(assetsDir, name)
      if (!compressible.test(name) || !statSync(path).isFile()) continue
      const raw = readFileSync(path)
      if (raw.length < 1024) continue
      const [br, gz] = await Promise.all([
        brotliAsync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
        gzipAsync(raw, { level: 9 }),
      ])
      compressed.set(name, { br, gzip: gz })
    }
  })().catch(() => console.error('[web] Falha ao comprimir os arquivos da web; eles seguem sem compressão.'))

  const sendPage = (req: Request, res: Response) => {
    const { meta, status } = pageFor(req.path)
    const html = template.replace(metaBlock, () => `<!--argos:meta-->\n    ${renderMeta(meta)}\n    <!--/argos:meta-->`)
    setPageHeaders(res)
    res.status(status).type('html').send(html)
  }

  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.type('text/plain').send(robotsTxt())
  })
  app.get('/sitemap.xml', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.type('application/xml').send(sitemapXml())
  })
  // Sem esta rota, /index.html sairia como arquivo estático, sem a CSP da página nem os metadados.
  app.get('/index.html', (_req, res) => res.redirect(301, '/'))

  app.get('/assets/:name', (req, res, next) => {
    const entry = compressed.get(req.params.name)
    const encoding = entry ? preferredEncoding(req.header('accept-encoding')) : null
    if (!entry || !encoding) return next()
    const body = entry[encoding]
    res.setHeader('Content-Encoding', encoding)
    res.setHeader('Vary', 'Accept-Encoding')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('Content-Length', String(body.length))
    res.type(extname(req.params.name))
    res.end(req.method === 'HEAD' ? undefined : body)
  })

  app.use(
    express.static(root, {
      index: false,
      redirect: false,
      dotfiles: 'ignore',
      setHeaders: (res, path) => {
        if (path.startsWith(`${assetsDir}${sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          if (compressible.test(path)) res.setHeader('Vary', 'Accept-Encoding')
        } else if (path.endsWith(`${sep}sw.js`)) {
          // O navegador precisa ver logo a versão nova do service worker.
          res.setHeader('Cache-Control', 'no-cache')
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400')
        }
      },
    }),
  )

  // Rotas do React: qualquer GET sem extensão fora da API recebe a página (com o status certo).
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (/^\/(api|uploads|health)(\/|$)/.test(req.path) || extname(req.path)) return next()
    sendPage(req, res)
  })

  // Arquivo inexistente (ex.: /assets/tela-antiga.js depois de uma atualização): 404 de verdade, nunca a página,
  // para a web mostrar "Não foi possível abrir esta tela" em vez de tentar executar HTML como script.
  app.use((req, res, next) => {
    if (/^\/(api|health)(\/|$)/.test(req.path)) return next()
    res.status(404).type('text/plain').send('Não encontrado.')
  })

  return { ready }
}
