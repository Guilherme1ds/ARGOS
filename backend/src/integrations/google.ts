import { OAuth2Client } from 'google-auth-library'
import { env } from '../config/env.js'
import { HttpError } from '../utils/http.js'

export type GoogleIdentity = { sub: string; email: string; name: string; emailVerified: boolean }

export function googleEnabled() {
  return Boolean(env.GOOGLE_CLIENT_ID)
}

let client: OAuth2Client | null = null

/** Valida o ID token emitido pelo botão "Entrar com Google" (assinatura, emissor, audiência e validade). */
async function verifyWithGoogle(credential: string): Promise<GoogleIdentity> {
  client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID)
  const ticket = await client.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID })
  const payload = ticket.getPayload()
  if (!payload?.sub || !payload.email) throw new Error('Token do Google sem e-mail.')
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name ?? payload.email.split('@')[0], emailVerified: Boolean(payload.email_verified) }
}

// Substituível nos testes, que não podem gerar tokens assinados pelo Google.
export const googleVerifier = { verify: verifyWithGoogle }

export async function verifyGoogleCredential(credential: string) {
  if (!googleEnabled()) throw new HttpError(503, 'Login com Google não está configurado neste servidor.')
  try {
    return await googleVerifier.verify(credential)
  } catch {
    throw new HttpError(401, 'Não foi possível validar o login com Google.')
  }
}
