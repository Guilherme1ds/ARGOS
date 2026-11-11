const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

/** Converte "15m", "12h", "30d" em milissegundos; formatos diferentes retornam null (sem padrão silencioso). */
export function durationToMs(value: string) {
  const match = /^(\d{1,6})([smhd])$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * multipliers[match[2] as keyof typeof multipliers]
}
