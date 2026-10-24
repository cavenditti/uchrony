import { noise } from './random'
import { DEFAULT_SETTINGS, validateSettings, type SimulationSettings } from './settings'
import { ensureWarfare, commissionFleet, portAt } from './navy'
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
import { neighbors } from './hex'
import { generateGeography } from './geography'
import { MinHeap } from './heap'
export { HEX, neighbors } from './hex'

export const GRID_W = 112
export const GRID_H = 72
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

export function makeNation(id: number, capital: number): Nation {
  const [name, shortName, color, government, personality] = NAMES[id % NAMES.length]
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
): World {
  settings = validateSettings(settings)
  continents = Math.round(clamp(continents, 1, 5))
  nationCount = Math.round(clamp(nationCount, 4, 12))
  const rng = { rng: hashSeed(seed) },
    rand = () => random(rng)
  const width = GRID_W,
    height = GRID_H
  const cells = generateGeography(seed, continents, width, height)
  const land = cells.filter((c) => c.terrain !== 'water')
  const seeds: Cell[] = [land[Math.floor(rand() * land.length)]]
  const minDistances = new Float64Array(cells.length).fill(Infinity)
  const targetRegions = Math.min(180, Math.floor(land.length / 13))
  for (let i = 1; i < targetRegions; i++) {
    const last = seeds[seeds.length - 1]
    let best = land[0],
      max = -1
    for (const c of land) {
      minDistances[c.id] = Math.min(minDistances[c.id], (c.x - last.x) ** 2 + (c.y - last.y) ** 2)
      const d = minDistances[c.id] * (0.85 + rand() * 0.3)
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
  const regions: Region[] = seeds.map((c, id) => {
    const regionCells = land.filter((x) => x.region === id)
    const cx = regionCells.reduce((s, x) => s + x.x, 0) / regionCells.length
    const cy = regionCells.reduce((s, x) => s + x.y, 0) / regionCells.length
    const score = (x: Cell) =>
      Math.hypot(x.x - cx, x.y - cy) + Math.max(0, x.elevation - 0.2) * 45 - (x.river ? 4 : 0)
    c = regionCells.reduce((best, x) => (score(x) < score(best) ? x : best))

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
    const size = (28000 + rand() * 60000) * Math.sqrt(regionCells.length / 18)
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
      name: roots[id % roots.length] + ends[Math.floor(id / roots.length) % ends.length],
      nation: -1,
      culture: -1,
      center: c.id,
      cells: regionCells.map((x) => x.id),
      neighbors: [],
      coastal: false,
      terrain: c.terrain,
      fertility,
      deposits: {
        timber: 0.25 + c.moisture,
        stone: 0.2 + c.elevation,
        iron:
          Math.max(0, noise(c.x / 90, c.y / 90, hashSeed(`${seed}:iron`)) - 0.38) ** 2 *
          (1 + c.elevation) *
          9,
        coal:
          Math.max(0, noise(c.x / 80, c.y / 80, hashSeed(`${seed}:coal`)) - 0.4) ** 2 *
          (1.5 - c.elevation * 0.4) *
          10,
      },
      population: {
        children: Math.round(size * 0.29),
        adults: Math.round(size * 0.62),
        elders: Math.round(size * 0.09),
      },
      urban: 0.12 + rand() * 0.38,
      literacy: 0.22 + rand() * 0.3,
      health: 0.65 + rand() * 0.2,
      happiness: 0.65 + rand() * 0.17,
      infrastructure: 0.3 + rand() * 0.35,
      industry: 0.22 + rand() * 0.5,
      stocks,
      production: inventory(),
      consumption: inventory(),
      prices: inventory(),
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
  const capitals: Region[] = [regions.reduce((a, b) => (a.cells.length > b.cells.length ? a : b))]
  while (capitals.length < nationCount) {
    const candidates = regions.filter(
      (r) => !capitals.includes(r) && r.cells.length > 4 && landmassSize[r.center] >= 200,
    )
    let best = candidates[0],
      max = -1
    for (const r of candidates) {
      const c = cells[r.center]
      const d = Math.min(
        ...capitals.map((cap) => Math.hypot(c.x - cells[cap.center].x, c.y - cells[cap.center].y)),
      )
      if (d > max) {
        max = d
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
  while (stateFrontier.size) {
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
      r.nation = capitals.reduce((best, cap, i) => {
        const a = cells[cap.center],
          b = cells[capitals[best].center]
        return Math.hypot(a.x - c.x, a.y - c.y) < Math.hypot(b.x - c.x, b.y - c.y) ? i : best
      }, 0)
    }
    r.culture = r.nation
  }
  capitals.forEach((r, i) => {
    r.nation = i
    r.culture = i
    r.name = [
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
    ][i]
    r.urban = 0.72
    r.infrastructure = 0.85
    r.industry = 0.8
  })
  const world: World = {
    version: 1,
    generatorVersion: 2,
    simulation: { ...settings },
    seed,
    rng: rng.rng,
    month: 0,
    startYear: 1720,
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
        opinion: Math.round(random(world) * 75 - 30),
        treaty: random(world) > 0.65 ? 'trade' : 'neutral',
        since: 0,
        warExhaustion: 0,
        grievance: 0,
      })
    }
  for (const n of nations) {
    const r = regions[n.capital],
      soldiers = Math.min(3000, Math.floor(r.population.adults * 0.08))
    r.population.adults -= soldiers
    world.armies.push({
      id: world.nextArmy++,
      nation: n.id,
      name: `${n.shortName} I Corps`,
      region: n.capital,
      target: null,
      soldiers,
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
    detail: `${nations.length} sovereign states. ${regions.length} provinces. Every future begins here.`,
  })
  ensurePopulation(world)
  ensureCharacters(world)
  for (const nation of world.nations) {
    nation.policies = characterPolicyTargets(nation)
    nation.researchFocus = characterResearch(nation)
  }
  ensureWarfare(world)
  for (const n of world.nations) {
    const port = world.regions
      .filter((r) => r.nation === n.id && portAt(world, r.id))
      .sort((a, b) => b.stocks.timber - a.stocks.timber)[0]
    if (port) {
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
  world.totals.population = world.nations.reduce((sum, n) => sum + n.population, 0)
  return world
}
