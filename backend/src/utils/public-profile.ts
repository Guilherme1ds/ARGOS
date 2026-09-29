/** Apelido exibido publicamente: o nickname escolhido ou um derivado do nome, nunca o e-mail. */
export function publicNickname(input: { id: number; name?: string | null; nickname?: string | null }) {
  if (input.nickname?.trim()) return input.nickname.trim()

  const fallback = (input.name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 28)

  return fallback || `usuario.${input.id}`
}
