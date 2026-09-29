import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { loadScript } from '../utils/loadScript'

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export type TurnstileHandle = { reset: () => void }

/** CAPTCHA Cloudflare Turnstile; chama onToken com o token (ou vazio quando expira). */
export const TurnstileWidget = forwardRef<TurnstileHandle, { siteKey: string; onToken: (token: string) => void }>(function TurnstileWidget(
  { siteKey, onToken },
  ref,
) {
  const { t, language } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<string | null>(null)
  const tokenRef = useRef(onToken)
  tokenRef.current = onToken
  const [failed, setFailed] = useState(false)

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetRef.current && window.turnstile) window.turnstile.reset(widgetRef.current)
      tokenRef.current('')
    },
  }))

  useEffect(() => {
    let active = true
    loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return
        widgetRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          language: language.toLowerCase(),
          callback: (token: string) => tokenRef.current(token),
          'expired-callback': () => tokenRef.current(''),
          'error-callback': () => tokenRef.current(''),
        })
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current)
      widgetRef.current = null
    }
  }, [siteKey, language])

  if (failed) return <small className="field-error">{t('Não foi possível carregar a verificação anti-robô. Confira sua conexão.')}</small>
  return <div className="turnstile-widget" ref={containerRef} />
})
