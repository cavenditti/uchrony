/** Precious-metal scarcity is physical geography, shared by maps and mines. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { CELL_SIZE } from '../src/sim/grid'
import { hashSeed, noise } from '../src/sim/random'
import { habitableLand } from '../src/sim/terrain-access'
import {
  ensureResourceStocks,
  extractExtendedResource,
  fishCapacity,
  mineralEndowment,
  openingMineralStock,
  validateResourceStocks,
} from '../src/sim/resource-extraction'
import { facilitySitePotential } from '../src/sim/facility-investment'
import { resourceMapData } from '../src/map/natural-resources'
import { parseSave } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import type { Cell, World } from '../src/sim/types'

/** Simple immutable geography isolates the lode algorithm from settlement and
 * fiscal calibration. Water borders and unusable peaks cannot receive mines. */
function geography(width = 112, height = 72, seed = 'precious-lode spatial contract') {
  const cells = Array.from({ length: width * height }, (_, id): Cell => {
    const q = id % width,
      r = Math.floor(id / width),
      border = q === 0 || r === 0 || q === width - 1 || r === height - 1
    return {
      id,
      q,
      r,
      x: (q + 0.5) * CELL_SIZE,
      y: (r + 0.5) * CELL_SIZE,
      terrain: border ? 'water' : id % 37 === 0 ? 'mountains' : 'hills',
      elevation: id % 37 === 0 ? 0.9 : 0.3,
      moisture: 0.5,
      river: false,
      region: 0,
    }
  })
  return { seed, width, height, cells, month: 0, rng: 98765 } as World
}

/** Count eight-neighbor ore patches so a diagonal vein remains one locality. */
function patches(w: World, amounts: Float64Array) {
  const visited = new Set<number>(),
    sizes: number[] = []
  for (const cell of w.cells) {
    if (!amounts[cell.id] || visited.has(cell.id)) continue
    const queue = [cell.id]
    visited.add(cell.id)
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i],
        q = id % w.width,
        r = Math.floor(id / w.width)
      for (let row = Math.max(0, r - 1); row <= Math.min(w.height - 1, r + 1); row++)
        for (let column = Math.max(0, q - 1); column <= Math.min(w.width - 1, q + 1); column++) {
          const next = row * w.width + column
          if (!amounts[next] || visited.has(next)) continue
          visited.add(next)
          queue.push(next)
        }
    }
    sizes.push(queue.length)
  }
  return sizes
}

test('regional, continental and world geography contain a few compact rich lodes with mostly barren land', () => {
  for (const [width, height] of [
    [112, 72],
    [224, 144],
    [448, 288],
  ]) {
    const w = geography(width, height),
      data = resourceMapData(w, 'preciousOre'),
      land = w.cells.filter(habitableLand),
      ore = land.filter((cell) => data.quantities[cell.id] > 0),
      groups = patches(w, data.quantities)
    assert(ore.length > 0 && ore.length < land.length * 0.03, `${width}: ore must be spatially rare`)
    assert(groups.length >= 3 && groups.length <= 5, `${width}: ${groups.length} mining localities`)
    assert(
      groups.every((size) => size >= 2),
      'lodes are coherent spots, not isolated random pixels',
    )
    assert(data.maximum >= 18000 && data.maximum <= 30000, 'rich centres retain meaningful finite reserves')
    for (const cell of w.cells)
      if (!habitableLand(cell)) assert.equal(data.quantities[cell.id], 0, 'water and peaks are barren')
  }
})

test('real map seeds have substantially less widespread precious ore, with several viable mining spots', () => {
  for (const seed of [
    'natural resources browser review',
    'district productive facilities',
    'extended resource map reserves',
  ]) {
    const w = generateWorld(seed, 3, 4),
      data = resourceMapData(w, 'preciousOre'),
      land = w.cells.filter(habitableLand),
      ore = land.filter((cell) => data.quantities[cell.id] > 0)
    assert(ore.length > 0 && ore.length / land.length < 0.03, seed)
    assert(patches(w, data.quantities).length <= 5, seed)
    for (const cell of ore)
      assert(facilitySitePotential(w, cell.id, 'precious-mine') > 0, 'the map and mining sites share geology')
    const barren = land.find((cell) => !data.quantities[cell.id])!
    assert.equal(facilitySitePotential(w, barren.id, 'precious-mine'), 0)
  }
})

test('lodes are deterministic and read-only, stay fixed through political changes and cache repeated queries', () => {
  const w = geography(),
    before = structuredClone(w),
    first = resourceMapData(w, 'preciousOre')
  assert.deepEqual(w, before)
  assert.deepEqual(resourceMapData(structuredClone(w), 'preciousOre'), first)
  for (const cell of w.cells) cell.region = cell.id % 4
  assert.deepEqual(resourceMapData({ ...w }, 'preciousOre'), first, 'province ownership cannot move lodes')
  let visits = 0
  const cachedWorld = {
    ...w,
    cells: new Proxy(w.cells, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) visits++
        return Reflect.get(target, key, receiver)
      },
    }),
  }
  const peak = w.cells.find((cell) => first.quantities[cell.id] > 0)!,
    grade = mineralEndowment(cachedWorld, peak.id, 'preciousOre'),
    openingVisits = visits
  for (let i = 0; i < 100000; i++) assert.equal(mineralEndowment(cachedWorld, peak.id, 'preciousOre'), grade)
  assert.equal(visits, openingVisits, 'hot capacity queries must never repeat the geological search')
})

test('water-only or inaccessible worlds contain no artificial precious-metal deposit', () => {
  for (const terrain of ['water', 'mountains'] as const) {
    const w = geography(16, 16)
    for (const cell of w.cells) cell.terrain = terrain
    const data = resourceMapData(w, 'preciousOre')
    assert.equal(data.available, false)
    assert.equal(data.maximum, 0)
  }
})

test('finite lodes retain their geology and exact depletion after packed restoration', () => {
  const w = generateWorld('precious lodes regression', 3, 4),
    stocks = ensureResourceStocks(w),
    data = resourceMapData(w, 'preciousOre'),
    cell = w.cells.find((cell) => data.quantities[cell.id] > 0)!,
    r = w.regions[cell.region],
    opening = r.cells.reduce((sum, id) => sum + (stocks.minerals[id]?.preciousOre ?? 0), 0)
  assert.equal(stocks.geology, 2)
  assert(Math.abs(extractExtendedResource(w, r, 'preciousOre', opening * 2) - opening) < 1e-7)
  assert.equal(facilitySitePotential(w, cell.id, 'precious-mine'), 0)
  validateResourceStocks(w)
  const restored = parseSave(JSON.stringify(packWorldSave(w)))
  assert.deepEqual(restored.resourceStocks, stocks)
  assert.deepEqual(resourceMapData(restored, 'preciousOre'), resourceMapData(w, 'preciousOre'))
  assert.equal(extractExtendedResource(restored, { ...r, cells: [...r.cells] }, 'preciousOre', 1), 0)
  assert.equal(resourceMapData(restored, 'preciousOre').maximum, data.maximum)
  const invalid = structuredClone(restored)
  Reflect.set(invalid.resourceStocks!, 'geology', 99)
  assert.throws(() => validateResourceStocks(invalid), /resource stocks/)
})

test('already-saved broad-field reservoirs keep their original locations, grades and depletion', () => {
  const current = generateWorld('natural resources browser review', 3, 4),
    sparse = resourceMapData(current, 'preciousOre'),
    w = structuredClone(current),
    stocks = (w.resourceStocks = {
      version: 1,
      renewed: w.month,
      minerals: {},
      fish: {},
      caught: {},
    } as NonNullable<World['resourceStocks']>),
    salt = hashSeed(`${w.seed}:extended-geology`)
  // Reconstruct the pre-calibration saved endowment independently of the new
  // lode generator. Loading must preserve these assets instead of relocating them.
  for (const cell of w.cells) {
    if (habitableLand(cell)) {
      const potential =
        Math.max(0, noise((cell.q / w.width) * 9, (cell.r / w.height) * 9, salt + 71) - 0.55) ** 2 *
        (cell.terrain === 'hills' || cell.terrain === 'mountains' ? 8 : 0.4)
      stocks.minerals[cell.id] = {
        clay: openingMineralStock(w, cell.id, 'clay'),
        salt: openingMineralStock(w, cell.id, 'salt'),
        preciousOre: potential * 12000,
      }
    }
    const capacity = fishCapacity(w, cell.id)
    if (capacity) stocks.fish[cell.id] = capacity
    assert.equal(capacity, fishCapacity(current, cell.id), 'fish geography is unchanged')
    for (const good of ['clay', 'salt'] as const)
      assert.equal(openingMineralStock(w, cell.id, good), openingMineralStock(current, cell.id, good))
  }
  const oldSite = w.cells.find(
    (cell) => (stocks.minerals[cell.id]?.preciousOre ?? 0) > 0 && sparse.quantities[cell.id] === 0,
  )!
  assert(oldSite, 'existing saved mines can lie outside the newly generated lodes')
  stocks.minerals[oldSite.id].preciousOre *= 0.4
  const saved = JSON.stringify(packWorldSave(w)),
    restored = parseSave(saved)
  assert.equal(restored.resourceStocks!.geology, undefined)
  assert.deepEqual(restored.resourceStocks, stocks)
  assert.equal(
    resourceMapData(restored, 'preciousOre').quantities[oldSite.id],
    stocks.minerals[oldSite.id].preciousOre,
  )
})
