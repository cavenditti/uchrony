import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { divideStock } from '../src/sim/district-allocation'
import {
  clearProducerAssets,
  distributeProducerAssets,
  transferAccountPartitions,
} from '../src/sim/district-assets'
import { STRATA } from '../src/sim/economic-types'
import { advanceCoarsePeriod, applyCommand, prepareSpatialWorld, tick } from '../src/sim/engine'
import { generateWorld } from '../src/sim/generate'
import { accountAddress, auditLedger, balance, setBalance, stratumPeople } from '../src/sim/ledger'
import {
  controlRevision,
  establishControl,
  maintainControl,
  transferSovereignty,
} from '../src/sim/military-control'
import { navalEncounterPath } from '../src/sim/navy'
import {
  finiteNumber,
  integerAtMost,
  integerValidator,
  numberAtMost,
  numberValidator,
  recordValue,
  textValidator,
  validationFailure,
  worldValidators,
} from '../src/sim/persistence-primitives'
import { POLICY_RULES, policyCommandValue, validSavedPolicy } from '../src/sim/policy-rules'
import { peopleByStratum } from '../src/sim/population'
import { musterArmy } from '../src/sim/recruitment'
import { encodeSaveBlock, packWorldSave, unpackWorldSave } from '../src/sim/save-codec'
import { commitSettlementTrialWorld, createSettlementTrialWorld } from '../src/sim/settlement-trial'
import { bordering, nationRegions, territorialIndex } from '../src/sim/territory-index'
import { tradePolicy } from '../src/sim/trade-policy'
import { GOODS, inventory, population, relation, type Policies, type World } from '../src/sim/types'
import { rebaseEndowments } from './fixtures/endowment'
import { canonicalHash } from './fixtures/world-hash'

const initial = generateWorld('refactor-units', 3, 4, undefined, 'regional')
const fixture = () => structuredClone(initial)
const near = (a: number, b: number) =>
  assert(Math.abs(a - b) < 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`)

test('phase indexes match scan order and refresh after ownership, replacement and extinction', () => {
  const w = fixture(),
    index = territorialIndex(w)
  for (const n of w.nations) {
    assert.deepEqual(index.regions(n.id), nationRegions(w, n.id))
    for (const other of w.nations) assert.equal(index.bordering(n.id, other.id), bordering(w, n.id, other.id))
  }
  const r = w.regions[w.nations[0].capital]
  transferSovereignty(w, r.id, 1)
  assert(territorialIndex(w).regions(1).includes(r))
  for (const region of w.regions) if (region.nation === 0) region.nation = -1
  assert.equal(territorialIndex(w).alive(0), false)
  assert(territorialIndex(w).regions(-1).length)
  assert.equal(territorialIndex(structuredClone(w)).alive(0), false)
})

test('shared policy metadata retains command limits and wider configured/save domains', () => {
  const w = fixture()
  for (const key of Object.keys(POLICY_RULES) as (keyof Policies)[]) {
    const rule = POLICY_RULES[key]
    if (rule.kind === 'number') {
      assert.equal(policyCommandValue(key, -100), rule.commandMin)
      assert.equal(policyCommandValue(key, 200), rule.commandMax)
      assert(validSavedPolicy(key, rule.min))
      assert(validSavedPolicy(key, rule.max))
      for (const value of [NaN, Infinity, -Infinity, '40'])
        assert.throws(() => policyCommandValue(key, value))
      assert(!validSavedPolicy(key, rule.min - 1))
      assert(!validSavedPolicy(key, rule.max + 1))
      applyCommand(w, { type: 'policy', nation: 0, key, value: 200 })
      assert.equal(w.nations[0].policies[key], rule.commandMax)
    } else {
      for (const value of rule.options) assert.equal(policyCommandValue(key, value), value)
      assert.throws(() => policyCommandValue(key, 'unsupported'))
      assert.equal(validSavedPolicy(key, undefined), 'optional' in rule)
    }
  }
  assert.throws(() => applyCommand(w, { type: 'toString' } as never), /Unknown simulation command/)
  assert.throws(
    () => applyCommand(w, { type: 'policy', nation: 0, key: '__proto__', value: 1 } as never),
    /Unknown policy/,
  )
})

test('shared tariff tables preserve bilateral, institutional and unclaimed-market rules', () => {
  const w = fixture()
  w.nations[0].policies.tariff = 30
  relation(w, 0, 1)!.treaty = 'neutral'
  let policy = tradePolicy(w)
  assert.equal(policy.tariff(0, 1), 0.3)
  assert.equal(policy.tariff(0, 0), 0)
  assert.equal(policy.tariff(-1, 0), 0)
  assert.equal(policy.tariff(0, -1), 0.3)
  relation(w, 0, 1)!.treaty = 'trade'
  policy = tradePolicy(w)
  assert.equal(policy.tariff(0, 1), 0)
  assert.equal(policy.treaty(1, 0), 'trade')
  w.institutions = {
    organizations: [{ status: 'active', charter: { powers: ['trade'] }, members: [0, 2] }],
  } as World['institutions']
  assert.equal(tradePolicy(w).tariff(0, 2), 0)
})

test('one-pass stratum totals and cached account addresses follow current holders', () => {
  const w = fixture(),
    r = w.regions[0],
    counts = peopleByStratum(r.communities!)
  for (const stratum of STRATA) assert.equal(counts[stratum], stratumPeople(w, r.id, stratum))
  assert.deepEqual(peopleByStratum([]), Object.fromEntries(STRATA.map((s) => [s, 0])))
  const address = accountAddress(w, 'producer:0')
  assert.equal(address, accountAddress(w, 'producer:0'))
  w.economy!.producers[0] = { ...w.economy!.producers[0], cash: 37 }
  assert.equal(balance(w, 'producer:0'), 37)
  assert.equal(accountAddress(w, 'household:0:owner').group, 'owner')
  assert.equal(accountAddress(w, 'government:0').field, 'treasury')
})

test('producer partitions conserve extensive assets and project commitments, retaining intensive prices', () => {
  const original = structuredClone(initial.economy!.producers[0])
  original.capital = 17
  original.sales = 19
  original.planned = inventory(23)
  original.projects = [{ capital: 29, cost: 31, remaining: 4 }] as typeof original.projects
  const targets = [structuredClone(original), structuredClone(original)]
  for (const target of targets) clearProducerAssets(target)
  distributeProducerAssets(original, targets, [1, 2])
  near(
    targets.reduce((s, p) => s + p.capital, 0),
    17,
  )
  near(
    targets.reduce((s, p) => s + p.sales, 0),
    19,
  )
  for (const good of GOODS)
    near(
      targets.reduce((s, p) => s + p.planned[good], 0),
      23,
    )
  near(
    targets.reduce((s, p) => s + p.projects[0].cost, 0),
    31,
  )
  near(
    targets.reduce((s, p) => s + p.projects[0].capital, 0),
    29,
  )
  assert(targets.every((p) => p.wage === original.wage && p.cash === original.cash))
  assert.deepEqual(divideStock(7, [0, 0]), [3.5, 3.5])
})

test('overlapping asset partitions use opening balances and preserve loan terms and equity totals', () => {
  const w = fixture(),
    e = w.economy!
  setBalance(w, 'producer:0', 100)
  setBalance(w, 'producer:1', 80)
  const bank = e.banking!.banks[0]
  bank.owners = { 'producer:0': 10, 'producer:1': 20 }
  e.credit.loans = [
    {
      id: 1,
      borrower: 'producer:0',
      principal: 40,
      arrears: 2,
      originated: 0,
      bank: 0,
      rate: 0.003,
      contract: 7,
    },
  ]
  e.credit.nextId = 2
  rebaseEndowments(w)
  transferAccountPartitions(w, [
    { from: 'producer:0', recipients: ['producer:0', 'producer:1'], weights: [1, 1], cash: 100 },
    { from: 'producer:1', recipients: ['producer:0', 'producer:1'], weights: [1, 3], cash: 80 },
  ])
  near(balance(w, 'producer:0'), 70)
  near(balance(w, 'producer:1'), 110)
  near(
    Object.values(bank.owners).reduce((a, b) => a + b, 0),
    30,
  )
  assert.equal(
    e.credit.loans.reduce((s, l) => s + l.principal, 0),
    40,
  )
  assert(e.credit.loans.every((l) => l.rate === 0.003 && l.arrears === 2 && l.contract === 7))
  assert.equal(new Set(e.credit.loans.map((l) => l.id)).size, 2)
  auditLedger(w)
})

test('controller revisions change only with effective control and require no region scan', () => {
  const w = fixture(),
    r = w.regions[w.nations[0].capital]
  relation(w, 0, 1)!.treaty = 'war'
  const before = controlRevision(w)
  establishControl(w, r.id, 1)
  assert.equal(controlRevision(w), before + 1)
  establishControl(w, r.id, 1)
  assert.equal(controlRevision(w), before + 1)
  w.armies = []
  maintainControl(w)
  assert.equal(controlRevision(w), before + 2)
  transferSovereignty(w, r.id, 1)
  assert.equal(controlRevision(w), before + 3)
  assert.equal(controlRevision(structuredClone(w)), 0)
  w.regions = new Proxy(w.regions, {
    get() {
      throw new Error('revision scanned regions')
    },
  })
  for (let i = 0; i < 100; i++) assert.equal(controlRevision(w), before + 3)
})

test('naval proximity rejects distant pairs before searching and respects diagonal/blocked paths', () => {
  const w = {
    width: 5,
    height: 3,
    cells: Array.from({ length: 15 }, (_, id) => ({
      id,
      x: (id % 5) * 20,
      y: Math.floor(id / 5) * 20,
      terrain: 'water',
      elevation: 0,
    })),
  } as World
  // Actual grid units are imported below through the fixture's coordinate spacing.
  const spacing = initial.cells[1].x - initial.cells[0].x
  w.cells.forEach((c, id) => {
    c.x = (id % 5) * spacing
    c.y = Math.floor(id / 5) * spacing
  })
  assert.deepEqual(navalEncounterPath(w, 0, 6), [0, 6])
  let reads = 0
  w.cells = new Proxy(w.cells, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  assert.deepEqual(navalEncounterPath(w, 0, 4), [])
  assert.equal(reads, 2)
  w.cells[1].terrain = 'plains'
  w.cells[5].terrain = 'plains'
  assert.deepEqual(navalEncounterPath(w, 0, 6), [])
})

test('shared muster transfers real civilians, supplies and funds for each formation profile', () => {
  for (const kind of ['corps', 'reserve', 'levy']) {
    const w = fixture(),
      r = w.regions[w.nations[0].capital],
      before = population(r),
      cash = w.nations[0].treasury,
      arms = r.stocks.arms,
      food = r.stocks.food
    const force = musterArmy(w, r, {
      nation: 0,
      name: kind,
      soldiers: 50,
      establishment: 60,
      morale: 0.5,
      supply: 0.7,
      experience: 0.02,
      armsPerSoldier: kind === 'levy' ? 0.002 : 0.012,
      foodPerSoldier: kind === 'reserve' ? 0.06 : 0,
      expense: kind === 'levy' ? undefined : { amount: 1, category: 'recruitment test' },
      requisition: kind === 'levy',
      stance: 'entrench',
    })
    assert.equal(population(r) + force.soldiers, before)
    near(w.nations[0].treasury, cash - (kind === 'levy' ? 0 : 1))
    near(r.stocks.arms, arms - 50 * (kind === 'levy' ? 0.002 : 0.012))
    near(r.stocks.food, food - (kind === 'reserve' ? 3 : 0))
    assert.equal(force.operations!.food, kind === 'reserve' ? 3 : 0)
    assert.equal(force.operations!.stance, 'entrench')
    auditLedger(w)
  }
})

test('settlement trials isolate financial and territorial writes until commit', () => {
  const w = fixture()
  prepareSpatialWorld(w)
  const before = canonicalHash(w),
    trial = createSettlementTrialWorld(w, true)
  trial.nations[0].treasury -= 1
  trial.economy!.credit.cash += 1
  trial.regions[0].communities![0].population.adults -= 1
  trial.localEconomy!.units[0].stocks.food -= 1
  assert.equal(canonicalHash(w), before)
  assert.equal(trial.regions[0].stocks, trial.localEconomy!.units[0].stocks)
  commitSettlementTrialWorld(w, trial)
  assert.equal(w.nations, trial.nations)
  assert.equal(w.economy, trial.economy)
  const ordinary = createSettlementTrialWorld(w, false)
  assert.equal(ordinary.regions, w.regions)
  assert.notEqual(ordinary.nations[0], w.nations[0])
  assert.notEqual(ordinary.economy!.banking, w.economy!.banking)
})

test('validation primitives preserve bounds, noncoercion, safe IDs, text emptiness and world references', () => {
  for (const value of [NaN, Infinity, -Infinity, '1', null, undefined]) assert(!finiteNumber(value))
  assert(numberValidator(0, 1)(1))
  assert(!numberValidator(0, 1)(2))
  assert(numberAtMost(10)(9))
  assert(integerValidator(-1, 10)(-1))
  assert(!integerValidator(0, 10)(1.2))
  assert(!integerAtMost(Infinity, true)(Number.MAX_SAFE_INTEGER + 1))
  assert(integerAtMost(Infinity)(Number.MAX_SAFE_INTEGER + 1))
  assert(textValidator(3)(''))
  assert(!textValidator(3, 1)(''))
  assert(!textValidator(3)('four'))
  assert(recordValue({}))
  assert(!recordValue([]))
  assert(!recordValue(null))
  assert.throws(() => validationFailure('Bad: ', '.', 'record')(), /^Error: Bad: record\.$/)
  const w = fixture(),
    v = worldValidators(w)
  assert(v.nationId(0))
  assert(!v.nationId(w.nations.length))
  assert(!v.regionId(-1))
  assert(!v.cellId(1.1))
  assert(v.inventory(inventory(1)))
  assert(!v.inventory({ ...inventory(), food: NaN }))
  assert(!v.unit(1.1))
})

test('adaptive v1 table encoding stays compatible and rejects duplicate or oversized records', () => {
  const w = fixture()
  prepareSpatialWorld(w)
  const packed = packWorldSave(w) as {
    adaptive: { encoding: string; sites: unknown[]; commutingRows?: unknown; keys?: string[] }
  }
  assert.equal(packed.adaptive.encoding, 'adaptive-blocks-v1')
  assert.equal(canonicalHash(unpackWorldSave(packed) as World), canonicalHash(w))
  const legacy = structuredClone(packed)
  delete legacy.adaptive.keys
  delete legacy.adaptive.commutingRows
  assert(Array.isArray((unpackWorldSave(legacy) as World).adaptive!.commutingRows))
  const duplicate = structuredClone(packed)
  duplicate.adaptive.sites = [
    encodeSaveBlock([
      ['duplicate', {}],
      ['duplicate', {}],
    ]),
  ]
  assert.throws(() => unpackWorldSave(duplicate), /record identities/)
  const oversized = structuredClone(packed)
  oversized.adaptive.sites = [encodeSaveBlock(Array.from({ length: 4097 }, (_, i) => [String(i), {}]))]
  assert.throws(() => unpackWorldSave(oversized), /save block/)
})

test('cabinet planning preserves deterministic settled/frontier monthly and coarse checkpoints', () => {
  // Economic accounts and persisted crown records are part of the trajectory. Checkpoints
  // are captured only after two independent, validated replays agree at every phase.
  const expected = JSON.parse(
    readFileSync(new URL('./fixtures/cabinet-trajectories.json', import.meta.url), 'utf8'),
  )
  // The inspection archive is derived evidence, covered by its own continuation tests.
  // Keep the physical trajectory fingerprint comparable with the pre-archive baseline.
  const trajectoryHash = (w: World) => {
    const state = { ...w }
    delete state.archive
    return canonicalHash(state)
  }
  const actual = []
  for (const start of ['settled', 'frontier'] as const) {
    const w = generateWorld('refactor-contract', 3, 4, undefined, 'regional', start)
    prepareSpatialWorld(w)
    actual.push([start, 'prepared', trajectoryHash(w)])
    tick(w)
    actual.push([start, 'monthly', trajectoryHash(w)])
    tick(w, 'coarse')
    actual.push([start, 'coarse', trajectoryHash(w)])
    advanceCoarsePeriod(w, 6)
    actual.push([start, 'period', trajectoryHash(w)])
  }
  assert.deepEqual(actual, expected)
})
