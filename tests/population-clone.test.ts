import test from 'node:test'
import assert from 'node:assert/strict'
import { clonePopulationHolders } from '../src/sim/population-clone'
import type { PopulationCommunity } from '../src/sim/population-types'

test('settlement census copies preserve every field and isolate nested mutations', () => {
  const groups = [
    {
      culture: 7,
      population: { children: 2, adults: 3, elders: 0 },
      ageCohorts: [
        [0, 1, 1],
        [-400, 2, 1],
      ],
      ageMonth: 0,
    },
    { culture: 8, population: { children: 0, adults: 1, elders: 0 } },
  ] as PopulationCommunity[]
  const holders = [{ id: 1, communities: groups, delegation: { powers: ['taxation'] } }, { id: 2 }]
  const before = structuredClone(holders)
  const copy = clonePopulationHolders(holders)
  assert.deepEqual(copy, before)
  assert.equal(JSON.stringify(copy), JSON.stringify(holders))
  copy[0].communities![0].ageCohorts![0][1] = 90
  copy[0].communities![1].population.adults = 25
  copy[0].delegation!.powers.push('policing')
  assert.deepEqual(holders, before)
})
