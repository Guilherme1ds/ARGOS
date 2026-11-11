import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/**
 * Backup/restore da instalação de instância única: arquivo SQLite (cópia online consistente, compatível com WAL)
 * + diretório de uploads + manifesto com contagens e hash. Não depende de env.ts para rodar também em
 * contêineres de manutenção. Ver docs/operacao.md.
 */

export type BackupManifest = {
  format: 'argos-backup-v1'
  createdAt: string
  schemaVersion: number
  database: { file: string; sha256: string; bytes: number }
  counts: Record<string, number>
  uploads: { files: number }
}

const countedTables = ['users', 'items', 'claims', 'comments', 'uploads', 'notifications', 'item_reports', 'audit_logs']

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function schemaVersion(db: Database.Database) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (!table) return 0
  return (db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null }).version ?? 0
}

function tableCounts(db: Database.Database) {
  const counts: Record<string, number> = {}
  for (const table of countedTables) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
    if (exists) counts[table] = (db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total
  }
  return counts
}

function listFiles(dir: string) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name) : []
}

export async function createBackup(options: { databasePath: string; uploadDir: string; outDir: string; now?: Date }) {
  const databasePath = resolve(options.databasePath)
  if (!existsSync(databasePath)) throw new Error('Banco de dados não encontrado.')
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const target = resolve(options.outDir, `argos-backup-${stamp}`)
  mkdirSync(target, { recursive: true })

  const databaseFile = join(target, 'argos.sqlite')
  const source = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    // API de backup online do SQLite: cópia consistente mesmo com a aplicação gravando (WAL).
    await source.backup(databaseFile)
  } finally {
    source.close()
  }

  const uploadsTarget = join(target, 'uploads')
  mkdirSync(uploadsTarget, { recursive: true })
  if (existsSync(options.uploadDir)) cpSync(resolve(options.uploadDir), uploadsTarget, { recursive: true })

  const copy = new Database(databaseFile, { readonly: true })
  const manifest: BackupManifest = {
    format: 'argos-backup-v1',
    createdAt: new Date().toISOString(),
    schemaVersion: schemaVersion(copy),
    database: { file: 'argos.sqlite', sha256: sha256(databaseFile), bytes: readFileSync(databaseFile).length },
    counts: tableCounts(copy),
    uploads: { files: listFiles(uploadsTarget).length },
  }
  copy.close()
  writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { path: target, manifest }
}

export type BackupVerification = { ok: boolean; problems: string[]; manifest: BackupManifest | null }

/** Confere hash, integridade do SQLite, chaves estrangeiras e presença das imagens referenciadas. */
export function verifyBackup(backupDir: string): BackupVerification {
  const problems: string[] = []
  const manifestPath = join(backupDir, 'manifest.json')
  if (!existsSync(manifestPath)) return { ok: false, problems: ['manifest.json ausente'], manifest: null }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest
  const databaseFile = join(backupDir, basename(manifest.database.file))
  if (!existsSync(databaseFile)) return { ok: false, problems: ['arquivo do banco ausente'], manifest }
  if (sha256(databaseFile) !== manifest.database.sha256) problems.push('hash do banco não confere com o manifesto')

  const db = new Database(databaseFile, { readonly: true, fileMustExist: true })
  try {
    const integrity = db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') problems.push(`integrity_check: ${String(integrity)}`)
    const foreignKeys = db.pragma('foreign_key_check') as unknown[]
    if (foreignKeys.length) problems.push(`${foreignKeys.length} violação(ões) de chave estrangeira`)
    if (schemaVersion(db) !== manifest.schemaVersion) problems.push('versão de esquema diferente do manifesto')

    const uploadsDir = join(backupDir, 'uploads')
    const files = new Set(listFiles(uploadsDir))
    const referenced = db
      .prepare(
        `SELECT image_url AS url FROM items WHERE image_url IS NOT NULL AND image_url <> ''
         UNION SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> ''`,
      )
      .all() as Array<{ url: string }>
    const missing = referenced.filter((row) => !files.has(row.url.replace(/^\/uploads\//, '')))
    if (missing.length) problems.push(`${missing.length} imagem(ns) referenciada(s) ausente(s) no backup`)
  } finally {
    db.close()
  }
  return { ok: problems.length === 0, problems, manifest }
}

/**
 * Restaura um backup verificado. Sem `force`, recusa sobrescrever; com `force`, preserva o estado atual
 * renomeando-o para *.before-restore-<data> (permite desfazer a restauração).
 */
export function restoreBackup(options: { backupDir: string; databasePath: string; uploadDir: string; force?: boolean; now?: Date }) {
  const verification = verifyBackup(options.backupDir)
  if (!verification.ok) throw new Error(`Backup inválido: ${verification.problems.join('; ')}`)
  const databasePath = resolve(options.databasePath)
  const uploadDir = resolve(options.uploadDir)
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const preserved: string[] = []

  if (existsSync(databasePath) || existsSync(uploadDir)) {
    if (!options.force) throw new Error('Já existe banco ou diretório de uploads no destino. Use --force para preservar o atual e restaurar.')
    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, uploadDir]) {
      if (!existsSync(path)) continue
      const kept = `${path}.before-restore-${stamp}`
      renameSync(path, kept)
      preserved.push(kept)
    }
  }

  mkdirSync(resolve(databasePath, '..'), { recursive: true })
  cpSync(join(options.backupDir, 'argos.sqlite'), databasePath)
  mkdirSync(uploadDir, { recursive: true })
  cpSync(join(options.backupDir, 'uploads'), uploadDir, { recursive: true })

  const restored = new Database(databasePath, { readonly: true })
  const integrity = restored.pragma('integrity_check', { simple: true })
  restored.close()
  if (integrity !== 'ok') throw new Error('Banco restaurado falhou no integrity_check.')
  return { restored: databasePath, uploadDir, preserved, manifest: verification.manifest }
}

/** Remove backups antigos mantendo os `keep` mais recentes do diretório (rotação simples). */
export function pruneBackups(outDir: string, keep: number) {
  if (!existsSync(outDir) || keep < 1) return []
  const backups = readdirSync(outDir).filter((name) => name.startsWith('argos-backup-')).sort()
  const removed = backups.slice(0, Math.max(0, backups.length - keep))
  for (const name of removed) rmSync(join(outDir, name), { recursive: true, force: true })
  return removed
}
