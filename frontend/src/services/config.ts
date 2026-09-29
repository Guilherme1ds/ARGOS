import { useEffect, useState } from 'react'
import type { AppConfig } from '../types/api'
import { api } from './api'

const fallbackConfig: AppConfig = {
  map: { center: [-23.5505, -46.6333], zoom: 16 },
  ai: false,
  translation: null,
  googleClientId: null,
  turnstileSiteKey: null,
  push: { publicKey: '' },
}

let configPromise: Promise<AppConfig> | null = null

/** Uma única chamada por carregamento da página; sem o servidor, as integrações ficam desligadas. */
export function loadAppConfig() {
  configPromise ??= api
    .get<AppConfig>('/config')
    .then((response) => response.data)
    .catch(() => {
      configPromise = null
      return fallbackConfig
    })
  return configPromise
}

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  useEffect(() => {
    let active = true
    void loadAppConfig().then((next) => active && setConfig(next))
    return () => {
      active = false
    }
  }, [])
  return config
}
