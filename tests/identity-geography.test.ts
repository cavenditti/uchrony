import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensurePopulation, identityDistribution } from '../src/sim/population'
import { identityHomelands } from '../src/sim/identity-geography'
import { hashSeed } from '../src/sim/random'
import { population } from '../src/sim/types'
import { validateWorld } from '../src/sim/persistence'

test('new cultural and language majorities form connected homelands with only small border minorities', () => {
  for (const seed of ['Community basins', 'Border societies', 'Island cultures']) {
    const w = generateWorld(seed)
    for (const axis of ['culture', 'language'] as const) {
      const census = w.regions.map((r) => identityDistribution(r.communities!, axis))
      const majority = census.map((d) => d[0].id)
      for (const identity of new Set(majority)) {
        const remaining = new Set(w.regions.filter((r) => majority[r.id] === identity).map((r) => r.id))
        const queue = [remaining.values().next().value!]
        remaining.delete(queue[0])
        for (let i = 0; i < queue.length; i++)
          for (const next of w.regions[queue[i]].neighbors) if (remaining.delete(next)) queue.push(next)
        assert.equal(remaining.size, 0, `${seed}: disconnected ${axis} ${identity}`)
      }
      for (const r of w.regions) {
        const minority = census[r.id].slice(1)
        assert(minority.reduce((sum, d) => sum + d.count, 0) / population(r) < 0.041)
        for (const entry of minority)
          assert(
            r.neighbors.some((id) => majority[id] === entry.id),
            'minority has a neighboring homeland',
          )
      }
    }
    assert(
      w.nations.some(
        (n) =>
          new Set(
            w.regions
              .filter((r) => r.nation === n.id)
              .map((r) => identityDistribution(r.communities!, 'culture')[0].id),
          ).size > 1,
      ),
    )
    validateWorld(w)
  }
})

test('homeland generation is repeatable and preparation preserves an existing census', () => {
  const w = generateWorld('Persistent communities')
  const a = identityHomelands(w, { rng: hashSeed('origins') })
  const b = identityHomelands(w, { rng: hashSeed('origins') })
  assert.deepEqual(a.owner, b.owner)
  assert.deepEqual(
    a.seeds.map((r) => r.id),
    b.seeds.map((r) => r.id),
  )
  const restored = structuredClone(w)
  const before = w.regions.map((r) => identityDistribution(r.communities!, 'culture'))
  ensurePopulation(restored)
  assert.deepEqual(restored.regions.map((r) => identityDistribution(r.communities!, 'culture')), before)
})
