import { fundedUrbanFixture } from './fixtures/funded-urban-evolution'
import test from 'node:test'
import assert from 'node:assert/strict'
import { urbanFixture } from './fixtures/urban-evolution'
import { ensureUrbanFabric, validateUrbanFabric } from '../src/sim/urban-fabric'
import { planUrbanRenewal } from '../src/sim/urban-renewal'
import { fundUrbanProject } from '../src/sim/urban-projects'
import { advanceUrbanConstruction } from '../src/sim/urban-construction'
import { urbanMetrics } from '../src/sim/urban-metrics'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { generateWorld } from '../src/sim/generate'
import { ensureDistrictEconomy } from '../src/sim/districts'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { balances, auditLedger } from '../src/sim/ledger'
import { auditBanks } from '../src/sim/banking'
import { physicalStocks, auditGoods } from '../src/sim/goods-accounting'
import { reconcileGDP, auditNationalAccounts } from '../src/sim/national-accounts'

test('all five renewal choices have real geometry and staged capacity', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  for (const kind of ['repair', 'extend', 'convert', 'replace', 'consolidate'] as const) {
    const p = planUrbanRenewal(
      w,
      sites[0],
      kind,
      kind === 'convert' ? 'market' : 'housing',
      kind === 'consolidate' ? sites[1] : undefined,
    )
    assert.ok(p, kind)
    assert.ok(p.inputs.labor > 0 && p.inputs.timber > 0)
    assert.equal(p.status, 'proposed')
    if (kind === 'convert') assert.ok(p.after[0].fabric.uses.market > 0)
    if (kind === 'consolidate') assert.equal(p.after[0].capacity, 16)
  }
})

test('unaffordable projects and occupied cities without spare accommodation are unchanged', () => {
  const { w, sites } = fundedUrbanFixture()
  const project = planUrbanRenewal(w, sites[0], 'replace')!
  w.localEconomy!.units[0].stocks.timber = 0
  const before = JSON.stringify(w)
  assert.equal(fundUrbanProject(w, project, 1), false)
  assert.equal(JSON.stringify(w), before)
  w.localEconomy!.units[0].stocks.timber = 1000
  for (const s of sites) s.residents = s.capacity
  const full = JSON.stringify(w)
  assert.equal(fundUrbanProject(w, project, 1), false)
  assert.equal(JSON.stringify(w), full)
})

test('replacement conserves residents, consumes materials, pays workers and survives a save', () => {
  const { w, sites } = fundedUrbanFixture()
  const p = planUrbanRenewal(w, sites[0], 'replace')!
  const people = urbanMetrics(w).residents,
    stocks = w.localEconomy!.units[0].stocks.timber
  const money = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  assert.equal(fundUrbanProject(w, p, 1), true)
  assert.equal(sites[0].capacity, 0)
  assert.equal(sites[0].residents, 0)
  assert.equal(urbanMetrics(w).residents, people)
  assert.equal(w.localEconomy!.units[0].stocks.timber, stocks - p.inputs.timber)
  assert.ok(Math.abs(Object.values(balances(w)).reduce((a, b) => a + b, 0) - money) < 1e-6)
  validateUrbanFabric(w)
  const restored = JSON.parse(JSON.stringify(w))
  for (const world of [w, restored]) {
    world.month += 6
    advanceUrbanConstruction(world)
    validateUrbanFabric(world)
  }
  assert.deepEqual(restored.adaptive, w.adaptive)
  assert.equal(urbanMetrics(w).residents, people)
  assert.equal(sites[0].residents, 4)
})

test('calendar completion agrees at monthly and six-month integration intervals', () => {
  const { w, sites } = fundedUrbanFixture()
  assert.ok(fundUrbanProject(w, planUrbanRenewal(w, sites[0], 'replace')!, 1))
  const coarse = structuredClone(w)
  for (let m = 0; m < 6; m++) {
    w.month++
    advanceUrbanConstruction(w)
  }
  withSimulationPeriod(6, () => {
    coarse.month += 6
    advanceUrbanConstruction(coarse)
  })
  assert.deepEqual(coarse.adaptive, w.adaptive)
})

test('urban funding reconciles the complete goods, money and national accounts', () => {
  const w = generateWorld('Urban capital accounts')
  ensureDistrictEconomy(w)
  const physical = urbanFixture()
  w.adaptive = physical.w.adaptive
  // Move the prescribed building into one real market's land. It retains a real
  // footprint but these checks focus on accounting, not generated geography.
  const cell = w.cells.find((c) => c.region === 0 && c.terrain === 'plains')!
  assert.ok(cell)
  const site = physical.sites[0]
  const x = ((cell.id % w.width) + 0.5) * 1024,
    y = (Math.floor(cell.id / w.width) + 0.5) * 1024
  const dx = x - site.x,
    dy = y - site.y
  site.x = x
  site.y = y
  site.cell = cell.id
  site.parcel!.x += dx
  site.parcel!.y += dy
  site.building = site.building!.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  w.adaptive!.sites = { [site.id]: site }
  w.adaptive!.lanes = []
  ensureUrbanFabric(w)
  for (const h of Object.values(w.economy!.households[0])) {
    h.laborForce = 1000
    h.employed = 0
  }
  beginEconomyMonth(w)
  for (const h of Object.values(w.economy!.households[0])) {
    h.laborForce = 1000
    h.employed = 0
  }
  const before = physicalStocks(w)
  const project = planUrbanRenewal(w, site, 'repair')!
  assert.ok(project)
  assert.ok(fundUrbanProject(w, project, 1))
  reconcileGDP(w)
  auditGoods(w)
  auditLedger(w)
  auditBanks(w)
  auditNationalAccounts(w)
  assert.ok(Math.abs(physicalStocks(w).timber - before.timber + project.inputs.timber) < 1e-6)
})
