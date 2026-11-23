import { useState, type ImgHTMLAttributes } from 'react'
import { apiAssetUrl, apiThumbUrl } from '../services/api'

type UploadImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet'> & {
  url?: string | null
  /**
   * thumb: só a miniatura (cartões, listas, avatares); responsive: o navegador escolhe entre miniatura e foto
   * conforme `sizes` e a densidade da tela; full: só a foto (detalhe do caso).
   */
  variant?: 'thumb' | 'responsive' | 'full'
}

/** Foto enviada ao ARGOS. Carrega sob demanda e volta para a foto original se a miniatura falhar. */
export function UploadImage({ url, variant = 'thumb', loading = 'lazy', decoding = 'async', alt = '', ...rest }: UploadImageProps) {
  const full = apiAssetUrl(url)
  const thumb = variant === 'full' ? '' : apiThumbUrl(url)
  const [failedThumb, setFailedThumb] = useState('')
  if (!full) return null

  const useThumb = Boolean(thumb) && failedThumb !== thumb
  const common = { ...rest, alt, loading, decoding, onError: useThumb ? () => setFailedThumb(thumb) : rest.onError }
  if (!useThumb) return <img {...common} src={full} />
  if (variant === 'responsive') return <img {...common} src={full} srcSet={`${thumb} 640w, ${full} 1600w`} />
  return <img {...common} src={thumb} />
}
