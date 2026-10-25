import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { validatePopulation } from '../src/sim/population-persistence'
import type { PopulationCommunity } from '../src/sim/population-types'

test('large-map census capacity scales without bypassing census checks or import bounds', () => {
  const world = generateWorld('Large census validation', 3, 8, undefined, 'regional')
  const source = world.regions[0],
    base = source.communities![0]
  const cultures = world.demography!.identities.filter((i) => i.kind === 'culture')
  const languages = world.demography!.identities.filter((i) => i.kind === 'language')
  const beliefs = world.demography!.identities.filter((i) => i.kind === 'belief')
  const groups: PopulationCommunity[] = []
  for (const culture of cultures)
    for (const language of languages)
      for (const belief of beliefs)
        groups.push({
          ...base,
          culture: culture.id,
          language: language.id,
          belief: belief.id,
          population: { children: 1, adults: 1, elders: 1 },
          ageCohorts: undefined,
          ageMonth: undefined,
        })
  assert(groups.length >= 110)
  const communities = groups.slice(0, 110)
  world.regions = Array.from({ length: 1400 }, (_, id) => ({
    ...source,
    id,
    communities,
    population: { children: 110, adults: 110, elders: 110 },
  }))
  validatePopulation(world) // 154,000 valid, distinct civilian profiles, plus military.
  world.regions[0] = { ...world.regions[0], population: { children: 111, adults: 110, elders: 110 } }
  assert.throws(() => validatePopulation(world), /ages disagree/)
  // Legacy duplicate recovery still cannot accept an unbounded census on a small map.
  for (const identity of world.demography!.identities) identity.origin = 0
  world.regions = Array.from({ length: 40 }, (_, id) => ({
    ...source,
    id,
    communities: Array.from({ length: 4000 }, () => communities[0]),
    population: { children: 4000, adults: 4000, elders: 4000 },
  }))
  assert.throws(() => validatePopulation(world, true), /census exceeds/)
})
