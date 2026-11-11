import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { asyncHandler, HttpError } from '../../utils/http.js'

/**
 * Caixa de entrada de testes. Só é montada com NODE_ENV=test e ENABLE_TEST_MAIL_SINK=true (o boot recusa a
 * combinação em outros ambientes), só responde a conexões locais e só para destinatários do domínio reservado .test.
 * Permite que os testes HTTP do Flutter e o E2E web concluam a confirmação de e-mail e a redefinição de senha.
 */
const router = Router()

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

router.use((req, _res, next) => {
  if (env.NODE_ENV !== 'test' || !env.ENABLE_TEST_MAIL_SINK) return next(new HttpError(404, 'Recurso não encontrado.'))
  if (!loopback.has(req.socket.remoteAddress ?? '')) return next(new HttpError(404, 'Recurso não encontrado.'))
  next()
})

router.get(
  '/latest',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        to: z.string().trim().toLowerCase().email().refine((value) => value.endsWith('.test'), 'Somente destinatários .test.'),
        kind: z.enum(['verification', 'reset']),
      })
      .parse(req.query)
    const subject = input.kind === 'verification' ? 'Confirme seu e-mail no ARGOS' : 'Redefinição de senha'
    const message = db
      .prepare("SELECT body FROM mail_outbox WHERE LOWER(to_email) = ? AND subject = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
      .get(input.to, subject) as { body: string } | undefined
    const link = message ? /https?:\/\/\S+#token=[\w-]+/.exec(message.body)?.[0] : undefined
    if (!link) throw new HttpError(404, 'Nenhuma mensagem pendente para este destinatário.')
    res.json({ link, token: link.split('#token=')[1] })
  }),
)

export { router as testMailRoutes }
