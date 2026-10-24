import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { produce, consume, householdNeed } from '../src/sim/economy'
import { tick } from '../src/sim/engine'
import { validateWorld } from '../src/sim/persistence'
import { DEFAULT_SETTINGS } from '../src/sim/settings'
import { population } from '../src/sim/types'

test('geology creates spatially uneven resources, including provinces without workable iron or coal', () => {
  const w = generateWorld('geological-scarcity')
  for (const good of ['iron', 'coal'] as const) {
    assert(
      w.regions.some((r) => r.deposits[good] === 0),
      good,
    )
    const values = w.regions.map((r) => r.deposits[good]).sort((a, b) => a - b)
    assert(values.at(-1)! > values[Math.floor(values.length / 2)] * 3)
  }
  validateWorld(w)
})
test('abundance scales actual raw output; constrained populations can exhaust reserves', () => {
  const scarce = generateWorld('material-limit', 3, 8, {
      ...DEFAULT_SETTINGS,
      abundance: 0.35,
      instability: 0,
    }),
    rich = structuredClone(scarce)
  rich.simulation!.abundance = 1.6
  for (const w of [scarce, rich]) produce(w)
  for (const good of ['food', 'timber', 'iron', 'coal'] as const) {
    const total = (w: typeof scarce) => w.regions.reduce((s, r) => s + r.production[good], 0)
    assert(total(rich) > total(scarce) * 4, good)
  }
  for (let month = 0; month < 12; month++) tick(scarce)
  assert(scarce.regions.some((r) => r.foodCoverage < 0.9))
  assert(scarce.regions.some((r) => (r.materialCoverage ?? 1) < 0.9))
  validateWorld(scarce)
})
test('nonfood shortages are visible and impair production without inventing people or goods', () => {
  const w = generateWorld('missing-tools'),
    r = w.regions[0]
  const need = householdNeed(r, 'tools')
  const oldIndustry = r.industry
  r.industry = oldIndustry + 0.3
  assert(householdNeed(r, 'tools') > need)
  r.industry = oldIndustry
  for (const region of w.regions)
    for (const good of ['tools', 'textiles', 'timber', 'stone', 'iron', 'coal'] as const)
      region.stocks[good] = 0
  const people = w.regions.reduce((s, r) => s + population(r), 0)
  consume(w)
  assert.equal(r.materialCoverage, 0)
  assert.equal(
    w.regions.reduce((s, r) => s + population(r), 0),
    people,
  )
  assert(r.infrastructure > 0)
  const constrained = structuredClone(w),
    supplied = structuredClone(w)
  for (const region of supplied.regions) region.materialCoverage = 1
  produce(constrained)
  produce(supplied)
  assert(
    supplied.regions.reduce((s, r) => s + r.production.food, 0) >
      constrained.regions.reduce((s, r) => s + r.production.food, 0),
  )
})
