import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { competitivePressure } from '../src/sim/competitive-pressure'
import {
  EXPANSION_PROFILES,
  expansionParameters,
  withExpansionParameters,
} from '../src/sim/expansion-parameters'
import { intelligenceService } from '../src/sim/intelligence'
import { frontierValue } from '../src/sim/territorial-expansion'
import { pioneerExpedition, foundingPlan, advanceFounding } from '../src/sim/founding'
import { prepareSpatialWorld } from '../src/sim/engine'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { auditLedger, balances, householdAccount, transfer } from '../src/sim/ledger'
import { ensureFirms, finishFirms, regionalFirms } from '../src/sim/firms'
import { auditGoods, physicalStocks } from '../src/sim/goods-accounting'
import { GOODS, population } from '../src/sim/types'

const fixture = () => generateWorld('Peer pressure', 3, 8, undefined, 'regional', 'frontier')
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`)

test('reported peer success creates competitive pressure without access to hidden foreign accounts', () => {
  const w = fixture(),
    n = w.nations[0],
    service = intelligenceService(w, 0)
  service.dossiers = []
  service.chart = service.chart.filter((p) => p.nation === 0 || p.nation === -1)
  const unseen = competitivePressure(w, n)
  w.nations[1].gdp *= 1000
  w.nations[1].treasury *= 1000
  assert.deepEqual(competitivePressure(w, n), unseen)
  service.dossiers.push({
    nation: 1,
    name: 'Reported peer',
    discovered: 0,
    access: 0.7,
    expansion: 3,
    economy: {
      month: 0,
      confidence: 1,
      sources: ['trade reports'],
      values: {
        population: { estimate: 2500, low: 2400, high: 2600 },
        output: { estimate: 100, low: 95, high: 105 },
      },
    },
  })
  const reported = competitivePressure(w, n)
  assert(reported.peer > unseen.peer)
  const mild = withExpansionParameters(EXPANSION_PROFILES.economic, () => competitivePressure(w, n))
  const strong = withExpansionParameters(EXPANSION_PROFILES.expansionist, () => competitivePressure(w, n))
  assert(strong.urgency > mild.urgency)
  w.month = 120
  assert(competitivePressure(w, n).peers[0].prosperityGap < reported.peers[0].prosperityGap)
})

test('parameter scopes restore on failure and stronger economic motives increase productive land value', () => {
  const original = expansionParameters(),
    w = fixture(),
    n = w.nations[0]
  const r = w.regions.find((r) => r.nation === -1)!
  const before = withExpansionParameters(EXPANSION_PROFILES.baseline, () => frontierValue(w, n, r))
  const after = withExpansionParameters(EXPANSION_PROFILES.competitive, () => frontierValue(w, n, r))
  assert(after.score > before.score)
  assert.equal(after.cultural, before.cultural)
  assert.throws(() =>
    withExpansionParameters(EXPANSION_PROFILES.expansionist, () => {
      throw new Error('stop')
    }),
  )
  assert.equal(expansionParameters(), original)
})

test('a more assertive frontier still pays for materials, relocates people and respects player control', () => {
  const w = generateWorld('Frontier probe', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  w.nations.forEach((n) => (n.ai = false))
  w.month = 1
  withExpansionParameters(EXPANSION_PROFILES.competitive, () => {
    const expedition = pioneerExpedition()
    const target = w.regions.find(
      (r) =>
        r.nation === -1 &&
        r.neighbors.some((id) => w.regions[id].nation === 0) &&
        (() => {
          try {
            foundingPlan(w, 0, r.center, expedition)
            return true
          } catch {
            return false
          }
        })(),
    )!
    assert(target)
    const cash = w.nations[0].treasury,
      goods = physicalStocks(w)
    const people = w.regions.reduce((sum, r) => sum + population(r), 0)
    const money = Object.values(balances(w)).reduce((a, b) => a + b, 0)
    advanceFounding(w)
    assert.equal(w.regions.filter((r) => r.nation >= 0).length, 8)
    w.nations[0].ai = true
    advanceFounding(w)
    assert.equal(w.regions.filter((r) => r.nation >= 0).length, 9)
    near(w.nations[0].treasury, cash - expedition.cash)
    assert.equal(
      w.regions.reduce((sum, r) => sum + population(r), 0),
      people,
    )
    near(
      Object.values(balances(w)).reduce((a, b) => a + b, 0),
      money,
    )
    for (const good of GOODS)
      near(
        physicalStocks(w)[good],
        goods[good] -
          (['timber', 'stone', 'tools'].includes(good)
            ? expedition[good as 'timber' | 'stone' | 'tools']
            : 0),
      )
    auditLedger(w)
    auditGoods(w)
  })
})

test('coarse frontier reviews account for multiple scheduled decisions without adding resources', () => {
  const w = generateWorld('Frontier probe', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  w.nations.forEach((n) => (n.ai = false))
  w.nations[0].ai = true
  w.month = 6
  const cash = w.nations[0].treasury
  withExpansionParameters(EXPANSION_PROFILES.expansionist, () =>
    withSimulationPeriod(6, () => advanceFounding(w)),
  )
  const founded = w.regions.filter((r) => r.nation === 0).length - 1
  assert(founded >= 1 && founded <= 3)
  near(w.nations[0].treasury, cash - founded * 24)
  auditLedger(w)
  auditGoods(w)
})

test('small pioneer settlements can start businesses only with real local equity', () => {
  const w = generateWorld('Frontier probe', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  ensureFirms(w)
  w.nations.forEach((n) => (n.ai = n.id === 0))
  w.month = 1
  withExpansionParameters(EXPANSION_PROFILES.expansionist, () => advanceFounding(w))
  const camp = w
    .localEconomy!.active.map((id) => w.localEconomy!.units[id])
    .find((r) => r.nation === 0 && population(r) === 120)!
  assert(camp)
  assert.equal(regionalFirms(w, camp.id).length, 0)
  const old = structuredClone(w),
    unfunded = structuredClone(w)
  const owner = householdAccount(camp.id, 'owner')
  transfer(unfunded, owner, 'government:0', balances(unfunded)[owner], 'test withdrawal of local equity')
  withExpansionParameters(EXPANSION_PROFILES.baseline, () => finishFirms(old))
  assert.equal(regionalFirms(old, camp.id).filter((f) => f.active).length, 0)
  withExpansionParameters(EXPANSION_PROFILES.expansionist, () => finishFirms(unfunded))
  assert.equal(regionalFirms(unfunded, camp.id).filter((f) => f.active).length, 0)
  const money = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  withExpansionParameters(EXPANSION_PROFILES.expansionist, () => finishFirms(w))
  const firm = regionalFirms(w, camp.id).find((f) => f.active)
  assert(firm)
  assert(firm.cash >= EXPANSION_PROFILES.expansionist.enterpriseEquity && firm.cash < 1)
  const subscription = w.economy!.ledger.entries.find(
    (entry) =>
      entry.from === owner &&
      entry.to === `firm:${firm.id}` &&
      entry.category === 'entrepreneur equity subscription',
  )
  assert(subscription)
  near(subscription.amount, firm.cash)
  near(
    Object.values(balances(w)).reduce((a, b) => a + b, 0),
    money,
  )
  auditLedger(w)
  auditGoods(w)
})
