import 'dotenv/config'
import { resolve } from 'node:path'
import { createBackup, pruneBackups, restoreBackup, verifyBackup } from './backup.js'

/**
 * Uso (a partir de backend/):
 *   node dist/ops/backup-cli.js backup --out ../backups [--keep 14]
 *   node dist/ops/backup-cli.js verify ../backups/argos-backup-<data>
 *   node dist/ops/backup-cli.js restore ../backups/argos-backup-<data> [--force]
 * Em desenvolvimento: npm run backup -- --out ../backups (via tsx).
 * Restaure somente com a API parada. DATABASE_URL e UPLOAD_DIR vêm do ambiente.
 */
const [command, ...args] = process.argv.slice(2)
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const databasePath = resolve(process.env.DATABASE_URL ?? './argos.sqlite')
const uploadDir = resolve(process.env.UPLOAD_DIR ?? 'uploads')

async function main() {
  if (command === 'backup') {
    const outDir = resolve(flag('out') ?? 'backups')
    const { path, manifest } = await createBackup({ databasePath, uploadDir, outDir })
    const verification = verifyBackup(path)
    if (!verification.ok) throw new Error(`Backup criado mas inválido: ${verification.problems.join('; ')}`)
    const keep = Number(flag('keep') ?? 0)
    const removed = keep > 0 ? pruneBackups(outDir, keep) : []
    console.log(JSON.stringify({ backup: path, schemaVersion: manifest.schemaVersion, counts: manifest.counts, uploads: manifest.uploads, removed }, null, 2))
    return
  }
  if (command === 'verify') {
    const result = verifyBackup(resolve(args[0] ?? ''))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.ok ? 0 : 1
    return
  }
  if (command === 'restore') {
    const result = restoreBackup({ backupDir: resolve(args[0] ?? ''), databasePath, uploadDir, force: args.includes('--force') })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.error('Comandos: backup --out <dir> [--keep N] | verify <dir> | restore <dir> [--force]')
  process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
