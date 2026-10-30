import { expeditionPeople, expeditionMigration } from '../src/sim/overseas-types'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick, applyCommand, summarize } from '../src/sim/engine'
import { produce, trade, transportGraph } from '../src/sim/economy'
import { parseSave, validateWorld } from '../src/sim/persistence'
import { GOODS, population, relation, type World } from '../src/sim/types'
import { allForces } from '../src/sim/forces'
import { balances, borrow, transfer, beginLedgerMonth } from '../src/sim/ledger'
import { settleCredit } from '../src/sim/macroeconomy'
import { ensureFirms, firmCapacity, regionalFirms } from '../src/sim/firms'

const totalPeople = (w: World) =>
  w.regions.reduce((sum, r) => sum + population(r), 0) +
  allForces(w).reduce((sum, a) => sum + a.soldiers, 0) +
  expeditionPeople(w)
const sumGoods = (w: World, good: (typeof GOODS)[number]) =>
  w.regions.reduce((sum, r) => sum + r.stocks[good], 0)

test('seeded world generation and its evolution are deterministic', () => {
  const a = generateWorld('repeatable'),
    b = generateWorld('repeatable')
  assert.deepEqual(a, b)
  for (let i = 0; i < 18; i++) {
    tick(a)
    tick(b)
  }
  assert.deepEqual(a, b)
  assert.notDeepEqual(a.cells, generateWorld('different').cells)
})

test('every land cell belongs to exactly one valid region and each state has a capital', () => {
  for (const seed of ['archipelago', 'wide continent', 'test']) {
    const w = generateWorld(seed)
    validateWorld(w)
    assert.equal(
      w.regions.reduce((s, r) => s + r.cells.length, 0),
      w.cells.filter((c) => c.terrain !== 'water').length,
    )
    for (const n of w.nations) assert.equal(w.regions[n.capital].nation, n.id)
  }
})

test('monthly births, deaths, recruitment, and migration conserve people', () => {
  const w = generateWorld('population-ledger')
  for (let i = 0; i < 240; i++) {
    const before = totalPeople(w)
    tick(w)
    assert.equal(totalPeople(w), before + w.totals.births - w.totals.deaths, `month ${w.month}`)
    assert.equal(w.regions.reduce((s, r) => s + r.migration, 0) + expeditionMigration(w), 0)
  }
})

test('recruiting transfers working-age civilians into the military and charges resources', () => {
  const w = generateWorld('recruit'),
    n = w.nations[0],
    r = w.regions[n.capital]
  const people = totalPeople(w),
    treasury = n.treasury,
    arms = r.stocks.arms,
    adults = r.population.adults
  applyCommand(w, { type: 'recruit', nation: 0, region: r.id })
  assert.equal(totalPeople(w), people)
  assert(n.treasury < treasury)
  assert(r.stocks.arms < arms)
  assert(r.population.adults < adults)
})

test('trade conserves goods and total account balances and respects shared edge capacity', () => {
  const w = generateWorld('trade-ledger')
  const buyer = w.regions[0],
    seller = w.regions[buyer.neighbors[0]]
  buyer.stocks.food = 0
  seller.stocks.food = population(seller) * 0.5
  const goods = GOODS.map((g) => sumGoods(w, g)),
    treasury = Object.values(balances(w)).reduce((s, value) => s + value, 0)
  const graph = transportGraph(w)
  trade(w)
  GOODS.forEach((g, i) => assert(Math.abs(sumGoods(w, g) - goods[i]) < 0.00001, g))
  assert(Math.abs(Object.values(balances(w)).reduce((s, value) => s + value, 0) - treasury) < 0.00001)
  const used = new Map<string, number>(),
    caps = new Map<string, number>()
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
  graph.forEach((edges, a) => edges.forEach((e) => caps.set(key(a, e.to), e.capacity)))
  for (const r of w.routes)
    for (let i = 1; i < r.path.length; i++) {
      const k = key(r.path[i - 1], r.path[i])
      used.set(k, (used.get(k) ?? 0) + r.volume)
    }
  for (const [k, amount] of used) assert(amount <= (caps.get(k) ?? 0) + 0.00001, k)
})

test('war closes hostile borders to goods and permits only military access', () => {
  const w = generateWorld('border')
  const a = w.regions.find((r) => r.neighbors.some((id) => w.regions[id].nation !== r.nation))!
  const b = w.regions[a.neighbors.find((id) => w.regions[id].nation !== a.nation)!]
  applyCommand(w, { type: 'diplomacy', nation: a.nation, target: b.nation, action: 'war' })
  assert.equal(relation(w, a.nation, b.nation)?.treaty, 'war')
  assert(!transportGraph(w)[a.id].some((e) => e.to === b.id))
  assert(transportGraph(w, a.nation)[a.id].some((e) => e.to === b.id))
})

test('policies change outcomes and investment has a real treasury/material cost', () => {
  const low = generateWorld('policy'),
    high = structuredClone(low)
  applyCommand(low, { type: 'policy', nation: 0, key: 'tax', value: 10 })
  applyCommand(high, { type: 'policy', nation: 0, key: 'tax', value: 40 })
  tick(low)
  tick(high)
  assert(high.nations[0].income > low.nations[0].income)
  const r = low.regions[low.nations[0].capital],
    before = r.infrastructure
  applyCommand(low, { type: 'build', region: r.id, building: 'road' })
  assert(r.infrastructure > before)
  assert.throws(() => applyCommand(low, { type: 'policy', nation: 0, key: 'tax', value: NaN }))
})

test('research eventually unlocks implemented technology effects', () => {
  const w = generateWorld('science')
  applyCommand(w, { type: 'research', nation: 0, field: 'agriculture' })
  applyCommand(w, { type: 'policy', nation: 0, key: 'research', value: 80 })
  let researchReported = false
  for (let i = 0; i < 120; i++) {
    tick(w)
    // The bounded live chronicle can evict a breakthrough before this ten-year run ends.
    researchReported ||= w.events.some((e) => e.type === 'research')
  }
  assert(w.nations[0].technologies.agriculture > 0)
  assert(researchReported)
})

test('save and restore continue the same random stream without divergence', () => {
  const a = generateWorld('round-trip')
  for (let i = 0; i < 20; i++) tick(a)
  const b = parseSave(JSON.stringify(a))
  for (let i = 0; i < 15; i++) {
    tick(a)
    tick(b)
  }
  assert.deepEqual(a, b)
})

test('malformed and unsupported saves are rejected before simulation', () => {
  assert.throws(() => parseSave('not json'))
  assert.throws(() => validateWorld({ version: 5 }))
  for (const mutate of [
    (w: World) => {
      w.regions[0].population.adults = -1
    },
    (w: World) => {
      w.regions[0].nation = 999
    },
    (w: World) => {
      w.nations[0].policies = null as never
    },
    (w: World) => {
      w.armies[0].target = 999999
    },
    (w: World) => {
      w.relations[1] = { ...w.relations[0] }
    },
    (w: World) => {
      w.regions[0].stocks.food = Infinity
    },
  ]) {
    const w = generateWorld('invalid')
    mutate(w)
    assert.throws(() => validateWorld(w))
  }
})

test('a prolonged simulation retains finite nonnegative state and valid save structure', () => {
  const w = generateWorld('centuries')
  for (let i = 0; i < 1200; i++) tick(w)
  summarize(w, false)
  validateWorld(w)
  assert(w.history.length < 250)
  assert(w.nations.some((n) => n.technologies.medicine > 0))
  assert(totalPeople(w) > 0)
})

test('agricultural output is bounded by land even when population grows without bound', () => {
  const w = generateWorld('land-capacity'),
    r = w.regions[0]
  ensureFirms(w)
  const firms = regionalFirms(w, r.id).filter((f) => f.active)
  // Hold financial and product-demand constraints fixed to isolate physical carrying capacity.
  const output = (jobs: number) =>
    firms.reduce((sum, f) => {
      f.employment = jobs / firms.length
      return sum + firmCapacity(w, r, f, firms.length).q.food
    }, 0)
  const first = output(1e8)
  assert(first > 0)
  assert(Math.abs(output(1e9) - first) < 0.001)
})

test('sovereign insolvency restructures debt instead of compounding beyond save limits', () => {
  const w = generateWorld('debt-crisis'),
    n = w.nations[0]
  beginLedgerMonth(w)
  borrow(w, `government:${n.id}`, 1000, 1000)
  transfer(w, `government:${n.id}`, `producer:${n.capital}`, n.treasury, 'exhausted public funds')
  w.economy!.credit.loans.find((l) => l.borrower === `government:${n.id}`)!.arrears = 11
  settleCredit(w)
  assert.equal(n.debt, 350)
  assert(w.events.some((e) => e.title.includes('restructures its debt') && e.nation === n.id))
  assert(n.legitimacy < 72)
  validateWorld(w)
})
