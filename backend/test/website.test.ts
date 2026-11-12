import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { get as httpGet, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { startHarness, type Harness } from './support/harness.js'

// Web servida pela própria API (WEB_DIST_DIR): rotas da SPA, cache, compressão, cabeçalhos da página,
// robots/sitemap e prévias de link sem dados privados.
let h: Harness
let website: { ready: Promise<void> }
const dist = join(tmpdir(), `argos-web-dist-${Date.now()}-${process.pid}`)
const site = 'https://argos.campus.example'
const bundle = `console.log(${JSON.stringify('ARGOS '.repeat(800))})\n`

/** GET sem descompressão automática (o supertest descompacta gzip/br e esconderia o corpo real). */
function rawGet(path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolveRequest, reject) => {
    const server = h.app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      httpGet({ host: '127.0.0.1', port, path, headers }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          server.close()
          resolveRequest({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
        })
      }).on('error', (error) => {
        server.close()
        reject(error)
      })
    })
  })
}

beforeAll(async () => {
  mkdirSync(join(dist, 'assets'), { recursive: true })
  mkdirSync(join(dist, 'icons'), { recursive: true })
  writeFileSync(
    join(dist, 'index.html'),
    `<!doctype html>
<html lang="pt-BR">
  <head>
    <!--argos:meta-->
    <title>ARGOS - Achados e perdidos</title>
    <!--/argos:meta-->
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`,
  )
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), bundle)
  writeFileSync(join(dist, 'sw.js'), 'self.addEventListener("push", () => {})\n')
  writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"ARGOS"}\n')
  writeFileSync(join(dist, 'icons', 'og-image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  h = await startHarness('website', {
    WEB_DIST_DIR: dist,
    FRONTEND_URL: site,
    API_PUBLIC_URL: site,
    SUPPORT_EMAIL: 'ajuda@campus.example',
  })
  website = ((await import('../src/app.js')) as { website: { ready: Promise<void> } }).website
})

afterAll(() => {
  h.cleanup()
  rmSync(dist, { recursive: true, force: true })
})

describe('páginas da web', () => {
  it('serve a página inicial com os cabeçalhos de segurança da web', async () => {
    const response = await request(h.app).get('/').expect(200)
    expect(response.headers['content-type']).toMatch(/^text\/html/)
    expect(response.headers['cache-control']).toBe('no-cache')
    const csp = response.headers['content-security-policy']
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('https://tile.openstreetmap.org')
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups')
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.text).toContain('<div id="root"></div>')
    expect(response.text).toContain('<title>ARGOS - Achados e perdidos</title>')
    expect(response.text).toContain(`<link rel="canonical" href="${site}/" />`)
    expect(response.text).toContain(`<meta property="og:image" content="${site}/icons/og-image.png" />`)
    expect(response.text).not.toContain('name="robots"')
  })

  it('usa títulos por página, noindex nas telas de conta e 404 em caminho desconhecido', async () => {
    const items = await request(h.app).get('/items').expect(200)
    expect(items.text).toContain('<title>Buscar itens perdidos e encontrados · ARGOS</title>')
    expect((await request(h.app).get('/help').expect(200)).text).toContain('<title>Como funciona · ARGOS</title>')

    for (const path of ['/settings', '/admin', '/items/new', '/my-items', '/reset-password']) {
      const response = await request(h.app).get(path).expect(200)
      expect(response.text, path).toContain('<meta name="robots" content="noindex" />')
    }

    const missing = await request(h.app).get('/pagina-que-nao-existe').expect(404)
    expect(missing.headers['content-type']).toMatch(/^text\/html/)
    expect(missing.text).toContain('<div id="root"></div>')
    expect(missing.text).toContain('noindex')
    expect(missing.text).not.toContain('rel="canonical"')
  })

  it('mostra prévia de link só de casos públicos e sem dados privados', async () => {
    const owner = await h.register('preview-owner@example.com')
    const itemId = await h.createItem(owner.token, {
      title: 'Mochila "azul" <b>& alça</b>',
      description: 'Mochila azul encontrada perto da cantina, com chaveiro.',
      location: 'Bloco B',
    })
    h.db.prepare('UPDATE items SET image_url = ? WHERE id = ?').run('/uploads/foto-mochila.jpg', itemId)

    const page = await request(h.app).get(`/items/${itemId}`).expect(200)
    expect(page.text).toContain('<title>Encontrado: Mochila &quot;azul&quot; &lt;b&gt;&amp; alça&lt;/b&gt; · ARGOS</title>')
    expect(page.text).not.toContain('<b>&')
    expect(page.text).toContain('content="Bloco B · Mochila azul encontrada perto da cantina, com chaveiro."')
    expect(page.text).toContain(`<meta property="og:image" content="${site}/uploads/foto-mochila.jpg" />`)
    expect(page.text).toContain(`<meta property="og:url" content="${site}/items/${itemId}" />`)
    // Casos não entram nos buscadores, mas a prévia aparece no link compartilhado.
    expect(page.text).toContain('<meta name="robots" content="noindex" />')
    expect(page.text).not.toContain('preview-owner@example.com')
    expect(page.text).not.toContain('Pessoa preview-owner')

    // Imagem fora da pasta de uploads nunca vira prévia.
    h.db.prepare('UPDATE items SET image_url = ? WHERE id = ?').run('https://evil.example/x.png', itemId)
    const external = await request(h.app).get(`/items/${itemId}`).expect(200)
    expect(external.text).not.toContain('evil.example')
    expect(external.text).toContain(`content="${site}/icons/og-image.png"`)

    // Caso rejeitado pela moderação: 404 e nada do conteúdo na página.
    h.db.prepare("UPDATE items SET approval_status = 'rejected' WHERE id = ?").run(itemId)
    const hidden = await request(h.app).get(`/items/${itemId}`).expect(404)
    expect(hidden.text).not.toContain('Mochila')
    expect(hidden.text).not.toContain('Bloco B')

    await request(h.app).get('/items/999999').expect(404)
    await request(h.app).get('/items/abc').expect(404)
  })

  it('redireciona /index.html para a raiz (sem servir a página sem CSP)', async () => {
    const response = await request(h.app).get('/index.html').expect(301)
    expect(response.headers.location).toBe('/')
  })
})

describe('arquivos da web', () => {
  it('comprime os arquivos com hash e guarda em cache por um ano', async () => {
    await website.ready
    const br = await rawGet('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip, deflate, br' })
    expect(br.status).toBe(200)
    expect(br.headers['content-encoding']).toBe('br')
    expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(br.headers.vary).toContain('Accept-Encoding')
    expect(br.headers['content-type']).toMatch(/javascript/)
    expect(brotliDecompressSync(br.body).toString()).toBe(bundle)
    expect(br.body.length).toBeLessThan(bundle.length / 5)
    expect(Number(br.headers['content-length'])).toBe(br.body.length)

    const gz = await rawGet('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip' })
    expect(gz.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(gz.body).toString()).toBe(bundle)

    const refused = await rawGet('/assets/index-abc123.js', { 'Accept-Encoding': 'br;q=0, gzip;q=0' })
    expect(refused.status).toBe(200)
    expect(refused.headers['content-encoding']).toBeUndefined()
    expect(refused.body.toString()).toBe(bundle)
    expect(refused.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('responde 404 de verdade para arquivo que não existe (nunca a página)', async () => {
    const response = await request(h.app).get('/assets/ItemsPage-versao-antiga.js').expect(404)
    expect(response.headers['content-type']).toMatch(/^text\/plain/)
    expect(response.text).not.toContain('<div id="root">')
    await request(h.app).get('/uploads/nao-existe.jpg').expect(404)
    await request(h.app).post('/qualquer-coisa').expect(404)
  })

  it('serve service worker sem cache e o manifesto do app instalável', async () => {
    expect((await request(h.app).get('/sw.js').expect(200)).headers['cache-control']).toBe('no-cache')
    const manifest = await request(h.app).get('/manifest.webmanifest').expect(200)
    expect(manifest.headers['content-type']).toMatch(/^application\/manifest\+json/)
    expect(manifest.headers['cache-control']).toBe('public, max-age=86400')
  })

  it('marca as fotos enviadas como fora da busca de imagens', async () => {
    mkdirSync(join(h.root, 'uploads'), { recursive: true })
    writeFileSync(join(h.root, 'uploads', 'foto-teste.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    const response = await request(h.app).get('/uploads/foto-teste.jpg').expect(200)
    expect(response.headers['x-robots-tag']).toBe('noindex')
  })
})

describe('buscadores e integrações', () => {
  it('publica robots.txt e sitemap.xml com o domínio configurado', async () => {
    const robots = await request(h.app).get('/robots.txt').expect(200)
    expect(robots.headers['content-type']).toMatch(/^text\/plain/)
    expect(robots.text).toContain('Disallow: /admin')
    expect(robots.text).toContain('Disallow: /settings')
    expect(robots.text).toContain('Disallow: /api/')
    expect(robots.text).not.toMatch(/^Disallow: \/$/m)
    expect(robots.text).toContain(`Sitemap: ${site}/sitemap.xml`)

    const sitemap = await request(h.app).get('/sitemap.xml').expect(200)
    expect(sitemap.headers['content-type']).toMatch(/^application\/xml/)
    expect(sitemap.text).toContain(`<loc>${site}/help</loc>`)
    expect(sitemap.text).not.toContain('/admin')
    expect(sitemap.text).not.toContain('/items/')
  })

  it('homologação fica fora dos buscadores', async () => {
    const { env } = (await import('../src/config/env.js')) as { env: { NODE_ENV: string } }
    const previous = env.NODE_ENV
    env.NODE_ENV = 'staging'
    try {
      expect((await request(h.app).get('/robots.txt').expect(200)).text).toBe('User-agent: *\nDisallow: /\n')
      const page = await request(h.app).get('/').expect(200)
      expect(page.headers['x-robots-tag']).toBe('noindex, nofollow')
      expect(page.text).toContain('<meta name="robots" content="noindex" />')
    } finally {
      env.NODE_ENV = previous
    }
  })

  it('a API continua respondendo JSON e expõe o e-mail de atendimento', async () => {
    const missing = await request(h.app).get('/api/v1/nao-existe').expect(404)
    expect(missing.headers['content-type']).toMatch(/json/)
    expect((await request(h.app).get('/health/ready').expect(200)).body.status).toBe('ready')
    const config = await request(h.app).get('/api/v1/config').expect(200)
    expect(config.body.supportEmail).toBe('ajuda@campus.example')
  })

  it('a lista de rotas do servidor é a mesma do React (frontend/src/App.tsx)', async () => {
    const { webRoutes } = await import('../src/web/site.js')
    const app = readFileSync(join(__dirname, '..', '..', 'frontend', 'src', 'App.tsx'), 'utf8')
    const reactRoutes = [...app.matchAll(/path="([^"]+)"/g)].map((match) => match[1]).filter((path) => path !== '*')
    if (/<Route index /.test(app)) reactRoutes.push('/')
    expect([...webRoutes].sort()).toEqual([...new Set(reactRoutes)].sort())
  })
})
