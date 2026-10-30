/** Additional geology and shared coastal fish stocks remain physical resources,
 * independent of administrative boundaries and owned warehouse inventories. */
import { neighbors } from './grid'
import { hashSeed, noise } from './random'
import { habitableLand } from './terrain-access'
import { clamp, type Region, type World } from './types'

export const EXTENDED_MINERALS = ['clay', 'salt', 'preciousOre'] as const
export type ExtendedMineral = (typeof EXTENDED_MINERALS)[number]
export interface ResourceStocks {
  version: 1
  renewed: number
  minerals: Record<number, Record<ExtendedMineral, number>>
  fish: Record<number, number>
  caught: Record<number, number>
}
/** Potential is deterministic terrain information, not a newly discovered asset
 * each time the numerical mesh changes. Precious ore aggregates precious metals. */
interface ResourceGeography extends Record<ExtendedMineral, Float64Array> {
  fish: Float64Array
}
const geographyCache = new WeakMap<World, ResourceGeography>()
/** Static geographic fields are sampled once, not on every firm's capacity
 * quote. Remaining stocks stay live and are never cached with these fields. */
function resourceGeography(w: World): ResourceGeography {
  let cached = geographyCache.get(w)
  if (cached) return cached
  const size = w.cells.length
  cached = {
    clay: new Float64Array(size),
    salt: new Float64Array(size),
    preciousOre: new Float64Array(size),
    fish: new Float64Array(size),
  }
  const salt = hashSeed(`${w.seed}:extended-geology`)
  for (const c of w.cells) {
    const coast = neighbors(c.id, w.width, w.height)
    if (c.terrain === 'water') {
      if (coast.some((id) => habitableLand(w.cells[id]))) cached.fish[c.id] = 500 * (0.7 + c.moisture * 0.6)
    } else if (habitableLand(c)) {
      const x = (c.q / w.width) * 9,
        y = (c.r / w.height) * 9
      const field = noise(x, y, salt + 23),
        precious = noise(x, y, salt + 71)
      cached.clay[c.id] = Math.max(0, c.moisture - 0.18) * (c.river ? 1.5 : Math.max(0.1, 1 - c.elevation))
      cached.salt[c.id] =
        c.terrain === 'desert'
          ? 0.2 + field
          : field > 0.4 && coast.some((id) => w.cells[id].terrain === 'water')
            ? 0.15 + field * 0.4
            : 0
      cached.preciousOre[c.id] =
        Math.max(0, precious - 0.55) ** 2 * (c.terrain === 'hills' || c.terrain === 'mountains' ? 8 : 0.4)
    }
  }
  geographyCache.set(w, cached)
  return cached
}
export function mineralEndowment(w: World, cell: number, good: ExtendedMineral) {
  return resourceGeography(w)[good][cell] ?? 0
}
export function openingMineralStock(w: World, cell: number, good: ExtendedMineral) {
  return mineralEndowment(w, cell, good) * (good === 'preciousOre' ? 12000 : 120000)
}
/** Only coastal water supports the current shore-fishing technology. Offshore
 * expansion will require boats and access rules rather than unlimited sea area. */
export function fishCapacity(w: World, cell: number) {
  return resourceGeography(w).fish[cell] ?? 0
}
export function ensureResourceStocks(w: World): ResourceStocks {
  if (w.resourceStocks) return w.resourceStocks
  const minerals: ResourceStocks['minerals'] = {},
    fish: ResourceStocks['fish'] = {}
  for (const c of w.cells) {
    if (habitableLand(c))
      minerals[c.id] = {
        clay: openingMineralStock(w, c.id, 'clay'),
        salt: openingMineralStock(w, c.id, 'salt'),
        preciousOre: openingMineralStock(w, c.id, 'preciousOre'),
      }
    const capacity = fishCapacity(w, c.id)
    if (capacity > 0) fish[c.id] = capacity
  }
  return (w.resourceStocks = { version: 1, renewed: w.month, minerals, fish, caught: {} })
}
const coastIndexes = new WeakMap<World, WeakMap<number[], number[]>>()
/** Cache geographic access by the actual cell array; adjacent markets share the
 * same water-cell stock, so partitioning cannot duplicate a fishing ground. */
function coastalWaters(w: World, r: Region) {
  let cache = coastIndexes.get(w)
  if (!cache) coastIndexes.set(w, (cache = new WeakMap()))
  let waters = cache.get(r.cells)
  if (!waters) {
    const ids = new Set<number>()
    for (const id of r.cells)
      if (habitableLand(w.cells[id]))
        for (const next of neighbors(id, w.width, w.height)) if (fishCapacity(w, next) > 0) ids.add(next)
    waters = [...ids].sort((a, b) => a - b)
    cache.set(r.cells, waters)
  }
  return waters
}
export function regionalMineralPotential(w: World, r: Pick<Region, 'cells'>, good: ExtendedMineral) {
  // Capacity quotes remain read-only; an untouched reservoir has its opening grade.
  const stocks = w.resourceStocks
  let total = 0
  for (const cell of r.cells) {
    const opening = openingMineralStock(w, cell, good)
    if (opening > 0)
      total +=
        mineralEndowment(w, cell, good) *
        clamp((stocks ? (stocks.minerals[cell]?.[good] ?? 0) : opening) / opening)
  }
  return total / Math.max(1, r.cells.length)
}
export function fishingPotential(w: World, r: Region) {
  const stocks = w.resourceStocks,
    waters = coastalWaters(w, r)
  let available = 0,
    capacity = 0
  for (const id of waters) {
    const opening = fishCapacity(w, id)
    available += stocks ? (stocks.fish[id] ?? 0) : opening
    capacity += opening
  }
  return capacity > 0 ? available / capacity : 0
}
/** Extraction is bounded before output is booked. Stable cell order and one
 * shared reservoir preserve exact depletion through conquest and remeshing. */
export function extractExtendedResource(w: World, r: Region, good: ExtendedMineral | 'fish', wanted: number) {
  const stocks = ensureResourceStocks(w),
    cells = good === 'fish' ? coastalWaters(w, r) : r.cells
  let left = Math.max(0, wanted)
  for (const id of cells) {
    const caught = stocks.caught[id] ?? 0
    const available =
      good === 'fish'
        ? Math.max(0, (stocks.fish[id] + caught) * 0.2 - caught)
        : (stocks.minerals[id]?.[good] ?? 0)
    const used = Math.min(left, available)
    if (good === 'fish') {
      stocks.fish[id] -= used
      stocks.caught[id] = caught + used
    } else if (stocks.minerals[id]) stocks.minerals[id][good] -= used
    left -= used
    if (left <= 0) break
  }
  return Math.max(0, wanted) - left
}
/** Logistic recovery happens once per dated month, never once per firm or viewer.
 * The harvest bound leaves breeding stock; recovery creates no owned fish cargo. */
export function renewFishStocks(w: World) {
  const stocks = ensureResourceStocks(w)
  const elapsed = w.month - stocks.renewed
  if (elapsed <= 0) return
  for (const [key, biomass] of Object.entries(stocks.fish)) {
    const capacity = fishCapacity(w, +key)
    stocks.fish[+key] =
      biomass > 0 && capacity > 0 ? capacity / (1 + (capacity / biomass - 1) * Math.exp(-0.08 * elapsed)) : 0
  }
  stocks.renewed = w.month
  stocks.caught = {}
}

/** Untrusted saves may not erase a depleted cell to reseed its original reserve. */
export function validateResourceStocks(w: World) {
  const s = w.resourceStocks
  if (s === undefined) return
  const fail = () => {
    throw new Error('Invalid physical resource stocks')
  }
  if (
    !s ||
    s.version !== 1 ||
    !Number.isFinite(s.renewed) ||
    s.renewed < 0 ||
    s.renewed > w.month ||
    !s.minerals ||
    !s.fish ||
    !s.caught ||
    Array.isArray(s.minerals) ||
    Array.isArray(s.fish) ||
    Array.isArray(s.caught)
  )
    fail()
  let land = 0,
    water = 0
  for (const c of w.cells) {
    if (habitableLand(c)) {
      land++
      const stock = s.minerals[c.id]
      if (!stock || Object.keys(stock).length !== EXTENDED_MINERALS.length) fail()
      for (const good of EXTENDED_MINERALS)
        if (
          !Number.isFinite(stock[good]) ||
          stock[good] < 0 ||
          stock[good] > openingMineralStock(w, c.id, good) + 1e-7
        )
          fail()
    }
    const capacity = fishCapacity(w, c.id)
    if (capacity > 0) {
      water++
      const stock = s.fish[c.id]
      if (!Number.isFinite(stock) || stock < 0 || stock > capacity + 1e-7) fail()
      const caught = s.caught[c.id] ?? 0
      if (
        !Number.isFinite(caught) ||
        caught < 0 ||
        stock + caught > capacity + 1e-7 ||
        caught > (stock + caught) * 0.2 + 1e-7
      )
        fail()
    }
  }
  if (Object.keys(s.minerals).length !== land || Object.keys(s.fish).length !== water) fail()
  if (Object.keys(s.caught).some((key) => !Object.hasOwn(s.fish, key))) fail()
}
