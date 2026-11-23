import type { NextFunction, Request, Response } from 'express'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { formatTraceparent, logger, recordSpan, runWithTrace, startServerTrace, type TraceContext } from './telemetry.js'

declare global {
  namespace Express {
    interface Request {
      traceContext?: TraceContext
      /** Prefixo do roteador que atendeu (o Express restaura `baseUrl` antes do fim quando a rota repassa um erro). */
      routePrefix?: string
    }
  }
}

/**
 * Métricas da API em memória (Sprint 8): contadores e histograma no formato Prometheus (`/metrics`) e uma
 * janela móvel por minuto que alimenta o painel de observabilidade e os alertas automáticos.
 * São métricas do processo: reiniciar zera os contadores (o Prometheus lida com isso em `rate()`).
 */
const durationBuckets = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
const windowMinutes = 60
const samplesPerMinute = 600

type RouteStats = { count: number; errors: number; sumSeconds: number; buckets: number[] }
type MinuteBucket = { minute: number; requests: number; errors5xx: number; errors4xx: number; durations: number[] }

const routes = new Map<string, RouteStats>()
const statusCounters = new Map<string, number>()
const minutes: MinuteBucket[] = []
const startedAt = Date.now()
let inFlight = 0

const loopDelay = monitorEventLoopDelay({ resolution: 20 })
loopDelay.enable()

function minuteBucket(now: number) {
  const minute = Math.floor(now / 60_000)
  let bucket = minutes[minutes.length - 1]
  if (!bucket || bucket.minute !== minute) {
    bucket = { minute, requests: 0, errors5xx: 0, errors4xx: 0, durations: [] }
    minutes.push(bucket)
    while (minutes.length > windowMinutes) minutes.shift()
  }
  return bucket
}

/** Registra uma requisição concluída. `route` é o padrão da rota (baixa cardinalidade), nunca a URL com ids. */
export function observeRequest(method: string, route: string, status: number, durationMs: number, now = Date.now()) {
  const seconds = durationMs / 1000
  const key = `${method} ${route}`
  const stats = routes.get(key) ?? { count: 0, errors: 0, sumSeconds: 0, buckets: durationBuckets.map(() => 0) }
  stats.count += 1
  stats.sumSeconds += seconds
  if (status >= 500) stats.errors += 1
  durationBuckets.forEach((limit, index) => {
    if (seconds <= limit) stats.buckets[index] += 1
  })
  routes.set(key, stats)

  const statusKey = `${method}|${route}|${status}`
  statusCounters.set(statusKey, (statusCounters.get(statusKey) ?? 0) + 1)

  const bucket = minuteBucket(now)
  bucket.requests += 1
  if (status >= 500) bucket.errors5xx += 1
  else if (status >= 400) bucket.errors4xx += 1
  if (bucket.durations.length < samplesPerMinute) bucket.durations.push(durationMs)
}

function percentile(sorted: number[], fraction: number) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

/** Agregado dos últimos `lastMinutes` minutos (inclui o minuto em curso). */
export function windowStats(lastMinutes: number, now = Date.now()) {
  const from = Math.floor(now / 60_000) - lastMinutes + 1
  const selected = minutes.filter((bucket) => bucket.minute >= from)
  const durations = selected.flatMap((bucket) => bucket.durations).sort((a, b) => a - b)
  const requests = selected.reduce((total, bucket) => total + bucket.requests, 0)
  const errors5xx = selected.reduce((total, bucket) => total + bucket.errors5xx, 0)
  const errors4xx = selected.reduce((total, bucket) => total + bucket.errors4xx, 0)
  return {
    minutes: lastMinutes,
    requests,
    errors5xx,
    errors4xx,
    errorRatePercent: requests ? Math.round((errors5xx / requests) * 10_000) / 100 : 0,
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    p99Ms: Math.round(percentile(durations, 0.99)),
  }
}

/** Série por minuto (do mais antigo ao mais recente) para os gráficos do painel. */
export function minuteSeries(lastMinutes = windowMinutes, now = Date.now()) {
  const current = Math.floor(now / 60_000)
  const byMinute = new Map(minutes.map((bucket) => [bucket.minute, bucket]))
  return Array.from({ length: lastMinutes }, (_, index) => {
    const minute = current - lastMinutes + 1 + index
    const bucket = byMinute.get(minute)
    const sorted = bucket ? [...bucket.durations].sort((a, b) => a - b) : []
    return {
      at: new Date(minute * 60_000).toISOString(),
      requests: bucket?.requests ?? 0,
      errors: bucket?.errors5xx ?? 0,
      p95Ms: Math.round(percentile(sorted, 0.95)),
    }
  })
}

export function routeSummary(limit = 10) {
  return [...routes.entries()]
    .map(([route, stats]) => ({ route, count: stats.count, errors: stats.errors, avgMs: Math.round((stats.sumSeconds / stats.count) * 1000) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export function processStats() {
  const memory = process.memoryUsage()
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    startedAt: new Date(startedAt).toISOString(),
    memoryRssMb: Math.round(memory.rss / 1_048_576),
    heapUsedMb: Math.round(memory.heapUsed / 1_048_576),
    eventLoopDelayP99Ms: Math.round(loopDelay.percentile(99) / 1e6),
    inFlightRequests: inFlight,
    node: process.version,
  }
}

/** Atraso do laço de eventos desde a última leitura (ms, p99); zera o histograma para a próxima janela. */
export function takeEventLoopDelay() {
  const value = loopDelay.percentile(99) / 1e6
  loopDelay.reset()
  return Number.isFinite(value) ? value : 0
}

const escapeLabel = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

/** Exposição no formato de texto do Prometheus. `gauges` traz valores de negócio calculados na hora. */
export function prometheusText(gauges: Record<string, { help: string; value: number; labels?: Record<string, string> }[]> = {}) {
  const lines: string[] = []
  lines.push('# HELP argos_http_requests_total Requisições HTTP concluídas.', '# TYPE argos_http_requests_total counter')
  for (const [key, value] of statusCounters) {
    const [method, route, status] = key.split('|')
    lines.push(`argos_http_requests_total{method="${method}",route="${escapeLabel(route)}",status="${status}"} ${value}`)
  }
  lines.push('# HELP argos_http_request_duration_seconds Duração das requisições HTTP.', '# TYPE argos_http_request_duration_seconds histogram')
  for (const [key, stats] of routes) {
    const [method, ...rest] = key.split(' ')
    const labels = `method="${method}",route="${escapeLabel(rest.join(' '))}"`
    durationBuckets.forEach((limit, index) => lines.push(`argos_http_request_duration_seconds_bucket{${labels},le="${limit}"} ${stats.buckets[index]}`))
    lines.push(`argos_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${stats.count}`)
    lines.push(`argos_http_request_duration_seconds_sum{${labels}} ${stats.sumSeconds.toFixed(6)}`)
    lines.push(`argos_http_request_duration_seconds_count{${labels}} ${stats.count}`)
  }
  const stats = processStats()
  const simple: Array<[string, string, string, number]> = [
    ['argos_process_uptime_seconds', 'Tempo no ar do processo.', 'gauge', stats.uptimeSeconds],
    ['argos_process_resident_memory_bytes', 'Memória residente do processo.', 'gauge', process.memoryUsage().rss],
    ['argos_event_loop_delay_p99_ms', 'Atraso p99 do laço de eventos.', 'gauge', stats.eventLoopDelayP99Ms],
    ['argos_http_in_flight_requests', 'Requisições em andamento.', 'gauge', stats.inFlightRequests],
  ]
  for (const [name, help, type, value] of simple) lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value}`)
  for (const [name, series] of Object.entries(gauges)) {
    if (!series.length) continue
    lines.push(`# HELP ${name} ${series[0].help}`, `# TYPE ${name} gauge`)
    for (const entry of series) {
      const labels = Object.entries(entry.labels ?? {}).map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')
      lines.push(`${name}${labels ? `{${labels}}` : ''} ${entry.value}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Zera os dados (somente testes). */
export function resetMetrics() {
  routes.clear()
  statusCounters.clear()
  minutes.length = 0
}

/**
 * Middleware de telemetria: abre o rastro da requisição (aceitando `traceparent` de quem chamou), devolve
 * `traceparent` na resposta e, ao terminar, registra métricas, o span do servidor e uma linha de log.
 * O log leva o padrão da rota e o caminho sem query string (que pode conter texto digitado pela pessoa).
 */
export function telemetryMiddleware(req: Request, res: Response, next: NextFunction) {
  const context = startServerTrace(req.header('traceparent'), req.requestId)
  req.traceContext = context
  const startedAtMs = Date.now()
  const started = process.hrtime.bigint()
  inFlight += 1
  res.setHeader('traceparent', formatTraceparent(context))

  let finished = false
  const finish = (aborted: boolean) => {
    if (finished) return
    finished = true
    inFlight -= 1
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6
    const route = req.route?.path
      ? `${req.routePrefix ?? req.baseUrl}${String(req.route.path)}`.replace(/\/$/, '') || '/'
      : res.statusCode === 404
        ? 'not_found'
        : 'unmatched'
    // Arquivos estáticos e a própria coleta não entram nas estatísticas de erro e latência da API.
    const ignored = req.path.startsWith('/uploads/') || req.path === '/metrics' || route === 'unmatched'
    const status = aborted ? 499 : res.statusCode
    if (!ignored) observeRequest(req.method, route, status, durationMs)
    recordSpan({
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      name: `${req.method} ${route}`,
      kind: 'server',
      startMs: startedAtMs,
      endMs: startedAtMs + durationMs,
      attributes: { 'http.request.method': req.method, 'http.route': route, 'http.response.status_code': status, ...(req.user ? { 'enduser.id': String(req.user.id) } : {}) },
      error: status >= 500,
    })
    runWithTrace(context, () => {
      const fields = { method: req.method, route, path: req.path, status, durationMs: Math.round(durationMs * 10) / 10, userId: req.user?.id ?? null, ip: req.ip }
      if (status >= 500) logger.error('http.request', fields)
      else if (!ignored) logger.info('http.request', fields)
    })
  }
  res.on('finish', () => finish(false))
  res.on('close', () => finish(!res.writableFinished))
  runWithTrace(context, next)
}

/** Leitores de corpo (JSON, upload) perdem o contexto assíncrono: este middleware o restabelece em seguida. */
export function resumeTrace(req: Request, _res: Response, next: NextFunction) {
  if (req.traceContext) runWithTrace(req.traceContext, next)
  else next()
}

/** Guarda o prefixo do roteador (ex.: /api/v1/auth) para a métrica e o log nomearem a rota mesmo quando ela falha. */
export function markRoutePrefix(req: Request, _res: Response, next: NextFunction) {
  req.routePrefix = req.baseUrl
  next()
}
