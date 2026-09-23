import type { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'
import { ZodError } from 'zod'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'Recurso não encontrado.'))
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 422
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Arquivo excede o tamanho máximo permitido.'
      : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'Envie exatamente um arquivo no campo "file".'
        : 'Upload de arquivo inválido.'
    return res.status(status).json({ message, requestId: req.requestId })
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ message: 'JSON inválido.', requestId: req.requestId })
  }

  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Corpo da requisição excede o tamanho máximo permitido.', requestId: req.requestId })
  }

  if (error instanceof ZodError) {
    return res.status(422).json({ message: 'Dados inválidos.', errors: error.flatten(), requestId: req.requestId })
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message, details: error.details, requestId: req.requestId })
  }

  console.error({ requestId: req.requestId, error })
  return res.status(500).json({ message: 'Erro interno no servidor.', requestId: req.requestId })
}
