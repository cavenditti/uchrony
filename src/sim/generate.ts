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
import { hashSeed, random, fractal } from './random'

export const HEX = 7
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

export function neighbors(id: number, width: number, height: number): number[] {
  const q = id % width,
    r = Math.floor(id / width),
    s = r % 2
  return [
    [q - 1, r],
    [q + 1, r],
    [q - 1 + s, r - 1],
    [q + s, r - 1],
    [q - 1 + s, r + 1],
    [q + s, r + 1],
  ]
    .filter(([x, y]) => x >= 0 && x < width && y >= 0 && y < height)
    .map(([x, y]) => y * width + x)
}

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

export function generateWorld(seed = 'A world unwritten', continents = 3, nationCount = 8): World {
  continents = Math.round(clamp(continents, 1, 5))
  nationCount = Math.round(clamp(nationCount, 4, 12))
  const rng = { rng: hashSeed(seed) },
    rand = () => random(rng)
  const width = GRID_W,
    height = GRID_H,
    noiseSeed = rng.rng
  const masses = Array.from({ length: continents + 2 }, (_, i) => ({
    x: (i < continents ? 0.18 + ((i + rand() * 0.4) / continents) * 0.66 : 0.15 + rand() * 0.7) * width,
    y: (0.28 + rand() * 0.42) * height,
    rx: width * (i < continents ? 0.23 + rand() * 0.06 : 0.1),
    ry: height * (i < continents ? 0.33 + rand() * 0.12 : 0.13),
  }))
  const cells: Cell[] = []
  for (let r = 0; r < height; r++)
    for (let q = 0; q < width; q++) {
      const warpX = (fractal(q / 22, r / 22, noiseSeed + 9) - 0.5) * 18
      const warpY = (fractal(q / 22, r / 22, noiseSeed + 66) - 0.5) * 15
      const continental = Math.max(
        ...masses.map((m) => 1 - Math.hypot((q + warpX - m.x) / m.rx, (r + warpY - m.y) / m.ry)),
      )
      const rugged = fractal(q / 10, r / 10, noiseSeed)
      const elevation = continental * 0.64 + (rugged - 0.4) * 0.7
      const moisture = fractal(q / 14, r / 14, noiseSeed + 98)
      const latitude = Math.abs(r / height - 0.5) * 2
      const terrain =
        elevation < 0.095
          ? 'water'
          : elevation > 0.49
            ? 'mountains'
            : elevation > 0.36
              ? 'hills'
              : latitude > 0.68
                ? 'tundra'
                : moisture < 0.34
                  ? 'desert'
                  : moisture > 0.54
                    ? 'forest'
                    : 'plains'
      cells.push({
        id: r * width + q,
        q,
        r,
        x: Math.sqrt(3) * HEX * (q + (r % 2) / 2),
        y: HEX * 1.5 * r,
        elevation,
        moisture,
        terrain,
        region: -1,
        river: false,
      })
    }
  // Remove isolated single cells; the smallest islands still get an administrable province.
  for (const c of cells)
    if (c.terrain !== 'water' && neighbors(c.id, width, height).every((id) => cells[id].terrain === 'water'))
      c.terrain = 'water'
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
  const queue: number[] = []
  seeds.forEach((c, i) => {
    c.region = i
    queue.push(c.id)
  })
  for (let i = 0; i < queue.length; i++) {
    const c = cells[queue[i]]
    for (const n of neighbors(c.id, width, height))
      if (cells[n].terrain !== 'water' && cells[n].region < 0) {
        cells[n].region = c.region
        queue.push(n)
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
                : 0.22),
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
        iron: 0.1 + rand() * c.elevation * 2,
        coal: 0.1 + rand() * c.elevation * 2,
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
  // Rivers follow downhill paths from high ground; they are geographic features, not decoration.
  const springs = land.filter((c) => c.elevation > 0.38 && c.moisture > 0.48).sort(() => 0)
  for (let i = 0; i < 30 && springs.length; i++) {
    let c = springs[Math.floor(rand() * springs.length)]
    const visited = new Set<number>()
    for (let step = 0; step < 70; step++) {
      if (c.terrain === 'water' || visited.has(c.id)) break
      visited.add(c.id)
      c.river = true
      const next = neighbors(c.id, width, height)
        .map((id) => cells[id])
        .filter((x) => !visited.has(x.id))
        .sort((a, b) => a.elevation - b.elevation)[0]
      if (!next || next.elevation > c.elevation + 0.018) break
      c = next
    }
  }
  const capitals: Region[] = [regions.reduce((a, b) => (a.cells.length > b.cells.length ? a : b))]
  while (capitals.length < nationCount) {
    const candidates = regions.filter((r) => !capitals.includes(r) && r.cells.length > 4)
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
  for (const r of regions) {
    const c = cells[r.center]
    r.nation = capitals.reduce((best, cap, i) => {
      const a = cells[cap.center],
        b = cells[capitals[best].center]
      return Math.hypot(a.x - c.x, a.y - c.y) < Math.hypot(b.x - c.x, b.y - c.y) ? i : best
    }, 0)
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
  return world
}
