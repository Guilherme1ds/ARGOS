import { Router } from 'express'
import { db } from '../../db/database.js'
import { optionalAuth } from '../../middleware/auth.js'
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

export { router as privacyRoutes }
