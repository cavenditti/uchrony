/** Maritime political reach comes from delivered commerce or supplied forces,
 * never from a merely proposed route, a map discovery, or a passing empty ship. */
import { provinceId, economicRegion } from './local-units'
import { portAt } from './navy'
import { transportNetwork } from './transport'
import type { World } from './types'

export interface MaritimeContact {
  source: number
  trade: number
  protection: number
}

/** One pass over shipments and formations feeds every independent province. */
export function maritimeContacts(w: World) {
  const ports = new Set(transportNetwork(w).harbors.map((h) => h.region))
  const contacts = new Map<number, Map<number, MaritimeContact>>()
  const add = (province: number, nation: number, source: number, trade: number, protection: number) => {
    if (w.regions[province]?.nation !== -1 || nation < 0 || !w.nations[nation] || !ports.has(province)) return
    let states = contacts.get(province)
    if (!states) contacts.set(province, (states = new Map()))
    const prior = states.get(nation)
    if (prior) {
      prior.trade += trade
      prior.protection = Math.max(prior.protection, protection)
    } else states.set(nation, { source, trade, protection })
  }
  const trade = (from: number, to: number, volume: number) => {
    const a = w.regions[from],
      b = w.regions[to]
    if (a && b && volume > 0) {
      add(to, a.nation, from, volume, 0)
      add(from, b.nation, to, volume, 0)
    }
  }
  if (w.localEconomy)
    for (const s of w.localEconomy.shipments) {
      if (s.legs.some((l) => l.mode === 'sea'))
        trade(provinceId(economicRegion(w, s.from)), provinceId(economicRegion(w, s.to)), s.quantity)
    }
  else for (const r of w.routes) if (r.sea) trade(r.from, r.to, r.volume)
  for (const a of w.armies) {
    if (
      a.operations?.embarkedOn !== null ||
      a.operations.disorder ||
      a.supply < 0.65 ||
      a.morale < 0.4 ||
      a.soldiers < 50
    )
      continue
    // Actual supplied troops provide security, but not a sovereignty shortcut.
    const source = a.operations.source
    if (source !== null && w.regions[source]?.nation === a.nation)
      add(a.region, a.nation, source, 0, Math.min(1, (a.soldiers * a.supply) / 500))
  }
  for (const foothold of w.overseas?.footholds ?? []) {
    const province = w.cells[foothold.cell].region,
      harbor = portAt(w, province)
    if (!harbor) continue
    const fleet = w.warfare?.fleets.find(
      (f) => f.nation === foothold.nation && f.cell === harbor.water && f.supply >= 0.65 && f.hull >= 0.5,
    )
    if (fleet) add(province, foothold.nation, fleet.home, 0, 0.15)
  }
  return contacts
}
