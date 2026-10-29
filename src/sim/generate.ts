import { configurationValues, withConfigurationValues } from './configuration-context'
import { validateConfigurationValues } from './configuration'
import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from './configuration-defaults'
import { applyStartingEndowments, apportionPopulation } from './starting-conditions'
import { advanceAlmanac } from './almanac'
import { habitableLand } from './terrain-access'
import { seedLandscape, settlementWeight } from './landscape'
import { refreshSpatial } from './spatial'
import { WORLD_SCALES, worldScale, type WorldScale } from './scale'
import { DEFAULT_SETTINGS, validateSettings, type SimulationSettings } from './settings'
import { ensureWarfare, commissionFleet, portAt } from './navy'
import { ensureIntelligence } from './intelligence'
import { militaryPeople } from './forces'
import { ensurePopulation } from './population'
import { ensureCharacters, characterPolicyTargets, characterResearch } from './character'
import {
  type World,
  type Cell,
  type Region,
  type Nation,
  type Research,
  FIELDS,
  inventory,
  population,
  clamp,
} from './types'
import { hashSeed, random } from './random'
import { neighbors, GRID_TOPOLOGY } from './grid'
import { generateGeography } from './geography'
import { MinHeap } from './heap'
export { CELL_SIZE, neighbors } from './grid'

export { GRID_W } from './simulation-invariants'
export { GRID_H } from './simulation-invariants'
export const NAMES = [
  ['Aurelian Republic', 'Aurelia', '#d9b86c', 'Republic', 'mercantile'],
  ['Kingdom of Veyr', 'Veyr', '#759faf', 'Monarchy', 'expansionist'],
  ['Serrane League', 'Serrane', '#ba8582', 'Federation', 'scholarly'],
  ['Verdant Commonwealth', 'Verdant', '#88a67e', 'Commonwealth', 'agrarian'],
  ['Thalassic Union', 'Thalassa', '#a794bb', 'Republic', 'mercantile'],
  ['Ordan Empire', 'Ordan', '#c59162', 'Empire', 'expansionist'],
  ['Republic of Illyra', 'Illyra', '#79b5ab', 'Republic', 'scholarly'],
  ['Nordmark Dominion', 'Nordmark', '#b2b9c5', 'Monarchy', 'agrarian'],
  ['Sovereignty of Caelis', 'Caelis', '#a6ae66', 'Federation', 'scholarly'],
  ['Kingdom of Rhenn', 'Rhenn', '#c7859f', 'Monarchy', 'expansionist'],
  ['Isles of Meridia', 'Meridia', '#78a4c8', 'Republic', 'mercantile'],
  ['Ashari Confederation', 'Ashar', '#d0a077', 'Federation', 'agrarian'],
] as const
const roots = [
  'Aster',
  'Bel',
  'Caer',
  'Dun',
  'El',
  'Falk',
  'Grey',
  'Hal',
  'Isen',
  'Jun',
  'Kel',
  'Lor',
  'Mor',
  'Nor',
  'Ost',
  'Pel',
  'Quen',
  'Raven',
  'Sol',
  'Tor',
  'Ul',
  'Val',
  'Wes',
  'Yar',
]
const ends = [
  'haven',
  'ford',
  'mere',
  'wick',
  'dale',
  'port',
  'mont',
  'bridge',
  'heim',
  'crest',
  'mar',
  'vale',
  'stead',
  'holm',
  'cairn',
  'fell',
]

function provinceName(id: number) {
  const base = roots[id % roots.length] + ends[Math.floor(id / roots.length) % ends.length]
  const district = Math.floor(id / (roots.length * ends.length))
  return district ? `${roots[(district - 1) % roots.length]} ${base}` : base
}

export function makeNation(id: number, capital: number): Nation {
  let [name, shortName, color] = NAMES[id % NAMES.length] as readonly string[]
  const [, , , government, personality] = NAMES[id % NAMES.length]
  if (id >= NAMES.length) {
    shortName = provinceName(id * 7)
    name = `${government === 'Monarchy' ? 'Kingdom' : government} of ${shortName}`
    // Separate hues as well as names when many independent states share the map.
    const hue = (id * 137.508) % 360,
      chroma = 0.3,
      light = 0.6
    const channel = (n: number) => {
      const k = (n + hue / 30) % 12
      return Math.round(
        255 * (light - chroma * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
      )
        .toString(16)
        .padStart(2, '0')
    }
    color = `#${channel(0)}${channel(8)}${channel(4)}`
  }
  return {
    id,
    name,
    shortName,
    color,
    capital,
    government,
    personality,
    treasury: 24000,
    debt: 0,
    stability: 75,
    legitimacy: 72,
    policies: {
      tax: 22,
      welfare: 20,
      education: 15,
      military: 20,
      research: 15,
      tariff: 8,
      conscription: 1,
      migration: 'open',
      priority: 'balanced',
    },
    technologies: Object.fromEntries(FIELDS.map((k) => [k, 0])) as Record<Research, number>,
    researchProgress: Object.fromEntries(FIELDS.map((k) => [k, 0])) as Record<Research, number>,
    researchFocus:
      personality === 'expansionist'
        ? 'military'
        : personality === 'agrarian'
          ? 'agriculture'
          : personality === 'scholarly'
            ? 'medicine'
            : 'logistics',
    income: 0,
    spending: 0,
    gdp: 0,
    population: 0,
    foodCoverage: 1,
    manpower: 0,
    casualties: 0,
    budget: { welfare: 0, education: 0, military: 0, research: 0, administration: 0, infrastructure: 0 },
    ai: true,
  }
}

export function generateWorld(
  seed = 'A world unwritten',
  continents = 3,
  nationCount = 8,
  settings: SimulationSettings = DEFAULT_SETTINGS,
  scale: WorldScale = 'regional',
  start: 'settled' | 'frontier' = 'settled',
  configuration?: ConfigurationValues,
): World {
  const values =
    configuration === undefined ? DEFAULT_CONFIGURATION_VALUES : validateConfigurationValues(configuration)
  if (!['settled', 'frontier'].includes(start)) throw new Error('Unknown settlement pattern.')
  return withConfigurationValues(values, () =>
    generateConfiguredWorld(
      seed,
      continents,
      nationCount,
      configuration ? values.conditions : settings,
      scale,
      start,
      configuration === undefined ? undefined : values,
    ),
  )
}

/** Geography and endowments are seeded once. Downstream initialization consumes
 * these actual people and goods; it must not recreate the default balances. */
function generateConfiguredWorld(
  seed: string,
  continents: number,
  nationCount: number,
  settings: SimulationSettings,
  scale: WorldScale,
  start: 'settled' | 'frontier',
  configuration?: ConfigurationValues,
): World {
  const opening = configurationValues().starting
  const extent = WORLD_SCALES[worldScale(scale)]
  settings = validateSettings(settings)
  continents = Math.round(clamp(continents, 1, 5))
  nationCount = Math.round(clamp(nationCount, 4, 48))
  const rng = { rng: hashSeed(seed) },
    rand = () => random(rng)
  const { width, height } = extent
  const cells = generateGeography(seed, continents, width, height)
  seedLandscape(cells, width, height, seed)
  const land = cells.filter((c) => c.terrain !== 'water')
  const habitable = land.filter(habitableLand)
  if (habitable.length < nationCount)
    throw new Error('Geography leaves too little habitable land for the requested states.')
  const seeds: Cell[] = [habitable[Math.floor(rand() * habitable.length)]]
  const minDistances = new Float64Array(cells.length).fill(Infinity)
  const targetRegions = Math.min(
    configurationValues().geography.provinceCount || extent.provinces,
    Math.floor(land.length / 13),
    habitable.length,
  )
  for (let i = 1; i < targetRegions; i++) {
    const last = seeds[seeds.length - 1]
    let best = habitable[0],
      max = -1
    for (const c of habitable) {
      minDistances[c.id] = Math.min(minDistances[c.id], (c.x - last.x) ** 2 + (c.y - last.y) ** 2)
      const d = minDistances[c.id] * (0.04 + c.landscape!.attraction ** 3 * 4) * (0.85 + rand() * 0.3)
      if (d > max) {
        max = d
        best = c
      }
    }
    seeds.push(best)
  }
  // Cost-based growth keeps provinces connected and makes ridges meaningful boundaries.
  const frontier = new MinHeap(),
    costs = new Float64Array(cells.length).fill(Infinity)
  seeds.forEach((c, i) => {
    c.region = i
    costs[c.id] = 0
    frontier.push(c.id, 0)
  })
  while (frontier.size) {
    const { id, cost } = frontier.pop(),
      c = cells[id]
    if (cost !== costs[id]) continue
    for (const next of neighbors(id, width, height)) {
      const n = cells[next]
      if (n.terrain === 'water') continue
      const step = 1 + Math.abs(n.elevation - c.elevation) * 12 + (n.terrain === 'mountains' ? 1.8 : 0)
      if (cost + step < costs[next]) {
        costs[next] = cost + step
        n.region = c.region
        frontier.push(next, cost + step)
      }
    }
  }
  // Seed any disconnected island not reached by the main flood fill.
  for (const c of land)
    if (c.region < 0) {
      c.region = seeds.length
      seeds.push(c)
      const island = [c.id]
      for (let i = 0; i < island.length; i++)
        for (const n of neighbors(island[i], width, height)) {
          if (cells[n].terrain !== 'water' && cells[n].region < 0) {
            cells[n].region = c.region
            island.push(n)
          }
        }
    }
  const provinceCells: Cell[][] = seeds.map(() => [])
  for (const c of land) provinceCells[c.region].push(c)
  const densityScale = (land.length * 3000) / land.reduce((sum, c) => sum + settlementWeight(c), 0)
  const regions: Region[] = seeds.map((c, id) => {
    const regionCells = provinceCells[id]
    const cx = regionCells.reduce((s, x) => s + x.x, 0) / regionCells.length
    const cy = regionCells.reduce((s, x) => s + x.y, 0) / regionCells.length
    const score = (x: Cell) =>
      Math.hypot(x.x - cx, x.y - cy) * 0.3 +
      Math.max(0, x.elevation - 0.2) * 45 -
      x.landscape!.attraction * 70
    const candidates = regionCells.filter(habitableLand)
    c = (candidates.length ? candidates : regionCells).reduce((best, x) =>
      score(x) < score(best) ? x : best,
    )

    const fertility = clamp(
      regionCells.reduce(
        (s, x) =>
          s +
          (x.terrain === 'plains'
            ? 0.92
            : x.terrain === 'forest'
              ? 0.64
              : x.terrain === 'hills'
                ? 0.48
                : 0.22) +
          (x.river ? 0.12 : 0),
        0,
      ) / regionCells.length,
    )
    const size = regionCells.reduce((sum, c) => sum + settlementWeight(c), 0) * densityScale
    const attraction =
      regionCells.reduce((sum, c) => sum + c.landscape!.attraction * settlementWeight(c), 0) /
      Math.max(
        1e-9,
        regionCells.reduce((sum, c) => sum + settlementWeight(c), 0),
      )
    const deposits = { timber: 0, stone: 0, iron: 0, coal: 0 }
    for (const good of ['timber', 'stone', 'iron', 'coal'] as const)
      deposits[good] =
        regionCells.reduce((sum, c) => sum + c.landscape!.resources[good], 0) / regionCells.length
    const stocks = inventory()
    stocks.food = size * 0.026 * (2 + rand() * 2)
    stocks.timber = size * 0.02
    stocks.stone = size * 0.014
    stocks.iron = size * 0.008
    stocks.coal = size * 0.006
    stocks.tools = size * 0.002
    stocks.textiles = size * 0.003
    stocks.arms = size * 0.001
    return {
      id,
      name: provinceName(id),
      nation: -1,
      culture: -1,
      center: c.id,
      cells: regionCells.map((x) => x.id),
      neighbors: [],
      coastal: false,
      terrain: c.terrain,
      fertility,
      deposits,
      population: {
        children: Math.round(size * 0.29),
        adults: Math.round(size * 0.62),
        elders: Math.round(size * 0.09),
      },
      urban: 0.012 + attraction ** 2 * 0.65,
      literacy: 0.12 + attraction * 0.45,
      health: 0.65 + rand() * 0.2,
      happiness: 0.65 + rand() * 0.17,
      infrastructure: 0.08 + attraction ** 1.5 * 0.75,
      industry: 0.025 + attraction ** 2 * 0.9,
      stocks,
      production: inventory(),
      consumption: inventory(),
      prices: { ...configurationValues().basePrices },
      foodCoverage: 1,
      migration: 0,
      births: 0,
      deaths: 0,
      employed: 0,
      unrest: 10 + rand() * 8,
      devastation: 0,
      gdp: 0,
    }
  })
  for (const r of regions) {
    const adjacent = new Set<number>()
    for (const id of r.cells)
      for (const n of neighbors(id, width, height)) {
        if (cells[n].terrain === 'water') r.coastal = true
        else if (cells[n].region !== r.id) adjacent.add(cells[n].region)
      }
    r.neighbors = [...adjacent]
  }
  // Uneven placement redistributes the opening endowment; it should not also
  // silently erase most of the world's industrial or transport capacity.
  for (const [field, target] of [
    ['industry', 0.47],
    ['infrastructure', 0.5],
  ] as const) {
    const people = regions.reduce((sum, r) => sum + population(r), 0)
    let low = 0,
      high = 64
    for (let iteration = 0; iteration < 40; iteration++) {
      const scale = (low + high) / 2
      const mean =
        regions.reduce((sum, r) => sum + population(r) * Math.min(1.2, r[field] * scale), 0) / people
      if (mean < target) low = scale
      else high = scale
    }
    for (const r of regions) r[field] = Math.min(1.2, (r[field] * (low + high)) / 2)
  }
  const landmassSize = new Uint32Array(cells.length)
  for (const c of land)
    if (!landmassSize[c.id]) {
      const group = [c.id]
      landmassSize[c.id] = 1
      for (let i = 0; i < group.length; i++)
        for (const n of neighbors(group[i], width, height)) {
          if (cells[n].terrain !== 'water' && !landmassSize[n]) {
            landmassSize[n] = 1
            group.push(n)
          }
        }
      group.forEach((id) => {
        landmassSize[id] = group.length
      })
    }
  const capitals: Region[] = [regions.reduce((a, b) => (population(a) > population(b) ? a : b))]
  while (capitals.length < nationCount) {
    const candidates = regions.filter(
      (r) =>
        habitableLand(cells[r.center]) &&
        !capitals.includes(r) &&
        r.cells.length > 4 &&
        landmassSize[r.center] >= 200,
    )
    if (!candidates.length)
      candidates.push(...regions.filter((r) => habitableLand(cells[r.center]) && !capitals.includes(r)))
    if (!candidates.length)
      throw new Error(
        'Geography cannot support this many starting states. Reduce the count or change the seed.',
      )
    let best = candidates[0],
      max = -1
    for (const r of candidates) {
      const c = cells[r.center]
      const d = Math.min(
        ...capitals.map((cap) => Math.hypot(c.x - cells[cap.center].x, c.y - cells[cap.center].y)),
      )
      const score = d * (0.25 + Math.sqrt(population(r) / Math.max(1, r.cells.length)) / 100)
      if (score > max) {
        max = score
        best = r
      }
    }
    capitals.push(best)
  }
  const nations = capitals.map((r, i) => makeNation(i, r.id))
  const stateFrontier = new MinHeap(),
    stateCosts = new Float64Array(regions.length).fill(Infinity)
  capitals.forEach((r, i) => {
    r.nation = i
    stateCosts[r.id] = 0
    stateFrontier.push(r.id, 0)
  })
  while (start === 'settled' && stateFrontier.size) {
    const { id, cost } = stateFrontier.pop(),
      r = regions[id]
    if (cost !== stateCosts[id]) continue
    for (const next of r.neighbors) {
      const n = regions[next],
        a = cells[r.center],
        b = cells[n.center]
      const step = Math.hypot(a.x - b.x, a.y - b.y) * (1 + Math.abs(a.elevation - b.elevation) * 3)
      if (cost + step < stateCosts[next]) {
        n.nation = r.nation
        stateCosts[next] = cost + step
        stateFrontier.push(next, cost + step)
      }
    }
  }
  for (const r of regions) {
    // Unsettled islands join the closest capital across water.
    if (r.nation < 0) {
      const c = cells[r.center]
      const closest = capitals.reduce((best, cap, i) => {
        const a = cells[cap.center],
          b = cells[capitals[best].center]
        return Math.hypot(a.x - c.x, a.y - c.y) < Math.hypot(b.x - c.x, b.y - c.y) ? i : best
      }, 0)
      if (start === 'settled') r.nation = closest
      r.culture = closest
    }
    if (r.nation >= 0) r.culture = r.nation
  }
  capitals.forEach((r, i) => {
    r.nation = i
    r.culture = i
    r.name =
      [
        'Aurel',
        'Veyrholm',
        'Serrana',
        'Greenhaven',
        'Thalassos',
        'Ord',
        'Illyria',
        'Nordvik',
        'Cael',
        'Rhennburg',
        'Meridia',
        'Ashara',
      ][i] ?? `${nations[i].shortName} City`
    r.urban = 0.72
    r.infrastructure = 0.85
    r.industry = 0.8
  })
  if (start === 'frontier') {
    // A few independent market settlements provide nuclei for future city
    // states. They begin with ordinary household assets and no government.
    const markets = new Set(
      regions
        .filter(
          (r) =>
            r.nation === -1 &&
            habitableLand(cells[r.center]) &&
            r.fertility > 0.45 &&
            !cells[r.center].river &&
            neighbors(r.center, width, height).every((id) => habitableLand(cells[id])),
        )
        .sort((a, b) => hashSeed(`${seed}:market:${a.id}`) - hashSeed(`${seed}:market:${b.id}`))
        .slice(0, Math.max(1, Math.floor(regions.length / opening.marketOneIn)))
        .map((r) => r.id),
    )
    for (const r of regions) {
      const capital = r.nation >= 0
      // Most wilderness is empty; inhabited land includes hamlets and a few markets.
      const roll = hashSeed(`${seed}:independent:${r.id}`)
      const market = markets.has(r.id)
      const people = capital
        ? opening.capitalPopulation
        : market
          ? opening.marketPopulation + (roll % (opening.marketVariation + 1))
          : habitableLand(cells[r.center]) && roll % opening.hamletOneIn === 0
            ? opening.hamletPopulation + (roll % (opening.hamletVariation + 1))
            : 0
      r.population = apportionPopulation(people, opening)
      r.urban = capital || market ? 1 : 0
      r.infrastructure = capital ? 0.2 : market ? 0.12 : 0.02
      r.industry = capital ? 0.18 : market ? 0.12 : people ? 0.02 : 0
      r.stocks = inventory()
      if (capital) Object.assign(r.stocks, opening.capitalStocks)
      else if (people)
        Object.assign(r.stocks, { food: people * 0.026 * 6, timber: people * 0.02, tools: people * 0.003 })
    }
    for (const n of nations) {
      n.treasury = opening.treasury
      n.population = opening.capitalPopulation
    }
  }
  if (configuration) applyStartingEndowments(regions, nations, start, opening)
  const world: World = {
    ...(configuration ? { configuration: { version: 1 as const, revision: 0, values: configuration } } : {}),
    version: 1,
    generatorVersion: 5,
    ...(start === 'frontier' ? { settlementStart: 'frontier' as const } : {}),
    gridTopology: GRID_TOPOLOGY,
    modelProvenance: { accepted: 0, lastMonth: 0, roles: {}, source: 'native' },
    simulation: { ...settings },
    seed,
    rng: rng.rng,
    month: 0,
    startYear: opening.year,
    width,
    height,
    cells,
    regions,
    nations,
    relations: [],
    armies: [],
    routes: [],
    events: [],
    history: [],
    nextEvent: 1,
    nextArmy: 1,
    climate: 1,
    totals: { population: 0, gdp: 0, trade: 0, wars: 0, births: 0, deaths: 0, migration: 0 },
  }
  for (let a = 0; a < nations.length; a++)
    for (let b = a + 1; b < nations.length; b++) {
      world.relations.push({
        a,
        b,
        opinion: Math.round(random(world) * 75 - 30) || 0,
        treaty: random(world) > 0.65 ? 'trade' : 'neutral',
        since: 0,
        warExhaustion: 0,
        grievance: 0,
      })
    }
  for (const n of nations) {
    if (start === 'frontier' || opening.armyScale === 0) continue
    const r = regions[n.capital]
    let soldiers = Math.min(
      Math.round(3000 * opening.armyScale),
      Math.floor(r.population.adults * Math.min(1, 0.08 * opening.armyScale)),
    )
    if (scale === 'regional') r.population.adults -= soldiers
    else {
      // A larger country begins with a standing establishment proportional to
      // its people. All initial personnel come from its civilian population.
      let needed = Math.round(
        opening.armyScale *
          Math.max(
            3000,
            Math.floor(
              regions.filter((p) => p.nation === n.id).reduce((sum, p) => sum + population(p), 0) * 0.002,
            ),
          ),
      )
      soldiers = 0
      for (const province of [r, ...regions.filter((p) => p.nation === n.id && p.id !== r.id)]) {
        const recruited = Math.min(needed, Math.floor(province.population.adults * 0.08))
        province.population.adults -= recruited
        soldiers += recruited
        needed -= recruited
        if (!needed) break
      }
    }
    world.armies.push({
      id: world.nextArmy++,
      nation: n.id,
      name: `${n.shortName} I Corps`,
      region: n.capital,
      target: null,
      soldiers,
      establishment: soldiers,
      morale: 0.85,
      supply: 1,
      experience: 0.15,
      casualties: 0,
    })
    n.population = regions.filter((r) => r.nation === n.id).reduce((s, r) => s + population(r), 0) + soldiers
  }
  world.totals.population = nations.reduce((s, n) => s + n.population, 0)
  world.events.push({
    id: world.nextEvent++,
    month: 0,
    type: 'world',
    title: 'A world unwritten',
    detail:
      start === 'frontier'
        ? `${nations.length} founding settlements begin with people and supplies. Most of the land is unclaimed wilderness; scattered independent communities live beyond the states.`
        : `${nations.length} sovereign states. ${regions.length} provinces. Every future begins here.`,
  })
  ensurePopulation(world)
  ensureCharacters(world)
  for (const nation of world.nations) {
    nation.policies = opening.policyFromLeaders ? characterPolicyTargets(nation) : { ...opening.policies }
    nation.researchFocus = opening.researchFromLeaders ? characterResearch(nation) : opening.researchFocus
  }
  ensureWarfare(world)
  for (const n of world.nations) {
    const port = world.regions
      .filter((r) => r.nation === n.id && portAt(world, r.id))
      .sort((a, b) => b.stocks.timber - a.stocks.timber)[0]
    if (port && start === 'settled' && opening.fleets) {
      try {
        commissionFleet(world, n.id, port.id, 1, 4)
      } catch {
        /* A state without materials begins without a fleet. */
      }
    }
    n.population =
      world.regions.filter((r) => r.nation === n.id).reduce((sum, r) => sum + population(r), 0) +
      militaryPeople(world, n.id)
  }
  world.totals.population =
    world.nations.reduce((sum, n) => sum + n.population, 0) +
    regions.filter((r) => r.nation < 0).reduce((sum, r) => sum + population(r), 0)
  ensureIntelligence(world)
  refreshSpatial(world)
  advanceAlmanac(world)
  return world
}
