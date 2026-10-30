/** Save boundaries accept one complete schema and never repair obsolete worlds. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { generateWorld } from '../src/sim/generate'
import { configurationDraft } from '../src/sim/configuration'
import { prepareSpatialWorld } from '../src/sim/engine'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { WORLD_VERSION } from '../src/sim/save-version'
import { residentialSites } from '../src/sim/residential-sites'
import { validateAdaptiveWorld } from '../src/sim/adaptive-persistence'

const world = generateWorld('Current save schema', 3, 4, undefined, 'regional', 'frontier')

test('retired versions fail before reading configuration or compressed registries', () => {
  for (const version of [undefined, 0, 1, WORLD_VERSION + 1, '2']) {
    const retired = {
      version,
      get configuration() {
        throw new Error('Retired configuration must not be read')
      },
      get worldEncoding() {
        throw new Error('Retired blocks must not be read')
      },
    }
    for (const read of [validateWorld, restoreWorld])
      assert.throws(() => read(retired), /unsupported version.*Create a new world/)
  }
  for (const input of [null, [], 3]) assert.throws(() => restoreWorld(input), /expected an object/)
})

test('default generation carries a complete configuration and no shadow conditions', () => {
  assert.equal(world.version, WORLD_VERSION)
  assert.deepEqual(world.configuration.values, configurationDraft())
  assert.equal(Object.hasOwn(world, 'simulation'), false)
  assert(world.nations.every((nation) => nation.character && !Object.hasOwn(nation, 'personality')))
  assert.equal(Object.hasOwn(world, 'supplyChainsVersion'), false)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(world))))
  assert.deepEqual(restored, world)
  const custom = generateWorld('Current save schema', 3, 4, { instability: 0, abundance: 1.1, extremity: 0 })
  assert.deepEqual(custom.configuration.values.conditions, { instability: 0, abundance: 1.1, extremity: 0 })
})

test('missing saved configuration or provenance is rejected without filling defaults', () => {
  for (const missing of ['configuration', 'modelProvenance'] as const) {
    const incomplete = structuredClone(world) as Partial<typeof world>
    delete incomplete[missing]
    const before = JSON.stringify(incomplete)
    assert.throws(() => restoreWorld(incomplete), /configuration|provenance/)
    assert.equal(JSON.stringify(incomplete), before)
  }
  const partial = structuredClone(world)
  delete (partial.configuration.values as Partial<typeof partial.configuration.values>).model
  assert.throws(() => restoreWorld(partial), /missing parameter/)
})

test('current mountain housing is invalid instead of being relocated during restore', () => {
  const current = structuredClone(world)
  prepareSpatialWorld(current)
  const home = residentialSites(current).find((s) => s.capacity > 0)!
  current.cells[home.cell].terrain = 'mountains'
  const before = JSON.stringify(current)
  assert.throws(() => validateAdaptiveWorld(current), /housing on inaccessible mountains/)
  assert.throws(() => restoreWorld(current))
  assert.equal(JSON.stringify(current), before)
})
