/** Read-only benchmark; --save profiles a copy of a saved world. Never contacts a model or writes a save. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { WORLD_SCALES, worldScale } from '../src/sim/scale'
import { validateWorld } from '../src/sim/persistence'
import { population, type World } from '../src/sim/types'
const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const root = resolve(argument('--engine-root') ?? '.'),
  { tick } = await import(pathToFileURL(resolve(root, 'src/sim/engine.ts')).href),
  save = argument('--save'),
  scale = worldScale(argument('--scale') ?? 'regional'),
  original = save
    ? JSON.parse(readFileSync(resolve(save), 'utf8'))
    : generateWorld('performance-ledger', 3, WORLD_SCALES[scale].states, undefined, scale),
  initial: World = original.world ?? original,
  months = Number(argument('--months') ?? 24),
  repeats = Number(argument('--repeats') ?? 2),
  people = (world: World) =>
    world.regions.reduce((sum, region) => sum + population(region), 0) +
    [...world.armies, ...(world.warfare?.fleets ?? [])].reduce((sum, army) => sum + army.soldiers, 0),
  results = []
assert(Number.isInteger(months) && months > 0 && months <= 240)
assert(Number.isInteger(repeats) && repeats > 0 && repeats <= 10)
for (let trial = 0; trial < repeats; trial++) {
  const world = structuredClone(initial)
  const started = performance.now()
  for (let month = 0; month < months; month++) {
    const before = people(world)
    tick(world)
    assert.equal(people(world), before + world.totals.births - world.totals.deaths, `month ${world.month}`)
  }
  const elapsed = performance.now() - started
  validateWorld(world)
  results.push({ ms: Math.round(elapsed), monthsPerSecond: +((months * 1000) / elapsed).toFixed(2) })
}
console.log(
  JSON.stringify(
    {
      engine: root,
      fromMonth: initial.month,
      months,
      repeats,
      cells: initial.cells.length,
      communities: initial.regions.reduce((sum, region) => sum + (region.communities?.length ?? 0), 0),
      results,
    },
    null,
    2,
  ),
)
