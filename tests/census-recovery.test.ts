import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateWorld } from '../src/sim/generate'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { communitySize, coalesceCommunities } from '../src/sim/population'
import { extractAges } from '../src/sim/age-cohorts'
import { persistSave } from '../src/storage/autosave'
import { DiskAutosaves } from '../server/autosave'
import type { PopulationCommunity } from '../src/sim/population-types'
import type { WorldSave } from '../src/storage/save-types'

function duplicate(groups: PopulationCommunity[]) {
  const source = groups[0],
    copy = extractAges(source, {
      children: Math.floor(source.population.children / 2),
      adults: Math.floor(source.population.adults / 2),
      elders: Math.floor(source.population.elders / 2),
    })
  groups.push(copy)
  return { source, copy }
}
test('allegiance convergence reproduces the reported failure and coalesces without dropping people', () => {
  const w = generateWorld('allegiance-collision'),
    r = w.regions[0],
    { source, copy } = duplicate(r.communities!)
  copy.allegiance = (source.allegiance + 1) % w.nations.length
  validateWorld(w)
  copy.allegiance = source.allegiance
  assert.throws(() => validateWorld(w), /duplicate census community/)
  const people = r.population.children + r.population.adults + r.population.elders
  r.communities = coalesceCommunities(r.communities!)
  assert.equal(
    r.communities.reduce((s, g) => s + communitySize(g), 0),
    people,
  )
  validateWorld(w)
})
test('safe recovery merges civilian and military duplicate representations after checking all census totals', () => {
  const w = generateWorld('duplicate-recovery'),
    r = w.regions[0],
    { source, copy } = duplicate(r.communities!)
  source.wealth = 0.1
  copy.wealth = 0.9
  const expected =
    (communitySize(source) * 0.1 + communitySize(copy) * 0.9) / (communitySize(source) + communitySize(copy))
  duplicate(w.armies[0].communities!)
  if (w.warfare?.fleets[0]) duplicate(w.warfare.fleets[0].communities!)
  const raw = JSON.stringify(w),
    recovered = restoreWorld(w)
  validateWorld(recovered)
  assert.equal(recovered.regions[0].communities![0].wealth, expected)
  assert.deepEqual(
    recovered.regions.map((r) => r.population),
    w.regions.map((r) => r.population),
  )
  assert.deepEqual(
    recovered.armies.map((a) => a.soldiers),
    w.armies.map((a) => a.soldiers),
  )
  assert.equal(JSON.stringify(w), raw, 'source snapshot must remain untouched')
  const bad = structuredClone(w)
  bad.regions[0].population.adults++
  assert.throws(() => restoreWorld(bad), /ages disagree/)
})
test('autosave writes the checked canonical snapshot rather than the rejected duplicate input', async () => {
  const world = generateWorld('duplicate-autosave')
  duplicate(world.regions[0].communities!)
  let written: WorldSave | undefined
  await persistSave(
    [
      {
        name: 'browser',
        async read() {
          return null
        },
        async write(save) {
          written = save
        },
      },
    ],
    { version: 1, savedAt: Date.now(), world },
  )
  assert(written)
  validateWorld(written.world)
  assert.notEqual(written.world, world)
})
test('disk recovery checks original bytes before canonicalizing and preserves the original checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uchrony-census-')),
    slot = randomUUID(),
    world = generateWorld('duplicate-disk')
  duplicate(world.regions[0].communities!)
  const record = {
      version: 1,
      savedAt: Date.now(),
      world,
      checksum: createHash('sha256').update(JSON.stringify(world)).digest('hex'),
    },
    raw = JSON.stringify(record),
    file = join(root, `${slot}.json`)
  try {
    await writeFile(file, raw)
    const result = await new DiskAutosaves(root).read(slot)
    assert(result.save)
    validateWorld(result.save.world)
    assert.equal(await readFile(file, 'utf8'), raw)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
