import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { apportion } from '../src/sim/allocation'
import {
  cohortBirths,
  cohortDeaths,
  annualMortality,
  desiredFertility,
  ensureAges,
  expectedInteger,
  refreshAges,
} from '../src/sim/age-cohorts'
import { MODEL_PARAMETERS as P } from '../src/sim/model-parameters'
import { random } from '../src/sim/random'
import { preparePayments, transfer, withBatchedLedgerEntries, beginLedgerMonth } from '../src/sim/ledger'
import { MinHeap } from '../src/sim/heap'
import { prepareSpatialWorld } from '../src/sim/engine'
import { residentialSites } from '../src/sim/residential-sites'
import { commuteSiteRoute, snapshotSiteAccessibility, withCommuteCostSnapshot } from '../src/sim/commuting'
import type { PopulationCommunity } from '../src/sim/population-types'
import { cloneCommunity } from '../src/sim/population-clone'
import { provincialRealService, provincialServiceLookup } from '../src/sim/public-services'

// The original object-based allocation is an independent replay oracle for
// capacity saturation, exact floating-point remainders and stable index ties.
function referenceAllocation(total: number, weights: number[], limits = weights.map(() => Infinity)) {
  const result = weights.map(() => 0)
  let left = Math.min(
    Math.max(0, Math.floor(total)),
    limits.reduce((sum, n) => sum + n, 0),
  )
  while (left > 0) {
    const active = weights
      .map((weight, index) => ({ index, weight: Math.max(0, weight) }))
      .filter(({ index }) => result[index] < limits[index])
    const sum = active.reduce((value, item) => value + item.weight, 0)
    if (!active.length) break
    const shares = active.map(({ index, weight }) => ({
      index,
      exact: left * (sum ? weight / sum : 1 / active.length),
    }))
    let granted = 0
    for (const share of shares) {
      const amount = Math.min(limits[share.index] - result[share.index], Math.floor(share.exact))
      result[share.index] += amount
      granted += amount
    }
    left -= granted
    if (left <= 0) break
    shares.sort(
      (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.index - b.index,
    )
    let remainder = 0
    for (const { index } of shares)
      if (left && result[index] < limits[index]) {
        result[index]++
        left--
        remainder++
      }
    if (!remainder && !granted) break
  }
  return result
}

test('allocation preserves exact capacity and remainder results for short and long population vectors', () => {
  const rng = { rng: 71319 }
  for (let trial = 0; trial < 5000; trial++) {
    const size = [0, 1, 2, 2, 3, 5, 96][trial % 7]
    const weights = Array.from({ length: size }, () =>
      trial % 9 === 0 ? 0 : trial % 11 === 0 ? 1 : Math.floor(random(rng) * 20000) / (trial % 3 ? 1 : 7) - 10,
    )
    const limits = weights.map(() =>
      trial % 4 === 0 ? Infinity : Math.floor(random(rng) * 1000) / (trial % 13 ? 1 : 3),
    )
    const total = random(rng) * 40000 - 10
    assert.deepEqual(
      apportion(total, weights, limits),
      referenceAllocation(total, weights, limits),
      `trial ${trial}`,
    )
    assert.deepEqual(
      apportion(total, weights),
      referenceAllocation(total, weights),
      `unbounded trial ${trial}`,
    )
  }
})

function referenceDeaths(
  group: PopulationCommunity,
  month: number,
  rng: { rng: number },
  shortage: number,
  multiplier: number,
) {
  ensureAges(group, month)
  let deaths = 0
  for (const c of group.ageCohorts!) {
    const probability =
      month - c[0] >= P.maximumAgeMonths
        ? 1
        : -Math.expm1(-annualMortality((month - c[0]) / 12, group.health, shortage, multiplier) / 12)
    for (const sex of [1, 2] as const) {
      const dead = Math.min(c[sex], expectedInteger(rng, c[sex] * probability))
      c[sex] -= dead
      deaths += dead
    }
  }
  refreshAges(group, month)
  return deaths
}
function referenceBirths(
  group: PopulationCommunity,
  month: number,
  rng: { rng: number },
  shortage: number,
  multiplier: number,
) {
  ensureAges(group, month)
  let expected = 0
  for (const [born, female] of group.ageCohorts!) {
    const age = (month - born) / 12
    if (age >= 15 && age < 50) expected += (female * P.fertilityAnnual[Math.floor((age - 15) / 5)]) / 12
  }
  const modifier =
    (desiredFertility(group) / (5 * P.fertilityAnnual.reduce((sum, rate) => sum + rate, 0))) *
    (1 - shortage * 0.8) *
    multiplier
  const births = expectedInteger(rng, expected * Math.max(0, modifier))
  if (births) {
    const female = expectedInteger(rng, births * P.femaleBirthShare),
      existing = group.ageCohorts!.find((c) => c[0] === month)
    if (existing) {
      existing[1] += female
      existing[2] += births - female
    } else group.ageCohorts!.push([month, female, births - female])
  }
  refreshAges(group, month)
  return births
}

test('fused cohort updates preserve every birthday, sex count and random draw, including empty newborn bins', () => {
  const template = generateWorld('cohort-replay', 3, 4, undefined, 'regional').regions[0].communities![0]
  const rng = { rng: 98137 }
  for (let trial = 0; trial < 400; trial++) {
    const month = trial + 1,
      shortage = random(rng),
      multiplier = random(rng) * 3
    const a = structuredClone(template)
    a.health = random(rng)
    a.ageMonth = trial % 2 ? month : month - 1
    a.ageCohorts = [
      [month, 0, 0],
      ...Array.from(
        { length: 30 },
        () =>
          [
            month - Math.floor(random(rng) * 1500),
            Math.floor(random(rng) * 300),
            Math.floor(random(rng) * 300),
          ] as [number, number, number],
      ),
    ]
    const b = structuredClone(a),
      ra = { rng: rng.rng },
      rb = { ...ra }
    // Exercise births without mortality first too: the empty current-month bin
    // must retain its historical position when a new birth makes it nonempty.
    if (trial % 3) {
      assert.equal(
        cohortDeaths(a, month, ra, shortage, multiplier),
        referenceDeaths(b, month, rb, shortage, multiplier),
      )
      assert.deepEqual(a, b)
      assert.deepEqual(ra, rb)
    }
    assert.equal(
      cohortBirths(a, month, ra, shortage, multiplier),
      referenceBirths(b, month, rb, shortage, multiplier),
    )
    assert.deepEqual(a, b)
    assert.deepEqual(ra, rb)
  }
})

test('prepared payroll preserves immediate settlement, partial payments, lazy bank enrollment and journal tails', () => {
  const ordinary = generateWorld('payment-replay', 3, 4, undefined, 'regional'),
    batched = structuredClone(ordinary)
  const names = ['producer:0', 'household:0:laborer', 'household:0:professional', 'government:0']
  for (const w of [ordinary, batched]) for (const name of names) delete w.economy!.banking!.accounts[name]
  const run = (prepared: boolean) => {
    const w = prepared ? batched : ordinary,
      payments = preparePayments(w),
      accounts = names.map(payments.account)
    const pay = (a: number, b: number, amount: number, label: string) =>
      prepared
        ? payments.transfer(accounts[a], accounts[b], amount, label)
        : transfer(w, names[a], names[b], amount, label)
    pay(0, 1, 0, 'zero')
    pay(0, 0, 12, 'self')
    for (const name of names) assert.equal(w.economy!.banking!.accounts[name], undefined)
    for (let i = 0; i < 3500; i++) {
      pay(i % 4, (i + 1) % 4, i % 17 === 0 ? 1e9 : 0.001, `payment ${i}`)
      if (i === 1500) beginLedgerMonth(w)
    }
    assert.throws(() => pay(0, 1, NaN, 'invalid'), /finite/)
  }
  run(false)
  withBatchedLedgerEntries(batched, () => run(true))
  assert.deepEqual(batched, ordinary)
})

test('journal batching preserves existing entry references and restores a nested interrupted tail', () => {
  const a = generateWorld('journal-replay', 3, 4, undefined, 'regional'),
    b = structuredClone(a)
  transfer(a, 'producer:0', 'household:0:laborer', 0.001, 'retained')
  transfer(b, 'producer:0', 'household:0:laborer', 0.001, 'retained')
  const retained = b.economy!.ledger.entries.at(-1)!,
    saved = { ...retained }
  const run = (w: typeof a) => {
    for (let i = 0; i < 2100; i++)
      transfer(
        w,
        i % 2 ? 'producer:0' : 'household:0:laborer',
        i % 2 ? 'household:0:laborer' : 'producer:0',
        0.001,
        `tail ${i}`,
      )
    throw new Error('interrupted')
  }
  assert.throws(() => run(a), /interrupted/)
  assert.throws(
    () => withBatchedLedgerEntries(b, () => withBatchedLedgerEntries(b, () => run(b))),
    /interrupted/,
  )
  assert.deepEqual(a, b)
  assert.deepEqual(retained, saved)
})

test('numeric heap preserves legacy pop ordering under ties and mixed insertions', () => {
  const items: { id: number; cost: number }[] = [],
    heap = new MinHeap(),
    rng = { rng: 9923 },
    cursor = { id: 0, cost: 0 }
  const push = (id: number, cost: number) => {
    let i = items.length
    const item = { id, cost }
    items.push(item)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (items[p].cost <= cost) break
      items[i] = items[p]
      i = p
    }
    items[i] = item
    heap.push(id, cost)
  }
  const pop = () => {
    const first = items[0],
      last = items.pop()!
    if (items.length) {
      let i = 0
      while (i * 2 + 1 < items.length) {
        let child = i * 2 + 1
        if (child + 1 < items.length && items[child + 1].cost < items[child].cost) child++
        if (items[child].cost >= last.cost) break
        items[i] = items[child]
        i = child
      }
      items[i] = last
    }
    heap.popInto(cursor)
    assert.deepEqual(cursor, first)
    assert.equal(heap.size, items.length)
  }
  for (let i = 0; i < 10000; i++) {
    if (!items.length || random(rng) < 0.65) push(i, Math.floor(random(rng) * 30))
    else pop()
  }
  while (items.length) pop()
  assert.equal(heap.pop(), undefined)
})

test('housing access snapshots agree with full routes across phases and travel limits', () => {
  const w = generateWorld('access-replay', 3, 4, undefined, 'regional')
  prepareSpatialWorld(w)
  const homes = residentialSites(w)
  let reachable = 0,
    blocked = 0
  for (const limit of [15, 60, 90]) {
    w.month++
    withCommuteCostSnapshot(w, () => {
      const accessibleFrom = snapshotSiteAccessibility(w, limit)
      for (let i = 0; i < homes.length; i += 47) {
        const from = homes[i],
          accessible = accessibleFrom(from)
        for (let j = Math.max(0, i - 8); j < Math.min(homes.length, i + 8); j++) {
          const to = homes[j],
            expected = commuteSiteRoute(w, from, to, limit) !== null
          assert.equal(accessible(to), expected)
          if (expected) reachable++
          else blocked++
        }
      }
    })
    for (const r of w.regions) r.infrastructure *= 0.7
    for (const corridor of w.corridors ?? []) corridor.traffic *= 2
  }
  assert(reachable > 0)
  assert(blocked > 0)
})

test('cohort copies preserve optional fields and isolate nested social metadata', () => {
  const original = {
    culture: 1,
    population: { children: 2, adults: 3, elders: 1 },
    ageCohorts: [
      [0, 1, 1],
      [-400, 2, 1],
      [-900, 0, 1],
    ],
    metadata: { notes: ['retained'] },
  } as unknown as PopulationCommunity & { metadata: { notes: string[] } }
  for (const group of [
    original,
    { ...original, ageCohorts: undefined },
    { culture: 3, population: { children: 0, adults: 1, elders: 0 } } as PopulationCommunity,
  ]) {
    const copy = cloneCommunity(group)
    assert.deepEqual(copy, structuredClone(group))
    assert.equal(JSON.stringify(copy), JSON.stringify(group))
    copy.population.adults++
    if (copy.ageCohorts) copy.ageCohorts[0][1]++
    assert.notDeepEqual(copy, group)
  }
  const copy = cloneCommunity(original) as typeof original
  copy.metadata.notes.push('isolated')
  assert.deepEqual(original.metadata.notes, ['retained'])
})

test('province service indexing keeps district order and reads current funded services', () => {
  const w = generateWorld('services-replay', 3, 4, undefined, 'regional')
  prepareSpatialWorld(w)
  const service = provincialServiceLookup(w)
  for (const phase of [1, 2]) {
    for (const id of w.localEconomy!.active) {
      w.economy!.producers[id].provincialServices = ((id % 7) + 0.1) * phase
      w.economy!.producers[id].administrationServices = ((id % 13) + 0.3) / phase
    }
    for (const r of w.regions)
      for (const kind of ['policing', 'administration'] as const)
        assert.equal(service(r, kind), provincialRealService(w, r, kind))
  }
})
