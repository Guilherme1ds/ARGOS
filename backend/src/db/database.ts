import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { env } from '../config/env.js'
import { normalizeKey } from '../utils/normalization.js'

const dbPath = resolve(env.DATABASE_URL)
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nickname TEXT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'citizen',
      status TEXT NOT NULL DEFAULT 'pending',
      spam_score INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT,
      phone TEXT,
      department TEXT,
      bio TEXT,
      preferred_contact TEXT NOT NULL DEFAULT 'in_app',
      language TEXT NOT NULL DEFAULT 'pt-BR',
      theme TEXT NOT NULL DEFAULT 'system',
      timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
      date_format TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
      compact_mode INTEGER NOT NULL DEFAULT 0,
      high_contrast INTEGER NOT NULL DEFAULT 0,
      email_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      checksum TEXT,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      category_key TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL,
      location_key TEXT NOT NULL DEFAULT '',
      campus_block TEXT,
      approximate_place TEXT,
      event_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'lost',
      approval_status TEXT NOT NULL DEFAULT 'pending',
      moderation_note TEXT,
      archived_at TEXT,
      image_url TEXT,
      contact_preference TEXT NOT NULL DEFAULT 'in_app',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      claimant_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      proof_details TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (claimant_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT NOT NULL,
      action_url TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS item_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      actor_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      replaced_by_token_hash TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      query_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_search_matches (
      saved_search_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (saved_search_id, item_id),
      FOREIGN KEY (saved_search_id) REFERENCES saved_searches(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS item_matches (
      item_id INTEGER NOT NULL,
      matched_item_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      reasons TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (item_id, matched_item_id),
      CHECK (item_id < matched_item_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (matched_item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id INTEGER PRIMARY KEY,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      in_app_enabled INTEGER NOT NULL DEFAULT 1,
      digest_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS privacy_consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      terms_version TEXT NOT NULL,
      purpose TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 1,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mail_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS rate_limit_windows (
      bucket_key TEXT PRIMARY KEY,
      hit_count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );
  `)

  const columns = (table: string) => db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  const ensureColumn = (table: string, name: string, definition: string) => {
    if (!columns(table).some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }

  ensureColumn('users', 'email_verified_at', 'TEXT')
  ensureColumn('users', 'nickname', 'TEXT')
  ensureColumn('users', 'avatar_url', 'TEXT')
  ensureColumn('users', 'phone', 'TEXT')
  ensureColumn('users', 'department', 'TEXT')
  ensureColumn('users', 'bio', 'TEXT')
  ensureColumn('users', 'preferred_contact', "TEXT NOT NULL DEFAULT 'in_app'")
  ensureColumn('users', 'language', "TEXT NOT NULL DEFAULT 'pt-BR'")
  ensureColumn('users', 'theme', "TEXT NOT NULL DEFAULT 'system'")
  ensureColumn('users', 'timezone', "TEXT NOT NULL DEFAULT 'America/Sao_Paulo'")
  ensureColumn('users', 'date_format', "TEXT NOT NULL DEFAULT 'dd/MM/yyyy'")
  ensureColumn('users', 'compact_mode', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('users', 'high_contrast', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('items', 'moderation_note', 'TEXT')
  ensureColumn('items', 'archived_at', 'TEXT')
  ensureColumn('items', 'category_key', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('items', 'location_key', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('notifications', 'action_url', 'TEXT')
  ensureColumn('refresh_tokens', 'replaced_by_token_hash', 'TEXT')
  ensureColumn('refresh_tokens', 'last_used_at', 'TEXT')
  ensureColumn('audit_logs', 'user_agent', 'TEXT')
  ensureColumn('uploads', 'checksum', 'TEXT')

  const itemKeys = db.prepare('SELECT id, category, location, category_key, location_key FROM items').all() as Array<{
    id: number
    category: string
    location: string
    category_key: string
    location_key: string
  }>
  const updateItemKeys = db.prepare('UPDATE items SET category_key = ?, location_key = ? WHERE id = ?')
  const backfillItemKeys = db.transaction(() => {
    for (const item of itemKeys) {
      const categoryKey = normalizeKey(item.category)
      const locationKey = normalizeKey(item.location)
      if (item.category_key !== categoryKey || item.location_key !== locationKey) {
        updateItemKeys.run(categoryKey, locationKey, item.id)
      }
    }
  })
  backfillItemKeys()

  // Deduplicate legacy open claims before enforcing the invariants at database level.
  db.exec(`
    UPDATE claims
    SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
    WHERE status IN ('pending', 'approved')
      AND id NOT IN (
        SELECT MIN(id) FROM claims
        WHERE status IN ('pending', 'approved')
        GROUP BY item_id, claimant_id
      );

    UPDATE claims
    SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'approved'
      AND id NOT IN (
        SELECT MIN(id) FROM claims
        WHERE status = 'approved'
        GROUP BY item_id
      );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_search ON items (approval_status, status, type, event_date, created_at);
    CREATE INDEX IF NOT EXISTS idx_items_owner ON items (owner_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_items_normalized_location ON items (category_key, location_key, event_date);
    CREATE INDEX IF NOT EXISTS idx_claims_item_status ON claims (item_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_one_open_per_user
      ON claims (item_id, claimant_id) WHERE status IN ('pending', 'approved');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_one_approved_per_item
      ON claims (item_id) WHERE status = 'approved';
    CREATE INDEX IF NOT EXISTS idx_comments_item_created ON comments (item_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, read_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active ON refresh_tokens (user_id, revoked_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_privacy_consents_user ON privacy_consents (user_id, purpose, created_at);
    CREATE INDEX IF NOT EXISTS idx_saved_searches_user_enabled ON saved_searches (user_id, enabled, created_at);
    CREATE INDEX IF NOT EXISTS idx_saved_searches_enabled ON saved_searches (enabled, id);
    CREATE INDEX IF NOT EXISTS idx_mail_outbox_pending ON mail_outbox (status, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_windows (reset_at);
    CREATE INDEX IF NOT EXISTS idx_uploads_checksum ON uploads (checksum);
  `)

  const hasItemsFts = Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items_fts'").get(),
  )
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, description, category, location, campus_block, approximate_place,
      content = 'items', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title, description, category, location, campus_block, approximate_place)
      VALUES (new.id, new.title, new.description, new.category, new.location, new.campus_block, new.approximate_place);
    END;

    CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, description, category, location, campus_block, approximate_place)
      VALUES ('delete', old.id, old.title, old.description, old.category, old.location, old.campus_block, old.approximate_place);
    END;

    CREATE TRIGGER IF NOT EXISTS items_fts_update AFTER UPDATE OF title, description, category, location, campus_block, approximate_place ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, description, category, location, campus_block, approximate_place)
      VALUES ('delete', old.id, old.title, old.description, old.category, old.location, old.campus_block, old.approximate_place);
      INSERT INTO items_fts(rowid, title, description, category, location, campus_block, approximate_place)
      VALUES (new.id, new.title, new.description, new.category, new.location, new.campus_block, new.approximate_place);
    END;
  `)
  if (!hasItemsFts) db.exec("INSERT INTO items_fts(items_fts) VALUES ('rebuild')")

  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(env.ADMIN_EMAIL) as { id: number } | undefined
  if (!admin) {
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

  if (env.NODE_ENV === 'development') {
    const testUser = {
      name: 'Usuário de teste ARGOS',
      email: 'usuario.teste@argos.local',
      password: 'Usuario@123',
    }

    const seedTestUser = db.transaction(() => {
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
        SELECT ?, '2026-08-18', 'account_registration', 1, 'development-seed'
        WHERE NOT EXISTS (
          SELECT 1
          FROM privacy_consents
          WHERE user_id = ? AND purpose = 'account_registration'
        )
      `).run(user.id, user.id)
    })

    seedTestUser()
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
  created_at: string
  updated_at: string
}
