import { decisionPolicy, domesticMonthlyWage } from './decision-policy'
import { recordWorldEvent } from './event-memory'
import { simulationMonths } from './simulation-period'
import { competitivePressure } from './competitive-pressure'
import { expansionParameters } from './expansion-parameters'
import { claimIndependentProvince, frontierValue } from './territorial-expansion'
import { habitableLand } from './terrain-access'
import { subdivideHousing } from './building-lots'
import { neighbors } from './grid'
import { cellPosition } from './physical-space'
import { population, type World } from './types'
import { apportion } from './allocation'
import { extractAges } from './age-cohorts'
import { addCommunity, communitySize, rollupPopulation } from './population'
import { aggregateDistricts } from './districts'
import { relocateHouseholdClaims } from './district-finance'
import { governmentAccount, householdAccount, producerAccount, transfer } from './ledger'
import { marketStore, recordGift, recordOwnCapital, recordUse, recordWages } from './national-accounts'
import { STRATA } from './economic-types'
import {
  residentialSites,
  occupiedResidents,
  createResidentialParcel,
  syncResidentialPopulation,
} from './residential-sites'
import { refreshCityLabels } from './cities'
import { rebuildAdaptiveMesh } from './adaptive-world'
import { settlementComponents, type SettlementComponent } from './settlement-morphology'

export const FOUNDING = {
  people: 600,
  reserve: 1200,
  cash: 120,
  food: 94,
  timber: 40,
  stone: 20,
  tools: 5,
  range: 24,
  reserveMonths: 3,
} as const

/** A settlement pays the same per-resident costs at every expedition size. */
export function pioneerExpedition(w?: World, nation?: number): Expedition {
  const p = expansionParameters(),
    scale = p.pioneerPeople / 200
  return {
    ...FOUNDING,
    people: p.pioneerPeople,
    reserve: p.homeReserve,
    cash:
      w && nation !== undefined && decisionPolicy().realCosts
        ? p.pioneerPeople * domesticMonthlyWage(w, nation) * 6
        : 40 * scale,
    food: 32 * scale,
    timber: 14 * scale,
    stone: 7 * scale,
    tools: 2 * scale,
    range: p.range,
    reserveMonths: p.homeFoodMonths,
  }
}
type Expedition = { [K in keyof typeof FOUNDING]: number }

/** A bounded land journey through home territory or unclaimed land. */
function reachable(w: World, nation: number, cell: number, range: number) {
  const distance = new Map([[cell, 0]]),
    queue = [cell]
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i],
      steps = distance.get(c)!
    if (steps === range) continue
    for (const next of neighbors(c, w.width, w.height)) {
      const terrain = w.cells[next],
        owner = w.regions[terrain.region]?.nation
      if (distance.has(next) || !habitableLand(terrain) || (owner !== nation && owner !== -1)) continue
      distance.set(next, steps + 1)
      queue.push(next)
    }
  }
  return distance
}

/** Validate the entire expedition before any person, goods, cash or border moves. */
export function foundingPlan(w: World, nation: number, cell: number, expedition: Expedition = FOUNDING) {
  const state = w.nations[nation],
    terrain = w.cells[cell],
    region = w.regions[terrain?.region]
  if (
    !state ||
    !Number.isInteger(cell) ||
    !region ||
    !habitableLand(terrain) ||
    ['tundra', 'desert'].includes(terrain.terrain)
  )
    throw new Error('Choose habitable land for the settlement.')
  if (region.nation !== nation && region.nation !== -1) throw new Error('That land belongs to another state.')
  if (!w.localEconomy || !w.adaptive || !w.economy) throw new Error('The world is still preparing.')
  const point = cellPosition(w, cell)
  if (
    residentialSites(w).some(
      (s) =>
        (s.residents! > 0 || s.capacity > 0 || w.adaptive!.construction?.some((p) => p.site === s.id)) &&
        Math.hypot(s.x - point.x, s.y - point.y) < 1500,
    )
  )
    throw new Error('Choose open land at least 1.5 km from existing homes.')
  if (state.treasury < expedition.cash) throw new Error(`Founding needs ${expedition.cash} in the treasury.`)
  const target =
      w.localEconomy.units[
        w.localEconomy.active.find((id) => w.localEconomy!.units[id].cells.includes(cell))!
      ],
    path = reachable(w, nation, cell, expedition.range)
  const sources = w.localEconomy.active
    .map((id) => w.localEconomy!.units[id])
    .filter(
      (r) =>
        r.nation === nation &&
        r.id !== target.id &&
        population(r) >= expedition.people + expedition.reserve &&
        path.has(r.center),
    )
    .sort((a, b) => path.get(a.center)! - path.get(b.center)! || a.id - b.id)
  if (!sources.length)
    throw new Error(
      `A settlement within the overland expedition range must retain ${expedition.reserve} people after sending ${expedition.people} settlers.`,
    )
  const source = sources.find(
    (r) =>
      r.stocks.food >= expedition.food + population(r) * 0.026 * expedition.reserveMonths &&
      r.stocks.timber >= expedition.timber &&
      r.stocks.stone >= expedition.stone &&
      r.stocks.tools >= expedition.tools,
  )
  if (!source)
    throw new Error(
      `The departing settlement needs ${expedition.food} food, ${expedition.timber} timber, ${expedition.stone} stone and ${expedition.tools} tools, plus ${expedition.reserveMonths} months of food to keep at home.`,
    )
  return { state, region, target, source, point }
}

/** A paid, immediately inhabited founding camp. Later housing uses ordinary timed construction. */
export function foundSettlement(w: World, nation: number, cell: number) {
  return settleFounding(w, nation, cell, false)
}

function settleFounding(
  w: World,
  nation: number,
  cell: number,
  deferMesh: boolean,
  refreshLabels?: (nation: number) => void,
  expedition: Expedition = FOUNDING,
) {
  const { state, region, target, source, point } = foundingPlan(w, nation, cell, expedition)
  const size = 256,
    site = createResidentialParcel(w, target.id, cell, point, {
      x: point.x - size / 2,
      y: point.y - size / 2,
      size,
    })
  let materials = 0
  for (const good of ['timber', 'stone', 'tools'] as const) {
    materials += recordUse(w, marketStore(source.id), good, expedition[good])
    source.stocks[good] -= expedition[good]
    source.consumption[good] += expedition[good]
  }
  // Pay the actual departing households for surveying and erecting the camp.
  const workers = STRATA.map((s) =>
    source
      .communities!.filter((g) => (g.stratum ?? 'laborer') === s)
      .reduce((n, g) => n + communitySize(g), 0),
  )
  const total = population(source)
  let wages = 0
  STRATA.forEach((s, i) => {
    const paid = transfer(
      w,
      governmentAccount(nation),
      householdAccount(source.id, s),
      (expedition.cash * workers[i]) / total,
      'settlement founding wages',
    )
    w.economy!.households[source.id][s].income += paid
    wages += paid
  })
  state.spending += wages
  recordWages(w, source.id, producerAccount(source.id), wages)
  recordOwnCapital(w, source.id, producerAccount(source.id), materials + wages)
  recordGift(w, marketStore(source.id), marketStore(target.id), 'food', expedition.food)
  source.stocks.food -= expedition.food
  target.stocks.food += expedition.food

  const counts = apportion(expedition.people, source.communities!.map(communitySize))
  const moved = STRATA.map(() => 0)
  source.communities!.forEach((group, i) => {
    const ages = apportion(counts[i], [
      group.population.children,
      group.population.adults,
      group.population.elders,
    ])
    const incoming = extractAges(group, { children: ages[0], adults: ages[1], elders: ages[2] })
    incoming.locality = target.id
    incoming.host = nation
    incoming.rootedness *= 0.65
    moved[STRATA.indexOf(incoming.stratum ?? 'laborer')] += counts[i]
    addCommunity(target.communities!, incoming)
  })
  const moves = STRATA.map((s, i) => ({
    from: householdAccount(source.id, s),
    to: householdAccount(target.id, s),
    fraction: moved[i] / Math.max(1, workers[i]),
  }))
  relocateHouseholdClaims(w, moves)
  moves.forEach((m, i) =>
    transfer(
      w,
      m.from,
      m.to,
      w.economy!.households[source.id][STRATA[i]].cash * m.fraction,
      'settler household assets',
    ),
  )
  rollupPopulation(source)
  rollupPopulation(target)
  // Remove exactly the departing residents from their old physical homes.
  const homes = residentialSites(w).filter((s) => s.pool === source.id)
  const departures = apportion(
    expedition.people,
    homes.map((s) => s.residents ?? 0),
    homes.map((s) => s.residents ?? 0),
  )
  homes.forEach((s, i) => {
    s.residents! -= departures[i]
  })
  site.capacity = Math.ceil((expedition.people * 7) / 6)
  site.investedValue = materials + wages
  site.residents = expedition.people
  w.localEconomy!.built[cell] = site.capacity / 12000

  if (region.nation === -1) {
    claimIndependentProvince(w, region, nation, false)
    for (const level of ['province', 'municipality'] as const)
      w.adaptive!.jurisdictions[`${level}:${region.id}`].seat = cell
  }
  if (w.adaptive!.buildingVersion === 1) subdivideHousing(w, site)
  source.migration -= expedition.people
  target.migration += expedition.people
  source.populationDynamics!.emigrants += expedition.people
  target.populationDynamics!.immigrants += expedition.people
  w.totals.migration += expedition.people
  aggregateDistricts(w)
  syncResidentialPopulation(w)
  if (!deferMesh) rebuildAdaptiveMesh(w)
  if (refreshLabels) refreshLabels(nation)
  else refreshCityLabels(w)
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: w.month,
    type: 'economy',
    nation,
    region: region.id,
    title: `A settlement is founded in ${region.name}`,
    detail: `${state.shortName} sends ${expedition.people} settlers from ${source.name}, with food and a paid founding camp in the surrounding province.`,
  })

  return `Founded a settlement in ${region.name}. ${expedition.people} people moved from ${source.name}; the camp used ${expedition.cash} treasury, ${expedition.timber} timber, ${expedition.stone} stone and ${expedition.tools} tools, and carries ${expedition.food} food.`
}

/** Governments periodically review productive and culturally related frontiers. */
export function advanceFounding(w: World) {
  if (!w.localEconomy || !w.adaptive || !w.economy) return
  let founded = 0
  let components: SettlementComponent[] | undefined
  const refreshLabels = (nation: number) => {
    // Each expedition changes only its own state and newly claimed wilderness.
    // Keep the ordered label updates, but reuse other states' unchanged physical
    // components during this synchronous founding round.
    const changed = new Set([nation, -1])
    const allBuildings = residentialSites(w).every((s) => !occupiedResidents(w, s) || !!s.building)
    components =
      components && allBuildings
        ? [
            ...components.filter((part) => !changed.has(w.localEconomy!.units[part.sites[0].pool].nation)),
            ...settlementComponents(w, changed),
          ].sort((a, b) => a.sites[0].id.localeCompare(b.sites[0].id))
        : settlementComponents(w)
    refreshCityLabels(w, components)
  }
  const p = expansionParameters()
  for (const n of w.nations) {
    const expedition = pioneerExpedition(w, n.id)
    const pressure = p.peerWeight > 0 ? competitivePressure(w, n) : undefined
    const cycle =
      pressure && pressure.peer * p.peerWeight > 0.3 ? Math.max(2, p.reviewMonths / 2) : p.reviewMonths
    const offset = (1 + (n.id % 3)) % cycle
    const reviews =
      Math.floor((w.month - offset) / cycle) - Math.floor((w.month - simulationMonths() - offset) / cycle)
    if (
      reviews <= 0 ||
      !n.ai ||
      n.foodCoverage < p.minimumFood ||
      n.stability < p.minimumStability ||
      w.relations.some((r) => r.treaty === 'war' && (r.a === n.id || r.b === n.id))
    )
      continue
    for (let review = 0; review < reviews; review++) {
      const candidates = w.regions
        .filter((r) => r.nation === -1 && r.neighbors.some((id) => w.regions[id].nation === n.id))
        .sort((a, b) => frontierValue(w, n, b).score - frontierValue(w, n, a).score || a.id - b.id)
      let settled = false
      for (const r of candidates) {
        const home = w.cells[w.regions[n.capital].center]
        const cells = [
          r.center,
          ...r.cells
            .filter((id) => id !== r.center && habitableLand(w.cells[id]))
            .sort(
              (a, b) =>
                Math.hypot(w.cells[a].q - home.q, w.cells[a].r - home.r) -
                  Math.hypot(w.cells[b].q - home.q, w.cells[b].r - home.r) || a - b,
            ),
        ]
          .filter((id) => {
            if (!decisionPolicy().renewal) return true
            const point = cellPosition(w, id)
            return !residentialSites(w).some(
              (s) =>
                (s.residents! > 0 ||
                  s.capacity > 0 ||
                  w.adaptive!.construction?.some((p) => p.site === s.id)) &&
                Math.hypot(s.x - point.x, s.y - point.y) < 1500,
            )
          })
          .slice(0, p.sitesPerProvince)
        for (const cell of cells) {
          try {
            foundingPlan(w, n.id, cell, expedition)
          } catch {
            continue
          }
          settleFounding(w, n.id, cell, true, refreshLabels, expedition)
          founded++
          settled = true
          break
        }
        if (settled) break
      }
      if (!settled) break
    }
  }
  if (founded) {
    // Founding decisions use current people, accounts, ownership and physical
    // plots. Rebuild the numerical partition once after their ordered settlement.
    w.adaptive!.revision += founded - 1
    rebuildAdaptiveMesh(w)
  }
}
