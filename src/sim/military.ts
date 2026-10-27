import { recordMilitaryInfluence } from './influence'
import { publicGoods } from './ledger'
import {
  marketStore,
  armyStore,
  fleetStore,
  recordGift,
  recordUse,
  recordRequisition,
} from './national-accounts'
import { BASE_PRICE } from './economy'
import { MAX_ARMIES } from './military-limits'
import { markOccupation } from './geopolitics'
import { knownMap } from './intelligence'
import { clamp, population, relation, type Army, type World } from './types'
import { transportGraph, shortestPaths, pathTo } from './economy'
import { corridorProfile, corridorUsage } from './corridors'
import { allForces, unitLoyalty } from './forces'
import { diplomaticAccessView } from './agreements'
import {
  takeCivilianAdults,
  removeCivilianAdults,
  releaseSoldiers,
  returnArmyPeople,
  apportion,
} from './population'
import {
  ensureWarfare,
  militaryDeaths,
  warEvent,
  cargoCapacity,
  portAt,
  disembark,
  embarkArmy,
  canEmbarkArmy,
  orderFleet,
  waterPath,
} from './navy'
import { effectMultiplier } from './effects'
import { random } from './random'
import { seaPassageView } from './naval-control'

export function landGraph(w: World, nation: number, profile = corridorProfile(w)) {
  return transportGraph(w, nation, profile).map((edges) => edges.filter((e) => !e.sea))
}
export function advanceArmies(w: World) {
  // Movement can change owners, but diplomatic commitments stay fixed in this phase.
  const passage = seaPassageView(w),
    access = diplomaticAccessView(w),
    accessible = (world: World, nation: number, region: number) =>
      world.regions[region].nation === nation ||
      relation(world, nation, world.regions[region].nation)?.treaty === 'alliance' ||
      access(nation, world.regions[region].nation)
  const state = ensureWarfare(w),
    profile = corridorProfile(w),
    remaining = profile.capacity.slice()
  state.deliveries = []
  // Civilian freight and military supply compete for the same physical road/sea segments.
  const freight = w.localEconomy
    ? w.localEconomy.shipments.map((s) => ({ legs: s.legs, volume: s.quantity }))
    : w.routes
  for (const route of freight)
    if (route.legs)
      for (const [index, count] of corridorUsage(profile, route.legs))
        remaining[index] = Math.max(0, remaining[index] - route.volume * count)
  const seaRemaining = new Map(
    state.fleets.map((f) => [
      f.id,
      cargoCapacity(
        f,
        w.armies.filter((a) => f.embarked.includes(a.id)).reduce((sum, a) => sum + a.soldiers, 0),
      ),
    ]),
  )
  let owners = ''
  const wars = new Set(w.relations.filter((r) => r.treaty === 'war').flatMap((r) => [r.a, r.b]))
  const pathCache = new WeakMap<
    ReturnType<typeof transportGraph>,
    Map<number, ReturnType<typeof shortestPaths>>
  >()
  function pathsFrom(graph: ReturnType<typeof transportGraph>, from: number) {
    let cache = pathCache.get(graph)
    if (!cache) {
      cache = new Map()
      pathCache.set(graph, cache)
    }
    let paths = cache.get(from)
    if (!paths) {
      paths = shortestPaths(graph, from)
      cache.set(from, paths)
    }
    return paths
  }
  const supplyGraphs = new Map<number, ReturnType<typeof transportGraph>>(),
    landGraphs = new Map<number, ReturnType<typeof landGraph>>()
  function graphFor(nation: number, land: boolean) {
    const currentOwners = w.regions.map((region) => region.nation).join(',')
    if (owners !== currentOwners) {
      owners = currentOwners
      supplyGraphs.clear()
      landGraphs.clear()
    }
    const cache = land ? landGraphs : supplyGraphs
    let graph = cache.get(nation)
    if (!graph) {
      const access = w.regions.map((region) => accessible(w, nation, region.id)),
        chart = land && w.nations[nation].ai ? new Set(knownMap(w, nation).map((r) => r.id)) : null
      graph = land
        ? landGraph(w, nation, profile).map((edges, from) => {
            if (!chart) return edges
            return chart.has(from) ? edges.filter((e) => chart.has(e.to)) : []
          })
        : transportGraph(w, nation, profile).map((edges, from) =>
            edges.filter((edge) => access[from] && access[edge.to]),
          )
      cache.set(nation, graph)
    }
    return graph
  }
  function supply(army: Army) {
    const ops = army.operations!,
      r = w.regions[army.region],
      n = w.nations[army.nation]
    ops.source = null
    ops.line = []
    const graph = graphFor(army.nation, false)
    const paths = pathsFrom(graph, army.region)
    const sources = w.regions
      .filter(
        (r) =>
          r.nation === army.nation &&
          (r.id === n.capital || (r.infrastructure >= 0.5 && r.industry >= 0.4 && r.devastation < 0.5)) &&
          Number.isFinite(paths.distance[r.id]),
      )
      .sort((a, b) => paths.distance[a.id] - paths.distance[b.id] || a.id - b.id)
    let delivered = 0
    for (const source of sources) {
      const needFood = Math.max(0, army.soldiers * 0.034 * 3 - ops.food),
        needArms = Math.max(0, army.soldiers * 0.0005 * 4 - ops.arms)
      if (needFood + needArms < 0.01) break
      const path = pathTo(paths.previous, army.region, source.id).reverse(),
        edges = path.slice(1).map((to, i) => graph[path[i]].find((e) => e.to === to)!),
        legs = edges.flatMap((e) => e.legs),
        usage = corridorUsage(profile, legs)
      const sea = edges.some((e) => e.sea)
      const convoy = sea
        ? state.fleets
            .filter(
              (f) =>
                f.nation === army.nation &&
                ['escort', 'transport'].includes(f.mission) &&
                legs.some((leg) => leg.mode === 'sea' && leg.cells.some((cell) => cell === f.cell)),
            )
            .sort((a, b) => (seaRemaining.get(b.id) ?? 0) - (seaRemaining.get(a.id) ?? 0))[0]
        : undefined
      if (sea && !convoy) continue
      let capacity = sea ? seaRemaining.get(convoy!.id)! : Infinity
      for (const [index, count] of usage) capacity = Math.min(capacity, remaining[index] / count)
      for (const edge of edges) capacity = Math.min(capacity, edge.capacity)
      const distance = paths.distance[source.id],
        security = path.reduce(
          (value, id) => value * (1 - w.regions[id].unrest * 0.002 - w.regions[id].devastation * 0.15),
          1,
        ),
        attenuation = Math.max(0.1, security) / (1 + distance / 160)
      capacity *= attenuation * passage(army.nation, legs)
      const foodPrice = (source.prices.food || BASE_PRICE.food) / 1000,
        armsPrice = (source.prices.arms || BASE_PRICE.arms) / 1000
      const food = Math.min(
        needFood,
        Math.max(0, source.stocks.food - population(source) * 0.025),
        capacity,
        n.treasury / foodPrice,
      )
      const arms = Math.min(
        needArms,
        source.stocks.arms,
        Math.max(0, capacity - food),
        Math.max(0, n.treasury - food * foodPrice) / armsPrice,
      )
      if (food + arms < 0.01) continue
      publicGoods(w, n.id, source.id, 'food', food, armyStore(army.id), foodPrice)
      publicGoods(w, n.id, source.id, 'arms', arms, armyStore(army.id), armsPrice)
      source.stocks.food -= food
      source.stocks.arms -= arms
      ops.food += food
      ops.arms += arms
      for (const [index, count] of usage)
        remaining[index] = Math.max(0, remaining[index] - (food + arms) * count)
      if (convoy) seaRemaining.set(convoy.id, seaRemaining.get(convoy.id)! - food - arms)
      state.deliveries.push({ army: army.id, from: source.id, month: w.month, food, arms, path, legs })
      ops.source ??= source.id
      if (!ops.line.length) ops.line = path
      delivered += food + arms
    }
    const need = army.soldiers * 0.034
    if (ops.food < need && ops.conduct === 'requisition' && accessible(w, army.nation, r.id)) {
      const taken = Math.min(r.stocks.food, need - ops.food, population(r) * 0.025 * 0.25)
      recordGift(w, marketStore(r.id), armyStore(army.id), 'food', taken)
      r.stocks.food -= taken
      ops.food += taken
      const hardship = taken / Math.max(1, population(r) * 0.025)
      if (taken > 0)
        recordMilitaryInfluence(w, army.nation, r.nation, r.id, 'requisition', army.soldiers / 2000, hardship)
      r.unrest = clamp(r.unrest + hardship * 20, 0, 100)
      r.devastation = clamp(r.devastation + hardship * 0.03)
      for (const group of r.communities ?? []) {
        group.grievance = clamp(group.grievance + hardship * 0.15)
        group.loyalty = clamp(group.loyalty - hardship * 0.08)
      }
    }
    ops.isolated = delivered > 0.01 ? 0 : ops.isolated + 1
    const food = Math.min(ops.food, need),
      armsNeed = army.soldiers * 0.0005,
      arms = Math.min(ops.arms, armsNeed)
    recordUse(w, armyStore(army.id), 'food', food, 'government')
    recordUse(w, armyStore(army.id), 'arms', arms, 'government')
    ops.food -= food
    ops.arms -= arms
    r.consumption.food += food
    r.consumption.arms += arms
    army.supply = clamp((0.85 * food) / Math.max(0.001, need) + (0.15 * arms) / Math.max(0.001, armsNeed))
    const social = unitLoyalty(w, army)
    ops.loyalty = social.loyalty
    ops.cohesion = social.cohesion
    const payroll = clamp(
      n.budget.military /
        Math.max(
          1,
          allForces(w)
            .filter((f) => f.nation === n.id)
            .reduce((s, a) => s + a.soldiers, 0) * 0.008,
        ),
    )
    for (const group of army.communities ?? [])
      group.loyalty = clamp(group.loyalty + (payroll - 0.65) * 0.008 - (1 - army.supply) * 0.015)
    army.morale = clamp(
      army.morale +
        (army.supply - 0.8) * 0.06 +
        (ops.loyalty - 0.55) * 0.025 +
        (payroll - 0.5) * 0.01 -
        ops.fatigue * 0.012,
      0.03,
      1,
    )
    army.experience = clamp(army.experience + payroll * 0.0015)
    ops.fatigue = clamp(ops.fatigue - (ops.stance === 'march' ? 0.06 : 0.13))
    if (ops.stance === 'entrench') ops.entrenchment = clamp(ops.entrenchment + 0.1 * r.infrastructure)
    const terrainStress = ['mountains', 'desert', 'tundra'].includes(r.terrain) ? 0.003 : 0.0005
    militaryDeaths(
      w,
      army,
      army.soldiers *
        ((1 - army.supply) * 0.022 +
          terrainStress * (1 - army.supply * 0.8) * (1 - n.technologies.medicine * 0.08)),
    )
    const deserters = Math.floor(
      army.soldiers * Math.max(0, 0.45 - ops.loyalty) * (0.015 + (1 - army.supply) * 0.03),
    )
    if (deserters) releaseSoldiers(w, army, r, deserters)
    if (ops.disorder) ops.disorder--
    if (!ops.disorder && ops.loyalty < 0.22 && army.morale < 0.3 && random(w) < 0.2) {
      ops.disorder = 3
      army.target = null
      warEvent(
        w,
        `Soldiers in ${army.name} refuse orders`,
        'Low confidence, poor provision and divided loyalties disrupt command. Some troops return to civilian life; the force must regroup.',
        army.nation,
        army.region,
      )
      releaseSoldiers(w, army, r, Math.floor(army.soldiers * 0.08))
    }
  }

  const engaged = new Set<number>()
  function battle(army: Army, destination: number, amphibious = false) {
    const next = w.regions[destination],
      n = w.nations[army.nation],
      former = w.nations[next.nation]
    let defenders = w.armies.filter(
      (a) =>
        a.nation === next.nation &&
        a.region === destination &&
        a.soldiers > 0 &&
        a.operations!.embarkedOn === null,
    )
    if (defenders.reduce((sum, force) => sum + force.soldiers, 0) < Math.min(1800, army.soldiers * 0.8)) {
      const willingAdults = next
          .communities!.filter((g) => g.allegiance !== army.nation)
          .reduce((sum, g) => sum + g.population.adults, 0),
        localLoyalty =
          next.communities!.reduce(
            (sum, g) =>
              sum +
              (g.population.adults + g.population.elders) *
                g.loyalty *
                (g.allegiance === former.id ? 1 : g.allegiance === army.nation ? 0 : 0.45),
            0,
          ) / Math.max(1, next.population.adults + next.population.elders)
      const levy = Math.min(
        2500,
        willingAdults,
        Math.floor(next.population.adults * 0.035 * localLoyalty),
        Math.floor(next.stocks.arms / 0.002),
      )
      if (levy >= 50 && w.armies.length < MAX_ARMIES) {
        const militia: Army = {
          id: w.nextArmy++,
          nation: former.id,
          name: `${next.name} local levy`,
          region: destination,
          target: null,
          soldiers: levy,
          establishment: levy,
          communities: takeCivilianAdults(w, next, levy, (g) => g.allegiance !== army.nation),
          morale: 0.45,
          supply: 0.6,
          experience: 0.05,
          casualties: 0,
        }
        recordRequisition(w, next.id, 'arms', levy * 0.002)
        next.stocks.arms -= levy * 0.002
        next.consumption.arms += levy * 0.002
        w.armies.push(militia)
        ensureWarfare(w)
        militia.operations!.stance = 'entrench'
        militia.operations!.entrenchment = 0.15
        defenders.push(militia)
      }
    }
    const power = (a: Army) =>
      a.soldiers *
      a.morale *
      (0.25 + a.supply * 0.75) *
      unitLoyalty(w, a).cohesion *
      (1 - a.operations!.fatigue * 0.4) *
      (1 + w.nations[a.nation].technologies.military * 0.16 + a.experience * 0.3) *
      effectMultiplier(w, 'militaryPower', a.nation, a.region) *
      effectMultiplier(w, 'armyMorale', a.nation, a.region)
    const terrain =
      next.terrain === 'mountains' ? 1.8 : next.terrain === 'forest' || next.terrain === 'hills' ? 1.3 : 1
    const crossing = w.cells[next.center].river ? 0.82 : 1
    const attack = power(army) * crossing * (amphibious ? 0.55 : 1),
      defenses = defenders.map((a) => power(a) * terrain * (1 + a.operations!.entrenchment * 0.6)),
      defense = defenses.reduce((s, p) => s + p, 0)
    const attackerLoss = Math.min(army.soldiers, Math.round(defense * (0.055 + random(w) * 0.04))),
      defenseLoss = Math.min(
        defenders.reduce((s, a) => s + a.soldiers, 0),
        Math.round(attack * (0.06 + random(w) * 0.04)),
      )
    for (const force of [army, ...defenders]) {
      const used = Math.min(force.operations!.arms, force.soldiers * 0.001)
      recordUse(w, armyStore(force.id), 'arms', used, 'government')
      force.operations!.arms -= used
      w.regions[force.region].consumption.arms += used
    }
    army.morale = clamp(
      army.morale - (attackerLoss / Math.max(1, army.soldiers)) * 0.3 - (attack < defense * 0.8 ? 0.04 : 0),
    )
    militaryDeaths(w, army, attackerLoss)
    const losses = apportion(
      defenseLoss,
      defenses,
      defenders.map((a) => a.soldiers),
    )
    defenders.forEach((a, i) => {
      militaryDeaths(w, a, losses[i])
      a.morale = clamp(a.morale - (losses[i] / Math.max(1, a.soldiers + losses[i])) * 0.5)
      engaged.add(a.id)
    })
    const civilianLoss = Math.min(
      next.population.adults,
      Math.floor((attackerLoss + defenseLoss) * (army.operations!.conduct === 'requisition' ? 0.035 : 0.012)),
    )
    recordMilitaryInfluence(
      w,
      army.nation,
      former.id,
      next.id,
      'attack',
      (army.soldiers + attackerLoss) / 2000,
      civilianLoss / Math.max(1, population(next) * 0.01),
    )
    removeCivilianAdults(w, next, civilianLoss)
    next.deaths += civilianLoss
    w.totals.deaths += civilianLoss
    next.devastation = clamp(next.devastation + 0.025 + civilianLoss / Math.max(1, population(next)))
    army.operations!.fatigue = clamp(army.operations!.fatigue + 0.2)
    army.experience = clamp(army.experience + 0.02)
    if (attack > defense * 1.2 && army.soldiers > 200 && army.morale > 0.2) {
      recordMilitaryInfluence(
        w,
        army.nation,
        former.id,
        next.id,
        'victory',
        attack / Math.max(1, attack + defense),
      )
      next.nation = army.nation
      markOccupation(w, next.id, former.id)
      next.unrest = clamp(next.unrest + 15, 0, 100)
      army.region = next.id
      army.operations!.entrenchment = 0
      for (const group of next.communities ?? [])
        group.grievance = clamp(group.grievance + (army.operations!.conduct === 'requisition' ? 0.15 : 0.05))
      for (const d of defenders) {
        const retreat = next.neighbors
          .filter((id) => w.regions[id].nation === former.id)
          .sort((a, b) => w.regions[b].infrastructure - w.regions[a].infrastructure)[0]
        if (retreat !== undefined) {
          d.region = retreat
          d.target = null
          d.operations!.entrenchment = 0
          d.operations!.fatigue = clamp(d.operations!.fatigue + 0.25)
        } else returnArmyPeople(w, d, next)
      }
      if (former.capital === next.id) {
        const remaining = w.regions
          .filter((r) => r.nation === former.id)
          .sort((a, b) => population(b) - population(a))
        if (remaining.length) {
          former.capital = remaining[0].id
          former.stability = Math.max(5, former.stability - 15)
        }
      }
      warEvent(
        w,
        `${n.shortName} occupies ${next.name}`,
        `Terrain, supply and troop cohesion shape the battle. ${attackerLoss + defenseLoss} troops and ${civilianLoss} civilians die; surviving defenders retreat or surrender. Occupation requires sustained forces and administration; local allegiance does not change with the battlefield result.`,
        n.id,
        next.id,
      )
      return true
    }
    recordMilitaryInfluence(
      w,
      former.id,
      army.nation,
      next.id,
      'defense',
      defense / Math.max(1, attack + defense),
    )
    if (w.month % 3 === army.id % 3)
      warEvent(
        w,
        `Fighting continues near ${next.name}`,
        `The attack fails to secure the province. ${attackerLoss + defenseLoss} military deaths and ${civilianLoss} civilian deaths are recorded.`,
        n.id,
        next.id,
      )
    return false
  }

  for (const a of [...w.armies]) {
    const ops = a.operations!,
      n = w.nations[a.nation]
    if (!w.regions.some((r) => r.nation === a.nation)) {
      if (ops.embarkedOn === null) returnArmyPeople(w, a, w.regions[a.region])
      continue
    }
    if (ops.embarkedOn !== null) {
      const fleet = state.fleets.find((f) => f.id === ops.embarkedOn)
      if (!fleet) continue
      const needed = a.soldiers * 0.034,
        fromFleet = Math.min(Math.max(0, fleet.food - fleet.soldiers * 0.034), Math.max(0, needed - ops.food))
      recordGift(w, fleetStore(fleet.id), armyStore(a.id), 'food', fromFleet)
      fleet.food -= fromFleet
      ops.food += fromFleet
      const eaten = Math.min(ops.food, needed)
      recordUse(w, armyStore(a.id), 'food', eaten, 'government')
      ops.food -= eaten
      a.supply = eaten / Math.max(0.001, needed)
      w.regions[fleet.region].consumption.food += eaten
      militaryDeaths(w, a, a.soldiers * (1 - a.supply) * 0.022)
      if (
        fleet.mission === 'transport' &&
        !fleet.course.length &&
        fleet.target !== null &&
        relation(w, a.nation, w.regions[fleet.target].nation)?.treaty === 'war'
      )
        if (battle(a, fleet.target, true)) disembark(w, a, fleet, fleet.target)
      continue
    }
    supply(a)
    if (engaged.has(a.id) || ops.disorder || a.soldiers < 50 || ops.stance !== 'march') continue
    if (a.target === null && !wars.has(a.nation)) continue
    const graph = graphFor(a.nation, true),
      paths = pathsFrom(graph, a.region)
    if (n.ai && a.target === null) {
      const chart = knownMap(w, n.id)
      const targets = chart
        .filter(
          (r) => relation(w, a.nation, r.nation)?.treaty === 'war' && Number.isFinite(paths.distance[r.id]),
        )
        .sort((a, b) => paths.distance[a.id] - paths.distance[b.id])
      a.target = targets[0]?.id ?? null
      if (a.target === null) {
        const fleet = state.fleets.find(
          (f) =>
            f.nation === a.nation &&
            f.cell === portAt(w, a.region)?.water &&
            !f.embarked.length &&
            f.transports >= 4 &&
            canEmbarkArmy(w, a, f),
        )
        const enemy = fleet
          ? chart.find(
              (r) =>
                relation(w, a.nation, r.nation)?.treaty === 'war' &&
                portAt(w, r.id) &&
                waterPath(w, fleet.cell, portAt(w, r.id)!.water).length,
            )
          : undefined
        if (fleet && enemy) {
          embarkArmy(w, a.id, fleet.id)
          orderFleet(w, fleet.id, enemy.id, 'transport')
        }
      }
    }
    if (a.target === null || a.target === a.region) {
      a.target = null
      continue
    }
    const path = pathTo(paths.previous, a.region, a.target)
    ops.march = path
      .slice(1)
      .flatMap((to, i) => graph[path[i]].find((e) => e.to === to)!.legs.flatMap((leg) => leg.cells))
    if (path.length < 2) continue
    const next = path[1],
      edge = graph[a.region].find((e) => e.to === next)!
    ops.progress +=
      (35 + n.technologies.logistics * 7) * (0.3 + a.supply * 0.7) * ops.cohesion * (1 - ops.fatigue * 0.5)
    if (ops.progress < edge.cost * 4) continue
    ops.progress = 0
    ops.entrenchment = 0
    ops.fatigue = clamp(ops.fatigue + 0.1)
    if (relation(w, a.nation, w.regions[next].nation)?.treaty === 'war') battle(a, next)
    else if (accessible(w, a.nation, next)) a.region = next
    if (a.target === a.region) a.target = null
  }
  for (const a of w.armies.filter((a) => a.soldiers === 0)) {
    const r = w.regions[a.region]
    recordUse(w, armyStore(a.id), 'food', a.operations!.food, 'other')
    recordUse(w, armyStore(a.id), 'arms', a.operations!.arms, 'other')
    r.consumption.food += a.operations!.food
    r.consumption.arms += a.operations!.arms
    for (const f of state.fleets) f.embarked = f.embarked.filter((id) => id !== a.id)
  }
  w.armies = w.armies.filter((a) => a.soldiers > 0)
}
