import test from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { solveInfluence, appendInfluenceTree, runInfluenceJobs } from '../src/sim/influence-kernel'
import { InfluencePool } from '../src/sim/influence-pool'
import { influenceFixture } from './fixtures/influence'
import { generateWorld } from '../src/sim/generate'
import { ensureFirms } from '../src/sim/firms'
import { ensureAdaptiveWorld, refreshAdaptiveTotals, rebuildAdaptiveMesh } from '../src/sim/adaptive-world'
import { ensureResidentialSites, residentialPools, compactResidence } from '../src/sim/residential-sites'
import { influenceSnapshot, settlementInfluence, setInfluenceExecutor } from '../src/sim/settlement-influence'
import { advanceSettlements, refreshCityLabels } from '../src/sim/cities'
import { balances } from '../src/sim/ledger'
import { physicalStocks } from '../src/sim/goods-accounting'
import { tick } from '../src/sim/engine'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { canonicalHash } from './fixtures/world-hash'

function fixture() {
  const w = generateWorld('Influence spheres', 3, 8, undefined, 'regional')
  ensureFirms(w)
  ensureAdaptiveWorld(w)
  ensureResidentialSites(w)
  refreshAdaptiveTotals(w)
  return w
}
const pool = (workers: number) =>
  new InfluencePool(() => {
    const worker = new Worker(new URL('./fixtures/influence-thread.mjs', import.meta.url))
    worker.on('error', () => {})
    return worker
  }, workers)

test('quadtree influence is bounded against independent exhaustive within-cell sums', () => {
  const input = influenceFixture(1, 1, 1024, 2048)
  const actual = solveInfluence(input)
  for (let h = 0; h < 1024; h += 17) {
    let jobs = 0,
      services = 0
    for (let i = 0; i < 2048; i++) {
      const x = 10 + ((i * 73) % 1000),
        y = 10 + ((i * 137) % 1000)
      const decay = Math.exp(
        (-Math.hypot(x - input.targets[h * 4], y - input.targets[h * 4 + 1]) * 0.015) / 30,
      )
      jobs += (10 + (i % 13)) * decay
      services += (i % 7) * decay
    }
    assert(Math.abs(actual[h * 2] / jobs - 1) <= input.tolerance + 1e-12)
    assert(Math.abs(actual[h * 2 + 1] / services - 1) <= input.tolerance + 1e-12)
  }
})

test('coincident workplaces aggregate exactly without maximum population or source-count limits', () => {
  const nodes: number[] = []
  appendInfluenceTree(
    nodes,
    Array.from({ length: 100000 }, () => ({ x: 500, y: 500, jobs: 1000, services: 1 })),
  )
  assert.equal(nodes.length, 6)
  assert.equal(nodes[3], 100000000)
  assert.equal(nodes[4], 100000)
})

test('real worker threads produce bit-identical fields, including a single dense urban cell', () => {
  for (const input of [influenceFixture(), influenceFixture(1, 1, 4096, 1024)]) {
    const expected = solveInfluence(input)
    for (const count of [2, 4]) {
      const executor = pool(count)
      try {
        assert.deepEqual(executor.solve(input), expected)
        assert.equal(executor.lastRun.workers, count)
        assert.deepEqual(executor.solve(input), expected, 'reused workers must not retain stale snapshots')
      } finally {
        executor.dispose()
      }
    }
  }
})

test('completed batches do not wait for an idle dispatched worker', () => {
  const input = influenceFixture()
  let created = 0
  const executor = new InfluencePool(
    () => {
      const active = created++ === 0
      return {
        postMessage(job) {
          if (active) runInfluenceJobs(job)
        },
        terminate() {},
      }
    },
    2,
    5,
  )
  try {
    assert.deepEqual(executor.solve(input), solveInfluence(input))
    assert.equal(executor.lastRun.fallback, false)
    assert.equal(executor.lastRun.workers, 2)
  } finally {
    executor.dispose()
  }
})

test('a missing or failed worker falls back atomically without using partial results', () => {
  const input = influenceFixture(),
    expected = solveInfluence(input)
  let stopped = 0
  const executor = new InfluencePool(
    () => ({
      postMessage() {},
      terminate() {
        stopped++
      },
    }),
    2,
    5,
  )
  assert.deepEqual(executor.solve(input), expected)
  assert.equal(executor.lastRun.fallback, true)
  assert.equal(stopped, 2)
  assert.deepEqual(executor.solve(input), expected)
  const broken = new InfluencePool(() => {
    throw new Error('unsupported')
  }, 2)
  assert.deepEqual(broken.solve(input), expected)
})

test('numerical refinement and city labels cannot change influence, urban share, assets or relocation', () => {
  const w = fixture(),
    clone = structuredClone(w)
  clone.localEconomy!.cities = []
  clone.spatial!.settlements = []
  for (const mode of ['fine', 'coarse'] as const) {
    rebuildAdaptiveMesh(clone, mode)
    assert.deepEqual(
      solveInfluence(influenceSnapshot(clone).input),
      solveInfluence(influenceSnapshot(w).input),
    )
  }
  const holdings = (v: typeof w) => ({
    money: balances(v),
    goods: physicalStocks(v),
    firms: v.economy!.firms,
    rng: v.rng,
  })
  const before = canonicalHash(holdings(w))
  advanceSettlements(w, true)
  advanceSettlements(clone, true)
  assert.deepEqual(
    w.localEconomy!.active.map((id) => w.localEconomy!.units[id].urban),
    clone.localEconomy!.active.map((id) => clone.localEconomy!.units[id].urban),
  )
  advanceSettlements(w)
  advanceSettlements(clone)
  assert.deepEqual(w.adaptive!.sites, clone.adaptive!.sites)
  const physical = canonicalHash({ sites: w.adaptive!.sites, people: w.regions.map((r) => r.communities) })
  refreshCityLabels(w)
  assert.equal(
    canonicalHash({ sites: w.adaptive!.sites, people: w.regions.map((r) => r.communities) }),
    physical,
  )
  assert.equal(canonicalHash(holdings(w)), before)
})

test('only funded administrative offices attract households; closing funding removes the field', () => {
  const w = fixture()
  for (const firm of w.economy!.firms) {
    firm.employment = 0
    if (firm.labor) firm.labor.unfilled = 0
  }
  const municipal = Object.values(w.adaptive!.jurisdictions).find((j) => j.level === 'municipality')!
  const home = w.adaptive!.sites[`home:${municipal.seat}`],
    producer = w.economy!.producers[home.pool]
  const base = settlementInfluence(w)(home)
  producer.administrationServices = 20
  const funded = settlementInfluence(w)(home)
  assert(funded > base + 0.08)
  producer.administrationServices = 0
  assert.equal(settlementInfluence(w)(home), base)
  const input = influenceSnapshot(w).input
  for (let i = 1; i < input.offsets.length; i++)
    for (let e = input.offsets[i - 1]; e < input.offsets[i]; e++) {
      const from = w.cells[input.edges[e]],
        to = w.cells[i - 1]
      assert.notEqual(from.terrain, 'water')
      assert.notEqual(to.terrain, 'water')
      assert.equal(w.regions[from.region].nation, w.regions[to.region].nation)
    }
})

test('funded rural infill can develop a dense center without an existing city identity', () => {
  const w = fixture(),
    home = [...residentialPools(w).values()].flat()[0]
  home.openingBuilt = 0
  home.investedValue = 0
  assert.equal(compactResidence(home), false)
  home.capacity = home.openingCapacity + 5000
  home.investedValue = 100
  assert.equal(compactResidence(home), true)
})

test('complete monthly outcomes and restored continuation are identical with parallel spatial execution', () => {
  const serial = fixture(),
    parallel = structuredClone(serial),
    executor = pool(4)
  try {
    tick(serial)
    setInfluenceExecutor((input) => executor.solve(input))
    tick(parallel)
    assert.equal(executor.lastRun.workers, 4)
    assert.equal(canonicalHash(parallel), canonicalHash(serial))
    const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(parallel))))
    tick(parallel)
    tick(restored)
    validateWorld(parallel)
    validateWorld(restored)
    assert.equal(canonicalHash(restored), canonicalHash(parallel))
  } finally {
    setInfluenceExecutor(solveInfluence)
    executor.dispose()
  }
})
