import { HttpError } from '../../utils/http.js'

export type ItemType = 'lost' | 'found'
export type ItemStatus = ItemType | 'claimed' | 'returned'

export function assertItemStatusTransition(type: ItemType, current: ItemStatus, next: ItemStatus) {
  if (current === next) return
  const allowed =
    (current === type && next === 'claimed') ||
    (type === 'lost' && current === 'lost' && next === 'returned') ||
    (current === 'claimed' && (next === 'returned' || next === type))

  if (!allowed) {
    throw new HttpError(422, `Transição de status inválida: ${current} -> ${next}.`)
  }
}
