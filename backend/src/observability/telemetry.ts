import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Logs centralizados e rastreamento distribuído (Sprint 8), sem dependências externas.
 *
 * - Logs: uma linha JSON por evento em stdout (formato `json` em produção/homologação), com `traceId`,
 *   `spanId` e `requestId` em toda linha emitida dentro de uma requisição. O coletor do ambiente
 *   (Docker, Loki, CloudWatch, ELK) centraliza a saída padrão; nada é gravado em arquivo local.
 * - Rastreamento: padrão W3C Trace Context. A API aceita `traceparent` de quem chamou, devolve o próprio
 *   e propaga para as integrações externas (`tracedFetch`). Com `OTEL_EXPORTER_OTLP_ENDPOINT`, os spans
 *   são enviados por OTLP/HTTP (JSON) a um coletor OpenTelemetry (Jaeger, Tempo, etc.).
 */
export type TraceContext = {
  traceId: string
  spanId: string
  parentSpanId: string | null
  sampled: boolean
  requestId?: string
}

const storage = new AsyncLocalStorage<TraceContext>()

export function currentTrace() {
  return storage.getStore()
}

export function runWithTrace<T>(context: TraceContext, fn: () => T) {
  return storage.run(context, fn)
}

const newTraceId = () => randomBytes(16).toString('hex')
const newSpanId = () => randomBytes(8).toString('hex')

/** Lê `traceparent` (00-<32 hex>-<16 hex>-<flags>); cabeçalho ausente ou inválido inicia um rastro novo. */
export function parseTraceparent(header: string | undefined): Pick<TraceContext, 'traceId' | 'parentSpanId' | 'sampled'> {
  const match = header ? /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header.trim().toLowerCase()) : null
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return { traceId: newTraceId(), parentSpanId: null, sampled: true }
  return { traceId: match[1], parentSpanId: match[2], sampled: (Number.parseInt(match[3], 16) & 1) === 1 }
}

export function formatTraceparent(context: Pick<TraceContext, 'traceId' | 'spanId' | 'sampled'>) {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`
}

export function startServerTrace(traceparent: string | undefined, requestId?: string): TraceContext {
  return { ...parseTraceparent(traceparent), spanId: newSpanId(), requestId }
}

// ---------------------------------------------------------------------------------------------------------
// Logs estruturados

type Level = 'debug' | 'info' | 'warn' | 'error'
const levelWeight: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
type Fields = Record<string, unknown>

/** Últimos eventos de aviso/erro em memória, para o painel de observabilidade (sem dados pessoais). */
const recentProblems: Array<{ ts: string; level: Level; event: string; traceId?: string; message?: string }> = []

function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: env.PRODUCTION_LIKE ? undefined : error.stack }
  return { message: String(error) }
}

function write(level: Level, event: string, fields: Fields = {}) {
  const trace = currentTrace()
  const { error, ...rest } = fields
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    service: env.OTEL_SERVICE_NAME,
    ...(trace ? { traceId: trace.traceId, spanId: trace.spanId, requestId: trace.requestId } : {}),
    ...rest,
    ...(error !== undefined ? { error: serializeError(error) } : {}),
  }
  if (levelWeight[level] >= levelWeight.warn) {
    recentProblems.push({ ts: entry.ts, level, event, traceId: trace?.traceId, message: error instanceof Error ? error.message : undefined })
    if (recentProblems.length > 50) recentProblems.shift()
  }
  if (levelWeight[level] < levelWeight[env.LOG_LEVEL]) return
  // Testes automatizados não poluem a saída; LOG_LEVEL=debug religa para depurar.
  if (env.NODE_ENV === 'test' && env.LOG_LEVEL !== 'debug') return
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  if (env.LOG_FORMAT === 'json') {
    stream.write(`${JSON.stringify(entry)}\n`)
    return
  }
  const details = Object.entries(rest)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' ')
  const failure = error !== undefined ? ` | ${serializeError(error).message}` : ''
  stream.write(`${entry.ts.slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${event} ${details}${failure}${trace ? ` trace=${trace.traceId.slice(0, 8)}` : ''}\n`)
}

export const logger = {
  debug: (event: string, fields?: Fields) => write('debug', event, fields),
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
}

export function recentLogProblems() {
  return [...recentProblems].reverse()
}

// ---------------------------------------------------------------------------------------------------------
// Spans e exportação OTLP

export type Span = {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  kind: 'server' | 'client' | 'internal'
  startMs: number
  endMs: number
  attributes: Record<string, string | number | boolean>
  error: boolean
}

const spanQueue: Span[] = []
let flushTimer: NodeJS.Timeout | null = null
export const tracingStats = { exported: 0, dropped: 0, failures: 0 }

export function tracingExportEnabled() {
  return Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT) && env.NODE_ENV !== 'test'
}

export function recordSpan(span: Span) {
  if (!tracingExportEnabled()) return
  if (spanQueue.length >= 2000) {
    tracingStats.dropped += 1
    return
  }
  spanQueue.push(span)
  flushTimer ??= setTimeout(() => void flushSpans(), 5000)
  flushTimer.unref()
}

const nanos = (ms: number) => `${Math.round(ms * 1_000_000)}`

/** Corpo OTLP/HTTP JSON (https://opentelemetry.io/docs/specs/otlp/). Exportado para os testes. */
export function otlpPayload(spans: Span[]) {
  const attribute = (key: string, value: string | number | boolean) => ({
    key,
    value: typeof value === 'number' ? (Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }) : typeof value === 'boolean' ? { boolValue: value } : { stringValue: value },
  })
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', env.OTEL_SERVICE_NAME), attribute('deployment.environment', env.NODE_ENV)] },
        scopeSpans: [
          {
            scope: { name: 'argos-telemetry' },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: span.kind === 'server' ? 2 : span.kind === 'client' ? 3 : 1,
              startTimeUnixNano: nanos(span.startMs),
              endTimeUnixNano: nanos(span.endMs),
              attributes: Object.entries(span.attributes).map(([key, value]) => attribute(key, value)),
              status: { code: span.error ? 2 : 1 },
            })),
          },
        ],
      },
    ],
  }
}

export async function flushSpans() {
  flushTimer = null
  if (!spanQueue.length || !env.OTEL_EXPORTER_OTLP_ENDPOINT) return
  const batch = spanQueue.splice(0, 500)
  try {
    const response = await fetch(`${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(otlpPayload(batch)),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`coletor respondeu ${response.status}`)
    tracingStats.exported += batch.length
  } catch (error) {
    // O coletor fora do ar não pode derrubar nem atrasar a API: o lote é descartado e contado.
    tracingStats.failures += 1
    tracingStats.dropped += batch.length
    logger.debug('tracing.export_failed', { error })
  }
  if (spanQueue.length) {
    flushTimer = setTimeout(() => void flushSpans(), 5000)
    flushTimer.unref()
  }
}

/** Executa `fn` em um span filho do rastro atual (ex.: chamada a um serviço externo). */
export async function withSpan<T>(name: string, kind: Span['kind'], attributes: Span['attributes'], fn: (context: TraceContext) => Promise<T>) {
  const parent = currentTrace()
  const context: TraceContext = {
    traceId: parent?.traceId ?? newTraceId(),
    spanId: newSpanId(),
    parentSpanId: parent?.spanId ?? null,
    sampled: parent?.sampled ?? true,
    requestId: parent?.requestId,
  }
  const startMs = Date.now()
  let failed = false
  try {
    return await storage.run(context, () => fn(context))
  } catch (error) {
    failed = true
    throw error
  } finally {
    recordSpan({ traceId: context.traceId, spanId: context.spanId, parentSpanId: context.parentSpanId, name, kind, startMs, endMs: Date.now(), attributes, error: failed })
  }
}

/** `fetch` para integrações externas: cria um span cliente e propaga `traceparent` (só o host vai para o span). */
export function tracedFetch(url: string, init: RequestInit = {}) {
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return 'desconhecido'
    }
  })()
  return withSpan(`HTTP ${init.method ?? 'GET'} ${host}`, 'client', { 'http.request.method': init.method ?? 'GET', 'server.address': host }, async (context) => {
    const headers = new Headers(init.headers)
    headers.set('traceparent', formatTraceparent(context))
    const startedAt = Date.now()
    const response = await fetch(url, { ...init, headers })
    logger.debug('http.client', { host, status: response.status, durationMs: Date.now() - startedAt })
    return response
  })
}
