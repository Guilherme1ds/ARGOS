import bcrypt from 'bcryptjs'
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'

/**
 * Hash e verificação de senha fora da thread principal.
 *
 * O bcryptjs é JavaScript puro: cada hash de custo 12 ocupa a CPU por ~0,25 s. Na thread principal, uma rajada de
 * logins (início das aulas) travava todas as outras requisições — medido: a busca caiu de ~1.300 para ~18 req/s com
 * 8 logins simultâneos. Aqui o trabalho vai para um pequeno pool de workers; o formato do hash é o mesmo ($2a$/$2b$),
 * então senhas já gravadas continuam válidas. Sem worker disponível, cai no bcryptjs assíncrono da thread principal.
 */

const require = createRequire(import.meta.url)
const workerSource = `
const { parentPort } = require('node:worker_threads')
const bcrypt = require(${JSON.stringify(require.resolve('bcryptjs'))})
parentPort.on('message', (job) => {
  try {
    const result = job.op === 'hash' ? bcrypt.hashSync(job.password, job.cost) : bcrypt.compareSync(job.password, job.hash)
    parentPort.postMessage({ id: job.id, result })
  } catch (error) {
    parentPort.postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) })
  }
})
`

type Slot = { worker: Worker; busy: number }
type Pending = { slot: Slot; resolve: (value: unknown) => void; reject: (error: Error) => void }

const poolSize = Math.max(1, Math.min(4, availableParallelism() - 1))
const slots: Slot[] = []
const pending = new Map<number, Pending>()
let nextJobId = 0
let workersUnavailable = false

function failSlot(slot: Slot, error: Error) {
  for (const [id, job] of pending) {
    if (job.slot !== slot) continue
    pending.delete(id)
    job.reject(error)
  }
  const index = slots.indexOf(slot)
  if (index >= 0) slots.splice(index, 1)
}

function spawn(): Slot | null {
  try {
    const worker = new Worker(workerSource, { eval: true })
    const slot: Slot = { worker, busy: 0 }
    // Ocioso, o worker não segura o processo aberto (scripts, testes e o encerramento do servidor).
    worker.unref()
    worker.on('message', (message: { id: number; result?: unknown; error?: string }) => {
      const job = pending.get(message.id)
      if (!job) return
      pending.delete(message.id)
      slot.busy -= 1
      if (slot.busy === 0) worker.unref()
      if (message.error !== undefined) job.reject(new Error(message.error))
      else job.resolve(message.result)
    })
    worker.on('error', (error) => failSlot(slot, error instanceof Error ? error : new Error(String(error))))
    worker.on('exit', (code) => failSlot(slot, new Error(`Worker de senha encerrado (código ${code}).`)))
    slots.push(slot)
    return slot
  } catch {
    workersUnavailable = true
    return null
  }
}

function leastBusySlot() {
  while (!workersUnavailable && slots.length < poolSize) if (!spawn()) break
  return slots.reduce<Slot | null>((best, slot) => (!best || slot.busy < best.busy ? slot : best), null)
}

function run<T>(job: { op: 'hash'; password: string; cost: number } | { op: 'compare'; password: string; hash: string }): Promise<T> | null {
  const slot = leastBusySlot()
  if (!slot) return null
  const id = (nextJobId += 1)
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { slot, resolve: resolve as (value: unknown) => void, reject })
    if (slot.busy === 0) slot.worker.ref()
    slot.busy += 1
    slot.worker.postMessage({ id, ...job })
  })
}

export function hashPassword(password: string, cost = 12): Promise<string> {
  return run<string>({ op: 'hash', password, cost }) ?? bcrypt.hash(password, cost)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return run<boolean>({ op: 'compare', password, hash }) ?? bcrypt.compare(password, hash)
}

/** Quantos workers o pool usa nesta máquina (para documentação e testes). */
export const passwordWorkerPoolSize = poolSize
