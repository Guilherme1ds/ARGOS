import { useCallback, useEffect, useRef, useState } from 'react'

export type CurrentPosition = { latitude: number; longitude: number; accuracy: number }
export type CurrentPositionStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable' | 'unsupported'

/**
 * Localização real do navegador, pedida uma vez por chamada de `locate` (não acompanha em segundo plano).
 * Com `auto`, pede ao abrir a tela. Cada resposta é um objeto novo, o que o MapView usa para recentralizar.
 * O navegador só informa a localização em contexto seguro (HTTPS ou localhost).
 */
export function useCurrentPosition({ auto = false }: { auto?: boolean } = {}) {
  const [position, setPosition] = useState<CurrentPosition | null>(null)
  const [status, setStatus] = useState<CurrentPositionStatus>('idle')
  const mounted = useRef(true)

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported')
      return
    }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (current) => {
        if (!mounted.current) return
        setPosition({ latitude: current.coords.latitude, longitude: current.coords.longitude, accuracy: current.coords.accuracy })
        setStatus('ready')
      },
      (error) => {
        if (!mounted.current) return
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable')
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }, [])

  useEffect(() => {
    mounted.current = true
    if (auto) locate()
    return () => {
      mounted.current = false
    }
  }, [auto, locate])

  return { position, status, locate }
}
