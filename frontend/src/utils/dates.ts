import { getActiveLanguage, t } from '../i18n'

type DateStyle = 'long' | 'short' | 'dayMonth'

const styleOptions: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  long: { day: '2-digit', month: 'long', year: 'numeric' },
  short: { day: '2-digit', month: 'short', year: 'numeric' },
  dayMonth: { day: 'numeric', month: 'long' },
}
const formatterCache = new Map<string, Intl.DateTimeFormat>()

// Formatadores são caros de criar: um por idioma e estilo.
function formatter(style: DateStyle | 'dateTime') {
  const locale = getActiveLanguage()
  const key = `${locale}:${style}`
  let cached = formatterCache.get(key)
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, style === 'dateTime' ? { dateStyle: 'short', timeStyle: 'short' } : styleOptions[style])
    formatterCache.set(key, cached)
  }
  return cached
}

/**
 * Datas "YYYY-MM-DD" são dias locais; timestamps do SQLite ("YYYY-MM-DD HH:MM:SS") vêm em UTC sem sufixo.
 */
export function parseApiDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value: string, style: DateStyle = 'long') {
  const date = parseApiDate(value)
  return date ? formatter(style).format(date) : value
}

export function formatDateTime(value: string) {
  const date = parseApiDate(value)
  return date ? formatter('dateTime').format(date) : value
}

export function relativeDate(value: string, fallbackStyle: DateStyle = 'dayMonth') {
  const date = parseApiDate(value)
  if (!date) return value

  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  if (diffDays < 1) return t('hoje')
  if (diffDays < 7) return t('{count} d', { count: diffDays })
  if (diffDays < 30) return t('{count} sem', { count: Math.floor(diffDays / 7) })
  return formatter(fallbackStyle).format(date)
}
