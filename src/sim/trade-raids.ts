/** Route sacking acts on real consignments after purchase. Food and ammunition
 * may become carried stores; other intercepted cargo is destroyed, never minted as money. */
import { economicRegion } from './local-units'
import { armyStore, fleetStore, marketStore, recordGift, recordUse } from './national-accounts'
import { fleetPower, fleetReach, navalPressure } from './naval-control'
import { clamp, relation, type Good, type RouteLeg, type World } from './types'

/** A bounded history for the current month, shared by both resolutions and in-flight freight. */
export interface TradeRaid {
  month: number
  force: number
  nation: number
  victim: number
  from: number
  to: number
  good: Good
  captured: number
  destroyed: number
}

/** Index raiders by location once; checks scale with the route, not all formations. */
export function tradeRaidView(w: World) {
  type Raider = {
    id: number
    nation: number
    strength: number
    budget: number
    store: string
    stocks: { food: number; arms: number }
    soldiers: number
  }
  const land = new Map<number, Raider[]>(),
    sea = new Map<number, Raider[]>(),
    used = new Map<number, number>(),
    guards = new Map<number, Map<number, number>>()
  // One provincial guard index avoids scanning every formation at every road cell.
  for (const a of w.armies ?? []) {
    if (a.operations?.embarkedOn != null || a.operations?.disorder || !a.soldiers) continue
    if (!guards.has(a.region)) guards.set(a.region, new Map())
    const local = guards.get(a.region)!
    local.set(a.nation, (local.get(a.nation) ?? 0) + a.soldiers * a.morale * a.supply)
  }
  for (const raid of w.warfare?.raids ?? [])
    if (raid.month === w.month)
      used.set(raid.force, (used.get(raid.force) ?? 0) + raid.captured + raid.destroyed)
  const index = (map: Map<number, Raider[]>, id: number, raider: Raider) => {
    if (!map.has(id)) map.set(id, [])
    map.get(id)!.push(raider)
  }
  for (const a of w.armies ?? []) {
    const o = a.operations
    if (o?.conduct !== 'raid' || o.embarkedOn !== null || o.disorder || !a.soldiers) continue
    const strength = a.soldiers * a.morale * a.supply * o.cohesion * (1 - o.fatigue)
    index(land, a.region, {
      id: a.id,
      nation: a.nation,
      strength,
      budget: Math.max(0, strength * 0.03 - (used.get(a.id) ?? 0)),
      store: armyStore(a.id),
      stocks: o,
      soldiers: a.soldiers,
    })
  }
  for (const f of w.warfare?.fleets ?? []) {
    if (
      f.mission !== 'raid' ||
      f.target === null ||
      relation(w, f.nation, w.regions[f.target]?.nation)?.treaty !== 'war'
    )
      continue
    const strength = fleetPower(w, f) * 400
    if (!strength) continue
    const raider: Raider = {
      id: f.id,
      nation: f.nation,
      strength,
      budget: Math.max(0, strength * 0.03 - (used.get(f.id) ?? 0)),
      store: fleetStore(f.id),
      stocks: f,
      soldiers: f.soldiers,
    }
    for (const cell of fleetReach(w, f).keys()) index(sea, cell, raider)
  }
  const pressure = sea.size ? navalPressure(w) : new Map<number, Float64Array>()
  return (from: number, to: number, good: Good, quantity: number, legs: RouteLeg[]) => {
    if ((!land.size && !sea.size) || quantity <= 0) return quantity
    const seller = economicRegion(w, from),
      buyer = economicRegion(w, to),
      candidates = new Map<number, { raider: Raider; strength: number }>()
    for (const leg of legs)
      for (const cell of leg.cells) {
        const atSea = w.cells[cell].terrain === 'water',
          province = w.cells[cell].region
        for (const raider of (atSea ? sea.get(cell) : land.get(province)) ?? []) {
          if (
            !raider.budget ||
            (relation(w, raider.nation, buyer.nation)?.treaty !== 'war' &&
              relation(w, raider.nation, seller.nation)?.treaty !== 'war')
          )
            continue
          let defense = 0
          if (atSea) {
            for (const [nation, field] of pressure)
              if (
                nation === buyer.nation ||
                nation === seller.nation ||
                relation(w, nation, buyer.nation)?.treaty === 'alliance'
              )
                defense += field[cell] * 400
          } else {
            for (const [nation, strength] of guards.get(province) ?? [])
              if (relation(w, raider.nation, nation)?.treaty === 'war') defense += strength
          }
          const strength = Math.max(0, raider.strength - defense)
          if (strength > (candidates.get(raider.id)?.strength ?? 0))
            candidates.set(raider.id, { raider, strength })
        }
      }
    const attackers = [...candidates.values()].sort((a, b) => a.raider.id - b.raider.id),
      strength = attackers.reduce((sum, a) => sum + a.strength, 0)
    if (!strength) return quantity
    // A single aggregate interception rate prevents army splitting from multiplying loot.
    const exposed = quantity * clamp(strength / (strength + 1200), 0, 0.65)
    let lost = 0
    for (const { raider, strength: share } of attackers) {
      const taken = Math.min(raider.budget, (exposed * share) / strength)
      if (taken <= 1e-9) continue
      let captured = 0
      if (good === 'food' || good === 'arms') {
        const carry = raider.soldiers * (good === 'food' ? 0.034 * 3 : 0.0005 * 4)
        captured = Math.min(taken, Math.max(0, carry - raider.stocks[good]))
        recordGift(w, marketStore(to), raider.store, good, captured)
        raider.stocks[good] += captured
      }
      const destroyed = taken - captured
      recordUse(w, marketStore(to), good, destroyed, 'other')
      if (w.economy?.goods) w.economy.goods.destruction[good] += destroyed
      buyer.stocks[good] -= taken
      lost += taken
      raider.budget -= taken
      const state = w.warfare!
      state.raids ??= []
      state.raids.push({
        month: w.month,
        force: raider.id,
        nation: raider.nation,
        victim: relation(w, raider.nation, buyer.nation)?.treaty === 'war' ? buyer.nation : seller.nation,
        from,
        to,
        good,
        captured,
        destroyed,
      })
    }
    return Math.max(0, quantity - lost)
  }
}
