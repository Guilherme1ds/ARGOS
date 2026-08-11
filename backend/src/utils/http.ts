import type { NextFunction, Request, Response } from 'express'
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

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ message: 'JSON invalido.', requestId: req.requestId })
  }

  if (error instanceof ZodError) {
    return res.status(422).json({ message: 'Dados invalidos.', errors: error.flatten(), requestId: req.requestId })
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message, details: error.details, requestId: req.requestId })
  }

  console.error({ requestId: req.requestId, error })
  return res.status(500).json({ message: 'Erro interno no servidor.', requestId: req.requestId })
}
