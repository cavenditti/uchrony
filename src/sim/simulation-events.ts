/** Event publication shared by simulation phases and human commands. */
import { recordWorldEvent } from './event-memory'
import { type SimEvent, type World } from './types'

/** Assign a chronological event ID and omit unclaimed-state identities. */
export function event(
  w: World,
  type: SimEvent['type'],
  title: string,
  detail: string,
  nation?: number,
  region?: number,
) {
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: w.month,
    type,
    title,
    detail,
    ...(nation !== undefined && nation >= 0 ? { nation } : {}),
    ...(region !== undefined ? { region } : {}),
  })
}
