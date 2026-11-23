import type Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeKey } from '../utils/normalization.js'
import { pseudonymizeEmail } from '../utils/pseudonym.js'

export type Migration = {
  version: number
  name: string
  up: (db: Database.Database) => void
}

const columns = (db: Database.Database, table: string) => db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>

function ensureColumn(db: Database.Database, table: string, name: string, definition: string) {
  if (!columns(db, table).some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

const redactedBody = '[conteúdo removido após o processamento]'

/**
 * Migrações numeradas. Cada uma roda uma única vez, dentro de transação, e fica registrada em schema_migrations.
 * Nunca edite uma migração já publicada: crie a próxima versão.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'baseline_schema',
    // Esquema existente até 2026-11 (antes gerado a cada boot). Idempotente para bancos legados.
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_operations (
          user_id INTEGER NOT NULL,
          operation_key TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          item_id INTEGER NOT NULL,
          PRIMARY KEY(user_id, operation_key)
        );
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
        CREATE TABLE IF NOT EXISTS password_resets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS item_translations (
          item_id INTEGER NOT NULL,
          language TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          provider TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (item_id, language),
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rate_limit_windows (
          bucket_key TEXT PRIMARY KEY,
          hit_count INTEGER NOT NULL,
          reset_at INTEGER NOT NULL
        );
      `)

      // Colunas adicionadas ao longo do tempo em bancos criados por versões antigas.
      for (const [table, name, definition] of [
        ['users', 'email_verified_at', 'TEXT'],
        ['users', 'nickname', 'TEXT'],
        ['users', 'avatar_url', 'TEXT'],
        ['users', 'phone', 'TEXT'],
        ['users', 'department', 'TEXT'],
        ['users', 'bio', 'TEXT'],
        ['users', 'preferred_contact', "TEXT NOT NULL DEFAULT 'in_app'"],
        ['users', 'language', "TEXT NOT NULL DEFAULT 'pt-BR'"],
        ['users', 'theme', "TEXT NOT NULL DEFAULT 'system'"],
        ['users', 'timezone', "TEXT NOT NULL DEFAULT 'America/Sao_Paulo'"],
        ['users', 'date_format', "TEXT NOT NULL DEFAULT 'dd/MM/yyyy'"],
        ['users', 'compact_mode', 'INTEGER NOT NULL DEFAULT 0'],
        ['users', 'high_contrast', 'INTEGER NOT NULL DEFAULT 0'],
        ['items', 'moderation_note', 'TEXT'],
        ['items', 'archived_at', 'TEXT'],
        ['items', 'category_key', "TEXT NOT NULL DEFAULT ''"],
        ['items', 'location_key', "TEXT NOT NULL DEFAULT ''"],
        ['notifications', 'action_url', 'TEXT'],
        ['refresh_tokens', 'replaced_by_token_hash', 'TEXT'],
        ['refresh_tokens', 'last_used_at', 'TEXT'],
        ['audit_logs', 'user_agent', 'TEXT'],
        ['uploads', 'checksum', 'TEXT'],
        ['notification_preferences', 'last_digest_at', 'TEXT'],
        ['items', 'latitude', 'REAL'],
        ['items', 'longitude', 'REAL'],
        ['users', 'google_sub', 'TEXT'],
      ] as const) {
        ensureColumn(db, table, name, definition)
      }

      // Backfill único das chaves normalizadas (antes repetido em todo boot).
      const rows = db.prepare('SELECT id, category, location, category_key, location_key FROM items').all() as Array<{
        id: number
        category: string
        location: string
        category_key: string
        location_key: string
      }>
      const updateKeys = db.prepare('UPDATE items SET category_key = ?, location_key = ? WHERE id = ?')
      for (const row of rows) {
        const categoryKey = normalizeKey(row.category)
        const locationKey = normalizeKey(row.location)
        if (row.category_key !== categoryKey || row.location_key !== locationKey) updateKeys.run(categoryKey, locationKey, row.id)
      }

      // Remove reivindicações abertas duplicadas antes de impor as invariantes no banco.
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
        CREATE INDEX IF NOT EXISTS idx_uploads_user_url ON uploads (user_id, url);
        CREATE INDEX IF NOT EXISTS idx_favorites_item ON favorites (item_id);
        CREATE INDEX IF NOT EXISTS idx_item_history_item ON item_history (item_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_claims_claimant ON claims (claimant_id, id);
        CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id, used_at);
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_items_location ON items (approval_status, latitude, longitude);
      `)

      const hasItemsFts = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'items_fts'").get())
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
    },
  },
  {
    version: 2,
    name: 'email_verification_and_mail_privacy',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS email_verifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications (user_id, created_at);
      `)
      ensureColumn(db, 'mail_outbox', 'sensitive', 'INTEGER NOT NULL DEFAULT 0')
      ensureColumn(db, 'mail_outbox', 'expires_at', 'INTEGER')

      // Mensagens já processadas não precisam mais do corpo (links de senha antigos incluídos).
      db.prepare("UPDATE mail_outbox SET body = ? WHERE status <> 'pending'").run(redactedBody)
      // Links de redefinição pendentes há mais de 1 hora já expiraram: não serão enviados.
      db.prepare(
        `UPDATE mail_outbox SET status = 'expired', body = ?, sensitive = 1
         WHERE status = 'pending' AND subject = 'Redefinição de senha' AND created_at <= datetime('now', '-1 hour')`,
      ).run(redactedBody)
      db.prepare("UPDATE mail_outbox SET sensitive = 1 WHERE subject = 'Redefinição de senha'").run()

      // Auditoria passa a guardar pseudônimo em vez do e-mail digitado em logins falhos e pedidos de acesso.
      const rows = db
        .prepare(
          `SELECT id, entity_id FROM audit_logs
           WHERE action IN ('auth.login_failed', 'auth.access_requested') AND entity_id LIKE '%@%'`,
        )
        .all() as Array<{ id: number; entity_id: string }>
      const update = db.prepare('UPDATE audit_logs SET entity_id = ? WHERE id = ?')
      for (const row of rows) update.run(pseudonymizeEmail(row.entity_id), row.id)
      // Contas antigas sem email_verified_at continuam não verificadas: confirmam no próximo login.
    },
  },
  {
    version: 3,
    name: 'moderation_reports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS item_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER,
          item_title TEXT NOT NULL,
          reporter_id INTEGER,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
          assigned_to INTEGER,
          resolution_note TEXT,
          resolved_by INTEGER,
          resolved_at TEXT,
          legacy_audit_id INTEGER UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
          FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_item_reports_status ON item_reports (status, created_at);
        CREATE INDEX IF NOT EXISTS idx_item_reports_item ON item_reports (item_id, reporter_id, status);
      `)
      // Denúncias antigas existiam só como evento de auditoria: viram itens abertos da fila, sem perder o evento.
      db.exec(`
        INSERT OR IGNORE INTO item_reports (item_id, item_title, reporter_id, reason, status, legacy_audit_id, created_at, updated_at)
        SELECT items.id,
               COALESCE(items.title, 'Caso #' || audit_logs.entity_id || ' (removido)'),
               (SELECT users.id FROM users WHERE users.id = audit_logs.actor_id),
               COALESCE(NULLIF(json_extract(CASE WHEN json_valid(audit_logs.metadata) THEN audit_logs.metadata END, '$.reason'), ''), 'Sem motivo informado'),
               'open', audit_logs.id, audit_logs.created_at, audit_logs.created_at
        FROM audit_logs
        LEFT JOIN items ON items.id = CAST(audit_logs.entity_id AS INTEGER)
        WHERE audit_logs.action = 'item.reported'
      `)
    },
  },
  {
    version: 4,
    name: 'match_refresh_and_notification_dedup',
    up(db) {
      ensureColumn(db, 'item_matches', 'updated_at', 'TEXT')
      db.exec(`
        CREATE TABLE IF NOT EXISTS item_match_notifications (
          item_id INTEGER NOT NULL,
          matched_item_id INTEGER NOT NULL,
          notified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (item_id, matched_item_id),
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
          FOREIGN KEY (matched_item_id) REFERENCES items(id) ON DELETE CASCADE
        );
        -- Pares existentes já geraram aviso quando foram criados: não avisar de novo após edição.
        INSERT OR IGNORE INTO item_match_notifications (item_id, matched_item_id, notified_at)
        SELECT item_id, matched_item_id, created_at FROM item_matches;
      `)
    },
  },
  {
    version: 5,
    name: 'organizations_spaces_and_scoped_roles',
    // Sprint 5: modelo de tenant (organização > espaço), vínculos com papel de escopo e convites de gestores.
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL UNIQUE,
          description TEXT,
          contact_email TEXT,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS spaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL,
          description TEXT,
          address TEXT,
          latitude REAL,
          longitude REAL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (organization_id, name_key),
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
        );
        -- Papel de escopo: org_admin vale para a organização inteira; space_manager, só para o espaço indicado.
        CREATE TABLE IF NOT EXISTS organization_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id INTEGER NOT NULL,
          space_id INTEGER,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('org_admin', 'space_manager')),
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((role = 'org_admin' AND space_id IS NULL) OR (role = 'space_manager' AND space_id IS NOT NULL)),
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_unique
          ON organization_members (organization_id, user_id, role, COALESCE(space_id, 0));
        CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members (user_id);
        -- Convite de gestor: só o hash do token fica no banco; o link vai por e-mail e vale por tempo limitado.
        CREATE TABLE IF NOT EXISTS manager_invites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id INTEGER NOT NULL,
          space_id INTEGER,
          email TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('org_admin', 'space_manager')),
          token_hash TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
          invited_by INTEGER,
          accepted_by INTEGER,
          expires_at TEXT NOT NULL,
          accepted_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((role = 'org_admin' AND space_id IS NULL) OR (role = 'space_manager' AND space_id IS NOT NULL)),
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
          FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_manager_invites_org ON manager_invites (organization_id, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_manager_invites_email ON manager_invites (email, status);
      `)
      // Espaço institucional do caso (opcional): define quais gestores podem tratar o caso.
      ensureColumn(db, 'items', 'space_id', 'INTEGER REFERENCES spaces(id) ON DELETE SET NULL')
      db.exec('CREATE INDEX IF NOT EXISTS idx_items_space ON items (space_id, approval_status, status)')
    },
  },
  {
    version: 6,
    name: 'chat_and_automatic_moderation',
    // Sprint 6: conversa privada por caso (quem publicou x interessado) e registro das decisões automáticas de moderação.
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          owner_id INTEGER NOT NULL,
          participant_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
          closed_by INTEGER,
          owner_last_read_id INTEGER NOT NULL DEFAULT 0,
          participant_last_read_id INTEGER NOT NULL DEFAULT 0,
          last_message_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (item_id, participant_id),
          CHECK (owner_id <> participant_id),
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (participant_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations (owner_id, last_message_at);
        CREATE INDEX IF NOT EXISTS idx_conversations_participant ON conversations (participant_id, last_message_at);
        CREATE TABLE IF NOT EXISTS chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL,
          sender_id INTEGER NOT NULL,
          body TEXT NOT NULL,
          -- visible: entregue; flagged: entregue e na fila da moderação; removed: retirada pela moderação.
          status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'flagged', 'removed')),
          moderation_rule TEXT,
          reported_by INTEGER,
          reviewed_by INTEGER,
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
          FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, id);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_status ON chat_messages (status, id);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages (sender_id, created_at);
        -- Decisões automáticas (bloqueio, sinalização, ocultação, silêncio): base das regras por reincidência.
        CREATE TABLE IF NOT EXISTS moderation_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          context TEXT NOT NULL,
          rule TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('blocked', 'flagged', 'warned', 'hidden', 'muted')),
          entity_type TEXT,
          entity_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_moderation_events_user ON moderation_events (user_id, action, created_at);
        CREATE INDEX IF NOT EXISTS idx_moderation_events_created ON moderation_events (created_at);
      `)
      // Silêncio temporário aplicado pelas regras automáticas (pistas e conversas); expira sozinho.
      ensureColumn(db, 'users', 'chat_muted_until', 'TEXT')
    },
  },
  {
    version: 7,
    name: 'custody_chain_and_search_synonyms',
    // Sprint 7: cadeia de custódia somente-inserção, encadeada por hash, e dicionário de sinônimos da busca.
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS custody_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          -- item_ref/space_ref/actor_ref são os identificadores originais (entram no hash e nunca mudam);
          -- item_id/space_id/actor_id são vínculos que viram NULL se o registro relacionado for removido.
          item_ref INTEGER NOT NULL,
          item_id INTEGER,
          item_title TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL CHECK (event_type IN ('received', 'stored', 'transferred', 'handed_over', 'disposed', 'note')),
          space_ref INTEGER,
          space_id INTEGER,
          space_name TEXT,
          storage_location TEXT,
          claim_id INTEGER,
          notes TEXT,
          actor_ref INTEGER NOT NULL,
          actor_id INTEGER,
          occurred_at TEXT NOT NULL,
          prev_hash TEXT NOT NULL,
          hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (item_ref, sequence),
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
          FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL,
          FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_custody_events_item ON custody_events (item_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_custody_events_space ON custody_events (space_ref, event_type, occurred_at);
        -- A trilha é somente-inserção: só os vínculos (item_id, space_id, actor_id) podem virar NULL.
        CREATE TRIGGER IF NOT EXISTS custody_events_immutable BEFORE UPDATE ON custody_events
        WHEN NOT (
          NEW.id = OLD.id AND NEW.item_ref = OLD.item_ref AND NEW.item_title = OLD.item_title AND NEW.sequence = OLD.sequence
          AND NEW.event_type = OLD.event_type AND NEW.space_ref IS OLD.space_ref AND NEW.space_name IS OLD.space_name
          AND NEW.storage_location IS OLD.storage_location AND NEW.claim_id IS OLD.claim_id AND NEW.notes IS OLD.notes
          AND NEW.actor_ref = OLD.actor_ref AND NEW.occurred_at = OLD.occurred_at AND NEW.prev_hash = OLD.prev_hash
          AND NEW.hash = OLD.hash AND NEW.created_at = OLD.created_at
          AND (NEW.item_id IS OLD.item_id OR NEW.item_id IS NULL)
          AND (NEW.space_id IS OLD.space_id OR NEW.space_id IS NULL)
          AND (NEW.actor_id IS OLD.actor_id OR NEW.actor_id IS NULL)
        )
        BEGIN
          SELECT RAISE(ABORT, 'custody_events: a cadeia de custódia não pode ser alterada');
        END;
        CREATE TRIGGER IF NOT EXISTS custody_events_no_delete BEFORE DELETE ON custody_events
        BEGIN
          SELECT RAISE(ABORT, 'custody_events: a cadeia de custódia não pode ser apagada');
        END;
        CREATE TABLE IF NOT EXISTS search_synonym_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          terms TEXT NOT NULL,
          created_by INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
      `)
      // Dicionário inicial (termos já normalizados: sem acento, minúsculos). A administração edita pela API.
      const seeded = db.prepare('SELECT COUNT(*) AS total FROM search_synonym_groups').get() as { total: number }
      if (!seeded.total) {
        const insert = db.prepare('INSERT INTO search_synonym_groups (terms) VALUES (?)')
        for (const group of [
          ['celular', 'telefone', 'smartphone', 'iphone', 'aparelho'],
          ['notebook', 'laptop', 'computador', 'macbook'],
          ['fone', 'headphone', 'headset', 'earbuds', 'airpods', 'auricular'],
          ['carregador', 'fonte', 'cabo'],
          ['mochila', 'bolsa', 'bag', 'sacola'],
          ['carteira', 'porta cartao', 'porta documentos'],
          ['documento', 'rg', 'cnh', 'identidade', 'cracha', 'carteirinha'],
          ['chave', 'chaveiro', 'molho'],
          ['oculos', 'lente', 'armacao'],
          ['garrafa', 'squeeze', 'copo termico', 'cantil', 'termica'],
          ['guarda chuva', 'sombrinha'],
          ['casaco', 'jaqueta', 'blusa', 'moletom', 'agasalho'],
          ['bone', 'chapeu', 'gorro', 'touca'],
          ['relogio', 'smartwatch', 'pulseira'],
          ['pendrive', 'pen drive', 'hd externo', 'flash drive'],
          ['estojo', 'penal', 'necessaire'],
          ['caderno', 'agenda', 'fichario', 'bloco'],
          ['tablet', 'ipad', 'kindle'],
          ['bicicleta', 'bike'],
          ['anel', 'alianca'],
          ['colar', 'corrente', 'cordao'],
        ]) {
          insert.run(JSON.stringify(group))
        }
      }
    },
  },
  {
    version: 8,
    name: 'retention_runs_and_system_alerts',
    // Sprint 8: histórico das rotinas de retenção e alertas automáticos de saúde da API.
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS retention_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
          actor_id INTEGER,
          report TEXT NOT NULL,
          total INTEGER NOT NULL DEFAULT 0,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_retention_runs_finished ON retention_runs (finished_at);
        CREATE TABLE IF NOT EXISTS system_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          alert_key TEXT NOT NULL,
          severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'firing' CHECK (status IN ('firing', 'resolved')),
          value REAL,
          threshold REAL,
          fired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          resolved_at TEXT
        );
        -- No máximo um alerta ativo por regra: a regra que continua disparando só atualiza last_seen_at.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_system_alerts_firing ON system_alerts (alert_key) WHERE status = 'firing';
        CREATE INDEX IF NOT EXISTS idx_system_alerts_fired ON system_alerts (fired_at);
      `)
      // Momento em que a reivindicação foi encerrada: referência do prazo para apagar as provas enviadas.
      ensureColumn(db, 'claims', 'proof_redacted_at', 'TEXT')
    },
  },
]

export const latestSchemaVersion = Math.max(...migrations.map((migration) => migration.version))

export type MigrationOptions = {
  /** Diretório onde salvar a cópia anterior às migrações; null desativa. */
  backupDir?: string | null
  now?: Date
  log?: (message: string) => void
  /** Lista alternativa (usada nos testes de falha parcial). */
  migrations?: Migration[]
}

export type MigrationReport = { from: number; to: number; applied: number[]; backupPath: string | null }

export function currentSchemaVersion(db: Database.Database) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (!table) return 0
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null }
  return row.version ?? 0
}

/** Aplica, em ordem, as migrações pendentes. Falha em uma migração desfaz só aquela e interrompe o processo. */
export function runMigrations(db: Database.Database, options: MigrationOptions = {}): MigrationReport {
  const log = options.log ?? (() => undefined)
  const list = options.migrations ?? migrations
  const latest = Math.max(...list.map((migration) => migration.version))
  const from = currentSchemaVersion(db)
  if (from > latest) {
    throw new Error(
      `Banco na versão de esquema ${from}, mais nova que a suportada por este código (${latest}). Use a versão correspondente ou restaure o backup.`,
    )
  }
  const pending = list.filter((migration) => migration.version > from).sort((a, b) => a.version - b.version)
  if (!pending.length) return { from, to: from, applied: [], backupPath: null }

  // Banco existente (com dados) recebe uma cópia consistente antes da primeira alteração.
  const hasExistingSchema = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get())
  let backupPath: string | null = null
  if (hasExistingSchema && options.backupDir && db.name && db.name !== ':memory:') {
    mkdirSync(options.backupDir, { recursive: true })
    const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
    backupPath = join(options.backupDir, `argos-pre-migration-v${from}-to-v${latest}-${stamp}.sqlite`)
    db.prepare('VACUUM INTO ?').run(backupPath)
    log(`[db] Cópia de segurança antes das migrações: ${backupPath}`)
  }

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
  const applied: number[] = []
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db)
      record.run(migration.version, migration.name)
    }).immediate()
    applied.push(migration.version)
    log(`[db] Migração ${migration.version} (${migration.name}) aplicada.`)
  }
  return { from, to: latest, applied, backupPath }
}
