/** Funded civilian expeditions use real fleets and households. Arrival creates
 * homes and a sponsor's foothold; jurisdiction changes remain a political act. */
import type { Fleet } from './military-types'
import { settlementPermission } from './overseas-access'
export { settlementPermission } from './overseas-access'
import { rebuildAdaptiveMesh } from './adaptive-world'
import { cohortDeaths, extractAges } from './age-cohorts'
import { apportion } from './allocation'
import { subdivideHousing } from './building-lots'
import { withWorldConfiguration } from './configuration'
import { aggregateDistricts } from './districts'
import { STRATA } from './economic-types'
import { recordWorldEvent } from './event-memory'
import { pioneerExpedition } from './founding'
import { neighbors } from './grid'
import { knownMap } from './intelligence'
import { balance, governmentAccount, householdAccount, publicGoods, transfer } from './ledger'
import { availableTransport, seaDistance, sailingMonths } from './maritime-routing'
import { marketStore, recordGift, recordOwnCapital, recordUse, recordWages } from './national-accounts'
import { cargoCapacity, orderFleet, portAt, transportSeats, waterPath } from './navy'
import { portBlockadeView } from './naval-control'
import {
  activeExpedition,
  expeditionAccount,
  expeditionStore,
  type OverseasExpedition,
} from './overseas-types'
import { cellPosition } from './physical-space'
import { communitySize } from './population'
import { refreshPlaces } from './places'
import { residentialSites, createResidentialParcel, syncResidentialPopulation } from './residential-sites'
import { departSettlers, receiveSettlers, settleExpeditionAccounts } from './settler-transfers'
import { habitableLand } from './terrain-access'
import { transportNetwork } from './transport'
import { GOODS, inventory, population, type World, type Region } from './types'

/** Surveyed, open coastal land must have a short walk from the landing place. */
function settlementSite(w: World, nation: number, cell: number) {
  const c = w.cells[cell],
    r = w.regions[c?.region]
  if (
    !r ||
    !habitableLand(c) ||
    ['tundra', 'desert'].includes(c.terrain) ||
    !settlementPermission(w, nation, r.id)
  )
    throw new Error('Choose habitable coastal land with settlement rights or secure military control.')
  if (!knownMap(w, nation).some((p) => p.id === r.id))
    throw new Error('Overseas settlement requires a surveyed coast.')
  const harbor = portAt(w, r.id)
  if (!harbor || portBlockadeView(w)(nation, r.id) <= 0)
    throw new Error('The landing coast is unavailable or blockaded.')
  const reached = new Set([cell]),
    queue = [cell],
    limit = pioneerExpedition(w, nation).range
  let steps = 0,
    end = queue.length
  for (let i = 0; i < queue.length && steps < limit; i++) {
    if (queue[i] === harbor.land) break
    for (const next of neighbors(queue[i], w.width, w.height))
      if (!reached.has(next) && w.cells[next].region === r.id && habitableLand(w.cells[next])) {
        reached.add(next)
        queue.push(next)
      }
    if (i + 1 === end) {
      steps++
      end = queue.length
    }
  }
  if (!reached.has(harbor.land))
    throw new Error('Choose a site within the landing expedition’s overland range.')
  const point = cellPosition(w, cell)
  if (
    residentialSites(w).some(
      (s) => (s.residents! > 0 || s.capacity > 0) && Math.hypot(s.x - point.x, s.y - point.y) < 1500,
    )
  )
    throw new Error('Choose open land at least 1.5 km from existing homes.')
  return { r, harbor, point }
}

/** Cargo and berths are separate constraints. Reserve room for the crew's
 * course-length provisions as well as the civilians' return and building cargo. */
function expeditionCargo(p: ReturnType<typeof pioneerExpedition>, people: number, months: number) {
  return {
    ...inventory(),
    food: p.food + people * 0.026 * (months * 2 + 2),
    timber: p.timber,
    stone: p.stone,
    tools: p.tools,
  }
}
function cargoRoom(f: Fleet, people: number, goods: ReturnType<typeof inventory>, months: number) {
  const crewFood = f.soldiers * 0.034 * Math.max(4, Math.ceil(months / 0.7) + 2)
  return (
    GOODS.reduce((sum, g) => sum + goods[g], 0) + Math.max(f.food, crewFood) + f.arms <=
    cargoCapacity(f, people)
  )
}

/** Cost and wages are thousands of crowns; cargo is tons. Sailing time excludes rendezvous. */
export interface OverseasQuote {
  cell: number
  province: number
  name: string
  source: number
  departure: number
  fleet: number
  people: number
  months: number
  wages: number
  goods: ReturnType<typeof inventory>
  cost: number
}

/** Quotes include cargo at current prices and reserve provisions for a return.
 * A 25% cargo-price reserve absorbs ordinary price changes while assembling;
 * unused funding returns to the treasury. A distant outpost must not depend on food appearing after it lands. */
export function overseasQuote(w: World, nation: number, cell: number): OverseasQuote {
  return withWorldConfiguration(w, () => {
    if (!w.adaptive || !w.localEconomy || !w.economy) throw new Error('The world is still preparing.')
    if (!w.nations[nation] || w.nations[nation].extinct !== undefined)
      throw new Error('Choose a living sponsoring state.')
    const { r, harbor } = settlementSite(w, nation, cell),
      p = pioneerExpedition(w, nation)
    let best: OverseasQuote | undefined
    for (const h of transportNetwork(w).harbors) {
      if (w.regions[h.region].nation !== nation || w.regions[h.region].control || h.region === r.id) continue
      const path = waterPath(w, h.water, harbor.water)
      if (!path.length) continue
      const months = sailingMonths(w, nation, seaDistance(w, path))
      const fleet = availableTransport(w, nation, h.region, p.people)
      if (!fleet) continue
      const goods = expeditionCargo(p, p.people, months)
      if (!cargoRoom(fleet, p.people, goods, months)) continue
      for (const id of w.localEconomy.active) {
        const source = w.localEconomy.units[id]
        if (
          source.province !== h.region ||
          source.nation !== nation ||
          population(source) < p.people + p.reserve
        )
          continue
        if (
          GOODS.some(
            (g) =>
              source.stocks[g] < goods[g] + (g === 'food' ? population(source) * 0.026 * p.reserveMonths : 0),
          )
        )
          continue
        const cost = p.cash + GOODS.reduce((s, g) => s + (goods[g] * source.prices[g]) / 1000, 0) * 1.25
        if (w.nations[nation].treasury < cost) continue
        const q = {
          cell,
          province: r.id,
          name: r.name,
          source: id,
          departure: h.region,
          fleet: fleet.id,
          people: p.people,
          months,
          wages: p.cash,
          goods,
          cost,
        }
        if (!best || q.months < best.months || (q.months === best.months && q.cost < best.cost)) best = q
      }
    }
    if (!best)
      throw new Error(
        'An overseas expedition needs an available supplied transport, a populated home port, cargo, and treasury funding.',
      )
    return best
  })
}

/** One affordable expedition at a time keeps native commitments bounded. */
export function overseasOptions(w: World, nation: number, limit = 3) {
  if (w.overseas?.expeditions.some((e) => e.nation === nation && activeExpedition(e))) return []
  const result: OverseasQuote[] = []
  if (!w.adaptive || !w.warfare?.fleets.some((f) => f.nation === nation && f.transports)) return result
  const home = new Set(w.regions.filter((r) => r.nation === nation).map((r) => r.id))
  for (const r of knownMap(w, nation)) {
    if (home.has(r.id) || !r.coastal || !settlementPermission(w, nation, r.id)) continue
    const harbor = portAt(w, r.id)
    if (!harbor) continue
    // Bound the site search to coastal land; interior sites are not first landings.
    for (const cell of [harbor.land, ...neighbors(harbor.land, w.width, w.height)]) {
      if (w.cells[cell]?.region !== r.id) continue
      try {
        result.push(overseasQuote(w, nation, cell))
        break
      } catch {
        /* A later coast may be viable. */
      }
    }
    if (result.length >= limit) break
  }
  return result
}

/** Reserve money and a fleet now; families leave only after the ship arrives. */
export function startOverseasExpedition(w: World, nation: number, cell: number) {
  if (w.overseas?.expeditions.some((e) => e.nation === nation && activeExpedition(e)))
    throw new Error('Complete or recall the state’s current settlement expedition first.')
  const q = overseasQuote(w, nation, cell)
  const state = (w.overseas ??= { nextId: 1, expeditions: [], footholds: [] })
  if (state.expeditions.length >= 2048) throw new Error('The expedition archive is full.')
  const e: OverseasExpedition = {
    id: state.nextId++,
    nation,
    cell,
    source: q.source,
    departure: q.departure,
    arrival: q.province,
    fleet: q.fleet,
    started: w.month,
    updated: w.month - 1,
    stage: 'assembling',
    obstacle: '',
    people: 0,
    communities: [],
    goods: inventory(),
    accounts: Object.fromEntries(
      [...STRATA, 'construction'].map((s) => [s, { cash: 0 }]),
    ) as OverseasExpedition['accounts'],
    settlers: q.people,
    wages: q.wages,
  }
  state.expeditions.push(e)
  transfer(
    w,
    governmentAccount(nation),
    expeditionAccount(e.id, 'construction'),
    q.cost,
    'overseas expedition funding',
  )
  return `Expedition to ${q.name} funded: ${q.people} settlers, ${q.cost.toFixed(2)}k crowns, approximately ${q.months} months at sea after embarkation. Provincial ownership remains unchanged.`
}

function sourceUnit(w: World, e: OverseasExpedition) {
  return w.localEconomy!.units[e.source]
}
function returnFunds(w: World, e: OverseasExpedition, target: Region) {
  settleExpeditionAccounts(w, target, (s) => expeditionAccount(e.id, s))
  transfer(
    w,
    expeditionAccount(e.id, 'construction'),
    governmentAccount(e.nation),
    balance(w, expeditionAccount(e.id, 'construction')),
    'unused expedition funding returned',
  )
}

/** Prefer the original home, but a lost or blockaded port cannot trap a recall
 * when another owned coast remains physically reachable. */
function orderReturn(w: World, e: OverseasExpedition, fleet: Fleet) {
  const candidates = transportNetwork(w).harbors.filter(
    (h) =>
      w.regions[h.region].nation === e.nation &&
      !w.regions[h.region].control &&
      portBlockadeView(w)(e.nation, h.region) > 0,
  )
  const destinations = candidates
    .map((h) => ({ h, path: waterPath(w, fleet.cell, h.water) }))
    .filter((v) => v.path.length)
    .sort(
      (a, b) =>
        Number(b.h.region === e.departure) - Number(a.h.region === e.departure) ||
        seaDistance(w, a.path) - seaDistance(w, b.path),
    )
  const destination = destinations[0]?.h.region
  if (destination === undefined)
    throw new Error('No reachable home coast is available for the recalled settlers.')
  orderFleet(w, fleet.id, destination, 'return')
  e.returnPort = destination
}

/** Recall remains physical after sailing; before embarkation it releases funding. */
export function cancelOverseasExpedition(w: World, nation: number, id: number) {
  const e = w.overseas?.expeditions.find((e) => e.id === id && e.nation === nation)
  if (!e || !activeExpedition(e)) throw new Error('Choose an active expedition belonging to this state.')
  if (!e.people) {
    returnFunds(w, e, sourceUnit(w, e))
    e.stage = 'returned'
    e.fleet = null
    return 'Expedition cancelled; reserved funds and ships released.'
  }
  e.stage = 'returning'
  e.obstacle = 'Returning settlers to a home port.'
  const fleet = w.warfare?.fleets.find((f) => f.id === e.fleet)
  if (fleet) {
    try {
      orderReturn(w, e, fleet)
    } catch (error) {
      e.obstacle = error instanceof Error ? error.message : 'The home port is unavailable.'
    }
  }
  return 'The expedition has been recalled. Its settlers must sail home.'
}

/** Assemble, purchase and embark in one transaction after revalidating all inputs. */
export function prepareOverseasExpeditions(w: World) {
  for (const e of w.overseas?.expeditions ?? []) {
    if (e.stage !== 'assembling') continue
    const f = w.warfare?.fleets.find((f) => f.id === e.fleet && f.nation === e.nation),
      source = sourceUnit(w, e)
    if (!f) {
      e.fleet = null
      e.obstacle = 'The assigned transport is unavailable; recall this expedition and plan a new one.'
      continue
    }
    if (w.regions[e.departure].nation !== e.nation) {
      e.obstacle = 'The departure port is no longer under home control.'
      continue
    }
    try {
      settlementSite(w, e.nation, e.cell)
      if (f.cell !== portAt(w, e.departure)?.water) {
        if (f.target !== e.departure || !f.course.length) orderFleet(w, f.id, e.departure, 'return')
        continue
      }
      const p = pioneerExpedition(w, e.nation),
        harbor = portAt(w, e.arrival)!,
        path = waterPath(w, f.cell, harbor.water)
      if (!path.length) throw new Error('The sea passage is unavailable.')
      const months = sailingMonths(w, e.nation, seaDistance(w, path))
      const goods = expeditionCargo(p, e.settlers, months)
      const cost = GOODS.reduce((s, g) => s + (goods[g] * source.prices[g]) / 1000, 0)
      if (f.embarked.length || transportSeats(f) < e.settlers || !cargoRoom(f, e.settlers, goods, months))
        throw new Error('Transport berths or cargo capacity are unavailable.')
      if (f.supply < 0.65 || f.hull < 0.5) throw new Error('The transport needs provisions or repairs.')
      if (
        population(source) < e.settlers + p.reserve ||
        GOODS.some(
          (g) =>
            source.stocks[g] < goods[g] + (g === 'food' ? population(source) * 0.026 * p.reserveMonths : 0),
        )
      )
        throw new Error('The departure settlement no longer has the required people and supplies.')
      if (balance(w, expeditionAccount(e.id, 'construction')) + 1e-8 < cost + e.wages)
        throw new Error('Prices rose beyond reserved funding; recall and request a new quote.')
      orderFleet(w, f.id, e.arrival, 'transport')
      transfer(
        w,
        expeditionAccount(e.id, 'construction'),
        governmentAccount(e.nation),
        cost,
        'expedition cargo budget',
      )
      for (const g of GOODS)
        if (goods[g]) {
          publicGoods(w, e.nation, source.id, g, goods[g], expeditionStore(e.id), source.prices[g] / 1000)
          source.stocks[g] -= goods[g]
          e.goods[g] += goods[g]
        }
      e.communities = departSettlers(w, source, e.settlers, (s) => expeditionAccount(e.id, s))
      e.people = e.communities.reduce((s, g) => s + communitySize(g), 0)
      e.departed = { month: w.month, people: e.people }
      e.stage = 'sailing'
      e.obstacle = ''
      aggregateDistricts(w)
      syncResidentialPopulation(w)
    } catch (error) {
      e.obstacle = error instanceof Error ? error.message : 'The expedition cannot depart.'
    }
  }
}

function losePeople(w: World, e: OverseasExpedition, losses: number) {
  const counts = apportion(losses, e.communities.map(communitySize), e.communities.map(communitySize))
  e.communities.forEach((g, i) => {
    const ages = apportion(counts[i], [g.population.children, g.population.adults, g.population.elders])
    extractAges(g, { children: ages[0], adults: ages[1], elders: ages[2] })
  })
  e.communities = e.communities.filter((g) => communitySize(g) > 0)
  e.people -= losses
  w.totals.deaths += losses
}

/** Settle cargo into homes only when landing rights still exist on arrival. */
function landExpedition(w: World, e: OverseasExpedition, returning = false) {
  const site = returning ? null : settlementSite(w, e.nation, e.cell)
  if (!returning) {
    const plan = pioneerExpedition(w, e.nation),
      fraction = e.people / Math.max(1, e.settlers)
    if (
      e.goods.food < e.people * 0.026 ||
      ['timber', 'stone', 'tools'].some(
        (g) =>
          e.goods[g as 'timber' | 'stone' | 'tools'] + 1e-8 <
          plan[g as 'timber' | 'stone' | 'tools'] * fraction,
      )
    )
      throw new Error('Too much cargo was lost to build and provision the settlement; returning home.')
  }
  const home = sourceUnit(w, e)
  const target = returning
    ? home.retired === undefined && home.province === (e.returnPort ?? e.departure)
      ? home
      : w.localEconomy!.units[
          w.localEconomy!.active.find(
            (id) => w.localEconomy!.units[id].province === (e.returnPort ?? e.departure),
          )!
        ]
    : w.localEconomy!.units[
        w.localEconomy!.active.find((id) => w.localEconomy!.units[id].cells.includes(e.cell))!
      ]
  const people = e.people
  let materials = 0
  for (const g of GOODS)
    if (e.goods[g]) {
      const amount = e.goods[g]
      if (!returning && ['timber', 'stone', 'tools'].includes(g)) {
        materials += recordUse(w, expeditionStore(e.id), g, amount)
        sourceUnit(w, e).consumption[g] += amount
      } else {
        recordGift(w, expeditionStore(e.id), marketStore(target.id), g, amount)
        target.stocks[g] += amount
      }
      e.goods[g] = 0
    }
  e.arrived = { month: w.month, people }
  receiveSettlers(w, target, e.communities)
  e.communities = []
  e.people = 0
  if (site) {
    const size = 256,
      point = site.point
    const home = createResidentialParcel(w, target.id, e.cell, point, {
      x: point.x - size / 2,
      y: point.y - size / 2,
      size,
    })
    home.capacity = Math.ceil((people * 7) / 6)
    home.residents = people
    let wages = 0
    const counts = STRATA.map((s) =>
        target.communities!.reduce(
          (sum, g) => sum + ((g.stratum ?? 'laborer') === s ? communitySize(g) : 0),
          0,
        ),
      ),
      total = counts.reduce((a, b) => a + b, 0)
    for (const [i, s] of STRATA.entries())
      wages += transfer(
        w,
        expeditionAccount(e.id, 'construction'),
        householdAccount(target.id, s),
        (e.wages * counts[i]) / Math.max(1, total),
        'overseas settlement construction wages',
      )
    w.nations[e.nation].spending += wages
    recordWages(w, target.id, `government:${e.nation}`, wages)
    recordOwnCapital(w, target.id, `government:${e.nation}`, materials + wages)
    home.investedValue = materials + wages
    w.localEconomy!.built[e.cell] = home.capacity / 12000
    const foothold = { nation: e.nation, cell: e.cell, since: w.month, expedition: e.id }
    const previous = w.overseas!.footholds.findIndex((f) => f.cell === e.cell)
    if (previous >= 0) w.overseas!.footholds[previous] = foothold
    else w.overseas!.footholds.push(foothold)
    if (w.adaptive!.buildingVersion === 1) subdivideHousing(w, home)
    recordWorldEvent(w, {
      id: w.nextEvent++,
      month: w.month,
      type: 'economy',
      nation: e.nation,
      region: site.r.id,
      title: `${w.nations[e.nation].shortName} establishes an overseas foothold`,
      detail: `${people} settlers arrive with funded homes and supplies. ${site.r.name}'s sovereignty remains unchanged; trade, local support and administration determine its future.`,
    })
  }
  returnFunds(w, e, target)
  e.stage = returning ? 'returned' : 'settled'
  const carrier = w.warfare?.fleets.find((f) => f.id === e.fleet)
  if (carrier && !carrier.course.length) carrier.mission = 'escort'
  e.fleet = null
  e.obstacle = ''
  aggregateDistricts(w)
  syncResidentialPopulation(w)
  rebuildAdaptiveMesh(w)
  refreshPlaces(w)
}

/** Navy movement and combat happen first; civilians then eat, age and land.
 * Lost ships remove passengers and cargo once, while property passes to heirs. */
export function advanceOverseasExpeditions(w: World) {
  for (const e of w.overseas?.expeditions ?? []) {
    if (!['sailing', 'returning'].includes(e.stage) || e.updated === w.month) continue
    e.updated = w.month
    const f = w.warfare?.fleets.find((f) => f.id === e.fleet && f.nation === e.nation)
    if (!f) {
      losePeople(w, e, e.people)
      for (const g of GOODS) {
        recordUse(w, expeditionStore(e.id), g, e.goods[g], 'other')
        sourceUnit(w, e).consumption[g] += e.goods[g]
        e.goods[g] = 0
      }
      returnFunds(w, e, sourceUnit(w, e))
      e.stage = 'lost'
      e.fleet = null
      e.obstacle = 'The expedition’s transport was lost.'
      continue
    }
    if (e.people > transportSeats(f)) losePeople(w, e, e.people - transportSeats(f))
    const cargo = GOODS.reduce((sum, g) => sum + e.goods[g], 0)
    const capacity = Math.max(0, cargoCapacity(f, e.people) - f.food - f.arms)
    if (cargo > capacity) {
      // Lost holds destroy the same proportion of each cargo lot; every removal
      // is a recorded physical loss, rather than stocks disappearing on landing.
      const fraction = 1 - capacity / cargo
      for (const g of GOODS) {
        const lost = e.goods[g] * fraction
        recordUse(w, expeditionStore(e.id), g, lost, 'other')
        sourceUnit(w, e).consumption[g] += lost
        e.goods[g] -= lost
      }
    }
    const need = e.people * 0.026,
      eaten = Math.min(need, e.goods.food)
    recordUse(w, expeditionStore(e.id), 'food', eaten, 'government')
    e.goods.food -= eaten
    sourceUnit(w, e).consumption.food += eaten
    const shortage = 1 - eaten / Math.max(0.001, need)
    for (const group of e.communities)
      w.totals.deaths += cohortDeaths(group, w.month, w.demography!, shortage)
    e.communities = e.communities.filter((g) => communitySize(g) > 0)
    e.people = e.communities.reduce((s, g) => s + communitySize(g), 0)
    if (!e.people) {
      for (const g of GOODS) {
        recordUse(w, expeditionStore(e.id), g, e.goods[g], 'other')
        sourceUnit(w, e).consumption[g] += e.goods[g]
        e.goods[g] = 0
      }
      returnFunds(w, e, sourceUnit(w, e))
      e.stage = 'lost'
      e.fleet = null
      continue
    }
    if (!settlementPermission(w, e.nation, e.arrival) && e.stage === 'sailing') {
      e.stage = 'returning'
      e.obstacle = 'Settlement rights were lost; the expedition is returning.'
      try {
        orderReturn(w, e, f)
      } catch (error) {
        e.obstacle = String(error)
      }
    }
    if (
      e.stage === 'returning' &&
      (e.returnPort === undefined ||
        w.regions[e.returnPort].nation !== e.nation ||
        w.regions[e.returnPort].control ||
        portBlockadeView(w)(e.nation, e.returnPort) <= 0)
    ) {
      try {
        orderReturn(w, e, f)
      } catch (error) {
        e.obstacle = error instanceof Error ? error.message : 'Return passage is blocked.'
      }
    }
    if (f.course.length) continue
    if (f.cell === portAt(w, e.arrival)?.water && e.stage === 'sailing') {
      try {
        landExpedition(w, e)
      } catch (error) {
        e.obstacle = error instanceof Error ? error.message : 'Landing is blocked.'
        e.stage = 'returning'
        try {
          orderReturn(w, e, f)
        } catch {
          /* Remain at the real position for a later safe return. */
        }
      }
    } else if (
      e.stage === 'returning' &&
      e.returnPort !== undefined &&
      w.regions[e.returnPort].nation === e.nation &&
      !w.regions[e.returnPort].control &&
      portBlockadeView(w)(e.nation, e.returnPort) > 0 &&
      f.cell === portAt(w, e.returnPort)?.water
    )
      landExpedition(w, e, true)
    else if (f.mission === 'return' && f.target !== null) {
      // A supply diversion does not cancel the civilian destination. Resume only
      // after actual resupply; the food-aware return planner can choose a new port.
      e.obstacle = 'The fleet diverted for supplies or repairs.'
      if (f.supply >= 0.8 && f.hull >= 0.5)
        try {
          orderFleet(
            w,
            f.id,
            e.stage === 'returning' ? (e.returnPort ?? e.departure) : e.arrival,
            e.stage === 'returning' ? 'return' : 'transport',
          )
          e.obstacle = ''
        } catch (error) {
          e.obstacle = String(error)
        }
    }
  }
}
