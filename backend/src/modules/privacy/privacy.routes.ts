import { Router } from 'express'
import { z } from 'zod'
import { privacyNotice, retentionSummary } from '../../config/privacy-notice.js'
import { db } from '../../db/database.js'
import { auth, optionalAuth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'

const router = Router()

type ConsentRow = { terms_version: string; purpose: string; granted: number; created_at: string }

/** Situação do aceite da conta em relação à versão vigente do aviso. */
export function consentStatus(userId: number) {
  const latest = db
    .prepare(
      `SELECT terms_version, granted, created_at FROM privacy_consents
       WHERE user_id = ? AND purpose = 'account_registration'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(userId) as { terms_version: string; granted: number; created_at: string } | undefined
  return {
    currentVersion: privacyNotice.version,
    acceptedVersion: latest?.granted ? latest.terms_version : null,
    acceptedAt: latest?.granted ? latest.created_at : null,
    upToDate: Boolean(latest?.granted && latest.terms_version === privacyNotice.version),
  }
}

router.get(
  '/summary',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const consents = req.user
      ? (db
          .prepare(
            `SELECT terms_version, purpose, granted, created_at
             FROM privacy_consents
             WHERE user_id = ?
             ORDER BY created_at DESC, id DESC`,
          )
          .all(req.user.id) as ConsentRow[])
      : []

    res.json({
      data: {
        termsVersion: privacyNotice.version,
        controller: privacyNotice.controller,
        purposes: privacyNotice.purposes,
        publicDataPolicy: privacyNotice.publicDataPolicy,
        userRights: privacyNotice.userRights,
        externalProcessors: privacyNotice.externalProcessors,
        retention: retentionSummary(),
        consents,
        consentStatus: req.user ? consentStatus(req.user.id) : null,
      },
    })
  }),
)

// Aceite de uma nova versão do aviso. A versão é a do servidor; um cliente com texto antigo recebe 409.
router.post(
  '/consents',
  auth,
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = z.object({ accepted: z.literal(true), termsVersion: z.string().trim().min(3).max(40) }).parse(req.body)
    if (input.termsVersion !== privacyNotice.version) {
      throw new HttpError(409, 'O resumo de privacidade foi atualizado. Leia a versão vigente e confirme novamente.', {
        code: 'terms_outdated',
        currentVersion: privacyNotice.version,
      })
    }
    const status = consentStatus(req.user!.id)
    if (!status.upToDate) {
      db.prepare(
        `INSERT INTO privacy_consents (user_id, terms_version, purpose, granted, ip_address, user_agent)
         VALUES (?, ?, 'account_registration', 1, ?, ?)`,
      ).run(req.user!.id, privacyNotice.version, req.ip, req.get('user-agent') ?? null)
      logAudit(req, 'privacy.consent_granted', 'user', req.user!.id, { termsVersion: privacyNotice.version })
    }
    res.status(status.upToDate ? 200 : 201).json({ message: 'Aceite registrado.', consentStatus: consentStatus(req.user!.id) })
  }),
)

// Portabilidade: tudo o que a conta produziu ou que o sistema guarda sobre ela, sem dados de terceiros.
router.get(
  '/export',
  auth,
  rateLimit(5, 60_000),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const email = req.user!.email
    const profile = db
      .prepare(
        `SELECT id, name, nickname, email, role, status, avatar_url, phone, department, bio, preferred_contact,
                language, theme, timezone, date_format, compact_mode, high_contrast, email_verified_at,
                spam_score, created_at, updated_at
         FROM users WHERE id = ?`,
      )
      .get(userId)

    const data = {
      exportedAt: new Date().toISOString(),
      termsVersion: privacyNotice.version,
      profile,
      linkedGoogleAccount: Boolean((db.prepare('SELECT google_sub FROM users WHERE id = ?').get(userId) as { google_sub: string | null }).google_sub),
      notificationPreferences:
        db.prepare('SELECT email_enabled, in_app_enabled, digest_enabled FROM notification_preferences WHERE user_id = ?').get(userId) ?? null,
      consents: db
        .prepare('SELECT terms_version, purpose, granted, ip_address, user_agent, created_at FROM privacy_consents WHERE user_id = ? ORDER BY created_at, id')
        .all(userId),
      accessRequests: db
        .prepare('SELECT name, email, reason, status, created_at, reviewed_at FROM access_requests WHERE LOWER(email) = LOWER(?) ORDER BY id')
        .all(email),
      items: db
        .prepare(
          `SELECT id, type, title, description, category, location, campus_block, approximate_place, event_date, status,
                  approval_status, image_url, contact_preference, latitude, longitude, created_at, updated_at
           FROM items WHERE owner_id = ? ORDER BY id`,
        )
        .all(userId),
      itemHistory: db
        .prepare(
          `SELECT item_history.item_id, item_history.action, item_history.details, item_history.created_at
           FROM item_history JOIN items ON items.id = item_history.item_id
           WHERE items.owner_id = ? ORDER BY item_history.id`,
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
      reportsFiled: db
        .prepare('SELECT id, item_id, item_title, reason, status, created_at FROM item_reports WHERE reporter_id = ? ORDER BY id')
        .all(userId),
      following: db.prepare('SELECT item_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at').all(userId),
      savedSearches: db.prepare('SELECT id, name, query_json, enabled, created_at FROM saved_searches WHERE user_id = ? ORDER BY id').all(userId),
      notifications: db.prepare('SELECT id, title, body, type, action_url, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id').all(userId),
      emails: db
        .prepare('SELECT subject, status, created_at, sent_at FROM mail_outbox WHERE LOWER(to_email) = LOWER(?) ORDER BY id')
        .all(email),
      uploads: db.prepare('SELECT id, url, original_name, mime_type, size, created_at FROM uploads WHERE user_id = ? ORDER BY id').all(userId),
      pushSubscriptions: db.prepare('SELECT user_agent, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY id').all(userId),
      securityEvents: db
        .prepare('SELECT action, entity_type, created_at, ip_address, user_agent FROM audit_logs WHERE actor_id = ? ORDER BY id DESC LIMIT 1000')
        .all(userId),
    }

    logAudit(req, 'privacy.data_exported', 'user', userId)
    res.setHeader('Content-Disposition', `attachment; filename="argos-meus-dados-${userId}.json"`)
    res.setHeader('Cache-Control', 'no-store')
    res.json(data)
  }),
)

export { router as privacyRoutes }
