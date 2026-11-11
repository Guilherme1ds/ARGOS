import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { Router } from 'express'
import { bearer, startHarness, type Harness } from './support/harness.js'

type Schema = {
  $ref?: string
  type?: string
  required?: string[]
  properties?: Record<string, Schema>
  items?: Schema
  enum?: unknown[]
  nullable?: boolean
  allOf?: Schema[]
  oneOf?: Schema[]
  additionalProperties?: boolean | Schema
}
type Operation = { summary?: string; tags?: string[]; security?: unknown[]; responses?: Record<string, { $ref?: string; content?: Record<string, { schema?: Schema }> }> }
type Spec = {
  paths: Record<string, Record<string, Operation> & { servers?: unknown }>
  components: { schemas: Record<string, Schema>; responses: Record<string, unknown>; parameters: Record<string, unknown> }
}

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const spec = parse(readFileSync(join(repoRoot, 'docs', 'openapi', 'argos.v1.yaml'), 'utf8')) as Spec
const methods = ['get', 'post', 'put', 'patch', 'delete'] as const
let h: Harness

beforeAll(async () => {
  h = await startHarness('contract')
})

afterAll(() => h.cleanup())

function documentedOperations() {
  const operations = new Set<string>()
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of methods) if (item[method]) operations.add(`${method.toUpperCase()} ${path}`)
  }
  return operations
}

function toOpenApiPath(path: string) {
  return path.replace(/:(\w+)/g, '{$1}').replace(/\/$/, '') || '/'
}

async function expressOperations() {
  const { app, apiRoutes } = await import('../src/app.js')
  const operations = new Set<string>()
  type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> } }
  const collect = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (!layer.route) continue
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
      for (const path of paths) {
        for (const method of Object.keys(layer.route.methods)) operations.add(`${method.toUpperCase()} ${toOpenApiPath(`${prefix}${path}`)}`)
      }
    }
  }
  for (const [prefix, router] of apiRoutes) collect((router as unknown as Router & { stack: Layer[] }).stack, prefix)
  // Rotas do próprio app (health) ficam fora de /api/v1 e são documentadas com servidor próprio.
  collect((app as unknown as { _router: { stack: Layer[] } })._router.stack, '')
  return operations
}

function resolveRef<T>(ref: string): T {
  const parts = ref.replace(/^#\//, '').split('/')
  let current: unknown = spec
  for (const part of parts) current = (current as Record<string, unknown>)?.[part]
  if (current === undefined) throw new Error(`$ref não resolvido: ${ref}`)
  return current as T
}

/** Validador mínimo de JSON Schema/OpenAPI 3.0 (type, required, properties, items, enum, nullable, allOf, $ref). */
function validate(value: unknown, schema: Schema, path = '$'): string[] {
  if (schema.$ref) return validate(value, resolveRef<Schema>(schema.$ref), path)
  if (schema.allOf) return schema.allOf.flatMap((part) => validate(value, part, path))
  if (schema.oneOf) return schema.oneOf.some((part) => validate(value, part, path).length === 0) ? [] : [`${path}: nenhum oneOf corresponde`]
  if (value === null) return schema.nullable ? [] : [`${path}: null não permitido`]
  const errors: string[] = []
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: valor fora do enum (${String(value)})`)
  const type = schema.type
  if (type === 'object' || schema.properties) {
    if (typeof value !== 'object' || Array.isArray(value)) return [`${path}: esperado objeto`]
    for (const key of schema.required ?? []) if (!(key in (value as object))) errors.push(`${path}.${key}: obrigatório ausente`)
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in (value as object)) errors.push(...validate((value as Record<string, unknown>)[key], child, `${path}.${key}`))
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: esperado array`]
    if (schema.items) value.forEach((entry, index) => errors.push(...validate(entry, schema.items!, `${path}[${index}]`)))
  } else if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: esperado inteiro`)
  else if (type === 'number' && typeof value !== 'number') errors.push(`${path}: esperado número`)
  else if (type === 'string' && typeof value !== 'string') errors.push(`${path}: esperado string`)
  else if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: esperado booleano`)
  return errors
}

function responseSchema(method: string, path: string, status: number) {
  const operation = spec.paths[path]?.[method]
  if (!operation) throw new Error(`Operação não documentada: ${method.toUpperCase()} ${path}`)
  let response = operation.responses?.[String(status)]
  if (!response) throw new Error(`Status ${status} não documentado em ${method.toUpperCase()} ${path}`)
  if (response.$ref) response = resolveRef(response.$ref)
  const schema = response.content?.['application/json']?.schema
  if (!schema) throw new Error(`Sem schema JSON para ${status} em ${method.toUpperCase()} ${path}`)
  return schema
}

function expectMatchesContract(method: string, path: string, response: request.Response) {
  const errors = validate(response.body, responseSchema(method, path, response.status))
  expect(errors, `${method.toUpperCase()} ${path} ${response.status}`).toEqual([])
}

describe('API-01 OpenAPI contract stays in sync with the server', () => {
  it('documents every Express route and nothing that does not exist', async () => {
    const documented = documentedOperations()
    const implemented = await expressOperations()
    expect([...implemented].filter((operation) => !documented.has(operation)).sort(), 'rotas sem documentação').toEqual([])
    expect([...documented].filter((operation) => !implemented.has(operation)).sort(), 'documentação sem rota').toEqual([])
  })

  it('declares summary, tag, success response and authentication errors for every operation', () => {
    const problems: string[] = []
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of methods) {
        const operation = item[method]
        if (!operation) continue
        const label = `${method.toUpperCase()} ${path}`
        if (!operation.summary) problems.push(`${label}: sem summary`)
        if (!operation.tags?.length) problems.push(`${label}: sem tag`)
        const statuses = Object.keys(operation.responses ?? {})
        if (!statuses.some((status) => /^2\d\d$/.test(status))) problems.push(`${label}: sem resposta 2xx`)
        const isPublic = Array.isArray(operation.security) && operation.security.length === 0
        if (!isPublic && !statuses.includes('401')) problems.push(`${label}: rota autenticada sem 401`)
      }
    }
    expect(problems).toEqual([])
  })

  it('resolves every $ref in the document', () => {
    const refs = JSON.stringify(spec).match(/"\$ref":"([^"]+)"/g) ?? []
    for (const ref of new Set(refs.map((entry) => entry.slice(8, -1)))) expect(() => resolveRef(ref)).not.toThrow()
  })

  it('covers every endpoint called by the web and Flutter clients', () => {
    const documented = new Set([...documentedOperations()].map((operation) => operation.split(' ')[1]))
    const pattern = (path: string) => new RegExp(`^${path.replace(/\{\w+\}/g, '[^/]+')}$`)
    const documentedPatterns = [...documented].map(pattern)
    const files = (dir: string, extension: RegExp): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name), extension) : extension.test(entry.name) ? [join(dir, entry.name)] : [],
      )
    const used = new Map<string, string>()
    const register = (raw: string, file: string) => {
      const path = raw.split('?')[0].replace(/\$\{[^}]+\}/g, 'X').replace(/\$\w+/g, 'X').replace(/\/$/, '')
      if (path) used.set(path, file)
    }
    for (const file of files(join(repoRoot, 'frontend', 'src'), /\.tsx?$/)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/api\s*\.\s*(?:get|post|patch|put|delete)\s*(?:<[^>]*>)?\s*\(\s*([`'])(\/[^`']*)\1/g)) register(match[2], file)
    }
    for (const file of files(join(repoRoot, 'apps', 'flutter', 'lib'), /\.dart$/)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\.(?:get|post|patch|put|delete)\s*(?:<[^>]*>)?\s*\(\s*'(\/[^']*)'/g)) register(match[1], file)
      for (const match of source.matchAll(/(?:authenticate|collection)\(\s*'(\/[^']*)'/g)) register(match[1], file)
      for (const match of source.matchAll(/AccountCollection\(path:\s*'(\/[^']*)'/g)) register(match[1], file)
    }
    expect(used.size).toBeGreaterThan(30)
    const missing = [...used].filter(([path]) => !documentedPatterns.some((regex) => regex.test(path))).map(([path, file]) => `${path} (${file})`)
    expect(missing).toEqual([])
  })

  it('returns payloads that match the documented schemas', async () => {
    const person = await h.register('contract@example.com')
    const itemId = await h.createItem(person.token, { title: 'Estojo do contrato' })
    const other = await h.register('contract-other@example.com')
    await h.createItem(other.token, { type: 'lost', title: 'Estojo perdido', description: 'Estojo azul perdido no laboratório.' })
    await request(h.app).post(`/api/v1/items/${itemId}/report`).set(bearer(other.token)).send({ reason: 'Conferir o conteúdo.' }).expect(201)
    await request(h.app).post('/api/v1/saved-searches').set(bearer(person.token)).send({ name: 'Estojos', query: { q: 'estojo' } }).expect(201)

    const register = await request(h.app).post('/api/v1/auth/register').set('X-Forwarded-For', h.nextIp())
      .send({ name: 'Schema', email: 'schema@example.com', password: 'Password@123', privacyTermsAccepted: true })
    expectMatchesContract('post', '/auth/register', register)
    expectMatchesContract('post', '/auth/login', await request(h.app).post('/api/v1/auth/login').set('X-Forwarded-For', h.nextIp()).send({ email: 'schema@example.com', password: 'Password@123' }))
    expectMatchesContract('get', '/auth/me', await request(h.app).get('/api/v1/auth/me').set(bearer(person.token)))
    expectMatchesContract('get', '/items/search', await request(h.app).get('/api/v1/items/search?q=estojo'))
    expectMatchesContract('get', '/items/{id}', await request(h.app).get(`/api/v1/items/${itemId}`).set(bearer(person.token)))
    expectMatchesContract('get', '/items/{id}/matches', await request(h.app).get(`/api/v1/items/${itemId}/matches`).set(bearer(person.token)))
    expectMatchesContract('get', '/dashboard', await request(h.app).get('/api/v1/dashboard').set(bearer(person.token)))
    expectMatchesContract('get', '/saved-searches', await request(h.app).get('/api/v1/saved-searches').set(bearer(person.token)))
    expectMatchesContract('get', '/privacy/summary', await request(h.app).get('/api/v1/privacy/summary').set(bearer(person.token)))
    expectMatchesContract('get', '/admin/reports', await request(h.app).get('/api/v1/admin/reports').set(bearer(h.admin.token)))
    expectMatchesContract('get', '/admin/users', await request(h.app).get('/api/v1/admin/users').set(bearer(h.admin.token)))
    expectMatchesContract('get', '/notifications', await request(h.app).get('/api/v1/notifications').set(bearer(person.token)))
    expectMatchesContract('get', '/health/ready', await request(h.app).get('/health/ready'))
    expectMatchesContract('post', '/items', await request(h.app).post('/api/v1/items').set(bearer(person.token)).send({ type: 'invalid' }))
    expectMatchesContract('get', '/auth/me', await request(h.app).get('/api/v1/auth/me'))
  })
})
