import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfigurationEditor, InitialCashControl } from '../src/components/ConfigurationEditor'
import { configurationDraft, applyConfiguration, validateConfigurationValues } from '../src/sim/configuration'
import { CONFIGURATION_FIELDS, setConfigurationValue } from '../src/sim/configuration-schema'
import { searchConfigurationGroups } from '../src/sim/configuration-search'
import { generateWorld } from '../src/sim/generate'

const paths = (query: string, live = false) =>
  searchConfigurationGroups(query, live).flatMap(({ fields }) => fields.map(({ path }) => path))

test('search matches tags, full help, units, paths and option values', () => {
  assert(CONFIGURATION_FIELDS.every(({ tags }) => tags.length >= 3))
  assert(paths('starting money').includes('starting.treasury'))
  assert(paths('treasury').includes('starting.settledTreasury'))
  assert(paths('salary').includes('wageSkills.laborer'))
  assert(paths('layoffs').includes('model.jobSeparationMonthly'))
  assert(paths('deaths babies').includes('model.infantHazardAnnual'))
  assert(paths('Later spending can reduce it').includes('starting.treasury'))
  assert(paths('thousand crowns').includes('starting.treasury'))
  assert.deepEqual(paths('starting.settledTreasury'), ['starting.settledTreasury'])
  assert(paths('pasture').includes('climate.crops.polar'))
})

test('search is case-insensitive, ignores extra whitespace and matches all terms across metadata', () => {
  // The established-state help also mentions frontier cash, so both are relevant.
  assert.deepEqual(paths('  MONEY\tFRONTIER\n'), ['starting.treasury', 'starting.settledTreasury'])
  assert.deepEqual(paths('frontier money'), paths('money frontier'))
  assert.deepEqual(paths('money nonexistent-parameter'), [])
  assert.deepEqual(
    paths('  '),
    CONFIGURATION_FIELDS.map(({ path }) => path),
  )
  assert.deepEqual(paths('nonexistent-parameter'), [])
})

test('search includes generated matrix descriptions and preserves live visibility', () => {
  assert(paths('assigned freezing wet').includes('climate.matrix.freezing.wet'))
  assert(!paths('assigned freezing wet').includes('climate.matrix.hot.wet'))
  assert.deepEqual(paths('starting money', true), [])
  assert(paths('bankCount', true).includes('model.bankCount'))
  assert(!searchConfigurationGroups('', true).some(({ key }) => key === 'starting' || key === 'geography'))
})

test('basic cash control selects the scenario value and shares advanced validation bounds', () => {
  const values = configurationDraft()
  values.starting.treasury = 1234
  values.starting.settledTreasury = 5678
  for (const [start, amount] of [
    ['frontier', 1234],
    ['settled', 5678],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(InitialCashControl, { value: values, start, onChange: () => {} }),
    )
    assert.match(html, /Initial cash per state/)
    assert.match(html, new RegExp(`value="${amount}"`))
    assert.match(html, /min="0" max="1000000000" step="any"/)
    assert.match(html, /thousand crowns/)
  }
  const live = renderToStaticMarkup(
    createElement(ConfigurationEditor, { value: values, onChange: () => {}, live: true }),
  )
  assert.match(live, /Initial cash per state is set in World menu/)
  assert(!live.includes('Initial cash per frontier state'))
})

test('initial cash edits reach each state, allow zero and cannot rewrite a running treasury', () => {
  for (const [start, key, amount] of [
    ['frontier', 'treasury', 0],
    ['settled', 'settledTreasury', 1234.5],
  ] as const) {
    const values = setConfigurationValue(configurationDraft(), `starting.${key}`, amount)
    const world = generateWorld('initial-cash-control', 3, 4, undefined, 'regional', start, values)
    assert(world.nations.every(({ treasury }) => treasury === amount))
    const changed = setConfigurationValue(values, `starting.${key}`, amount + 1)
    assert.throws(() => applyConfiguration(world, changed, 0), /only be changed when creating a world/)
    assert(world.nations.every(({ treasury }) => treasury === amount))
    assert.throws(() => validateConfigurationValues(setConfigurationValue(values, `starting.${key}`, -1)))
    assert.throws(() => validateConfigurationValues(setConfigurationValue(values, `starting.${key}`, NaN)))
    assert.throws(() =>
      validateConfigurationValues(setConfigurationValue(values, `starting.${key}`, 1e9 + 1)),
    )
    assert.equal(
      validateConfigurationValues(setConfigurationValue(values, `starting.${key}`, 1e9)).starting[key],
      1e9,
    )
  }
})
