import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { loadScript } from '../utils/loadScript'

type GoogleCredentialResponse = { credential: string }
type GoogleAccountsId = {
  initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void; ux_mode?: 'popup' }) => void
  renderButton: (element: HTMLElement, options: Record<string, string | number>) => void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

/** Botão oficial do Google Identity Services; entrega o ID token para o backend validar. */
export function GoogleSignInButton({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const { t, language } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const callbackRef = useRef(onCredential)
  callbackRef.current = onCredential
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    loadScript('https://accounts.google.com/gsi/client')
      .then(() => {
        if (!active || !containerRef.current || !window.google) return
        window.google.accounts.id.initialize({ client_id: clientId, callback: (response) => callbackRef.current(response.credential), ux_mode: 'popup' })
        containerRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          locale: language,
          width: 320,
        })
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [clientId, language])

  if (failed) return <small className="privacy-note">{t('Não foi possível carregar o login com Google.')}</small>
  return <div className="google-button" ref={containerRef} />
}
