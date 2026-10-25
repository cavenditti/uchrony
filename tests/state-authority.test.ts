import { endowTreasury } from './fixtures/endowment'
import { extractAges } from '../src/sim/age-cohorts'
import { balances } from '../src/sim/ledger'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick, summarize } from '../src/sim/engine'
import { ensureWarfare } from '../src/sim/navy'
import {
  releaseSoldiers,
  ageMilitaryPopulation,
  rollupPopulation,
  takeCivilianAdults,
  addCommunity,
  communitySize,
} from '../src/sim/population'
import { initializeEstablishments, reinforceArmies } from '../src/sim/military-personnel'
import { advanceSovereignty, authoritySummary, ensureSovereignty } from '../src/sim/sovereignty'
import { ensureStatecraft, stateAgentContext } from '../src/sim/statecraft'
import { validateWorld } from '../src/sim/persistence'
import { allForces } from '../src/sim/forces'
import { population, type World } from '../src/sim/types'
const people = (w: World) =>
  w.regions.reduce((s, r) => s + population(r), 0) + allForces(w).reduce((s, a) => s + a.soldiers, 0)
const funds = (w: World) => Object.values(balances(w)).reduce((s, value) => s + value, 0)
function funded() {
  const w = generateWorld('standing-replacements')
  ensureStatecraft(w)
  ensureWarfare(w)
  for (const n of w.nations) {
    endowTreasury(w, n.id, 100000)
    n.budget.military = 500
    n.policies.military = 50
    n.policies.conscription = 3
  }
  for (const r of w.regions) {
    r.foodCoverage = 1
    r.unrest = 10
    r.stocks.food = population(r) * 0.3
    r.stocks.arms = 1000
  }
  for (const a of w.armies) {
    a.supply = 1
    a.operations!.food = a.soldiers * 0.1
    a.operations!.stance = 'hold'
  }
  return w
}
test('a depleted legacy formation gets gradual funded replacements with conserved civilian and military people', () => {
  const w = funded(),
    a = w.armies[0],
    r = w.regions[a.region]
  releaseSoldiers(w, a, r, a.soldiers - 10)
  delete a.establishment
  const before = people(w),
    adults = r.population.adults,
    treasury = w.nations[a.nation].treasury,
    arms = r.stocks.arms
  reinforceArmies(w)
  assert(a.soldiers > 10 && a.soldiers <= 130)
  assert.equal(a.establishment, 3000)
  assert.equal(people(w), before)
  assert.equal(adults - r.population.adults, a.replacements)
  assert(w.nations[a.nation].treasury < treasury)
  assert(r.stocks.arms < arms)
  summarize(w, false)
  validateWorld(w)
})
test('ordinary retirement and mortality no longer inexorably erase a supplied standing army', () => {
  const w = funded(),
    before = people(w),
    initial = w.armies[0].soldiers
  let deaths = 0
  for (let i = 0; i < 36; i++) {
    w.month++
    w.totals.deaths = 0
    ageMilitaryPopulation(w)
    deaths += w.totals.deaths
    reinforceArmies(w)
  }
  assert(w.armies[0].soldiers >= initial * 0.95)
  assert.equal(people(w), before - deaths)
  summarize(w, false)
  validateWorld(w)
})
test('replacement personnel require real funds, arms, food and local access', () => {
  const w = funded(),
    a = w.armies[0],
    r = w.regions[a.region]
  releaseSoldiers(w, a, r, a.soldiers - 100)
  initializeEstablishments(w)
  a.establishment = 3000
  const before = people(w)
  r.stocks.arms = 0
  reinforceArmies(w)
  assert.equal(a.soldiers, 100)
  r.stocks.arms = 100
  endowTreasury(w, a.nation, 0)
  reinforceArmies(w)
  assert.equal(a.soldiers, 100)
  assert.equal(people(w), before)
})
function crisis() {
  const w = generateWorld('organized-challenge')
  ensureStatecraft(w)
  ensureWarfare(w)
  w.month = 20
  const r =
    w.regions.find(
      (r) =>
        r.nation === 0 &&
        r.id !== w.nations[0].capital &&
        r.neighbors.every((id) => !w.armies.some((a) => a.region === id)),
    ) ?? w.regions.find((r) => r.nation === 0 && r.id !== w.nations[0].capital)!
  for (const a of w.armies.filter((a) => a.nation === 0)) {
    releaseSoldiers(w, a, w.regions[a.region], a.soldiers)
    a.operations!.food = 0
    a.operations!.arms = 0
  }
  w.armies = w.armies.filter((a) => a.soldiers > 0)
  const movement = r.communities![0].movement
  for (const group of r.communities!) {
    group.movement = movement
    group.grievance = 0.95
    group.loyalty = 0.1
    group.rootedness = 0.95
  }
  // Two distinct allegiances converge on the successor: both civilian and guard profiles must coalesce.
  const original = r.communities![0],
    parallel = extractAges(original, {
      children: Math.floor(original.population.children / 3),
      adults: Math.floor(original.population.adults / 3),
      elders: Math.floor(original.population.elders / 3),
    })
  parallel.allegiance = 1
  r.communities!.push(parallel)
  r.unrest = 95
  r.foodCoverage = 0.6
  r.materialCoverage = 0.3
  r.stocks.arms = 100
  r.stocks.tools = 100
  r.stocks.timber = 100
  rollupPopulation(r)
  w.nations[0].legitimacy = 10
  w.nations[0].stability = 10
  ensureSovereignty(w).provinces.push({
    region: r.id,
    nation: 0,
    since: 0,
    protection: 0.05,
    neglect: 8,
    contested: 0,
    movement,
    organization: 0.9,
    support: 0.85,
    mobilizable: 0,
    loyalStrength: 0,
    stage: 'organizing',
    warned: 0,
  })
  summarize(w, false)
  return { w, r }
}
test('organized opposition gives warning, then secedes with real supporters, equipment and conserved funds', () => {
  const { w, r } = crisis(),
    old = r.nation,
    count = w.nations.length,
    before = people(w),
    money = funds(w)
  advanceSovereignty(w)
  assert.equal(r.nation, old)
  assert.equal(w.sovereignty!.provinces.find((p) => p.region === r.id)!.stage, 'contested')
  const context = stateAgentContext(w, old, true)
  assert(context.strategicLandscape.authority.contested > 0)
  assert(context.strategicLandscape.authority.emergencies.some((e) => /near-term/.test(e.warning)))
  w.month++
  advanceSovereignty(w)
  assert.equal(r.nation, old)
  w.month++
  advanceSovereignty(w)
  assert.notEqual(r.nation, old)
  assert.equal(w.nations.length, count + 1)
  assert(w.armies.some((a) => a.nation === r.nation && a.region === r.id && a.soldiers >= 75))
  assert.equal(people(w), before)
  assert(Math.abs(funds(w) - money) < 1e-6)
  summarize(w, false)
  validateWorld(w)
})
test('an organized resistance can restore its former state without allocating a new sovereign identity', () => {
  const { w, r } = crisis(),
    count = w.nations.length
  r.occupation = { former: 1, since: 0, resistance: 0.9, settled: 0 }
  for (const g of r.communities!) g.allegiance = 1
  rollupPopulation(r)
  const before = people(w)
  for (let i = 0; i < 3; i++) {
    advanceSovereignty(w)
    w.month++
  }
  assert.equal(r.nation, 1)
  assert.equal(r.occupation, undefined)
  assert.equal(w.nations.length, count)
  assert.equal(people(w), before)
  summarize(w, false)
  validateWorld(w)
})
test('restored credible protection stops a pending organized challenge', () => {
  const { w, r } = crisis(),
    report = w.sovereignty!.provinces[0]
  advanceSovereignty(w)
  assert.equal(report.stage, 'contested')
  const protector = w.armies.find((a) => a.nation === 1)!
  // Uneven province sizes can produce an opposition larger than the opening guard.
  // Make protection credible using actual civilians, rather than assuming a fixed guard suffices.
  const source = w.regions
    .filter((p) => p.nation === 1)
    .sort((a, b) => b.population.adults - a.population.adults)[0]
  const recruits = takeCivilianAdults(w, source, Math.max(0, report.mobilizable * 2 - protector.soldiers))
  for (const group of recruits) addCommunity(protector.communities!, group)
  protector.soldiers += recruits.reduce((sum, group) => sum + communitySize(group), 0)
  protector.nation = 0
  protector.region = r.id
  protector.supply = 1
  protector.morale = 1
  protector.operations!.loyalty = 1
  const count = w.nations.length
  for (let i = 0; i < 5; i++) {
    w.month++
    advanceSovereignty(w)
  }
  assert.equal(r.nation, 0)
  assert.equal(w.nations.length, count)
  assert.equal(report.contested, 0)
})
test('no organization means no magical breakup even in an unhappy province', () => {
  const { w, r } = crisis(),
    report = w.sovereignty!.provinces[0]
  report.organization = 0.05
  report.support = 0.1
  const count = w.nations.length
  for (let i = 0; i < 2; i++) {
    w.month++
    advanceSovereignty(w)
  }
  assert.equal(r.nation, 0)
  assert.equal(w.nations.length, count)
})
test('an external force already present can gain control through a local organized challenge', () => {
  const { w, r } = crisis(),
    foreign = w.armies.find((a) => a.nation === 1)!
  foreign.region = r.id
  foreign.supply = 1
  foreign.morale = 1
  foreign.operations!.loyalty = 1
  const rel = w.relations.find((rel) => rel.a === 0 && rel.b === 1)!
  rel.treaty = 'war'
  const before = people(w),
    money = funds(w)
  for (let i = 0; i < 3; i++) {
    w.month++
    advanceSovereignty(w)
  }
  assert.equal(r.nation, 1)
  assert.equal(people(w), before)
  assert(Math.abs(funds(w) - money) < 1e-6)
  summarize(w, false)
  validateWorld(w)
})
test('new authority and military establishment persist through exact continuation and reject forged state', () => {
  const w = funded()
  for (let i = 0; i < 4; i++) {
    const before = people(w)
    tick(w)
    assert.equal(people(w), before + w.totals.births - w.totals.deaths)
  }
  const copy = structuredClone(validateWorld(w))
  tick(w)
  tick(copy)
  assert.deepEqual(w, copy)
  const bad = structuredClone(w)
  bad.sovereignty!.provinces[0].organization = 5
  assert.throws(() => validateWorld(bad))
})
