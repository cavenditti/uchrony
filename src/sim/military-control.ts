import { clamp, population, relation, type Army, type World } from './types'
import { economicRegions, provinceId } from './local-units'
import { balance, governmentAccount, producerAccount, transfer, publicExpense } from './ledger'
import { domesticMonthlyWage } from './decision-policy'
import { periodRate } from './simulation-period'
import { recordMilitaryInfluence } from './influence'
import { recordWorldEvent } from './event-memory'
import { reconcileJurisdictionSovereignty } from './jurisdictions'

export interface MilitaryControl {
  nation: number
  since: number
  lastPillage: number
  spoils: number
}
export const controller = (w: World, region: number) =>
  w.regions[region].control?.nation ?? w.regions[region].nation
export const occupationStrengthRequired = (w: World, region: number) =>
  Math.max(20, population(w.regions[region]) * 0.001)

export function holdingForce(w: World, region: number, nation: number) {
  return w.armies
    .filter(
      (a) =>
        a.region === region &&
        a.nation === nation &&
        a.operations?.embarkedOn == null &&
        !a.operations?.disorder,
    )
    .reduce((sum, a) => sum + a.soldiers * a.supply * a.morale, 0)
}
export function controlsProvince(w: World, region: number, nation: number) {
  const r = w.regions[region]
  if (!r || r.control?.nation !== nation || relation(w, nation, r.nation)?.treaty !== 'war') return false
  const local = holdingForce(w, region, nation)
  return local >= occupationStrengthRequired(w, region) && local > holdingForce(w, region, r.nation) * 1.5
}
export function establishControl(w: World, region: number, nation: number) {
  const r = w.regions[region]
  if (r.nation === nation) {
    delete r.control
    return
  }
  if (relation(w, nation, r.nation)?.treaty !== 'war') throw new Error('Military occupation requires war.')
  if (r.control?.nation !== nation) r.control = { nation, since: w.month, lastPillage: -1, spoils: 0 }
}
export function maintainControl(w: World) {
  for (const r of w.regions) if (r.control && !controlsProvince(w, r.id, r.control.nation)) delete r.control
}

/** Legal sovereignty changes only through a government decision or signed treaty. */
export function transferSovereignty(w: World, region: number, nation: number) {
  const r = w.regions[region]
  r.nation = nation
  delete r.control
  for (const unit of economicRegions(w))
    if (provinceId(unit) === region) {
      unit.nation = nation
      for (const group of unit.communities ?? []) group.host = nation
    }
  for (const group of r.communities ?? []) group.host = nation
  if (w.adaptive) reconcileJurisdictionSovereignty(w)
}
export function annexationObstacle(w: World, nation: number, region: number) {
  const r = w.regions[region]
  if (!r || !w.nations[nation] || !controlsProvince(w, region, nation))
    return 'Annexation requires secure military control of an enemy province.'
  if (w.month - r.control!.since < 6) return 'Hold the province for six months before annexation.'
  const cost = domesticMonthlyWage(w, nation) * Math.max(20, population(r) * 0.02)
  if (w.nations[nation].treasury < cost) return 'The treasury cannot fund annexation administration.'
  return ''
}
export function annexProvince(w: World, nation: number, region: number) {
  const obstacle = annexationObstacle(w, nation, region)
  if (obstacle) return obstacle
  const r = w.regions[region],
    former = r.nation
  const cost = domesticMonthlyWage(w, nation) * Math.max(20, population(r) * 0.02)
  publicExpense(w, nation, cost, 'annexation administration', region)
  transferSovereignty(w, region, nation)
  r.occupation = { former, since: w.month, resistance: 0.75, settled: 0 }
  r.unrest = Math.max(r.unrest, 65)
  relation(w, nation, former)!.grievance += 10
  recordMilitaryInfluence(w, nation, former, region, 'attack', 0.5, 0.1)
  for (const n of w.nations)
    if (n.capital === region && n.id !== nation) {
      const next = w.regions.filter((p) => p.nation === n.id).sort((a, b) => population(b) - population(a))[0]
      if (next) n.capital = next.id
    }
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: w.month,
    type: 'war',
    nation,
    region,
    title: `${w.nations[nation].shortName} annexes ${r.name}`,
    detail: `After sustained military control, the cabinet declares annexation and pays ${cost.toFixed(3)}k in administration costs. Local allegiance and resistance persist.`,
  })
  return `${r.name} annexed; local resistance remains.`
}

/** One levy per occupied province per period, independent of army splitting.
 * Spoils are conserved transfers from real local deposits, never created loot. */
export function pillageProvince(w: World, army: Army) {
  const r = w.regions[army.region],
    c = r.control
  if (
    !c ||
    c.lastPillage === w.month ||
    !controlsProvince(w, r.id, army.nation) ||
    army.operations?.conduct !== 'pillage'
  )
    return 0
  c.lastPillage = w.month
  const strength = clamp(holdingForce(w, r.id, army.nation) / Math.max(50, population(r) * 0.02))
  const rate = periodRate(0.025) * strength
  let taken = 0
  for (const unit of economicRegions(w).filter((u) => provinceId(u) === r.id)) {
    const account = producerAccount(unit.id)
    taken += transfer(
      w,
      account,
      governmentAccount(army.nation),
      balance(w, account) * rate,
      'occupation pillage',
    )
    unit.devastation = clamp(unit.devastation + rate * 0.6)
    for (const g of unit.communities ?? []) {
      g.grievance = clamp(g.grievance + rate)
      g.loyalty = clamp(g.loyalty - rate * 0.5)
    }
  }
  const share = population(r) / Math.max(1, w.nations[r.nation].population)
  const taxLoot = transfer(
    w,
    governmentAccount(r.nation),
    governmentAccount(army.nation),
    w.nations[r.nation].treasury * Math.min(1, share) * rate,
    'seized occupation taxes',
  )
  w.nations[r.nation].spending += taxLoot
  taken += taxLoot
  w.nations[army.nation].income += taken
  c.spoils += taken
  if (w.localEconomy) r.devastation = clamp(r.devastation + rate * 0.6)
  r.unrest = clamp(r.unrest + rate * 50, 0, 100)
  recordMilitaryInfluence(w, army.nation, r.nation, r.id, 'requisition', strength, strength * 0.3)
  if (taken > 0)
    recordWorldEvent(w, {
      id: w.nextEvent++,
      month: w.month,
      type: 'war',
      nation: army.nation,
      region: r.id,
      title: `${army.name} pillages ${r.name}`,
      detail: `${taken.toFixed(3)}k is transferred from local merchants and seized taxes to the occupying treasury. Damage and opposition reduce the value of continued occupation.`,
    })
  return taken
}
