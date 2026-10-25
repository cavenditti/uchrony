import { unpackWorldSave } from './save-codec'
import { validateDistrictEconomy } from './district-persistence'
import { validateEconomy } from './economic-persistence'
import { validateSpatial } from './spatial-persistence'
import { MAX_ARMIES } from './military-limits'
import { MAX_MAP_CELLS, MAX_PROVINCES } from './scale'
import { validateInstitutions } from './institutions'
import { validateIntelligence } from './intelligence-persistence'
import { validateForeignOffices } from './diplomatic-persistence'
import { validateGeopolitics } from './geopolitics-persistence'
import { coalesceCommunities, communityKey } from './population'
import type { PopulationCommunity } from './population-types'
import { MAX_STATE_IDENTITIES } from './types'
import { validateSovereignty } from './sovereignty-persistence'
import { validatePressures } from './pressure-persistence'
import { GOODS, FIELDS, type World, type RouteLeg } from './types'
import { neighbors } from './hex'
import { validateHistoryState, validateHistoricalRecord } from './history-schema'
import { validateStatecraft } from './statecraft-persistence'
import { validatePopulation } from './population-persistence'
import { validateCharacters } from './character-persistence'
import { validateWarfare } from './military-persistence'
import { initialArmyOperations } from './navy'
import { MAX_SAVE_BYTES } from '../storage/save-types'

/** Validates untrusted save files before they enter the simulation worker. */
export function validateWorld(value: unknown, allowDuplicateCommunities = false): World {
  const fail = (message: string): never => {
    throw new Error(`Invalid world save: ${message}`)
  }
  const object = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x)
  const number = (x: unknown, min = 0, max = 1e14) =>
    typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max
  const walk = (x: unknown, depth = 0) => {
    if (depth > 15) fail('data is nested too deeply')
    if (typeof x === 'number' && !Number.isFinite(x)) fail('non-finite number')
    if (typeof x === 'string' && x.length > 5000) fail('oversized text field')
    if (object(x) || Array.isArray(x)) for (const v of Object.values(x)) walk(v, depth + 1)
  }
  if (!object(value)) fail('expected an object')
  const w = value as unknown as World
  walk(w)
  if (w.viewOnly) fail('display snapshots cannot be restored')
  if (w.version !== 1) fail('unsupported version; this app supports version 1')
  if (w.generatorVersion !== undefined && ![1, 2, 3, 4].includes(w.generatorVersion))
    fail('unsupported geography generator')
  if (
    typeof w.seed !== 'string' ||
    w.seed.length > 100 ||
    !number(w.month, 0, 120000) ||
    !Number.isInteger(w.month)
  )
    fail('invalid seed or simulation date')
  if (
    !number(w.startYear, 1, 10000) ||
    !number(w.rng, 0, 4294967295) ||
    !number(w.nextEvent) ||
    !number(w.nextArmy) ||
    !number(w.climate, 0.1, 3)
  )
    fail('missing simulation counters')
  if (
    !number(w.width, 16, 448) ||
    !Number.isInteger(w.width) ||
    !number(w.height, 16, 288) ||
    !Number.isInteger(w.height) ||
    w.width * w.height > MAX_MAP_CELLS ||
    !Array.isArray(w.cells) ||
    w.cells.length !== w.width * w.height
  )
    fail('unsupported map dimensions')
  if (!Array.isArray(w.regions) || w.regions.length < 4 || w.regions.length > MAX_PROVINCES)
    fail('invalid provinces')
  if (!Array.isArray(w.nations) || w.nations.length < 4 || w.nations.length > MAX_STATE_IDENTITIES)
    fail('invalid states')
  const regionId = (id: unknown) => number(id, 0, w.regions.length - 1) && Number.isInteger(id)
  const nationId = (id: unknown) => number(id, 0, w.nations.length - 1) && Number.isInteger(id)
  const cellId = (id: unknown) => number(id, 0, w.cells.length - 1) && Number.isInteger(id)
  const terrain = (v: unknown) =>
    ['water', 'plains', 'forest', 'hills', 'mountains', 'desert', 'tundra'].includes(String(v))
  for (const [i, c] of w.cells.entries()) {
    if (
      !object(c) ||
      c.id !== i ||
      !number(c.x) ||
      !number(c.y) ||
      c.q !== i % w.width ||
      c.r !== Math.floor(i / w.width) ||
      !terrain(c.terrain) ||
      !number(c.elevation, -5, 5) ||
      !number(c.moisture, 0, 1) ||
      typeof c.river !== 'boolean'
    )
      fail(`invalid map cell ${i}`)
    if (c.terrain !== 'water' && !regionId(c.region)) fail('land cell without a province')
    if (c.riverFlow !== undefined && !number(c.riverFlow, 0, w.cells.length * 2)) fail('invalid river runoff')
    if (c.downstream !== undefined) {
      if (!cellId(c.downstream) || !neighbors(c.id, w.width, w.height).includes(c.downstream))
        fail('invalid downstream connection')
      const next = w.cells[c.downstream]
      if (!object(next) || !number(next.elevation, -5, 5) || next.elevation >= c.elevation)
        fail('river drainage must descend without cycles')
    }
  }
  const seenCells = new Set<number>()
  for (const [i, r] of w.regions.entries()) {
    if (r.materialCoverage !== undefined && !number(r.materialCoverage, 0, 1))
      fail('invalid material coverage')
    if (
      !object(r) ||
      r.id !== i ||
      typeof r.name !== 'string' ||
      !nationId(r.nation) ||
      !nationId(r.culture) ||
      !cellId(r.center) ||
      !terrain(r.terrain) ||
      typeof r.coastal !== 'boolean'
    )
      fail(`invalid province ${i}`)
    if (
      !Array.isArray(r.cells) ||
      !r.cells.length ||
      !r.cells.includes(r.center) ||
      r.cells.some(
        (id) =>
          !cellId(id) || w.cells[id].region !== i || w.cells[id].terrain === 'water' || seenCells.has(id),
      )
    )
      fail(`invalid province geometry ${i}`)
    r.cells.forEach((id) => seenCells.add(id))
    if (!Array.isArray(r.neighbors) || r.neighbors.some((id) => !regionId(id) || id === i))
      fail('invalid province neighbors')
    if (
      !object(r.population) ||
      ['children', 'adults', 'elders'].some((k) => !number(r.population[k as keyof typeof r.population]))
    )
      fail('invalid population cohorts')
    for (const key of ['stocks', 'production', 'consumption', 'prices'] as const)
      if (!object(r[key]) || GOODS.some((g) => !number(r[key][g]))) fail(`invalid ${key}`)
    if (
      r.plannedProduction !== undefined &&
      (!object(r.plannedProduction) || GOODS.some((g) => !number(r.plannedProduction![g])))
    )
      fail('invalid planned production')
    if (
      !object(r.deposits) ||
      ['timber', 'stone', 'iron', 'coal'].some((g) => !number(r.deposits[g as keyof typeof r.deposits]))
    )
      fail('invalid resource deposits')
    for (const key of [
      'fertility',
      'urban',
      'literacy',
      'health',
      'happiness',
      'infrastructure',
      'industry',
      'foodCoverage',
      'births',
      'deaths',
      'employed',
      'unrest',
      'devastation',
      'gdp',
    ] as const)
      if (!number(r[key], key === 'gdp' ? -1e14 : 0)) fail(`invalid province ${key}`)
    if (!number(r.migration, -1e14, 1e14)) fail('invalid migration')
  }
  if (seenCells.size !== w.cells.filter((c) => c.terrain !== 'water').length)
    fail('land missing from province geometry')
  for (const [i, n] of w.nations.entries()) {
    if (
      !object(n) ||
      n.id !== i ||
      !regionId(n.capital) ||
      typeof n.name !== 'string' ||
      typeof n.shortName !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(n.color) ||
      typeof n.government !== 'string' ||
      typeof n.ai !== 'boolean'
    )
      fail(`invalid state ${i}`)
    if (!['mercantile', 'expansionist', 'scholarly', 'agrarian'].includes(n.personality))
      fail('invalid state personality')
    if (
      !object(n.policies) ||
      !['balanced', 'agriculture', 'industry', 'military'].includes(n.policies.priority) ||
      !['open', 'controlled', 'closed'].includes(n.policies.migration)
    )
      fail('invalid government policies')
    for (const [key, options] of Object.entries({
      citizenship: ['civic', 'pluralist', 'heritage'],
      languagePolicy: ['local', 'common', 'multilingual'],
      beliefPolicy: ['protected', 'favored', 'restricted'],
    })) {
      const value = n.policies[key as keyof typeof n.policies]
      if (value !== undefined && !options.includes(String(value))) fail('invalid identity policy')
    }
    for (const key of [
      'tax',
      'welfare',
      'education',
      'military',
      'research',
      'tariff',
      'conscription',
    ] as const)
      if (!number(n.policies[key], 0, 100)) fail('invalid budget policy')
    for (const key of ['technologies', 'researchProgress'] as const)
      if (!object(n[key]) || FIELDS.some((f) => !number(n[key][f], 0, key === 'technologies' ? 6 : 1e14)))
        fail('invalid research')
    if (!FIELDS.includes(n.researchFocus)) fail('invalid research focus')
    if (
      !object(n.budget) ||
      ['welfare', 'education', 'military', 'research', 'administration', 'infrastructure'].some(
        (k) => !number(n.budget[k as keyof typeof n.budget]),
      )
    )
      fail('invalid treasury budget')
    for (const key of [
      'treasury',
      'debt',
      'stability',
      'legitimacy',
      'income',
      'spending',
      'gdp',
      'population',
      'foodCoverage',
      'manpower',
      'casualties',
    ] as const)
      if (!number(n[key], key === 'gdp' ? -1e14 : 0)) fail(`invalid state ${key}`)
  }
  if (!Array.isArray(w.relations) || w.relations.length !== (w.nations.length * (w.nations.length - 1)) / 2)
    fail('incomplete diplomacy table')
  const seenRelations = new Set<string>()
  for (const r of w.relations) {
    if (
      !object(r) ||
      !nationId(r.a) ||
      !nationId(r.b) ||
      r.a >= r.b ||
      !['neutral', 'trade', 'alliance', 'war', 'truce'].includes(r.treaty) ||
      !number(r.opinion, -100, 100) ||
      !number(r.warExhaustion) ||
      !number(r.since) ||
      !number(r.grievance) ||
      (r.aggressor !== undefined && r.aggressor !== r.a && r.aggressor !== r.b)
    )
      fail('invalid diplomatic relationship')
    const key = `${r.a}-${r.b}`
    if (seenRelations.has(key)) fail('duplicate diplomatic relationship')
    seenRelations.add(key)
  }
  if (!Array.isArray(w.armies)) fail('armies must be a list')
  if (w.armies.length > MAX_ARMIES)
    fail(`army formation capacity exceeded (${w.armies.length}; supported ${MAX_ARMIES})`)
  const armyIds = new Set<number>()
  for (const a of w.armies) {
    if (
      !object(a) ||
      !number(a.id) ||
      armyIds.has(a.id) ||
      typeof a.name !== 'string' ||
      !nationId(a.nation) ||
      !regionId(a.region) ||
      (a.target !== null && !regionId(a.target)) ||
      !number(a.soldiers) ||
      !number(a.morale, 0, 1) ||
      !number(a.supply, 0, 1) ||
      !number(a.experience, 0, 1) ||
      !number(a.casualties)
    )
      fail('invalid army')
    armyIds.add(a.id)
  }
  const validateLegs = (
    from: number,
    to: number,
    legs: RouteLeg[],
    maxLegs = w.regions.length * 3,
    fromCell = w.regions[from].center,
    toCell = w.regions[to].center,
  ) => {
    if (!Array.isArray(legs) || legs.length < 1 || legs.length > maxLegs) fail('invalid freight legs')
    let last = fromCell
    for (const leg of legs) {
      if (
        !object(leg) ||
        !['land', 'sea'].includes(leg.mode) ||
        !Array.isArray(leg.cells) ||
        leg.cells.length < 2 ||
        leg.cells.length > w.cells.length ||
        leg.cells.some((id) => !cellId(id))
      )
        fail('invalid freight geometry')
      if (leg.cells[0] !== last) fail('disconnected freight legs')
      for (let i = 0; i < leg.cells.length; i++) {
        const id = leg.cells[i],
          water = w.cells[id].terrain === 'water',
          seaInterior = leg.mode === 'sea' && i > 0 && i < leg.cells.length - 1
        if (water !== seaInterior) fail('freight path crosses invalid terrain')
        if (i > 0 && !neighbors(leg.cells[i - 1], w.width, w.height).includes(id))
          fail('freight path skips map cells')
      }
      if (leg.mode === 'sea' && leg.cells.length < 3) fail('shipping path needs water')
      last = leg.cells[leg.cells.length - 1]
    }
    if (last !== toCell) fail('freight endpoints do not match shipment')
  }
  if (!Array.isArray(w.routes) || w.routes.length > 20000) fail('invalid routes')
  for (const r of w.routes) {
    if (
      !object(r) ||
      !regionId(r.from) ||
      !regionId(r.to) ||
      !Array.isArray(r.path) ||
      r.path.some((id) => !regionId(id)) ||
      !object(r.goods) ||
      GOODS.some((g) => !number(r.goods[g])) ||
      !number(r.volume) ||
      !number(r.value) ||
      !number(r.capacity) ||
      typeof r.id !== 'string' ||
      typeof r.sea !== 'boolean' ||
      typeof r.international !== 'boolean'
    )
      fail('invalid trade route')
    if (r.legs !== undefined) {
      if (r.fromDistrict !== undefined || r.toDistrict !== undefined) {
        const a = w.localEconomy?.units[r.fromDistrict!],
          b = w.localEconomy?.units[r.toDistrict!]
        if (!a || !b || a.province !== r.from || b.province !== r.to)
          fail('invalid district freight endpoints')
        validateLegs(r.from, r.to, r.legs, w.cells.length, a!.center, b!.center)
      } else validateLegs(r.from, r.to, r.legs)
      if (
        r.sea !== r.legs.some((leg) => leg.mode === 'sea') ||
        r.path[0] !== r.from ||
        r.path[r.path.length - 1] !== r.to
      )
        fail('freight endpoints do not match shipment')
    }
  }
  if (w.tradeLanes !== undefined) {
    if (!Array.isArray(w.tradeLanes) || w.tradeLanes.length > w.regions.length * (w.regions.length - 1))
      fail('invalid trade memory')
    const seen = new Set<string>()
    for (const lane of w.tradeLanes) {
      if (
        !object(lane) ||
        !regionId(lane.from) ||
        !regionId(lane.to) ||
        lane.from === lane.to ||
        !Array.isArray(lane.path) ||
        lane.path.length < 2 ||
        lane.path.length > w.regions.length ||
        lane.path.some((id) => !regionId(id)) ||
        new Set(lane.path).size !== lane.path.length ||
        lane.path[0] !== lane.from ||
        lane.path.at(-1) !== lane.to ||
        !object(lane.flow) ||
        GOODS.some((good) => !number(lane.flow[good])) ||
        !number(lane.lastActive, 0, w.month) ||
        !Number.isInteger(lane.lastActive)
      )
        fail('invalid remembered trade lane')
      const key = `${lane.from}-${lane.to}`
      if (seen.has(key)) fail('duplicate remembered trade lane')
      seen.add(key)
    }
  }
  if (w.corridors !== undefined) {
    if (!Array.isArray(w.corridors) || w.corridors.length > w.cells.length * 3)
      fail('invalid corridor memory')
    const seen = new Set<number>()
    for (const trace of w.corridors) {
      if (
        !object(trace) ||
        !cellId(trace.a) ||
        !cellId(trace.b) ||
        trace.a >= trace.b ||
        !neighbors(trace.a, w.width, w.height).includes(trace.b) ||
        !number(trace.familiarity, 0, 1) ||
        !number(trace.traffic)
      )
        fail('invalid corridor trace')
      const key = trace.a * w.cells.length + trace.b
      if (seen.has(key)) fail('duplicate corridor trace')
      seen.add(key)
    }
  }
  if (w.corridorPlan !== undefined) {
    const plan = w.corridorPlan
    if (
      !object(plan) ||
      !number(plan.month, 0, w.month) ||
      !Number.isInteger(plan.month) ||
      !Array.isArray(plan.links) ||
      plan.links.length > (w.regions.length * (w.regions.length - 1)) / 2
    )
      fail('invalid corridor plan')
    const seen = new Set<string>()
    let cells = 0
    for (const link of plan.links) {
      if (
        !object(link) ||
        !regionId(link.from) ||
        !regionId(link.to) ||
        link.from >= link.to ||
        !number(link.changedAt, 0, plan.month) ||
        !Number.isInteger(link.changedAt)
      )
        fail('invalid corridor connection')
      const key = `${link.from}-${link.to}`
      if (seen.has(key)) fail('duplicate corridor connection')
      seen.add(key)
      validateLegs(link.from, link.to, link.legs, 3)
      for (const leg of link.legs) {
        cells += leg.cells.length
        if (leg.mode === 'land' && leg.cells.some((id) => ![link.from, link.to].includes(w.cells[id].region)))
          fail('corridor road crosses an unrelated province')
      }
      if (cells > w.cells.length * 16) fail('oversized corridor plan')
    }
  }
  if (!Array.isArray(w.events) || w.events.length > 240) fail('invalid chronicle')
  for (const e of w.events) {
    if (
      !object(e) ||
      !number(e.id) ||
      !number(e.month) ||
      typeof e.title !== 'string' ||
      typeof e.detail !== 'string' ||
      !['war', 'peace', 'economy', 'population', 'research', 'diplomacy', 'world'].includes(e.type) ||
      (e.region !== undefined && !regionId(e.region)) ||
      (e.nation !== undefined && !nationId(e.nation))
    )
      fail('invalid chronicle entry')
    if (
      e.expandedAccount !== undefined &&
      (typeof e.expandedAccount !== 'string' || e.expandedAccount.length > 2400)
    )
      fail('invalid expanded historical account')
    if (e.historical !== undefined) {
      validateHistoricalRecord(w, e.historical)
      if (e.historical.causeEvent >= e.id) fail('historical cause must precede its consequence')
    }
  }
  validateInstitutions(w)
  validateIntelligence(w)
  validateForeignOffices(w)
  validateGeopolitics(w)
  validateSovereignty(w)
  validatePressures(w)
  if (w.historical !== undefined) validateHistoryState(w, w.historical)
  validateWarfare(w, validateLegs)
  validateStatecraft(w)
  validatePopulation(w, allowDuplicateCommunities)
  validateCharacters(w)
  if (!Array.isArray(w.history) || w.history.length > 15000) fail('invalid history')
  for (const h of w.history) {
    if (
      !object(h) ||
      !['month', 'population', 'gdp', 'trade', 'wars', 'food'].every((k) =>
        number(h[k as keyof typeof h], k === 'gdp' ? -1e14 : 0),
      ) ||
      !Array.isArray(h.nations) ||
      h.nations.some(
        (n) =>
          !object(n) ||
          !nationId(n.id) ||
          !number(n.population) ||
          !number(n.gdp, -1e14) ||
          !number(n.territory) ||
          !number(n.treasury),
      )
    )
      fail('invalid history point')
  }
  if (
    !object(w.totals) ||
    ['population', 'gdp', 'trade', 'wars', 'births', 'deaths', 'migration'].some(
      (k) => !number(w.totals[k as keyof typeof w.totals], k === 'gdp' ? -1e14 : 0),
    )
  )
    fail('invalid totals')
  validateDistrictEconomy(w)
  validateEconomy(w)
  validateSpatial(w)
  return w
}

/** Recover only duplicate representation, after validating every profile and all declared age/troop totals. */
export function restoreWorld(value: unknown): World {
  value = unpackWorldSave(value)
  // Recover only machine-roundoff at natural bounds; real negatives and broken transport links still fail.
  const source = value as World
  let adjusted: World | undefined
  if (source && Array.isArray(source.armies) && source.warfare && Array.isArray(source.warfare.fleets)) {
    const clean = <T extends object>(record: T, unit: string[], nonnegative: string[]): T => {
      if (!record || typeof record !== 'object') return record
      let copy: Record<string, unknown> | undefined
      for (const key of [...unit, ...nonnegative]) {
        const number = (record as Record<string, unknown>)[key]
        if (typeof number !== 'number' || !Number.isFinite(number)) continue
        const replacement =
          number < 0 && number >= -1e-12
            ? 0
            : unit.includes(key) && number > 1 && number <= 1 + 1e-12
              ? 1
              : number
        if (number !== replacement) {
          copy ??= { ...record } as Record<string, unknown>
          copy[key] = replacement
        }
      }
      return (copy ?? record) as T
    }
    const armies = source.armies.map((army) => {
        const operations =
          army?.operations === undefined && army && typeof army === 'object'
            ? initialArmyOperations()
            : army?.operations
              ? clean(
                  army.operations,
                  ['fatigue', 'cohesion', 'loyalty', 'entrenchment'],
                  ['food', 'arms', 'progress'],
                )
              : army?.operations
        return operations === army?.operations ? army : { ...army, operations }
      }),
      fleets = source.warfare.fleets.map((fleet) =>
        clean(fleet, ['morale', 'supply', 'experience', 'hull'], ['food', 'arms']),
      )
    if (
      armies.some((a, i) => a !== source.armies[i]) ||
      fleets.some((f, i) => f !== source.warfare!.fleets[i])
    )
      adjusted = { ...source, armies, warfare: { ...source.warfare, fleets } }
  }
  const world = validateWorld(adjusted ?? value, true)
  let changed = false
  const census = (groups: PopulationCommunity[] | undefined) => {
    if (!groups) return groups
    const keys = new Set<string>()
    for (const group of groups) {
      const key = communityKey(group)
      if (keys.has(key)) {
        changed = true
        return coalesceCommunities(structuredClone(groups))
      }
      keys.add(key)
    }
    return groups
  }
  const regions = world.regions.map((region) => {
      const communities = census(region.communities)
      return communities === region.communities ? region : { ...region, communities }
    }),
    armies = world.armies.map((army) => {
      const communities = census(army.communities)
      return communities === army.communities ? army : { ...army, communities }
    }),
    warfare = world.warfare
      ? {
          ...world.warfare,
          fleets: world.warfare.fleets.map((fleet) => {
            const communities = census(fleet.communities)
            return communities === fleet.communities ? fleet : { ...fleet, communities }
          }),
        }
      : undefined
  return changed ? validateWorld({ ...world, regions, armies, ...(warfare ? { warfare } : {}) }) : world
}

export function parseSave(text: string): World {
  if (text.length > MAX_SAVE_BYTES)
    throw new Error(
      `This save is too large. Choose an Uchrony save smaller than ${MAX_SAVE_BYTES / 1024 / 1024} MiB.`,
    )
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON. Choose an exported Uchrony world.')
  }
  return restoreWorld(value)
}
