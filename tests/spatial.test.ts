import type { CompetitiveFirm } from '../src/sim/economic-types'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { neighbors } from '../src/sim/grid'
import { tick } from '../src/sim/engine'
import { buildSpatial, refreshSpatial, spatialState } from '../src/sim/spatial'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { population, type World } from '../src/sim/types'
import { balances } from '../src/sim/ledger'
import { viewSnapshot } from '../src/sim/view-snapshot'

function assertPartition(w: World) {
  const state = spatialState(w),
    seen = new Set<number>()
  const totals = w.regions.map(() => 0),
    capital = w.regions.map(() => 0)
  for (const d of state.districts) {
    const cells = new Set(d.cells),
      reached = new Set([d.cells[0]]),
      queue = [d.cells[0]]
    for (let i = 0; i < queue.length; i++)
      for (const id of neighbors(queue[i], w.width, w.height))
        if (cells.has(id) && !reached.has(id)) {
          reached.add(id)
          queue.push(id)
        }
    assert.equal(reached.size, cells.size, 'each clipped district is connected')
    for (const id of d.cells) {
      assert(!seen.has(id))
      seen.add(id)
      assert.equal(w.cells[id].region, d.region)
      assert.notEqual(w.cells[id].terrain, 'water')
    }
    totals[d.region] += d.population
    capital[d.region] += d.capital
  }
  assert.equal(seen.size, w.cells.filter((c) => c.terrain !== 'water').length)
  for (const r of w.regions) {
    assert.equal(totals[r.id], population(r), r.name)
    assert(Math.abs(capital[r.id] - r.industry) < 1e-9)
  }
}

test('settlements, populations and resources form uneven, deterministic geographic clusters', () => {
  for (const seed of ['A world unwritten', 'Long winter', 'Maritime republics']) {
    const w = generateWorld(seed)
    assert.deepEqual(w.spatial, generateWorld(seed).spatial)
    const sizes = w.regions.map((r) => r.cells.length).sort((a, b) => a - b)
    const density = w.regions.map((r) => population(r) / r.cells.length).sort((a, b) => a - b)
    assert(sizes[Math.floor(sizes.length * 0.9)] > sizes[Math.floor(sizes.length * 0.1)] * 3)
    assert(density[Math.floor(density.length * 0.9)] > density[Math.floor(density.length * 0.1)] * 4)
    assert(
      w.regions.filter((r) => !w.spatial!.settlements.some((s) => s.region === r.id)).length >
        w.regions.length * 0.15,
    )
    assert(w.regions.filter((r) => r.deposits.iron === 0).length > w.regions.length * 0.2)
    assert(w.spatial!.settlements.some((s) => s.kind === 'city'))
    assert(w.spatial!.settlements.some((s) => s.kind === 'village'))
    assert(w.spatial!.districts.some((d) => d.population === 0))
    assertPartition(w)
    validateWorld(w)
    const land = w.cells.filter((c) => c.terrain !== 'water')
    const positive = (id: number) => w.cells[id].landscape!.resources.iron > 0
    const pairs = land
      .filter((c) => positive(c.id))
      .flatMap((c) => neighbors(c.id, w.width, w.height).filter((id) => w.cells[id].terrain !== 'water'))
    assert(
      pairs.filter(positive).length / pairs.length >
        land.filter((c) => positive(c.id)).length / land.length + 0.2,
      'ore is spatially correlated rather than independent per province',
    )
  }
})

test('density refinement and coarsening preserve people, capital, stocks, claims and geography', () => {
  const w = generateWorld('Adaptive districts')
  balances(w)
  const geography = JSON.stringify(w.cells),
    accounts = JSON.stringify(w.economy),
    stocks = JSON.stringify(w.regions.map((r) => r.stocks))
  for (const r of w.regions) r.urban = 0
  refreshSpatial(w)
  const coarse = w.spatial!.districts.length
  for (const r of w.regions) r.urban = 0.9
  refreshSpatial(w)
  assert(w.spatial!.districts.length > coarse * 2)
  assertPartition(w)
  for (const r of w.regions) r.urban = 0
  refreshSpatial(w)
  assert.equal(w.spatial!.districts.length, coarse)
  assertPartition(w)
  assert.equal(JSON.stringify(w.cells), geography)
  assert.equal(JSON.stringify(w.economy), accounts)
  assert.equal(JSON.stringify(w.regions.map((r) => r.stocks)), stocks)
})

test('industrial employment refines rural land, with split and merge hysteresis', () => {
  const w = generateWorld('Industrial districts')
  balances(w)
  for (const r of w.regions) r.urban = 0
  // A minimal enterprise projection is sufficient to test the spatial consumer.
  w.economy!.firms = []
  refreshSpatial(w)
  assert.equal(w.spatial!.splits.length, 0)
  const r = w.regions.find((r) => r.deposits.iron > 0 && r.cells.length > 10)!
  const firm = {
    region: r.id,
    active: true,
    employment: 3000,
    laborMix: { tools: 1, textiles: 0, arms: 0, iron: 0, coal: 0 },
  }
  w.economy!.firms.push(firm as CompetitiveFirm)
  refreshSpatial(w)
  assert(w.spatial!.splits.includes('r'))
  firm.employment = 2000 // pressure 0.8 keeps an existing split, but cannot open one.
  refreshSpatial(w)
  assert(w.spatial!.splits.includes('r'))
  delete w.spatial
  refreshSpatial(w)
  assert.equal(w.spatial!.splits.length, 0)
  firm.employment = 3000
  refreshSpatial(w)
  firm.employment = 1000
  refreshSpatial(w)
  assert.equal(w.spatial!.splits.length, 0)
  assertPartition(w)
})

test('saved refinement continues deterministically and UI projection retains settlement detail', () => {
  const w = generateWorld('Spatial continuation')
  for (let i = 0; i < 12; i++) tick(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.deepEqual(restored.spatial, w.spatial)
  tick(w)
  tick(restored)
  assert.deepEqual(restored, w)
  assertPartition(w)
  validateWorld(w)
  assert.deepEqual(viewSnapshot(w).spatial, w.spatial)
})

test('square worlds reconstruct omitted spatial detail without moving residents or changing terrain', () => {
  const w = generateWorld('Legacy spatial')
  delete w.spatial
  for (const c of w.cells) delete c.landscape
  const before = JSON.stringify(w)
  const first = spatialState(w)
  assert.equal(JSON.stringify(w), before)
  assert.equal(spatialState(w), first)
  assert.deepEqual(buildSpatial(w), first)
  assertPartition(w)
  validateWorld(w)
})

test('save validation rejects duplicate, missing, out-of-bounds and financially impossible spatial data', () => {
  const w = generateWorld('Spatial validation')
  const cases = [
    (x: World) => x.spatial!.districts[0].cells.push(x.spatial!.districts[0].cells[0]),
    (x: World) => x.spatial!.districts.pop(),
    (x: World) => {
      x.spatial!.districts[0].node = 'r999'
    },
    (x: World) => {
      x.spatial!.districts[0].capital = -1
    },
    (x: World) => {
      x.spatial!.settlements[0].population++
    },
    (x: World) => {
      x.cells.find((c) => c.landscape)!.landscape!.resources.iron = -1
    },
  ]
  for (const mutate of cases) {
    const x = structuredClone(w)
    mutate(x)
    assert.throws(() => validateWorld(x), /spatial/)
  }
})
