import { recordWorldEvent } from './event-memory'
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
} as const

/** A bounded land journey through home territory or unclaimed land. */
function reachable(w: World, nation: number, cell: number) {
  const distance = new Map([[cell, 0]]),
    queue = [cell]
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i],
      steps = distance.get(c)!
    if (steps === FOUNDING.range) continue
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
export function foundingPlan(w: World, nation: number, cell: number) {
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
  if (state.treasury < FOUNDING.cash) throw new Error(`Founding needs ${FOUNDING.cash} in the treasury.`)
  const target =
      w.localEconomy.units[
        w.localEconomy.active.find((id) => w.localEconomy!.units[id].cells.includes(cell))!
      ],
    path = reachable(w, nation, cell)
  const sources = w.localEconomy.active
    .map((id) => w.localEconomy!.units[id])
    .filter(
      (r) =>
        r.nation === nation &&
        r.id !== target.id &&
        population(r) >= FOUNDING.people + FOUNDING.reserve &&
        path.has(r.center),
    )
    .sort((a, b) => path.get(a.center)! - path.get(b.center)! || a.id - b.id)
  if (!sources.length)
    throw new Error(
      'A settlement within about 25 km by land must retain 1,200 people after sending 600 settlers.',
    )
  const source = sources.find(
    (r) =>
      r.stocks.food >= FOUNDING.food + population(r) * 0.026 * 3 &&
      r.stocks.timber >= FOUNDING.timber &&
      r.stocks.stone >= FOUNDING.stone &&
      r.stocks.tools >= FOUNDING.tools,
  )
  if (!source)
    throw new Error(
      'The departing settlement needs 94 food, 40 timber, 20 stone and 5 tools, plus three months of food to keep at home.',
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
) {
  const { state, region, target, source, point } = foundingPlan(w, nation, cell)
  const size = 256,
    site = createResidentialParcel(w, target.id, cell, point, {
      x: point.x - size / 2,
      y: point.y - size / 2,
      size,
    })
  let materials = 0
  for (const good of ['timber', 'stone', 'tools'] as const) {
    materials += recordUse(w, marketStore(source.id), good, FOUNDING[good])
    source.stocks[good] -= FOUNDING[good]
    source.consumption[good] += FOUNDING[good]
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
      (FOUNDING.cash * workers[i]) / total,
      'settlement founding wages',
    )
    w.economy!.households[source.id][s].income += paid
    wages += paid
  })
  state.spending += wages
  recordWages(w, source.id, producerAccount(source.id), wages)
  recordOwnCapital(w, source.id, producerAccount(source.id), materials + wages)
  recordGift(w, marketStore(source.id), marketStore(target.id), 'food', FOUNDING.food)
  source.stocks.food -= FOUNDING.food
  target.stocks.food += FOUNDING.food

  const counts = apportion(FOUNDING.people, source.communities!.map(communitySize))
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
    FOUNDING.people,
    homes.map((s) => s.residents ?? 0),
    homes.map((s) => s.residents ?? 0),
  )
  homes.forEach((s, i) => {
    s.residents! -= departures[i]
  })
  site.capacity = 700
  site.investedValue = materials + wages
  site.residents = FOUNDING.people
  w.localEconomy!.built[cell] = 700 / 12000

  if (region.nation === -1) {
    region.nation = nation
    for (const id of w.localEconomy!.active) {
      const unit = w.localEconomy!.units[id]
      if (unit.province === region.id) {
        unit.nation = nation
        for (const group of unit.communities!) group.host = nation
      }
    }
    for (const level of ['province', 'municipality'] as const) {
      const id = `${level}:${region.id}`
      w.adaptive!.jurisdictions[id] = {
        id,
        level,
        name: region.name,
        nation,
        seat: cell,
        cells: [...region.cells],
        founded: w.month,
        revised: w.month,
        predecessors: [],
        successors: [],
        account: governmentAccount(nation),
      }
    }
  }
  if (w.adaptive!.buildingVersion === 1) subdivideHousing(w, site)
  source.migration -= FOUNDING.people
  target.migration += FOUNDING.people
  source.populationDynamics!.emigrants += FOUNDING.people
  target.populationDynamics!.immigrants += FOUNDING.people
  w.totals.migration += FOUNDING.people
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
    detail: `${state.shortName} sends 600 settlers from ${source.name}, with food and a paid founding camp in the surrounding province.`,
  })

  return `Founded a settlement in ${region.name}. 600 people moved from ${source.name}; the camp used 120 treasury, 40 timber, 20 stone and 5 tools, and carries 94 food.`
}

/** Governments assess nearby open land yearly; the same material constraints apply to manual orders. */
export function advanceFounding(w: World) {
  if (w.settlementStart !== 'frontier') return
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
  for (const n of w.nations) {
    if (
      (w.month - 1) % 12 !== n.id % 3 ||
      !n.ai ||
      n.policies.priority === 'military' ||
      n.foodCoverage < 0.95 ||
      n.stability < 40 ||
      w.relations.some((r) => r.treaty === 'war' && (r.a === n.id || r.b === n.id))
    )
      continue
    const candidates = w.regions
      .filter((r) => r.nation === -1 && r.neighbors.some((id) => w.regions[id].nation === n.id))
      .sort(
        (a, b) =>
          b.fertility + b.deposits.timber * 0.15 - (a.fertility + a.deposits.timber * 0.15) || a.id - b.id,
      )
    for (const r of candidates) {
      try {
        foundingPlan(w, n.id, r.center)
      } catch {
        continue
      }
      settleFounding(w, n.id, r.center, true, refreshLabels)
      founded++
      break
    }
  }
  if (founded) {
    // Founding decisions use current people, accounts, ownership and physical
    // plots. Rebuild the numerical partition once after their ordered settlement.
    w.adaptive!.revision += founded - 1
    rebuildAdaptiveMesh(w)
  }
}
