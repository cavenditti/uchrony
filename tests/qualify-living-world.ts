/** Offline projection/detail measurement; no browser, saves or model services. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { economicLandscape, TILE_ACTIVITIES } from '../src/sim/economic-landscape'
import { activityLayout } from '../src/map/activity-layout'
import { canonicalHash } from './fixtures/world-hash'
import { WORLD_SCALES } from '../src/sim/scale'

const results = []
for (const scale of ['regional', 'world'] as const) {
  const start = performance.now()
  const w = generateWorld(
    'Living world qualification 2026-10-26',
    3,
    WORLD_SCALES[scale].states,
    undefined,
    scale,
  )
  tick(w)
  const preparationMs = performance.now() - start
  const before = canonicalHash(w)
  globalThis.gc?.()
  const heapBefore = process.memoryUsage().heapUsed
  const times = []
  let land = economicLandscape(w)
  for (let i = 0; i < 3; i++) {
    const begin = performance.now()
    land = economicLandscape(w)
    times.push(performance.now() - begin)
  }
  const activityCounts = Object.fromEntries(TILE_ACTIVITIES.map((use) => [use, 0]))
  for (const use of land.activity) activityCounts[TILE_ACTIVITIES[use]]++
  const visible = w.cells.filter((c) => c.terrain !== 'water').slice(0, 64)
  const detailStart = performance.now()
  const plans = visible.map((c) => activityLayout(w, land, c.id))
  const detailMs = performance.now() - detailStart
  const residents = land.residents.reduce((sum, n) => sum + n, 0)
  const population = w.regions.reduce(
    (sum, r) => sum + r.population.children + r.population.adults + r.population.elders,
    0,
  )
  const workers = land.workers.reduce((sum, n) => sum + n, 0)
  const employment = w.economy!.firms!.filter((f) => f.active).reduce((sum, f) => sum + f.employment, 0)
  assert(Math.abs(residents - population) < Math.max(1e-6, population * 1e-12))
  assert(Math.abs(workers - employment) < Math.max(1e-6, employment * 1e-12))
  assert.equal(canonicalHash(w), before)
  globalThis.gc?.()
  const result = {
    scale,
    sourceCells: w.cells.length,
    month: w.month,
    preparationMs: Math.round(preparationMs),
    warmedProjectionMs: times.map((ms) => +ms.toFixed(2)),
    retainedArrayBytes:
      land.activity.byteLength +
      land.intensity.byteLength +
      land.workers.byteLength +
      land.residents.byteLength,
    rgbaGroundTextureBytes: w.cells.length * 4,
    sampledHeapChangeBytes: globalThis.gc ? process.memoryUsage().heapUsed - heapBefore : null,
    harbors: land.harbors.length,
    activityCounts,
    detailTiles: plans.length,
    detailPlanMs: +detailMs.toFixed(2),
    detailPieces: plans.reduce((n, p) => n + p.pieces.length, 0),
    detailMotions: plans.reduce((n, p) => n + p.motions.length, 0),
    projectedResidents: residents,
    projectedWorkers: workers,
    populationAndEmploymentConserved: true,
    canonicalStateUnchanged: true,
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
const sources = [
  'src/sim/economic-landscape.ts',
  'src/sim/climate.ts',
  'src/map/activity-layout.ts',
  'src/map/activity-material.ts',
  'src/map/activity-scenery.ts',
  'tests/qualify-living-world.ts',
]
writeFileSync(
  process.argv[2] ?? 'docs/validation/living-world-2026-10-26.json',
  JSON.stringify(
    {
      date: '2026-10-26',
      command: 'node --expose-gc --import tsx tests/qualify-living-world.ts',
      cpu: cpus()[0].model,
      node: process.version,
      scope:
        'One generated month per size; three warmed economic projections and 64 deterministic tile plans. No GPU, full-engine throughput, peak memory or endurance claim. Heap delta is a noisy post-GC sample; retained-array bytes are exact and exclude JavaScript objects.',
      sources: Object.fromEntries(
        sources.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
      ),
      results,
    },
    null,
    2,
  ) + '\n',
)
