import { validateProductionTechniques } from './production-chains'
import { validateResourceStocks } from './resource-extraction'
import { validateFacilities } from './facility-persistence'
import { validateProductiveLand } from './productive-land-persistence'
import { validateOverseas } from './overseas-persistence'
import { validateDynasticState } from './dynastic-persistence'
import { validateWorldArchive } from './world-archive'
import { MAX_SAVE_BYTES } from '../storage/save-types'
import { validateAdaptiveWorld } from './adaptive-persistence'
import { validateAlmanac } from './almanac-persistence'
import { validateCharacters } from './character-persistence'
import { validateWorldConfiguration, withWorldConfiguration } from './configuration'
import { validateForeignOffices } from './diplomatic-persistence'
import { validateDistrictEconomy } from './district-persistence'
import { validateEconomy } from './economic-persistence'
import { validateGeopolitics } from './geopolitics-persistence'
import { adjacentCells, CELL_SIZE, GRID_TOPOLOGY, geographicNeighbors as movementNeighbors } from './grid'
import { validateHistoricalRecord, validateHistoryState } from './history-schema'
import { validateInfluence } from './influence-persistence'
import { validateInstitutions } from './institutions'
import { validateIntelligence } from './intelligence-persistence'
import { MAX_ARMIES } from './military-limits'
import { validateWarfare } from './military-persistence'
import { validBorderPolicy } from './border-policy'
import { initialArmyOperations } from './navy'
import { numberValidator, recordValue, validationFailure } from './persistence-primitives'
import { POLICY_RULES, validSavedPolicy } from './policy-rules'
import { coalesceCommunities, communityKey } from './population'
import { validatePopulation } from './population-persistence'
import type { PopulationCommunity } from './population-types'
import { validatePressures } from './pressure-persistence'
import { unpackWorldSave } from './save-codec'
import { MAX_MAP_CELLS, MAX_PROVINCES } from './scale'
import { validateSovereignty } from './sovereignty-persistence'
import { validateSpatial } from './spatial-persistence'
import { validateStatecraft } from './statecraft-persistence'
import { FIELDS, GOODS, MAX_STATE_IDENTITIES, type RouteLeg, type World } from './types'

/** Validates untrusted save files before they enter the simulation worker. */
export function validateWorld(value: unknown, allowDuplicateCommunities = false): World {
  const source = value as World | null
  if (source?.configuration !== undefined) {
    const configuration = validateWorldConfiguration(source.configuration)
    return withWorldConfiguration({ configuration }, () =>
      validateConfiguredWorld({ ...source, configuration }, allowDuplicateCommunities),
    )
  }
  return validateConfiguredWorld(value, allowDuplicateCommunities)
}
function validateConfiguredWorld(value: unknown, allowDuplicateCommunities = false): World {
  const fail = validationFailure('Invalid world save: ', '', '')
  const object = recordValue
  const number = numberValidator(0, 1e14)
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
  if (w.gridTopology !== GRID_TOPOLOGY)
    fail(
      'this world uses the retired hex grid. Create a new square-grid world; your existing save file is unchanged',
    )
  if (w.settlementStart !== undefined && w.settlementStart !== 'frontier') fail('invalid settlement start')
  if (w.generatorVersion !== 5) fail('unsupported geography generator')
  if (
    typeof w.seed !== 'string' ||
    w.seed.length > 100 ||
    !number(w.month, 0, 120000) ||
    !Number.isInteger(w.month)
  )
    fail('invalid seed or simulation date')
  if (
    w.fastForward !== undefined &&
    (!object(w.fastForward) ||
      !Number.isInteger(w.fastForward.months) ||
      !number(w.fastForward.months, 1, w.month) ||
      !Number.isInteger(w.fastForward.lastMonth) ||
      !number(w.fastForward.lastMonth, 1, w.month) ||
      !Number.isInteger(w.fastForward.phase) ||
      !number(w.fastForward.phase, 0, 5) ||
      w.fastForward.phase > w.fastForward.months ||
      (w.fastForward.phase > 0 && w.fastForward.lastMonth !== w.month))
  )
    fail('invalid fast-forward provenance')
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
      c.x !== (c.q + 0.5) * CELL_SIZE ||
      c.y !== (c.r + 0.5) * CELL_SIZE ||
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
      if (!cellId(c.downstream) || !adjacentCells(c.id, w.width, w.height).includes(c.downstream))
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
      !(r.nation === -1 || nationId(r.nation)) ||
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
      r.publicWorks !== undefined &&
      (!object(r.publicWorks) ||
        (r.publicWorks.road !== undefined &&
          (typeof r.publicWorks.road !== 'string' ||
            !['gravel', 'paved', 'rail'].includes(r.publicWorks.road))) ||
        (r.publicWorks.harbor !== undefined &&
          (typeof r.publicWorks.harbor !== 'number' ||
            !Number.isSafeInteger(r.publicWorks.harbor) ||
            r.publicWorks.harbor < 1 ||
            r.publicWorks.harbor > 3)))
    )
      fail('invalid public transport works')
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
    if (
      n.extinct !== undefined &&
      (!Number.isInteger(n.extinct) ||
        !number(n.extinct, 0, w.month) ||
        n.population !== 0 ||
        n.ai ||
        w.regions.some((r) => r.nation === i))
    )
      fail('invalid extinct state')
    if (!['mercantile', 'expansionist', 'scholarly', 'agrarian'].includes(n.personality))
      fail('invalid state personality')
    if (!object(n.policies)) fail('invalid government policies')
    for (const key of Object.keys(POLICY_RULES) as (keyof typeof POLICY_RULES)[])
      if (!validSavedPolicy(key, n.policies[key]))
        fail(
          POLICY_RULES[key].kind === 'number'
            ? 'invalid budget policy'
            : 'optional' in POLICY_RULES[key]
              ? 'invalid identity policy'
              : 'invalid government policies',
        )
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
    for (const key of ['capitalSpending', 'enterpriseIncome'] as const)
      if (n[key] !== undefined && !number(n[key])) fail(`invalid state ${key}`)
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
      (r.aPolicy !== undefined && !validBorderPolicy(r.aPolicy)) ||
      (r.bPolicy !== undefined && !validBorderPolicy(r.bPolicy)) ||
      (r.aggressor !== undefined && r.aggressor !== r.a && r.aggressor !== r.b) ||
      (r.defenseOf !== undefined && !nationId(r.defenseOf))
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
        if (i > 0 && !movementNeighbors(w.cells, leg.cells[i - 1], w.width, w.height).includes(id))
          fail('freight path skips map cells')
      }
      if (leg.mode === 'sea' && leg.cells.length < 3) fail('shipping path needs water')
      last = leg.cells[leg.cells.length - 1]
    }
    if (last !== toCell) fail('freight endpoints do not match shipment')
  }
  // Published routes summarize directed geographical-region pairs. Large worlds
  // can legitimately exceed the old fixed 20,000-route limit; file-size and
  // per-route geometry checks still bound and validate their representation.
  if (!Array.isArray(w.routes) || w.routes.length > w.regions.length * (w.regions.length - 1))
    fail('invalid routes')
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
  validateProductiveLand(w)
  validateFacilities(w)
  if (w.farmProjects !== undefined) {
    if (!Array.isArray(w.farmProjects) || w.farmProjects.length > w.cells.length)
      fail('invalid farm projects')
    let references = 0
    for (const p of w.farmProjects) {
      if (
        !object(p) ||
        !Number.isInteger(p.nation) ||
        !w.nations[p.nation] ||
        !Number.isInteger(p.funded) ||
        !number(p.funded, 0, w.month) ||
        p.completes !== p.funded + 6 ||
        !number(p.fertility, 0.0012, 0.12) ||
        !number(p.cost) ||
        !Array.isArray(p.cells) ||
        !p.cells.length ||
        p.cells.length > w.cells.length ||
        new Set(p.cells).size !== p.cells.length ||
        p.cells.some((id) => !Number.isInteger(id) || !w.cells[id] || w.cells[id].terrain === 'water')
      )
        fail('invalid farm project')
      references += p.cells.length
      if (references > w.cells.length * 12) fail('too many farm project cells')
    }
  }
  if (w.harbors !== undefined) {
    if (!Array.isArray(w.harbors) || w.harbors.length > w.cells.length) fail('invalid harbor memory')
    const seen = new Set<number>()
    for (const harbor of w.harbors) {
      if (
        !object(harbor) ||
        !Number.isInteger(harbor.cell) ||
        !w.cells[harbor.cell] ||
        seen.has(harbor.cell) ||
        !number(harbor.throughput) ||
        [harbor.since, harbor.updated, harbor.lastActive].some(
          (m) => !Number.isInteger(m) || !number(m, 0, w.month),
        ) ||
        harbor.since > harbor.lastActive ||
        harbor.lastActive > harbor.updated
      )
        fail('invalid remembered harbor')
      seen.add(harbor.cell)
    }
  }
  if (w.corridors !== undefined) {
    if (!Array.isArray(w.corridors) || w.corridors.length > w.cells.length * 4)
      fail('invalid corridor memory')
    const seen = new Set<number>()
    for (const trace of w.corridors) {
      if (
        !object(trace) ||
        !cellId(trace.a) ||
        !cellId(trace.b) ||
        trace.a >= trace.b ||
        !movementNeighbors(w.cells, trace.a, w.width, w.height).includes(trace.b) ||
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
  validateDynasticState(w)
  validateInstitutions(w)
  validateWorldArchive(w)
  validateIntelligence(w)
  validateForeignOffices(w)
  validateGeopolitics(w)
  validateInfluence(w)
  validateSovereignty(w)
  validatePressures(w)
  if (w.almanac !== undefined) validateAlmanac(w, w.almanac)
  if (w.historical !== undefined) validateHistoryState(w, w.historical)
  validateOverseas(w)
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
  for (const r of w.regions) validateProductionTechniques(r)
  for (const r of Object.values(w.localEconomy?.units ?? {})) validateProductionTechniques(r)
  validateResourceStocks(w)
  validateEconomy(w)
  validateSpatial(w)
  validateAdaptiveWorld(w)
  if (w.modelProvenance) {
    const p = w.modelProvenance
    if (
      !Number.isSafeInteger(p.accepted) ||
      p.accepted < 0 ||
      !number(p.lastMonth, 0, w.month) ||
      !object(p.roles) ||
      Object.values(p.roles).some((n) => !Number.isSafeInteger(n) || n < 0) ||
      !['native', 'model-assisted', 'legacy-unknown'].includes(p.source)
    )
      fail('invalid model provenance')
  }
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
  return withWorldConfiguration(world, () => recoverDuplicateCensus(world))
}
function recoverDuplicateCensus(world: World): World {
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
