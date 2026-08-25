export function normalizeKey(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function ftsPrefixQuery(value: string, maxTokens = 12) {
  return normalizeKey(value)
    .split(' ')
    .filter(Boolean)
    .slice(0, maxTokens)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' AND ')
}
