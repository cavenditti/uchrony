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
import { localWalkingConnection } from '../src/sim/residential-geometry'
import {
  residentialSites,
  createResidentialParcel,
  syncResidentialPopulation,
} from '../src/sim/residential-sites'
import { surveyBuildingPlots } from '../src/sim/urban-growth'
import { economicLandscape, TILE_ACTIVITIES } from '../src/sim/economic-landscape'
import { activityLayout } from '../src/map/activity-layout'
import { groundRoads } from '../src/map/ground-roads'
import { freightOverlay } from '../src/map/trade'
import { validateDistrictEconomy } from '../src/sim/district-persistence'
import { districtNetwork } from '../src/sim/district-transport'
import { worldBlob } from '../src/storage/json-blob'
import { balances, auditLedger } from '../src/sim/ledger'
import { physicalStocks } from '../src/sim/goods-accounting'
import { validateWorld, parseSave } from '../src/sim/persistence'
import { population, inventory, type World, type Cell, type Region } from '../src/sim/types'

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
    assert.equal(restored.adaptive!.terrainVersion, 1)
    assert.deepEqual(restored.localEconomy!.active, w.localEconomy!.active)
    assert.equal(restored.totals.population, w.totals.population)
  }
})

test('old mountain census corrections conserve people, capacity, stock, money and pending construction', () => {
  const w = generateWorld('Saved mountain homes', 3, 8, undefined, 'regional', 'settled')
  prepareSpatialWorld(w)
  const pool = w
    .localEconomy!.active.map((id) => w.localEconomy!.units[id])
    .find((u) => population(u) > 0 && u.cells.filter((id) => habitableLand(w.cells[id])).length >= 2)!
  const source = residentialSites(w).find((s) => s.pool === pool.id && (s.residents ?? 0) > 0)!
  const totals = () => ({
    people: w.localEconomy!.active.reduce((n, id) => n + population(w.localEconomy!.units[id]), 0),
    capacity: residentialSites(w).reduce((n, s) => n + s.capacity, 0),
    money: Object.values(balances(w)).reduce((n, x) => n + x, 0),
    stocks: physicalStocks(w),
  })
  w.adaptive!.construction = [{ site: source.id, capacity: 17, cost: 12, remaining: 2 }]
  w.cells[source.cell].terrain = 'mountains'
  delete w.adaptive!.terrainVersion
  const before = totals()
  prepareSpatialWorld(w)
  assert.deepEqual(totals(), before)
  assert.equal(source.residents, 0)
  assert.equal(source.capacity, 0)
  assert.equal(w.adaptive!.construction[0].capacity, 17)
  assert(habitableLand(w.cells[w.adaptive!.sites[w.adaptive!.construction[0].site].cell]))
  assert.equal(localWalkingConnection(w, source, source, pool.nation, [source.cell, source.cell]), null)
  assert.throws(() => createResidentialParcel(w, pool.id, source.cell, source, source.parcel!), /land/)
  assert.equal(surveyBuildingPlots(w, source, 1, true, [], false).plots.length, 0)
  const once = JSON.stringify(w)
  prepareSpatialWorld(w)
  assert.equal(JSON.stringify(w), once, 'correction is idempotent')
  auditLedger(w)
  validateWorld(w)
})

test('an entirely alpine legacy pool transfers dated people and claims without deleting them', () => {
  const w = generateWorld('Alpine legacy pool', 3, 8, undefined, 'regional', 'settled')
  prepareSpatialWorld(w)
  const pool = w
    .localEconomy!.active.map((id) => w.localEconomy!.units[id])
    .find(
      (u) =>
        population(u) > 0 &&
        w.localEconomy!.active.some(
          (id) =>
            id !== u.id &&
            w.localEconomy!.units[id].province === u.province &&
            w.localEconomy!.units[id].cells.some((c) => habitableLand(w.cells[c])),
        ),
    )!
  const census = () =>
    w
      .localEconomy!.active.flatMap((id) => w.localEconomy!.units[id].communities!)
      .flatMap((g) => (g.ageCohorts ?? []).map(([born, f, m]) => [born, f, m]))
      .reduce(
        (out, [born, f, m]) => {
          out[born] = (out[born] ?? 0) + f + m
          return out
        },
        {} as Record<number, number>,
      )
  const before = census(),
    money = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  for (const id of pool.cells) w.cells[id].terrain = 'mountains'
  delete w.adaptive!.terrainVersion
  prepareSpatialWorld(w)
  assert.equal(population(pool), 0)
  assert.deepEqual(census(), before)
  assert(Math.abs(Object.values(balances(w)).reduce((a, b) => a + b, 0) - money) < 1e-6)
  assert(
    residentialSites(w)
      .filter((s) => s.residents)
      .every((s) => habitableLand(w.cells[s.cell])),
  )
  auditLedger(w)
  validateWorld(w)
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

test('relocated mountain markets preserve completed shipment history through saving', async () => {
  const w = generateWorld('Historical mountain deliveries', 3, 8, undefined, 'regional', 'settled')
  prepareSpatialWorld(w)
  const local = w.localEconomy!
  const journey = [...districtNetwork(w).graph]
    .flatMap(([from, links]) => links.map((link) => ({ from, to: link.to, legs: link.legs })))
    .find((s) =>
      [s.from, s.to].every(
        (id) => local.units[id].cells.filter((cell) => habitableLand(w.cells[cell])).length >= 2,
      ),
    )!
  assert(journey, 'fixture has a surveyed journey between relocatable markets')
  const shipment = {
    ...journey,
    good: 'food' as const,
    quantity: 1,
    value: 1,
    freight: 0,
    tariff: 0,
    cells: journey.legs.flatMap((leg) => leg.cells),
  }
  local.shipments = [shipment]
  const from = local.units[shipment.from],
    to = local.units[shipment.to]
  const oldFrom = from.center,
    oldTo = to.center
  const history = structuredClone(local.shipments)
  w.cells[oldFrom].terrain = 'mountains'
  w.cells[oldTo].terrain = 'mountains'
  delete w.adaptive!.terrainVersion
  prepareSpatialWorld(w)
  assert.notEqual(from.center, oldFrom)
  assert.notEqual(to.center, oldTo)
  assert.deepEqual(local.shipments, history, 'migration does not rewrite delivered goods or their paths')
  const before = JSON.stringify(w)
  validateWorld(w)
  const restored = parseSave(await worldBlob(w).text())
  assert.deepEqual(restored.localEconomy!.shipments, history)
  assert.equal(JSON.stringify(w), before, 'save validation is read-only')
  assert(!traversableLegs(w, shipment.legs), 'historical acceptance does not reopen peaks to travel')

  // No broad relaxation: the exception requires a corrected mountain endpoint
  // belonging to that same district, and still validates every intermediate step.
  delete w.adaptive!.terrainVersion
  assert.throws(() => validateDistrictEconomy(w), /shipment (origin|destination)/)
  w.adaptive!.terrainVersion = 1
  const owned = from.cells
  from.cells = owned.filter((id) => id !== oldFrom)
  assert.throws(() => validateDistrictEconomy(w))
  from.cells = owned
  w.cells[oldFrom].terrain = 'plains'
  w.cells[oldFrom].elevation = 0.2
  assert.throws(() => validateDistrictEconomy(w), /shipment origin/)
})

// Empty housing weights must not give excluded cells a fallback population share.
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
