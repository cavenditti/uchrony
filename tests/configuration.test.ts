import test from 'node:test'
import assert from 'node:assert/strict'
import {
  configurationDraft,
  validateConfigurationValues,
  validateWorldConfiguration,
  applyConfiguration,
  withWorldConfiguration,
} from '../src/sim/configuration'
import { DEFAULT_CONFIGURATION_VALUES } from '../src/sim/configuration-defaults'
import { CONFIGURATION_FIELDS, configurationValue } from '../src/sim/configuration-schema'
import { MODEL_PARAMETERS } from '../src/sim/model-parameters'
import { generateWorld } from '../src/sim/generate'
import { tick, prepareSpatialWorld, applyCommand } from '../src/sim/engine'
import { classifyBiome, localClimate } from '../src/sim/climate'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { BIOMES, MOISTURE_BANDS, TEMPERATURE_BANDS } from '../src/sim/climate-types'
import { consumeHouseholds, householdDemand } from '../src/sim/macroeconomy'
import { GOODS, inventory } from '../src/sim/types'

const fixture = (values = configurationDraft()) =>
  generateWorld('central-configuration', 3, 4, undefined, 'regional', 'frontier', values)

test('the complete registry validates its defaults and rejects unknown, nonfinite and inconsistent values', () => {
  assert.deepEqual(validateConfigurationValues(configurationDraft()), DEFAULT_CONFIGURATION_VALUES)
  for (const field of CONFIGURATION_FIELDS.filter((field) => field.kind === 'number'))
    assert(Number.isFinite(configurationValue(DEFAULT_CONFIGURATION_VALUES, field.path)))
  assert.throws(() => validateConfigurationValues({ climate: { typo: 2 } }), /unknown parameter/)
  assert.throws(() => validateConfigurationValues({ model: { bankCapitalRatio: 0 } }), /Bank capital ratio/)
  assert.throws(() => validateConfigurationValues({ climate: { growthRange: 0 } }), /Growth range/)
  assert.throws(() => validateConfigurationValues({ model: { policyRateMonthly: NaN } }), /Policy rate/)
  assert.throws(
    () => validateConfigurationValues({ climate: { temperatureThresholds: { cold: -8 } } }),
    /strictly increasing/,
  )
  assert.throws(
    () => validateConfigurationValues({ starting: { childrenShare: 0.8, adultShare: 0.8 } }),
    /cannot exceed/,
  )
  assert.throws(
    () => validateConfigurationValues({ model: { fertilityAnnual: [0, 0, 0, 0, 0, 0, 0] } }),
    /fertility/,
  )
  assert.throws(() => validateConfigurationValues({ recipes: { tools: { iron: 0 } } }), /Iron/)
  assert.throws(() => validateConfigurationValues({ expansion: { range: 1.5 } }), /whole number/)
  assert.throws(() => validateWorldConfiguration({ version: 2, revision: 0, values: {} }), /unsupported/)
})

test('every editable parameter has explanatory help, including matrix cells and distinct treasury costs', () => {
  for (const field of CONFIGURATION_FIELDS) {
    assert(field.description.length > 30, `${field.path} needs an explanation`)
    assert(!field.description.includes('undefined'), `${field.path} has incomplete help`)
  }
  const field = (path: string) => CONFIGURATION_FIELDS.find((field) => field.path === path)!
  assert.match(field('starting.treasury').description, /Opening cash.*every state/)
  assert.match(field('founding.cash').description, /cost, not the cash/)
  assert.equal(field('starting.treasury').unit, 'thousand crowns')
  assert.equal(field('geography.temperatureOffset').unit, undefined)
})

test('large opening cash survives initialization and months; expedition cost does not grant cash', () => {
  const expedition = configurationDraft()
  expedition.founding.cash = 120000
  const ordinary = fixture(expedition)
  assert(ordinary.nations.every((nation) => nation.treasury === 500))

  const rich = configurationDraft()
  rich.starting.treasury = 1000000
  const world = fixture(rich)
  prepareSpatialWorld(world)
  assert(world.nations.every((nation) => nation.treasury === 1000000))
  tick(world)
  tick(world)
  assert(world.nations.every((nation) => nation.treasury > 900000))
  const restored = restoreWorld(packWorldSave(world))
  assert.deepEqual(
    restored.nations.map((nation) => nation.treasury),
    world.nations.map((nation) => nation.treasury),
  )
})

test('biome matrix and terrain overrides are exhaustive and preserve original strict thresholds', () => {
  const climate = configurationDraft().climate
  for (const temperature of TEMPERATURE_BANDS)
    for (const moisture of MOISTURE_BANDS) assert(BIOMES.includes(climate.matrix[temperature][moisture]))
  const original = (t: number, terrain: string, m: number) =>
    t < -5 || terrain === 'tundra'
      ? 'polar'
      : terrain === 'desert' || m < 0.2
        ? 'arid'
        : t < 7
          ? 'boreal'
          : t > 22 && m > 0.55
            ? 'tropical'
            : t > 14 && m < 0.48
              ? 'mediterranean'
              : 'temperate'
  for (const temperature of [-40, -5.001, -5, -4, 6.999, 7, 14, 14.001, 22, 22.001, 50])
    for (const moisture of [0, 0.19999, 0.2, 0.47999, 0.48, 0.55, 0.55001, 1])
      for (const terrain of ['plains', 'forest', 'tundra', 'desert'] as const)
        assert.equal(
          classifyBiome(temperature, terrain, moisture, climate),
          original(temperature, terrain, moisture),
        )
  climate.matrix.hot.wet = 'boreal'
  assert.equal(classifyBiome(30, 'plains', 0.8, climate), 'boreal')
  climate.terrainOverrides.desert.freezing = 'arid'
  assert.equal(classifyBiome(-20, 'desert', 0.1, climate), 'arid')
})

test('climate keeps hemispheres half a year apart and wraps negative months', () => {
  const north = { r: 10, elevation: 0.2, terrain: 'plains' as const, moisture: 0.5 }
  const south = { ...north, r: 89 }
  assert(
    Math.abs(
      localClimate({ height: 100, month: 0 }, north).season -
        localClimate({ height: 100, month: 6 }, south).season,
    ) < 1e-12,
  )
  assert.deepEqual(
    localClimate({ height: 100, month: -1 }, north),
    localClimate({ height: 100, month: 11 }, north),
  )
})

test('custom generation changes real opening endowments and is deterministic', () => {
  const values = configurationDraft()
  Object.assign(values.starting, { year: 1850, capitalPopulation: 4000, treasury: 1234, stockpileScale: 2 })
  values.model.bankCount = 4
  const a = fixture(values),
    b = fixture(values)
  assert.equal(a.startYear, 1850)
  assert(a.nations.every((nation) => nation.population === 4000 && nation.treasury === 1234))
  assert.deepEqual(a, b)
  prepareSpatialWorld(a)
  assert.equal(a.economy!.banking!.banks.length, 4)
  tick(a)
  validateWorld(a)
})

test('live updates are atomic, revision checked, world scoped and preserved in saves', () => {
  const world = fixture()
  prepareSpatialWorld(world)
  const snapshot = JSON.stringify(world)
  const invalid = configurationDraft(world)
  invalid.conditions.abundance = 1.2
  invalid.model.bankCount = 7
  assert.throws(() => applyConfiguration(world, invalid, 0), /only be changed/)
  assert.equal(JSON.stringify(world), snapshot)
  const changed = configurationDraft(world)
  changed.model.policyRateMonthly = 0.004
  changed.model.desiredChildrenBase = 0
  changed.model.ruralFamilyMotive = 0
  changed.climate.equatorTemperature = 35
  changed.monetary.target = 0.03
  applyCommand(world, { type: 'configuration', values: changed, revision: 0 })
  assert.equal(world.configuration!.revision, 1)
  assert.equal(world.economy!.banking!.centralBank.rate, 0.004)
  assert.equal(world.economy!.banking!.policy!.target, 0.03)
  assert.throws(() => applyConfiguration(world, changed, 0), /changed while/)
  assert.equal(
    withWorldConfiguration(world, () => MODEL_PARAMETERS.desiredChildrenBase),
    0,
  )
  assert.equal(MODEL_PARAMETERS.desiredChildrenBase, DEFAULT_CONFIGURATION_VALUES.model.desiredChildrenBase)
  assert.throws(
    () =>
      withWorldConfiguration(world, () => {
        throw new Error('scope failure')
      }),
    /scope failure/,
  )
  assert.equal(MODEL_PARAMETERS.desiredChildrenBase, DEFAULT_CONFIGURATION_VALUES.model.desiredChildrenBase)
  tick(world)
  assert.equal(world.totals.births, 0)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(world))))
  assert.deepEqual(restored.configuration, world.configuration)
  tick(restored)
  tick(world)
  assert.deepEqual(restored.totals, world.totals)
  assert.equal(restored.rng, world.rng)
})

test('legacy saves and legacy condition commands retain a coherent configuration', () => {
  const legacy = generateWorld('legacy-config', 3, 4, undefined, 'regional', 'frontier')
  assert.equal(legacy.configuration, undefined)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(legacy))))
  assert.equal(restored.configuration, undefined)
  const world = fixture()
  applyCommand(world, { type: 'conditions', settings: { instability: 0, abundance: 1.2, extremity: 0 } })
  assert.deepEqual(world.configuration!.values.conditions, world.simulation)
  assert.equal(world.configuration!.revision, 1)
})

test('configured age boundaries, terrain and initial policies survive validation', () => {
  const values = configurationDraft()
  values.model.adultAgeMonths = 241
  values.model.retirementAgeMonths = 793
  values.geography.relief = 0.8
  values.geography.moistureOffset = 0.1
  values.starting.policyFromLeaders = false
  values.starting.policies.tax = 12
  values.starting.ai = false
  values.starting.technology.agriculture = 2
  const world = fixture(values)
  assert(
    world.nations.every(
      (nation) => nation.policies.tax === 12 && !nation.ai && nation.technologies.agriculture === 2,
    ),
  )
  prepareSpatialWorld(world)
  validateWorld(world)
  tick(world)
  validateWorld(world)
  assert.equal(world.configuration!.values.model.adultAgeMonths, 241)
})

test('validated parameters are immutable and legacy scopes cannot leak changed values', () => {
  const values = validateConfigurationValues({ model: { desiredChildrenBase: 3 } })
  assert.throws(() => {
    values.model.desiredChildrenBase = 4
  }, TypeError)
  const world = fixture(values)
  const before = MODEL_PARAMETERS.desiredChildrenBase
  const legacy = generateWorld('nested-legacy', 3, 4, undefined, 'regional', 'frontier')
  const cell = legacy.cells.find((cell) => cell.terrain === 'plains')!
  const legacyClimate = localClimate(legacy, cell)
  const warmer = configurationDraft(world)
  warmer.climate.equatorTemperature = 40
  applyConfiguration(world, warmer, world.configuration!.revision)
  withWorldConfiguration(world, () => assert.deepEqual(localClimate(legacy, cell), legacyClimate))
  withWorldConfiguration(world, () =>
    withWorldConfiguration(legacy, () => assert.equal(MODEL_PARAMETERS.desiredChildrenBase, before)),
  )
  withWorldConfiguration(world, () => assert.equal(MODEL_PARAMETERS.desiredChildrenBase, 3))
  assert.equal(MODEL_PARAMETERS.desiredChildrenBase, before)
})

test('editable consumption weights preserve budgets and allow a food-only basket', () => {
  const prices = inventory(1000),
    needs = inventory(1),
    budget = 100
  const demand = (draft: ReturnType<typeof configurationDraft>) => {
    const values = validateConfigurationValues(draft)
    return withWorldConfiguration({ configuration: { version: 1, revision: 0, values } }, () =>
      householdDemand(prices, needs, budget),
    )
  }
  const defaults = configurationDraft(),
    scaled = configurationDraft()
  for (const good of GOODS) scaled.consumptionBudget[good] *= 0.5
  const initial = demand(defaults),
    rescaled = demand(scaled)
  for (const good of GOODS) assert(Math.abs(initial[good] - rescaled[good]) < 1e-10)
  assert(Object.values(rescaled).reduce((sum, amount) => sum + amount, 0) <= budget + 1e-10)

  scaled.consumptionBudget = inventory()
  assert.throws(() => demand(scaled), /positive total/)
  scaled.consumptionBudget.food = 1
  const foodOnly = demand(scaled)
  for (const good of GOODS) assert(Number.isFinite(foodOnly[good]))
  assert(Object.values(foodOnly).reduce((sum, amount) => sum + amount, 0) <= budget)
})

test('rescaling coverage weights changes neither household spending nor measured coverage', () => {
  const original = fixture(),
    rescaled = structuredClone(original)
  const values = configurationDraft(rescaled)
  for (const good of GOODS) values.materialCoverage[good] *= 0.5
  applyConfiguration(rescaled, values, 0)
  withWorldConfiguration(original, () => consumeHouseholds(original))
  withWorldConfiguration(rescaled, () => consumeHouseholds(rescaled))
  for (const region of original.regions) {
    assert(Math.abs(region.materialCoverage - rescaled.regions[region.id].materialCoverage) < 1e-10)
    assert.deepEqual(region.stocks, rescaled.regions[region.id].stocks)
  }
  assert.deepEqual(original.economy?.households, rescaled.economy?.households)
})
