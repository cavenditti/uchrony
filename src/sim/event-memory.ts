import type { World, SimEvent } from './types'
import type { Almanac, WorldFact } from './almanac-types'
export function worldMemory(w: World): Almanac {
  return (w.almanac ??= {
    version: 1,
    initialized: false,
    since: w.month,
    entries: {},
    facts: {},
    languages: {},
    lastMonth: -1,
    revision: 0,
  })
}
export function rememberFact(w: World, fact: WorldFact) {
  const a = worldMemory(w)
  if (a.facts[fact.id]) return
  a.facts[fact.id] = fact
  for (const id of fact.places) {
    const place = a.entries[id]
    if (place) {
      place.facts.push(fact.id)
      place.revision++
    }
  }
  a.revision++
}
/** Recent feed stays bounded; its dated evidence is retained independently. */
export function recordWorldEvent(w: World, e: SimEvent) {
  rememberFact(w, {
    id: `event:${e.id}`,
    month: e.month,
    title: e.title,
    detail: e.detail,
    source: 'recorded',
    event: e.id,
    places: [
      ...(e.region !== undefined ? [`province:${e.region}`] : []),
      ...(e.nation !== undefined ? [`nation:${e.nation}`] : []),
    ],
  })
  w.events.unshift(e)
  w.events = w.events.slice(0, 240)
}
