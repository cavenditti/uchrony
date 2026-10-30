import { landComponents } from '../src/sim/land-connectivity'
import { activityTexture } from '../src/map/activity-material'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, tick } from '../src/sim/engine'
import { habitableLand, highMountain } from '../src/sim/terrain-access'
import { movementNeighbors, CELL_SIZE } from '../src/sim/grid'
import { transportNetwork, traversableLegs } from '../src/sim/transport'
import { corridorProfile, roadCost } from '../src/sim/corridors'
import { commuteRoute } from '../src/sim/commuting'
import { residentialSites, syncResidentialPopulation } from '../src/sim/residential-sites'
import { economicLandscape, TILE_ACTIVITIES } from '../src/sim/economic-landscape'
import { activityLayout } from '../src/map/activity-layout'
import { groundRoads } from '../src/map/ground-roads'
import { freightOverlay } from '../src/map/trade'
import { validateWorld, parseSave } from '../src/sim/persistence'
import { inventory, type World, type Cell, type Region } from '../src/sim/types'

function ridge(pass = false) {
  const width = 5,
    height = 5
  const cells = Array.from({ length: width * height }, (_, id): Cell => {
    const q = id % width,
      r = Math.floor(id / width),
      peak = q === 2 && (!pass || r !== 4)
    return {
      id,
      q,
      r,
      x: (q + 0.5) * CELL_SIZE,
      y: (r + 0.5) * CELL_SIZE,
      terrain: peak ? 'mountains' : 'hills',
      elevation: peak ? 0.8 : 0.3,
      moisture: 0.5,
      river: false,
      region: q <= 2 ? 0 : 1,
    }
  })
  const regions = [0, 1].map((id) => ({
    id,
    center: id ? 14 : 10,
    cells: cells.filter((c) => c.region === id).map((c) => c.id),
    nation: 0,
    infrastructure: 0.5,
  })) as Region[]
  return { cells, regions, width, height, routes: [], month: 0 } as unknown as World
}

test('a complete high ridge disconnects roads; a low pass admits a real detour', () => {
  const closed = ridge()
  assert.notEqual(landComponents(closed)[10], landComponents(closed)[14])
  assert.equal(transportNetwork(closed).links.length, 0)
  assert.equal(roadCost(closed.cells[11], closed.cells[12]), Infinity)
  assert.deepEqual(movementNeighbors(closed.cells, 12, 5, 5), [])
  assert(!movementNeighbors(closed.cells, 6, 5, 5).includes(12))
  const open = ridge(true),
    link = transportNetwork(open).links[0]
  assert(link)
  assert.equal(landComponents(open)[10], landComponents(open)[14])
  assert(link.legs[0].cells.includes(22))
  assert(link.legs.every((leg) => leg.cells.every((id) => habitableLand(open.cells[id]))))
  // An inherited plan cannot force the previous peak crossing to remain open.
  closed.corridorPlan = {
    month: 0,
    links: [{ from: 0, to: 1, changedAt: 0, legs: [{ mode: 'land', cells: [10, 11, 12, 13, 14] }] }],
  }
  assert.equal(transportNetwork(closed).links.length, 0)
  closed.cells[12].terrain = 'plains'
  assert(highMountain(closed.cells[12]), 'elevation also blocks stale biome labels')
})

test('diagonal movement and ports cannot squeeze around a mountain corner', () => {
  const w = ridge()
  w.cells[1].terrain = 'mountains'
  assert(!movementNeighbors(w.cells, 0, 5, 5).includes(6))
  w.cells[11].terrain = 'water'
  assert(!movementNeighbors(w.cells, 11, 5, 5).includes(12))
  assert.equal(commuteRoute(w, 12, 12), null)
})

test('settled and frontier worlds leave peaks empty before and after a month and save round-trip', () => {
  for (const start of ['settled', 'frontier'] as const) {
    const w = generateWorld('Mountain exclusion', 3, 8, undefined, 'regional', start)
    prepareSpatialWorld(w)
    const check = () => {
      const peaks = w.cells.filter(highMountain)
      assert(peaks.length > 0)
      for (const site of residentialSites(w))
        if (highMountain(w.cells[site.cell])) {
          assert.equal(site.residents, 0)
          assert.equal(site.capacity, 0)
          assert.equal(site.building, undefined)
        }
      const landscape = economicLandscape(w)
      const texture = activityTexture(w, landscape)
      for (const peak of peaks) {
        assert.equal(landscape.residents[peak.id], 0)
        assert.equal(TILE_ACTIVITIES[landscape.activity[peak.id]], 'wild')
        assert.equal(texture.image.data[peak.id * 4 + 3], 0, 'no cultivated texture on peaks')
        assert.equal(landscape.workers[peak.id], 0)
        assert.equal(activityLayout(w, landscape, peak.id).pieces.length, 0)
      }
      texture.dispose()
      for (const link of transportNetwork(w).links) assert(traversableLegs(w, link.legs))
      assert(
        corridorProfile(w).segments.every((s) => !highMountain(w.cells[s.a]) && !highMountain(w.cells[s.b])),
      )
      validateWorld(w)
    }
    check()
    tick(w)
    check()
    const restored = parseSave(JSON.stringify(w))
    assert.deepEqual(restored.localEconomy!.active, w.localEconomy!.active)
    assert.equal(restored.totals.population, w.totals.population)
  }
})

test('old mountain tracks, freight marks and activity props are absent from map projections', () => {
  const w = ridge()
  w.routes = [
    {
      id: 'old',
      from: 0,
      to: 1,
      path: [0, 1],
      legs: [{ mode: 'land', cells: [10, 11, 12, 13, 14] }],
      sea: false,
      goods: inventory(),
      volume: 10,
      value: 10,
      capacity: 10,
      international: false,
    },
  ]
  w.corridors = [{ a: 11, b: 12, traffic: 20, familiarity: 1 }]
  assert.equal(groundRoads(w).length, 0)
  assert.equal(freightOverlay(w, 0, null).corridors.length, 0)
})

test('first arrivals with no housing capacity stay on habitable cells', () => {
  const w = generateWorld('Mountain arrival fallback', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  const pool = w
    .localEconomy!.active.map((id) => w.localEconomy!.units[id])
    .find(
      (u) =>
        u.cells.some((id) => highMountain(w.cells[id])) && u.cells.some((id) => habitableLand(w.cells[id])),
    )!
  const homes = residentialSites(w).filter((s) => s.pool === pool.id)
  for (const home of homes) {
    home.capacity = 0
    home.residents = 0
  }
  pool.population = { children: 0, adults: 7, elders: 0 }
  syncResidentialPopulation(w)
  assert.equal(
    homes.reduce((n, h) => n + h.residents!, 0),
    7,
  )
  assert(homes.filter((h) => h.residents).every((h) => habitableLand(w.cells[h.cell])))
})
