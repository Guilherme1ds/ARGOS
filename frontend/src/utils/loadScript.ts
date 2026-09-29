const loaded = new Map<string, Promise<void>>()

/** Carrega um script externo uma única vez (Google Identity Services, Cloudflare Turnstile). */
export function loadScript(src: string) {
  let promise = loaded.get(src)
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => {
        loaded.delete(src)
        script.remove()
        reject(new Error(`Falha ao carregar ${src}`))
      }
      document.head.appendChild(script)
    })
    loaded.set(src, promise)
  }
  return promise
}
