import { clamp, population, relation, type World } from './types'
import { simulationMonths } from './simulation-period'

export interface TradeContact {
  from: number
  to: number
  strength: number
}
export interface MilitaryImpression {
  actor: number
  fear: number
  opposition: number
}
export interface InfluenceState {
  updated: number
  tradeUpdated: number
  trade: TradeContact[]
  military: (MilitaryImpression & { observer: number })[]
  local: (MilitaryImpression & { region: number })[]
}
function influence(w: World): InfluenceState {
  return (w.influence ??= {
    updated: w.month,
    tradeUpdated: Math.max(0, w.month - simulationMonths()),
    trade: [],
    military: [],
    local: [],
  })
}
/** Fear fades faster than resentment. Reading impressions never changes them. */
export function advanceMilitaryInfluence(w: World) {
  const state = w.influence
  if (!state || state.updated === w.month) return
  const elapsed = Math.max(0, w.month - state.updated)
  for (const entry of [...state.military, ...state.local]) {
    entry.fear *= 0.985 ** elapsed
    entry.opposition *= 0.997 ** elapsed
  }
  state.updated = w.month
  state.military = state.military.filter((e) => e.fear + e.opposition > 0.001)
  state.local = state.local.filter((e) => e.fear + e.opposition > 0.001)
}
export const militaryImpression = (w: World, observer: number, actor: number) =>
  w.influence?.military.find((e) => e.observer === observer && e.actor === actor)
export const localImpression = (w: World, region: number, actor: number) =>
  w.influence?.local.find((e) => e.region === region && e.actor === actor)

/** Only participants and communities close enough to witness an action react.
 * Distant governments still learn wars through the existing intelligence reports. */
export function recordMilitaryInfluence(
  w: World,
  actor: number,
  target: number,
  region: number | null,
  kind: 'mobilization' | 'attack' | 'victory' | 'defense' | 'requisition',
  intensity: number,
  civilianHarm = 0,
) {
  if (!w.nations[actor]) return
  const state = influence(w)
  advanceMilitaryInfluence(w)
  const scale = clamp(intensity),
    harm = clamp(civilianHarm)
  const fear = (kind === 'victory' ? 0.24 : kind === 'mobilization' ? 0.06 : 0.12) * scale
  const opposition =
    kind === 'requisition'
      ? 0.3 * harm
      : kind === 'attack'
        ? 0.08 * scale + 0.25 * harm
        : kind === 'victory'
          ? 0.04 * scale
          : 0
  const observers = new Map<number, number>()
  if (w.nations[target] && target !== actor) observers.set(target, 1)
  if (region !== null && w.regions[region]) {
    for (const id of [region, ...w.regions[region].neighbors]) {
      const proximity = id === region ? 1 : 0.35
      if (!population(w.regions[id])) continue
      let entry = state.local.find((e) => e.region === id && e.actor === actor)
      if (!entry) state.local.push((entry = { region: id, actor, fear: 0, opposition: 0 }))
      entry.fear = clamp(entry.fear + (1 - entry.fear) * fear * proximity)
      entry.opposition = clamp(entry.opposition + (1 - entry.opposition) * opposition * proximity)
      const owner = w.regions[id].nation
      if (owner >= 0 && owner !== actor) observers.set(owner, Math.max(observers.get(owner) ?? 0, proximity))
    }
    // Keep the strongest local memories; no unbounded event log is needed.
    for (const id of [region, ...w.regions[region].neighbors]) {
      const entries = state.local
        .filter((e) => e.region === id)
        .sort((a, b) => b.fear + b.opposition - a.fear - a.opposition || a.actor - b.actor)
      const retained = new Set(entries.slice(0, 8))
      state.local = state.local.filter((e) => e.region !== id || retained.has(e))
    }
  }
  for (const [observer, proximity] of observers) {
    let entry = state.military.find((e) => e.observer === observer && e.actor === actor)
    if (!entry) state.military.push((entry = { observer, actor, fear: 0, opposition: 0 }))
    entry.fear = clamp(entry.fear + (1 - entry.fear) * fear * proximity)
    entry.opposition = clamp(entry.opposition + (1 - entry.opposition) * opposition * proximity)
    const rel = relation(w, observer, actor)
    if (rel) {
      const defenseCredit = kind === 'defense' && observer !== target && rel.treaty !== 'war' ? 2 * scale : 0
      rel.opinion = clamp(rel.opinion + (defenseCredit - opposition * 35) * proximity, -100, 100)
      rel.grievance = clamp(rel.grievance + opposition * 25 * proximity, 0, 100)
    }
  }
}

/** Goods exchanged per resident build durable, directional social contact.
 * Six-month clearings use monthly volume, and interrupted routes fade gradually. */
export function advanceTradeInfluence(w: World) {
  const state = influence(w)
  const elapsed = Math.max(0, Math.min(simulationMonths(), w.month - state.tradeUpdated))
  if (!elapsed) return
  state.tradeUpdated = w.month
  const volumes = new Map<string, number>()
  for (const route of w.routes) {
    if (route.from === route.to) continue
    for (const [from, to] of [
      [route.from, route.to],
      [route.to, route.from],
    ]) {
      if (!population(w.regions[from]) || !population(w.regions[to])) continue
      const key = `${from}:${to}`
      volumes.set(key, (volumes.get(key) ?? 0) + route.volume / simulationMonths())
    }
  }
  const prior = new Map(state.trade.map((entry) => [`${entry.from}:${entry.to}`, entry]))
  for (const key of volumes.keys())
    if (!prior.has(key)) {
      const [from, to] = key.split(':').map(Number)
      prior.set(key, { from, to, strength: 0 })
    }
  const contacts = w.regions.map(() => [] as TradeContact[])
  for (const [key, entry] of prior) {
    const target = clamp((volumes.get(key) ?? 0) / Math.max(1, population(w.regions[entry.from]) * 0.025))
    entry.strength += (target - entry.strength) * (1 - (target > entry.strength ? 0.96 : 0.985) ** elapsed)
    if (entry.strength > 0.001) contacts[entry.from].push(entry)
  }
  state.trade = contacts.flatMap((entries) =>
    entries.sort((a, b) => b.strength - a.strength || a.to - b.to).slice(0, 8),
  )
}
