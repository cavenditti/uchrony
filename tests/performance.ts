/** Read-only benchmark; --save profiles a copy of a saved world. Never contacts a model or writes a save. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import assert from 'node:assert/strict'
import { WORLD_SCALES, worldScale } from '../src/sim/scale'
import { validateWorld } from '../src/sim/persistence'
import { population, type World } from '../src/sim/types'
import { canonicalHash } from './fixtures/world-hash'
const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const root = resolve(argument('--engine-root') ?? '.'),
  { tick, prepareSpatialWorld } = await import(pathToFileURL(resolve(root, 'src/sim/engine.ts')).href),
  { generateWorld } = await import(pathToFileURL(resolve(root, 'src/sim/generate.ts')).href),
  compareRoot = argument('--compare-root'),
  referenceTick = compareRoot
    ? (await import(pathToFileURL(resolve(compareRoot, 'src/sim/engine.ts')).href)).tick
    : undefined,
  save = argument('--save'),
  scale = worldScale(argument('--scale') ?? 'regional'),
  start = argument('--start') ?? 'settled',
  seed = argument('--seed') ?? 'performance-ledger'
assert(start === 'frontier' || start === 'settled')
const generationCpuStarted = process.cpuUsage(),
  generationStarted = performance.now(),
  original = save
    ? JSON.parse(readFileSync(resolve(save), 'utf8'))
    : generateWorld(seed, 3, WORLD_SCALES[scale].states, undefined, scale, start),
  initial: World = original.world ?? original,
  months = Number(argument('--months') ?? 24),
  repeats = Number(argument('--repeats') ?? 2),
  warmup = Number(argument('--warmup') ?? 0),
  people = (world: World) =>
    world.regions.reduce((sum, region) => sum + population(region), 0) +
    [...world.armies, ...(world.warfare?.fleets ?? [])].reduce((sum, army) => sum + army.soldiers, 0),
  results = []
assert(Number.isInteger(months) && months >= 0 && months <= 240)
assert(Number.isInteger(repeats) && repeats > 0 && repeats <= 10)
assert(Number.isInteger(warmup) && warmup >= 0 && warmup <= 240)
const generationMs = Math.round(performance.now() - generationStarted)
const generationCpu = process.cpuUsage(generationCpuStarted)
const generationCpuMs = Math.round((generationCpu.user + generationCpu.system) / 1000)
const progress = process.argv.includes('--progress')
if (progress) console.error(`Generated ${scale} ${start} world in ${generationMs} ms`)
for (let month = 0; month < warmup; month++) tick(initial)
const fromMonth = initial.month,
  communities = initial.regions.reduce((sum, region) => sum + (region.communities?.length ?? 0), 0)
for (let trial = 0; trial < repeats; trial++) {
  // A single-process timing trial needs only one live world. Retaining an unused
  // second World-sized census creates GC/memory pressure absent from the worker.
  const world = repeats === 1 && !referenceTick ? initial : structuredClone(initial),
    reference = referenceTick ? structuredClone(initial) : undefined,
    timings: number[] = [],
    cpuTimings: number[] = [],
    referenceTimings: number[] = [],
    hashes: string[] = []
  let preparationMs: number | undefined,
    preparationCpuMs: number | undefined,
    preparedHash: string | undefined
  if (process.argv.includes('--prepare')) {
    const cpuStarted = process.cpuUsage()
    const started = performance.now()
    prepareSpatialWorld(world)
    preparationMs = Math.round(performance.now() - started)
    const cpu = process.cpuUsage(cpuStarted)
    preparationCpuMs = Math.round((cpu.user + cpu.system) / 1000)
    // Fingerprinting a World-sized census creates substantial temporary memory.
    // Keep it out of pure timing trials; use a separate fingerprinted replay.
    if (process.argv.includes('--fingerprints')) preparedHash = canonicalHash(world)
    if (reference) {
      const referenceEngine = await import(pathToFileURL(resolve(compareRoot!, 'src/sim/engine.ts')).href)
      referenceEngine.prepareSpatialWorld(reference)
      assert(isDeepStrictEqual(world, reference), 'complete prepared state')
    }
    if (progress) console.error(`Trial ${trial + 1}, prepared: ${preparationMs} ms`)
  }
  for (let month = 0; month < months; month++) {
    const before = people(world)
    const cpuStarted = process.cpuUsage()
    const started = performance.now()
    tick(world)
    timings.push(performance.now() - started)
    const cpu = process.cpuUsage(cpuStarted)
    cpuTimings.push((cpu.user + cpu.system) / 1000)
    if (process.argv.includes('--fingerprints')) hashes.push(canonicalHash(world))
    assert.equal(people(world), before + world.totals.births - world.totals.deaths, `month ${world.month}`)
    if (reference) {
      const referenceStarted = performance.now()
      referenceTick(reference)
      referenceTimings.push(performance.now() - referenceStarted)
      // Batched remeshing can insert equivalent tree-change keys in a different
      // order. Compare all values, including numerical metadata, when JSON order
      // differs; never exclude a subsystem to make a replay appear equivalent.
      if (canonicalHash(world) !== canonicalHash(reference))
        assert(isDeepStrictEqual(world, reference), `complete state at month ${world.month}`)
    }
    if (progress) console.error(`Trial ${trial + 1}, month ${world.month}: ${Math.round(timings.at(-1)!)} ms`)
  }
  const elapsed = timings.reduce((sum, ms) => sum + ms, 0)
  validateWorld(world)
  results.push({
    ms: Math.round(elapsed),
    ...(preparationMs !== undefined
      ? { preparationMs, preparationCpuMs, startupMs: generationMs + preparationMs, preparedHash }
      : {}),
    monthsPerSecond: elapsed ? +((months * 1000) / elapsed).toFixed(2) : 0,
    tickMs: timings.map(Math.round),
    cpuMs: Math.round(cpuTimings.reduce((sum, ms) => sum + ms, 0)),
    tickCpuMs: cpuTimings.map(Math.round),
    processPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    finalHash: canonicalHash(world),
    ...(hashes.length ? { monthlyHashes: hashes } : {}),
    ...(reference
      ? {
          referenceMs: Math.round(referenceTimings.reduce((sum, ms) => sum + ms, 0)),
          identicalMonths: months,
        }
      : {}),
  })
}
console.log(
  JSON.stringify(
    {
      engine: root,
      ...(compareRoot ? { referenceEngine: resolve(compareRoot) } : {}),
      seed: initial.seed,
      start: initial.settlementStart ?? 'settled',
      generationMs,
      generationCpuMs,
      fromMonth,
      months,
      repeats,
      cells: initial.cells.length,
      communities,
      results,
    },
    null,
    2,
  ),
)
