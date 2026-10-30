import { diplomaticAccess } from './agreements'
import { portBlockadeView } from './naval-control'
import { militaryVisit } from './military-access'
import { effectMultiplier } from './effects'
import { recordWorldEvent } from './event-memory'
import { unitLoyalty } from './forces'
import { movementNeighbors, stepDistance } from './grid'
import { MinHeap } from './heap'
import { recordMilitaryInfluence } from './influence'
import { publicExpense, publicGoods } from './ledger'
import type { ArmyOperations, Fleet } from './military-types'
import { armyStore, fleetStore, marketStore, recordGift, recordUse } from './national-accounts'
import {
  addCommunity,
  ensurePopulation,
  releaseSoldiers,
  removeSoldiers,
  returnArmyPeople,
  takeCivilianAdults,
} from './population'
import { random } from './random'
import { transportNetwork } from './transport'
import { clamp, population, relation, type Army, type World } from './types'

export const crewNeeded = (f: Pick<Fleet, 'warships' | 'transports'>) => f.warships * 90 + f.transports * 30
export const transportSeats = (f: Fleet) => Math.floor((f.transports * 800 + f.warships * 40) * f.hull)
export const cargoCapacity = (f: Fleet, passengers = 0) =>
  Math.max(0, (f.transports * 400 + f.warships * 25) * f.hull - passengers * 0.45)
export function warEvent(w: World, title: string, detail: string, nation: number, region?: number) {
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: w.month,
    type: 'war',
    title,
    detail,
    nation,
    ...(region === undefined ? {} : { region }),
  })
}
/** New formations start without supplies or an embarkation; their people are accounted separately. */
export function initialArmyOperations(): ArmyOperations {
  return {
    food: 0,
    arms: 0,
    fatigue: 0,
    cohesion: 0.8,
    loyalty: 0.65,
    entrenchment: 0,
    progress: 0,
    stance: 'march',
    conduct: 'restrained',
    isolated: 0,
    disorder: 0,
    embarkedOn: null,
    source: null,
    line: [],
    march: [],
  }
}
export function ensureWarfare(w: World) {
  w.warfare ??= { version: 1, revision: 0, fleets: [], deliveries: [] }
  for (const a of w.armies) {
    a.operations ??= initialArmyOperations()
    a.operations.march ??= []
  }
  return w.warfare
}
export const portAt = (w: World, region: number) =>
  transportNetwork(w).harbors.find((h) => h.region === region)
export const friendlyPort = (w: World, nation: number, region: number) =>
  diplomaticAccess(w, nation, w.regions[region].nation, 'transit', region) &&
  portBlockadeView(w)(nation, region) > 0

const paths = new WeakMap<World['cells'], Map<string, number[]>>()
function sailingDistance(w: World, path: number[]) {
  return path.slice(1).reduce((sum, id, i) => sum + stepDistance(w.cells[path[i]], w.cells[id]), 0)
}
/** Reject distant pairs in constant time; a traversable path can never be shorter
 * than its Euclidean displacement. Nearby fleets still respect coast obstructions. */
export function navalEncounterPath(w: World, from: number, to: number): number[] {
  if (stepDistance(w.cells[from], w.cells[to]) > 2) return []
  const path = waterPath(w, from, to)
  return path.length && sailingDistance(w, path) <= 2 ? path : []
}
export function waterPath(w: World, from: number, to: number) {
  if (w.cells[from]?.terrain !== 'water' || w.cells[to]?.terrain !== 'water') return []
  let saved = paths.get(w.cells)
  if (!saved) {
    saved = new Map()
    paths.set(w.cells, saved)
  }
  const key = `${from}:${to}`,
    prior = saved.get(key)
  if (prior) return [...prior]
  const previous = new Int32Array(w.cells.length).fill(-1),
    distances = new Float64Array(w.cells.length).fill(Infinity),
    queue = new MinHeap()
  previous[from] = from
  distances[from] = 0
  queue.push(from, 0)
  while (queue.size) {
    const current = queue.pop()
    if (current.cost !== distances[current.id]) continue
    if (current.id === to) break
    for (const id of movementNeighbors(w.cells, current.id, w.width, w.height)) {
      if (w.cells[id].terrain !== 'water') continue
      const cost = current.cost + stepDistance(w.cells[current.id], w.cells[id])
      if (cost < distances[id]) {
        distances[id] = cost
        previous[id] = current.id
        queue.push(id, cost)
      }
    }
  }
  if (previous[to] < 0) return []
  const route = [to]
  while (route.at(-1) !== from) route.push(previous[route.at(-1)!])
  route.reverse()
  if (saved.size > 1500) saved.clear()
  saved.set(key, route)
  return [...route]
}
export function commissionFleet(
  w: World,
  nation: number,
  region: number,
  warships: number,
  transports: number,
) {
  const state = ensureWarfare(w),
    n = w.nations[nation],
    r = w.regions[region],
    harbor = portAt(w, region)
  if (!n || !r || r.nation !== nation || !harbor)
    throw new Error('Commission ships at an owned coastal port.')
  if (
    ![warships, transports].every((v) => Number.isInteger(v) && v >= 0 && v <= 12) ||
    warships + transports < 1 ||
    warships + transports > 16
  )
    throw new Error('A commission needs 1–16 ships, with at most 12 of either type.')
  if (state.fleets.filter((f) => f.nation === nation).length >= 8)
    throw new Error('This state already operates eight fleets.')
  const crew = warships * 90 + transports * 30,
    cost = warships * 650 + transports * 350
  const timber = warships * 55 + transports * 40,
    iron = warships * 18 + transports * 8,
    arms = warships * 10,
    tools = (warships + transports) * 4
  if (
    n.treasury < cost ||
    r.population.adults < crew ||
    r.stocks.timber < timber ||
    r.stocks.iron < iron ||
    r.stocks.arms < arms ||
    r.stocks.tools < tools
  )
    throw new Error(
      'Shipbuilding needs treasury funds, timber, iron, arms, tools, and adult crews in this port.',
    )
  ensurePopulation(w)
  const communities = takeCivilianAdults(w, r, crew)
  publicExpense(w, n.id, cost, 'ship construction', r.id)
  for (const [good, amount] of [
    ['timber', timber],
    ['iron', iron],
    ['arms', arms],
    ['tools', tools],
  ] as const)
    recordUse(w, marketStore(r.id), good, amount)
  r.stocks.timber -= timber
  r.stocks.iron -= iron
  r.stocks.arms -= arms
  r.stocks.tools -= tools
  r.consumption.timber += timber
  r.consumption.iron += iron
  r.consumption.arms += arms
  r.consumption.tools += tools
  state.fleets.push({
    id: w.nextArmy++,
    nation,
    name: `${n.shortName} ${state.fleets.filter((f) => f.nation === nation).length + 1} Fleet`,
    region,
    home: region,
    cell: harbor.water,
    target: null,
    course: [],
    mission: 'escort',
    warships,
    transports,
    hull: 1,
    food: 0,
    arms: 0,
    embarked: [],
    soldiers: crew,
    communities,
    morale: 0.75,
    supply: 1,
    experience: 0.1,
    casualties: 0,
  })
  state.revision++
  warEvent(
    w,
    `${n.shortName} commissions a fleet`,
    `${warships} warships and ${transports} transports enter service at ${r.name}, drawing ${crew} adults into naval service.`,
    nation,
    region,
  )
  return 'Fleet commissioned. Its crews and supplies remain part of the population and goods accounts.'
}
export function orderFleet(w: World, id: number, target: number, mission: Fleet['mission']) {
  const f = ensureWarfare(w).fleets.find((f) => f.id === id),
    harbor = portAt(w, target)
  if (!f || !harbor) throw new Error('Choose a fleet and a coastal destination.')
  if (!['patrol', 'escort', 'blockade', 'raid', 'transport', 'return'].includes(mission))
    throw new Error('Unknown naval mission.')
  if (mission === 'blockade' || mission === 'raid') {
    if (relation(w, f.nation, w.regions[target].nation)?.treaty !== 'war')
      throw new Error('A blockade or route raid requires war with the port owner.')
    if (!f.warships) throw new Error('Blockades and raids require warships.')
  }
  if (mission === 'return' && !friendlyPort(w, f.nation, target))
    throw new Error('Returning fleets need port access.')
  if (
    mission === 'transport' &&
    !friendlyPort(w, f.nation, target) &&
    relation(w, f.nation, w.regions[target].nation)?.treaty !== 'war'
  )
    throw new Error('A landing needs military access or a declared war.')
  const path = waterPath(w, f.cell, harbor.water)
  if (!path.length) throw new Error('There is no navigable sea route to that coast.')
  f.target = target
  f.course = path.slice(1)
  f.sailingProgress = 0
  f.mission = mission
  w.warfare!.revision++
  for (const army of w.armies.filter((a) => f.embarked.includes(a.id))) army.target = target
  return 'Naval orders recorded. Ships sail and consume provisions on subsequent months.'
}
/** Shared eligibility for the automatic planner and explicit embarkation orders. */
export function canEmbarkArmy(w: World, army: Army, fleet: Fleet) {
  const aboard = w.armies.filter((a) => fleet.embarked.includes(a.id)).reduce((sum, a) => sum + a.soldiers, 0)
  return (
    army.nation === fleet.nation &&
    army.operations?.embarkedOn === null &&
    portAt(w, army.region)?.water === fleet.cell &&
    friendlyPort(w, fleet.nation, army.region) &&
    aboard + army.soldiers <= transportSeats(fleet)
  )
}
export function embarkArmy(w: World, armyId: number, fleetId: number) {
  ensureWarfare(w)
  const a = w.armies.find((a) => a.id === armyId),
    f = w.warfare!.fleets.find((f) => f.id === fleetId)
  if (
    !a ||
    !f ||
    a.nation !== f.nation ||
    a.operations!.embarkedOn !== null ||
    portAt(w, a.region)?.water !== f.cell ||
    !friendlyPort(w, f.nation, a.region)
  )
    throw new Error('Army and fleet must share an accessible embarkation port and sovereign command.')
  const aboard = w.armies.filter((a) => f.embarked.includes(a.id)).reduce((sum, a) => sum + a.soldiers, 0)
  if (aboard + a.soldiers > transportSeats(f))
    throw new Error('The fleet does not have enough transport berths for this army.')
  f.embarked.push(a.id)
  a.operations!.embarkedOn = f.id
  a.operations!.entrenchment = 0
  a.target = f.target
  return 'Army embarked. It remains a separate force and travels with this fleet.'
}
export function disembark(w: World, army: Army, fleet: Fleet, region: number) {
  w.warfare!.revision++
  army.region = region
  army.operations!.embarkedOn = null
  army.operations!.fatigue = clamp(army.operations!.fatigue + 0.18)
  army.target = null
  fleet.embarked = fleet.embarked.filter((id) => id !== army.id)
}
export function militaryDeaths(w: World, force: Army, amount: number) {
  const losses = Math.min(force.soldiers, Math.max(0, Math.floor(amount)))
  if (!losses) return
  removeSoldiers(w, force, losses)
  force.casualties += losses
  w.nations[force.nation].casualties += losses
  w.totals.deaths += losses
}
export function advanceNavy(w: World) {
  const state = ensureWarfare(w)
  for (const f of state.fleets) {
    // Positions, provisions and missions change within this loop; subsequent
    // harbor checks must not reuse pressure from the previous fleet's position.
    state.revision++
    if (!w.regions.some((r) => r.nation === f.nation)) {
      const home = w.regions[f.region]
      recordGift(w, fleetStore(f.id), marketStore(home.id), 'food', f.food)
      recordGift(w, fleetStore(f.id), marketStore(home.id), 'arms', f.arms)
      home.stocks.food += f.food
      home.stocks.arms += f.arms
      f.food = 0
      f.arms = 0
      for (const a of w.armies.filter((a) => f.embarked.includes(a.id))) {
        disembark(w, a, f, home.id)
        returnArmyPeople(w, a, home)
      }
      returnArmyPeople(w, f, home)
      continue
    }
    const coast = transportNetwork(w).harbors.find((h) => h.water === f.cell)
    const visit = coast
      ? militaryVisit(w, f.nation, coast.region, f.foreignStay)
      : { stay: undefined, withdraw: false }
    if (visit.stay) f.foreignStay = visit.stay
    else delete f.foreignStay
    const dock =
      !visit.withdraw &&
      transportNetwork(w).harbors.find((h) => h.water === f.cell && friendlyPort(w, f.nation, h.region))
    const n = w.nations[f.nation],
      aboard = w.armies.filter((a) => f.embarked.includes(a.id))
    f.hull = Math.max(0.05, f.hull - (dock ? 0.001 : 0.003))
    if (dock && diplomaticAccess(w, f.nation, w.regions[dock.region].nation, 'supply', dock.region)) {
      const r = w.regions[dock.region]
      const foodPrice = r.prices.food / 1000,
        armsPrice = r.prices.arms / 1000
      const load = Math.min(
        Math.max(0, r.stocks.food - population(r) * 0.025),
        Math.max(0, f.soldiers * 0.034 * 4 - f.food),
        Math.max(0, n.treasury) / Math.max(0.001, foodPrice),
      )
      publicGoods(w, n.id, r.id, 'food', load, fleetStore(f.id), foodPrice)
      const ammunition = Math.min(
        r.stocks.arms,
        Math.max(0, (f.warships + 1) * 0.8 * 3 - f.arms),
        Math.max(0, n.treasury) / Math.max(0.001, armsPrice),
      )
      publicGoods(w, n.id, r.id, 'arms', ammunition, fleetStore(f.id), armsPrice)
      f.food += load
      f.arms += ammunition
      r.stocks.food -= load
      r.stocks.arms -= ammunition
      const repair = Math.max(
        0,
        Math.min(
          0.07,
          1 - f.hull,
          r.stocks.timber / 60,
          r.stocks.iron / 15,
          r.stocks.tools / 4,
          n.treasury / 150,
        ),
      )
      f.hull += repair
      for (const [good, amount] of [
        ['timber', repair * 60],
        ['iron', repair * 15],
        ['tools', repair * 4],
      ] as const) {
        // Division/multiplication of the limiting input can round up by one ULP.
        // The physical withdrawal and consumption entry must use the same available quantity.
        const used = Math.min(r.stocks[good], amount)
        recordUse(w, marketStore(r.id), good, used)
        r.stocks[good] -= used
        r.consumption[good] += used
      }
      publicExpense(w, n.id, repair * 150, 'naval repairs', r.id)
      for (const a of aboard) {
        const loaded = Math.min(
          Math.max(0, r.stocks.food - population(r) * 0.025),
          Math.max(0, a.soldiers * 0.034 * 3 - a.operations!.food),
          Math.max(0, n.treasury) / Math.max(0.001, foodPrice),
        )
        publicGoods(w, n.id, r.id, 'food', loaded, armyStore(a.id), foodPrice)
        a.operations!.food += loaded
        r.stocks.food -= loaded
      }
      const replacements =
        r.nation === f.nation
          ? Math.min(
              Math.max(0, crewNeeded(f) - f.soldiers),
              Math.floor(r.population.adults * 0.001),
              Math.floor(n.treasury / 0.2),
            )
          : 0
      if (replacements > 0) {
        const people = takeCivilianAdults(w, r, replacements)
        for (const g of people) addCommunity(f.communities!, g)
        f.soldiers += replacements
        publicExpense(w, n.id, replacements * 0.2, 'naval recruitment', r.id)
      }
    }
    const need = f.soldiers * 0.034,
      eaten = Math.min(f.food, need)
    recordUse(w, fleetStore(f.id), 'food', eaten, 'government')
    f.food -= eaten
    f.supply = eaten / Math.max(0.001, need)
    w.regions[f.region].consumption.food += eaten
    const loyalty = unitLoyalty(w, f)
    f.morale = clamp(f.morale + (f.supply - 0.85) * 0.06 + (loyalty.loyalty - 0.5) * 0.02, 0.05, 1)
    militaryDeaths(w, f, f.soldiers * (1 - f.supply) * 0.025)
    if (dock && loyalty.loyalty < 0.3)
      releaseSoldiers(w, f, w.regions[dock.region], Math.floor(f.soldiers * 0.03))
    const speed = Math.floor(
      (12 + n.technologies.logistics * 3) *
        (0.3 + f.supply * 0.7) *
        Math.min(1, f.soldiers / Math.max(1, crewNeeded(f))) *
        (0.5 + f.hull * 0.5),
    )
    let distance = speed + (f.sailingProgress ?? 0)
    while (f.course.length) {
      const step = stepDistance(w.cells[f.cell], w.cells[f.course[0]])
      if (distance + 1e-9 < step) break
      distance -= step
      f.cell = f.course.shift()!
    }
    f.sailingProgress = f.course.length ? Math.max(0, distance) : 0
    if (!f.course.length && f.target !== null) f.region = f.target
    if (
      ['transport', 'return'].includes(f.mission) &&
      !f.course.length &&
      f.target !== null &&
      friendlyPort(w, f.nation, f.target)
    )
      for (const a of aboard) disembark(w, a, f, f.target)
    const invalidMission =
      f.target !== null &&
      ((['blockade', 'raid'].includes(f.mission) &&
        relation(w, f.nation, w.regions[f.target].nation)?.treaty !== 'war') ||
        (f.mission === 'transport' &&
          !friendlyPort(w, f.nation, f.target) &&
          relation(w, f.nation, w.regions[f.target].nation)?.treaty !== 'war'))
    if (
      (f.supply < 0.35 || f.hull < 0.3 || invalidMission || visit.withdraw) &&
      (f.mission !== 'return' || !f.course.length)
    ) {
      const port = transportNetwork(w)
        .harbors.filter(
          (h) =>
            friendlyPort(w, f.nation, h.region) &&
            (!visit.withdraw ||
              diplomaticAccess(w, f.nation, w.regions[h.region].nation, 'basing', h.region)),
        )
        .map((h) => ({ h, path: waterPath(w, f.cell, h.water) }))
        .filter((v) => v.path.length)
        .sort((a, b) => sailingDistance(w, a.path) - sailingDistance(w, b.path))[0]
      if (port) orderFleet(w, f.id, port.h.region, 'return')
    }
  }
  const fought = new Set<number>()
  for (const a of state.fleets)
    for (const b of state.fleets) {
      if (
        a.id >= b.id ||
        fought.has(a.id) ||
        fought.has(b.id) ||
        !a.soldiers ||
        !b.soldiers ||
        relation(w, a.nation, b.nation)?.treaty !== 'war'
      )
        continue
      if (!navalEncounterPath(w, a.cell, b.cell).length) continue
      const power = (f: Fleet) =>
        (f.warships + f.transports * 0.12) *
        f.hull *
        (0.3 + f.supply * 0.7) *
        (0.2 + 0.8 * Math.min(1, f.arms / Math.max(0.1, f.warships * 0.25))) *
        f.morale *
        unitLoyalty(w, f).cohesion *
        Math.min(1, f.soldiers / Math.max(1, crewNeeded(f))) *
        effectMultiplier(w, 'militaryPower', f.nation) *
        (1 + w.nations[f.nation].technologies.military * 0.15)
      const pa = power(a),
        pb = power(b)
      for (const [f, enemy, own] of [
        [a, pb, pa],
        [b, pa, pb],
      ] as [Fleet, number, number][]) {
        const ammunition = Math.min(f.arms, f.warships * 0.25)
        recordUse(w, fleetStore(f.id), 'arms', ammunition, 'government')
        f.arms -= ammunition
        w.regions[f.region].consumption.arms += ammunition
        const damage = Math.min(0.55, (enemy / Math.max(0.5, own)) * (0.07 + random(w) * 0.08))
        f.hull = clamp(f.hull - damage)
        militaryDeaths(w, f, f.soldiers * damage * 0.3)
        f.morale = clamp(f.morale - damage * 0.25)
        if (f.hull < 0.25 && f.warships + f.transports > 0) {
          if (f.warships) f.warships--
          else f.transports--
          f.hull = f.warships + f.transports > 0 ? 0.5 : 0
        }
      }
      const aggressor = relation(w, a.nation, b.nation)?.aggressor
      for (const [force, opponent, strength] of [
        [a, b, pa],
        [b, a, pb],
      ] as const)
        recordMilitaryInfluence(
          w,
          force.nation,
          opponent.nation,
          null,
          aggressor === force.nation ? 'attack' : 'defense',
          strength / Math.max(1, pa + pb),
        )
      fought.add(a.id)
      fought.add(b.id)
      warEvent(
        w,
        `${w.nations[a.nation].shortName} and ${w.nations[b.nation].shortName} clash at sea`,
        'Fleets exchange fire; damaged hulls, crew losses and ammunition expenditure affect subsequent sea control.',
        a.nation,
      )
    }
  for (const f of state.fleets) {
    const embarked = w.armies.filter((a) => f.embarked.includes(a.id))
    let excess = embarked.reduce((sum, a) => sum + a.soldiers, 0) - (f.transports * 800 + f.warships * 40)
    for (const a of embarked)
      if (excess > 0) {
        const lost = Math.min(a.soldiers, excess)
        militaryDeaths(w, a, lost)
        excess -= lost
      }
    if ((!f.warships && !f.transports) || !f.soldiers) {
      recordUse(w, fleetStore(f.id), 'food', f.food, 'other')
      recordUse(w, fleetStore(f.id), 'arms', f.arms, 'other')
      w.regions[f.region].consumption.food += f.food
      w.regions[f.region].consumption.arms += f.arms
      militaryDeaths(w, f, f.soldiers)
      for (const a of embarked) {
        militaryDeaths(w, a, a.soldiers)
        a.operations!.embarkedOn = null
      }
    }
  }
  state.fleets = state.fleets.filter((f) => f.soldiers > 0 && f.warships + f.transports > 0)
  for (const fleet of state.fleets)
    fleet.embarked = fleet.embarked.filter((id) =>
      w.armies.some(
        (army) =>
          army.id === id &&
          army.soldiers > 0 &&
          army.operations?.embarkedOn === fleet.id &&
          army.nation === fleet.nation,
      ),
    )
  state.revision++
}
