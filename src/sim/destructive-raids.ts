/** Scorched-earth orders destroy existing fixed assets. Deposits, debts and people
 * survive the loss of buildings; rebuilding must buy replacement capital. */
import { recordWorldEvent } from './event-memory'
import type { PhysicalSite } from './adaptive-types'
import type { ProducerAccount } from './economic-types'
import { recordMilitaryInfluence } from './influence'
import { economicRegion, economicRegions, localFirmRegion, provinceId } from './local-units'
import { controlsProvince } from './military-control'
import type { MilitaryControl } from './military-control'
import { armyStore, recordUse } from './national-accounts'
import { periodFlow, periodRate } from './simulation-period'
import { clamp, population, type World } from './types'
import { URBAN_USES } from './urban-types'

type DamageReport = NonNullable<MilitaryControl['destruction']>
type Survival = ReadonlyMap<number, number>
const damage = (value: number, keep: number, minimum = 0.001) => (value * keep < minimum ? 0 : value * keep)

/** Apply after movement and occupation checks. Force is pooled before damage, so
 * splitting an army cannot multiply the attack or charge the same asset twice.
 * The idle path scans armies only; active raids scan each asset collection once. */
export function advanceDestructiveRaids(w: World) {
  const forces = raidingForces(w)
  if (!forces.size) return
  const survival = new Map<number, number>()
  for (const [id, force] of forces) {
    const r = w.regions[id],
      strength = clamp(force / Math.max(50, population(r) * 0.02))
    // A supplied occupation force can remove at most a quarter of the remaining
    // stock each month. Tiny remnants collapse, giving destruction a finite end.
    survival.set(id, 1 - periodRate(0.25 * strength))
    r.control!.destruction = { month: w.month, housing: 0, capital: 0, buildings: 0, roads: 0 }
    r.unrest = clamp(r.unrest + periodFlow(strength * 8), 0, 100)
    recordMilitaryInfluence(w, r.control!.nation, r.nation, r.id, 'requisition', strength, strength)
  }
  damageProduction(w, survival)
  damageSettlements(w, survival)
  damageRoads(w, survival)
  for (const id of survival.keys()) {
    const r = w.regions[id],
      report = r.control!.destruction!
    recordWorldEvent(w, {
      id: w.nextEvent++,
      month: w.month,
      type: 'war',
      nation: r.control!.nation,
      region: id,
      title: `${w.nations[r.control!.nation].shortName} raids buildings and roads in ${r.name}`,
      detail: `${Math.round(report.housing)} housing spaces and ${report.capital.toFixed(3)} productive capital destroyed; ${report.buildings} buildings and ${report.roads} road segments demolished. Residents and debts remain; rebuilding needs real investment.`,
    })
  }
}

function raidingForces(w: World) {
  const forces = new Map<number, number>(),
    secure = new Map<number, boolean>()
  for (const army of w.armies) {
    const o = army.operations,
      r = w.regions[army.region]
    if (
      !o ||
      o.conduct !== 'raze' ||
      o.embarkedOn !== null ||
      o.disorder ||
      o.stance === 'march' ||
      o.arms <= 0 ||
      army.supply <= 0 ||
      r.control?.nation !== army.nation ||
      r.control.destruction?.month === w.month
    )
      continue
    if (!secure.has(r.id)) secure.set(r.id, controlsProvince(w, r.id, army.nation))
    if (!secure.get(r.id)) continue
    const required = periodFlow(army.soldiers * 0.002),
      ammunition = Math.min(o.arms, required)
    const strength =
      (army.soldiers * army.supply * army.morale * o.cohesion * (1 - o.fatigue * 0.5) * ammunition) /
      Math.max(1e-9, required)
    if (strength <= 0) continue
    recordUse(w, armyStore(army.id), 'arms', ammunition, 'government')
    o.arms -= ammunition
    // Province consumption is a display projection; write the actual local book.
    economicRegion(w, r.id).consumption.arms += ammunition
    forces.set(r.id, (forces.get(r.id) ?? 0) + strength)
  }
  return forces
}

function damageProduction(w: World, survival: Survival) {
  for (const unit of economicRegions(w)) {
    const id = provinceId(unit),
      keep = survival.get(id)
    if (keep === undefined) continue
    const report = w.regions[id].control!.destruction!
    unit.infrastructure = damage(unit.infrastructure, keep, 0.03)
    unit.devastation = Math.max(unit.devastation, Math.min(0.9, unit.devastation + (1 - keep) * 0.3))
    for (const group of unit.communities ?? []) {
      group.grievance = clamp(group.grievance + (1 - keep) * 0.4)
      group.loyalty = clamp(group.loyalty - (1 - keep) * 0.2)
    }
    const merchant = w.economy?.producers[unit.id]
    if (merchant) {
      report.capital += damageCapital(merchant, keep)
      unit.industry = merchant.capital
    } else unit.industry = damage(unit.industry, keep)
  }
  for (const firm of w.economy?.firms ?? []) {
    const unit = economicRegion(w, localFirmRegion(firm)),
      keep = survival.get(provinceId(unit))
    if (keep === undefined) continue
    w.regions[provinceId(unit)].control!.destruction!.capital += damageCapital(firm, keep)
    unit.industry += firm.capital
  }
}

/** The financial owner keeps its cash and liabilities when its real assets burn. */
function damageCapital(owner: Pick<ProducerAccount, 'capital' | 'projects'>, keep: number) {
  let lost = owner.capital
  owner.capital = damage(owner.capital, keep)
  lost -= owner.capital
  for (const project of owner.projects) {
    const before = project.capital
    project.capital = damage(before, keep)
    project.cost *= keep
    lost += before - project.capital
  }
  owner.projects = owner.projects.filter((p) => p.capital > 0)
  return lost
}

function damageSettlements(w: World, survival: Survival) {
  const a = w.adaptive
  if (!a) return
  for (const site of Object.values(a.sites)) {
    const id = w.cells[site.cell].region,
      keep = survival.get(id)
    if (keep !== undefined && site.retired === undefined)
      damageSite(site, keep, w.month, w.regions[id].control!.destruction!)
  }
  // A pre-raid blueprint must not restore destroyed stock for free on completion.
  if (a.construction)
    a.construction = a.construction.filter((p) => !survival.has(w.cells[a.sites[p.site].cell].region))
  for (const project of a.urban?.projects ?? [])
    if (
      survival.has(provinceId(economicRegion(w, project.host))) &&
      !['occupied', 'cancelled'].includes(project.status)
    ) {
      project.status = 'cancelled'
      project.reason = 'Construction destroyed by an enemy raid.'
    }
  a.revision++
}

function damageSite(site: PhysicalSite, keep: number, month: number, report: DamageReport) {
  const before = site.capacity
  site.capacity = damage(before, keep, site.kind === 'residential' ? 1 : 0.001)
  // Firm capacity is anchored to its capitalReference by syncSites. Preserve
  // that ratio; housing's opening fabric is itself an asset being destroyed.
  if (site.kind !== 'establishment') site.openingCapacity = damage(site.openingCapacity, keep, 1)
  site.openingBuilt = damage(site.openingBuilt ?? 0, keep, 0.0001)
  site.investedValue = damage(site.investedValue ?? 0, keep)
  if (site.kind === 'residential') report.housing += before - site.capacity
  const fabric = site.fabric
  if (fabric) {
    for (const use of URBAN_USES) fabric.uses[use] *= keep
    fabric.floorArea = URBAN_USES.reduce((sum, use) => sum + fabric.uses[use], 0)
    fabric.condition *= keep
    fabric.altered = month
  }
  if ((site.kind === 'residential' && site.capacity === 0) || (fabric && fabric.floorArea < 4)) {
    if (site.building) report.buildings++
    delete site.building
    site.openingBuilt = site.investedValue = 0
    if (fabric) {
      for (const use of URBAN_USES) fabric.uses[use] = 0
      fabric.floorArea = fabric.condition = 0
    }
  }
}

function damageRoads(w: World, survival: Survival) {
  for (const [id, keep] of survival) {
    const r = w.regions[id]
    if (w.localEconomy) {
      r.infrastructure = damage(r.infrastructure, keep, 0.03)
      r.devastation = Math.max(r.devastation, Math.min(0.9, r.devastation + (1 - keep) * 0.3))
    }
    // Paid upgrades cannot continue to grant rail/paved-road bonuses after the
    // underlying network has been reduced to tracks or completely destroyed.
    if (r.publicWorks?.road && r.infrastructure < 0.4) delete r.publicWorks.road
    else if (r.publicWorks?.road && r.infrastructure < 0.85) r.publicWorks.road = 'gravel'
  }
  const a = w.adaptive
  if (a) {
    if (a.lanes)
      a.lanes = a.lanes.filter((lane) => {
        const id = provinceId(economicRegion(w, lane.pool)),
          keep = survival.get(id)
        if (keep === undefined) return true
        lane.width *= keep
        if (lane.width >= 1) return true
        w.regions[id].control!.destruction!.roads++
        return false
      })
    if (a.urban) a.urban.streetRevision++
  }
  if (w.corridors)
    w.corridors = w.corridors.filter((trace) => {
      if (w.cells[trace.a].terrain === 'water' || w.cells[trace.b].terrain === 'water') return true
      const from = w.cells[trace.a].region,
        to = w.cells[trace.b].region
      const id = survival.has(from) ? from : survival.has(to) ? to : undefined
      if (id === undefined) return true
      trace.familiarity *= survival.get(id)!
      if (w.regions[id].infrastructure > 0) return true
      w.regions[id].control!.destruction!.roads++
      return false
    })
}
