import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { env } from '../config/env.js'
import { privacyNotice } from '../config/privacy-notice.js'
import { runMigrations } from './migrations.js'

const dbPath = resolve(env.DATABASE_URL)
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

/** Aplica migrações versionadas pendentes (com cópia prévia do banco) e garante as contas iniciais. */
export function migrate() {
  const report = runMigrations(db, {
    backupDir: env.MIGRATION_BACKUP ? resolve(env.MIGRATION_BACKUP_DIR || join(dirname(dbPath), 'backups')) : null,
    log: (message) => console.log(message),
  })
  bootstrapAccounts()
  return report
}

/** Contas iniciais: idempotente e executado a cada boot (não altera o esquema). */
function bootstrapAccounts() {
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(env.ADMIN_EMAIL) as { id: number } | undefined
  if (!admin) {
    if (!env.ADMIN_PASSWORD) {
      throw new Error('ADMIN_PASSWORD é obrigatório para criar o administrador inicial. Defina-o no cofre de segredos, inicie uma vez e depois remova.')
    }
    db.prepare(`
      INSERT INTO users (name, email, password_hash, role, status, email_verified_at)
      VALUES (@name, @email, @passwordHash, 'admin', 'active', CURRENT_TIMESTAMP)
    `).run({
      name: 'Administrador ARGOS',
      email: env.ADMIN_EMAIL,
      passwordHash: bcrypt.hashSync(env.ADMIN_PASSWORD, 12),
    })
  } else {
    db.prepare(`
      UPDATE users
      SET role = 'admin', status = 'active',
          email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id: admin.id })
  }

  if (env.NODE_ENV === 'development' && env.DEV_TEST_USER_PASSWORD) {
    const testUser = {
      name: 'Usuário de teste ARGOS',
      email: env.DEV_TEST_USER_EMAIL,
      password: env.DEV_TEST_USER_PASSWORD,
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO users (name, email, password_hash, role, status, email_verified_at)
        VALUES (@name, @email, @passwordHash, 'citizen', 'active', CURRENT_TIMESTAMP)
        ON CONFLICT(email) DO UPDATE SET
          name = excluded.name,
          password_hash = excluded.password_hash,
          role = 'citizen',
          status = 'active',
          email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      `).run({ ...testUser, passwordHash: bcrypt.hashSync(testUser.password, 12) })

      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(testUser.email) as { id: number }
      db.prepare(`
        INSERT INTO privacy_consents (user_id, terms_version, purpose, granted, user_agent)
        SELECT ?, ?, 'account_registration', 1, 'development-seed'
        WHERE NOT EXISTS (
          SELECT 1 FROM privacy_consents WHERE user_id = ? AND purpose = 'account_registration'
        )
      `).run(user.id, privacyNotice.version, user.id)
    })()
  }
}

export type Role = 'user' | 'citizen' | 'space_manager' | 'org_admin' | 'support' | 'admin'

export type DbUser = {
  id: number
  name: string
  nickname: string | null
  email: string
  password_hash: string
  role: Role
  status: 'pending' | 'active' | 'blocked'
  spam_score: number
  avatar_url: string | null
  phone: string | null
  department: string | null
  bio: string | null
  preferred_contact: 'in_app' | 'email'
  language: 'pt-BR' | 'en-US' | 'es-ES'
  theme: 'system' | 'light' | 'dark'
  timezone: string
  date_format: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'
  compact_mode: number
  high_contrast: number
  email_verified_at?: string | null
  google_sub?: string | null
  created_at: string
  updated_at: string
}
