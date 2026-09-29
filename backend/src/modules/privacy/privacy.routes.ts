import { Router } from 'express'
import { db } from '../../db/database.js'
import { auth, optionalAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()

router.get(
  '/summary',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const consents = req.user
      ? db
          .prepare(
            `SELECT terms_version, purpose, granted, created_at
             FROM privacy_consents
             WHERE user_id = ?
             ORDER BY created_at DESC`,
          )
          .all(req.user.id)
      : []

    res.json({
      data: {
        termsVersion: '2026-08-18',
        controller: 'ARGOS',
        purposes: [
          'Cadastro e autenticação',
          'Publicação e busca de itens perdidos ou encontrados',
          'Reivindicação e validação de propriedade',
          'Comunicações operacionais e notificações',
          'Auditoria, segurança e prevenção a fraude',
        ],
        publicDataPolicy:
          'A busca pública mostra apenas dados minimizados do item. E-mail, evidências, histórico interno e dados sensíveis ficam restritos a usuários autorizados.',
        userRights: ['acesso', 'correção', 'portabilidade quando aplicável', 'revogação', 'exclusão ou anonimização'],
        consents,
      },
    })
  }),
)

// Portabilidade: tudo o que a conta produziu, sem dados de terceiros (provas de outras pessoas ficam de fora).
router.get(
  '/export',
  auth,
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const profile = db
      .prepare(
        `SELECT id, name, nickname, email, role, status, avatar_url, phone, department, bio, preferred_contact,
                language, theme, timezone, date_format, compact_mode, high_contrast, created_at, updated_at
         FROM users WHERE id = ?`,
      )
      .get(userId)

    const data = {
      exportedAt: new Date().toISOString(),
      profile,
      notificationPreferences: db.prepare('SELECT email_enabled, in_app_enabled, digest_enabled FROM notification_preferences WHERE user_id = ?').get(userId) ?? null,
      consents: db.prepare('SELECT terms_version, purpose, granted, created_at FROM privacy_consents WHERE user_id = ? ORDER BY created_at').all(userId),
      items: db
        .prepare(
          `SELECT id, type, title, description, category, location, campus_block, approximate_place, event_date, status,
                  approval_status, image_url, contact_preference, created_at, updated_at
           FROM items WHERE owner_id = ? ORDER BY id`,
        )
        .all(userId),
      claims: db
        .prepare(
          `SELECT claims.id, claims.item_id, items.title AS item_title, claims.message, claims.proof_details, claims.status,
                  claims.created_at, claims.updated_at
           FROM claims JOIN items ON items.id = claims.item_id WHERE claims.claimant_id = ? ORDER BY claims.id`,
        )
        .all(userId),
      comments: db.prepare('SELECT id, item_id, body, created_at FROM comments WHERE user_id = ? ORDER BY id').all(userId),
      following: db.prepare('SELECT item_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at').all(userId),
      savedSearches: db.prepare('SELECT id, name, query_json, enabled, created_at FROM saved_searches WHERE user_id = ? ORDER BY id').all(userId),
      notifications: db.prepare('SELECT id, title, body, type, action_url, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id').all(userId),
      uploads: db.prepare('SELECT id, url, mime_type, size, created_at FROM uploads WHERE user_id = ? ORDER BY id').all(userId),
    }

    logAudit(req, 'privacy.data_exported', 'user', userId)
    res.setHeader('Content-Disposition', `attachment; filename="argos-meus-dados-${userId}.json"`)
    res.json(data)
  }),
)

export { router as privacyRoutes }
