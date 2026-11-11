import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), `argos-migrations-${Date.now()}-${process.pid}`)
let migrationsModule: typeof import('../src/db/migrations.js')
let backupModule: typeof import('../src/ops/backup.js')

/** Esquema como as versões antigas criavam (sem colunas novas e sem registro de migração). */
function legacyDatabase(path: string) {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'citizen', status TEXT NOT NULL DEFAULT 'pending',
      spam_score INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL, category TEXT NOT NULL, location TEXT NOT NULL, campus_block TEXT, approximate_place TEXT,
      event_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'lost', approval_status TEXT NOT NULL DEFAULT 'pending',
      image_url TEXT, contact_preference TEXT NOT NULL DEFAULT 'in_app', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (owner_id) REFERENCES users(id));
    CREATE TABLE claims (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, claimant_id INTEGER NOT NULL,
      message TEXT NOT NULL, proof_details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT, metadata TEXT, ip_address TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE mail_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at TEXT);
    CREATE TABLE item_matches (item_id INTEGER NOT NULL, matched_item_id INTEGER NOT NULL, score INTEGER NOT NULL, reasons TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (item_id, matched_item_id));

    INSERT INTO users (id, name, email, password_hash, status) VALUES (1, 'Pessoa Antiga', 'legacy@example.com', 'x', 'active');
    INSERT INTO users (id, name, email, password_hash, status) VALUES (2, 'Outra', 'other@example.com', 'x', 'active');
    INSERT INTO items (id, owner_id, type, title, description, category, location, event_date, status, approval_status)
      VALUES (1, 1, 'lost', 'Fone azul', 'Fone azul perdido na biblioteca.', 'Eletrônicos', 'Bloco Á', '2026-09-01', 'claimed', 'approved'),
             (2, 2, 'found', 'Fone encontrado', 'Fone encontrado no corredor.', 'Eletrônicos', 'Bloco A', '2026-09-02', 'found', 'approved');
    INSERT INTO claims (item_id, claimant_id, message, proof_details, status) VALUES
      (1, 2, 'Mensagem antiga 1', 'Prova antiga 1', 'pending'),
      (1, 2, 'Mensagem antiga 2', 'Prova antiga 2', 'pending');
    INSERT INTO item_matches (item_id, matched_item_id, score, reasons) VALUES (1, 2, 80, '["mesma categoria"]');
    INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES
      ('auth.login_failed', 'user', 'Legacy@Example.com', NULL),
      ('auth.login_succeeded', 'user', '1', NULL),
      ('item.reported', 'item', '1', '{"reason":"Parece anúncio"}'),
      ('item.reported', 'item', '999', 'not-json');
    INSERT INTO mail_outbox (to_email, subject, body, status) VALUES
      ('legacy@example.com', 'Redefinição de senha', 'acesse: http://localhost:5173/reset-password?token=SENT_TOKEN_VALUE', 'sent');
    INSERT INTO mail_outbox (to_email, subject, body, status, created_at) VALUES
      ('legacy@example.com', 'Redefinição de senha', 'acesse: http://localhost:5173/reset-password?token=OLD_PENDING_TOKEN', 'pending', datetime('now', '-3 hours'));
  `)
  return db
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'migration-test-secret-with-enough-length'
  mkdirSync(root, { recursive: true })
  migrationsModule = await import('../src/db/migrations.js')
  backupModule = await import('../src/ops/backup.js')
})

afterAll(() => {
  const absolute = resolve(root)
  if (absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes('argos-migrations-') && existsSync(absolute)) {
    rmSync(absolute, { recursive: true, force: true })
  }
})

describe('DATA-03 versioned migrations', () => {
  it('upgrades a legacy database once, with a pre-migration copy, and preserves its data', () => {
    const path = join(root, 'legacy.sqlite')
    const db = legacyDatabase(path)
    const backupDir = join(root, 'pre-migration')
    const report = migrationsModule.runMigrations(db, { backupDir })

    expect(report.from).toBe(0)
    expect(report.applied).toEqual(migrationsModule.migrations.map((migration) => migration.version))
    expect(report.backupPath && existsSync(report.backupPath)).toBe(true)
    // A cópia anterior continua no esquema antigo, com os dados originais.
    const copy = new Database(report.backupPath!, { readonly: true })
    expect(copy.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'").get()).toBeUndefined()
    expect((copy.prepare('SELECT COUNT(*) AS total FROM items').get() as { total: number }).total).toBe(2)
    copy.close()

    const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
    expect(columns('users')).toEqual(expect.arrayContaining(['email_verified_at', 'google_sub', 'nickname']))
    expect(columns('items')).toEqual(expect.arrayContaining(['category_key', 'location_key', 'latitude']))
    expect(db.prepare('SELECT category_key, location_key FROM items WHERE id = 1').get()).toEqual({ category_key: 'eletronicos', location_key: 'bloco a' })
    // Contas antigas não são presumidas como verificadas.
    expect(db.prepare('SELECT email_verified_at FROM users WHERE id = 1').get()).toEqual({ email_verified_at: null })
    // Duplicidade de reivindicação aberta resolvida antes do índice único.
    expect(db.prepare("SELECT COUNT(*) AS total FROM claims WHERE status = 'pending'").get()).toEqual({ total: 1 })

    // SEC-01/DATA-01: corpo de e-mail já processado e link vencido saem do banco; auditoria sem e-mail em claro.
    const mails = db.prepare('SELECT status, body FROM mail_outbox ORDER BY id').all() as Array<{ status: string; body: string }>
    expect(mails.map((mail) => mail.status)).toEqual(['sent', 'expired'])
    expect(JSON.stringify(mails)).not.toMatch(/SENT_TOKEN_VALUE|OLD_PENDING_TOKEN/)
    const failedLogin = db.prepare("SELECT entity_id FROM audit_logs WHERE action = 'auth.login_failed'").get() as { entity_id: string }
    expect(failedLogin.entity_id).toMatch(/^email:[0-9a-f]{24}$/)

    // MOD-01: denúncias antigas viram a fila, inclusive de caso removido e metadado inválido.
    const reports = db.prepare('SELECT item_id, item_title, reason, status FROM item_reports ORDER BY id').all()
    expect(reports).toEqual([
      { item_id: 1, item_title: 'Fone azul', reason: 'Parece anúncio', status: 'open' },
      { item_id: null, item_title: 'Caso #999 (removido)', reason: 'Sem motivo informado', status: 'open' },
    ])
    // FUNC-02: par existente já foi avisado e não gera novo aviso após edição.
    expect(db.prepare('SELECT item_id, matched_item_id FROM item_match_notifications').all()).toEqual([{ item_id: 1, matched_item_id: 2 }])

    const snapshot = JSON.stringify([
      db.prepare('SELECT * FROM items ORDER BY id').all(),
      db.prepare('SELECT * FROM item_reports ORDER BY id').all(),
      db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),
    ])
    const again = migrationsModule.runMigrations(db, { backupDir })
    expect(again.applied).toEqual([])
    expect(again.backupPath).toBeNull()
    expect(
      JSON.stringify([
        db.prepare('SELECT * FROM items ORDER BY id').all(),
        db.prepare('SELECT * FROM item_reports ORDER BY id').all(),
        db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),
      ]),
    ).toBe(snapshot)
    expect(readdirSync(backupDir)).toHaveLength(1)
    db.close()
  })

  it('creates a fresh schema without taking a backup of an empty database', () => {
    const db = new Database(join(root, 'fresh.sqlite'))
    const report = migrationsModule.runMigrations(db, { backupDir: join(root, 'fresh-backups') })
    expect(report.backupPath).toBeNull()
    expect(migrationsModule.currentSchemaVersion(db)).toBe(migrationsModule.latestSchemaVersion)
    expect(existsSync(join(root, 'fresh-backups'))).toBe(false)
    db.close()
  })

  it('rolls back only the failing migration and resumes after the fix', () => {
    const db = new Database(join(root, 'partial.sqlite'))
    const first = { version: 1, name: 'one', up: (database: Database.Database) => database.exec('CREATE TABLE one (id INTEGER)') }
    const broken = {
      version: 2,
      name: 'two',
      up: (database: Database.Database) => {
        database.exec('CREATE TABLE two (id INTEGER)')
        throw new Error('falha simulada')
      },
    }
    expect(() => migrationsModule.runMigrations(db, { migrations: [first, broken] })).toThrow('falha simulada')
    expect(migrationsModule.currentSchemaVersion(db)).toBe(1)
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'two'").get()).toBeUndefined()

    const fixed = { version: 2, name: 'two', up: (database: Database.Database) => database.exec('CREATE TABLE two (id INTEGER)') }
    expect(migrationsModule.runMigrations(db, { migrations: [first, fixed] }).applied).toEqual([2])
    db.close()
  })

  it('refuses to run older code against a newer schema', () => {
    const db = new Database(join(root, 'newer.sqlite'))
    migrationsModule.runMigrations(db)
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (999, 'futura')").run()
    expect(() => migrationsModule.runMigrations(db)).toThrow(/mais nova/)
    db.close()
  })
})

describe('OPS-01 backup, verification and restore', () => {
  function seedInstallation(name: string) {
    const dir = join(root, name)
    const uploads = join(dir, 'uploads')
    mkdirSync(uploads, { recursive: true })
    const path = join(dir, 'argos.sqlite')
    const db = new Database(path)
    db.pragma('journal_mode = WAL')
    migrationsModule.runMigrations(db)
    db.prepare("INSERT INTO users (id, name, email, password_hash, status, avatar_url) VALUES (1, 'Dona', 'dona@example.com', 'x', 'active', '/uploads/avatar.png')").run()
    db.prepare(
      `INSERT INTO items (owner_id, type, title, description, category, location, event_date, status, approval_status, image_url)
       VALUES (1, 'found', 'Mochila', 'Mochila encontrada no pátio.', 'Bolsas', 'Pátio', '2026-10-01', 'found', 'approved', '/uploads/item.png')`,
    ).run()
    writeFileSync(join(uploads, 'avatar.png'), 'avatar')
    writeFileSync(join(uploads, 'item.png'), 'item')
    return { dir, path, uploads, db }
  }

  it('backs up a live WAL database with its uploads and restores it to an isolated location', async () => {
    const source = seedInstallation('live')
    const { path: backupPath, manifest } = await backupModule.createBackup({
      databasePath: source.path,
      uploadDir: source.uploads,
      outDir: join(root, 'backups'),
    })
    // Escrita depois do backup não aparece na cópia.
    source.db.prepare("UPDATE items SET title = 'Alterado depois' WHERE id = 1").run()
    source.db.close()

    expect(manifest.counts).toMatchObject({ users: 1, items: 1 })
    expect(manifest.uploads.files).toBe(2)
    expect(backupModule.verifyBackup(backupPath)).toMatchObject({ ok: true, problems: [] })

    const target = join(root, 'restored')
    const restored = backupModule.restoreBackup({ backupDir: backupPath, databasePath: join(target, 'argos.sqlite'), uploadDir: join(target, 'uploads') })
    expect(restored.preserved).toEqual([])
    const db = new Database(join(target, 'argos.sqlite'), { readonly: true })
    expect(db.prepare('SELECT title FROM items WHERE id = 1').get()).toEqual({ title: 'Mochila' })
    expect(migrationsModule.currentSchemaVersion(db)).toBe(migrationsModule.latestSchemaVersion)
    db.close()
    expect(existsSync(join(target, 'uploads', 'item.png'))).toBe(true)

    // Sem --force, não sobrescreve; com --force, preserva o estado anterior para desfazer.
    expect(() => backupModule.restoreBackup({ backupDir: backupPath, databasePath: join(target, 'argos.sqlite'), uploadDir: join(target, 'uploads') })).toThrow(/--force/)
    const forced = backupModule.restoreBackup({ backupDir: backupPath, databasePath: join(target, 'argos.sqlite'), uploadDir: join(target, 'uploads'), force: true })
    expect(forced.preserved.length).toBeGreaterThan(0)
    for (const kept of forced.preserved) expect(existsSync(kept)).toBe(true)
  })

  it('detects tampered databases and missing referenced images', async () => {
    const source = seedInstallation('tamper')
    source.db.close()
    const { path: backupPath } = await backupModule.createBackup({ databasePath: source.path, uploadDir: source.uploads, outDir: join(root, 'tamper-backups') })
    rmSync(join(backupPath, 'uploads', 'item.png'))
    expect(backupModule.verifyBackup(backupPath).problems.join()).toMatch(/imagem/)

    const db = new Database(join(backupPath, 'argos.sqlite'))
    db.prepare("UPDATE items SET title = 'adulterado'").run()
    db.close()
    const verification = backupModule.verifyBackup(backupPath)
    expect(verification.ok).toBe(false)
    expect(verification.problems.join()).toMatch(/hash/)
    expect(() => backupModule.restoreBackup({ backupDir: backupPath, databasePath: join(root, 'never', 'a.sqlite'), uploadDir: join(root, 'never', 'u') })).toThrow(/Backup inválido/)
  })

  it('keeps only the most recent backups when pruning', () => {
    const dir = join(root, 'rotation')
    for (const stamp of ['2026-01-01', '2026-01-02', '2026-01-03']) mkdirSync(join(dir, `argos-backup-${stamp}`), { recursive: true })
    expect(backupModule.pruneBackups(dir, 2)).toEqual(['argos-backup-2026-01-01'])
    expect(readdirSync(dir).sort()).toEqual(['argos-backup-2026-01-02', 'argos-backup-2026-01-03'])
  })
})
