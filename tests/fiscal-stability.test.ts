import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CONFIGURATION_VALUES } from '../src/sim/configuration-defaults'
import { tick } from '../src/sim/engine'
import { nextFiscalStability } from '../src/sim/fiscal-stability'
import { generateWorld } from '../src/sim/generate'

const solvent = { debt: 0, gdp: 100, stability: 70, legitimacy: 70 }

test('sustainable debt retains ordinary happiness and legitimacy adjustment', () => {
  for (const debt of [0, 1200, 2400]) {
    const nation = Object.freeze({ ...solvent, debt })
    assert.equal(nextFiscalStability(nation, 0.7), 70)
    assert.equal(nextFiscalStability(nation, 1), 71.2)
    assert.equal(nextFiscalStability(nation, 0.2), 68)
  }
})

test('persistent excessive debt keeps eroding stability beyond the former six-point equilibrium', () => {
  const nation = { ...solvent, debt: 2401 }
  // Hold public happiness and legitimacy steady to isolate debt's cumulative effect.
  for (let month = 1; month <= 180; month++) {
    const previous = nation.stability
    nation.stability = nextFiscalStability(nation, 0.7)
    assert(nation.stability < previous, `debt stopped eroding stability in month ${month}`)
  }
  assert(Math.abs(nation.stability - 16) < 1e-9)
})

test('excessive debt blocks upward recovery even when the public is otherwise content', () => {
  const nation = { ...solvent, debt: 2401, stability: 20, legitimacy: 100 }
  assert.equal(nextFiscalStability(nation, 1), 19.7)
  // Bad political conditions can still compound the fiscal loss.
  assert.equal(nextFiscalStability({ ...nation, stability: 90, legitimacy: 0 }, 0), 85.2)
})

test('debt reduction or output recovery restores ordinary stability recovery', () => {
  const nation = { ...solvent, debt: 2401, stability: 40 }
  assert.equal(nextFiscalStability(nation, 0.7), 39.7)
  assert.equal(nextFiscalStability({ ...nation, debt: 2400 }, 0.7), 41.5)
  assert.equal(nextFiscalStability({ ...nation, gdp: 101 }, 0.7), 41.5)
})

test('nonpositive output creates fiscal distress only when debt exists', () => {
  for (const gdp of [0, -100]) {
    assert.equal(nextFiscalStability({ ...solvent, gdp }, 1), 71.2)
    assert.equal(nextFiscalStability({ ...solvent, gdp, debt: 1 }, 1), 69.7)
  }
})

test('persistent fiscal distress respects the stability floor and normal recovery the ceiling', () => {
  const nation = { ...solvent, debt: 1e14 }
  for (let month = 0; month < 1000; month++) nation.stability = nextFiscalStability(nation, 1)
  assert.equal(nation.stability, 5)
  assert.equal(nextFiscalStability({ ...solvent, stability: 99, legitimacy: 100 }, 1), 99)
})

test('the monthly simulation applies cumulative debt pressure to an overwhelmed state', () => {
  const configuration = structuredClone(DEFAULT_CONFIGURATION_VALUES)
  configuration.starting.debt = 1e9
  configuration.starting.stability = 20
  configuration.starting.legitimacy = 100
  configuration.starting.ai = false
  const world = generateWorld(
    'persistent-fiscal-distress',
    3,
    4,
    undefined,
    'regional',
    'settled',
    configuration,
  )
  for (const region of world.regions) region.happiness = 1
  tick(world)
  assert(world.nations.every((nation) => nation.debt > nation.gdp * 24))
  assert(world.nations.every((nation) => nation.stability < 20))
})
