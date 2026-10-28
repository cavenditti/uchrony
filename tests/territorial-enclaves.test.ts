import test from 'node:test'
import assert from 'node:assert/strict'
import {
  absorbUnclaimedEnclaves,
  claimIndependentProvince,
  UNCLAIMED_ENCLAVE_MAX_AREA_KM2,
} from '../src/sim/territorial-expansion'
import { CELL_SIZE, CELL_METERS, edgeNeighbors } from '../src/sim/grid'
import { generateWorld, makeNation } from '../src/sim/generate'
import { applyCommand, prepareSpatialWorld, summarize, tick } from '../src/sim/engine'
import { balances, auditLedger } from '../src/sim/ledger'
import { physicalStocks, auditGoods } from '../src/sim/goods-accounting'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { ensureSovereignty } from '../src/sim/sovereignty'
import { population, type Cell, type Region, type World } from '../src/sim/types'

/** Capitals are owned provinces, lowercase letters are independent provinces,
 * and dots are water. Deliberately omit administrative neighbor shortcuts. */
function fixture(rows: string[]) {
  const width = rows[0].length,
    height = rows.length,
    regions: Region[] = [],
    ids = new Map<string, number>()
  const cells = rows.flatMap((row, r) =>
    [...row].map((value, q): Cell => {
      const id = r * width + q
      if (value !== '.') {
        if (!ids.has(value)) {
          ids.set(value, regions.length)
          regions.push({
            id: regions.length,
            name: value,
            nation: value === 'B' ? 1 : value === value.toUpperCase() ? 0 : -1,
            cells: [],
            center: id,
            neighbors: [],
            communities: [],
          } as unknown as Region)
        }
        regions[ids.get(value)!].cells.push(id)
      }
      return {
        id,
        q,
        r,
        x: (q + 0.5) * CELL_SIZE,
        y: (r + 0.5) * CELL_SIZE,
        elevation: 0.2,
        moisture: 0.5,
        river: false,
        terrain: value === '.' ? 'water' : 'plains',
        region: ids.get(value) ?? -1,
      }
    }),
  )
  return {
    width,
    height,
    cells,
    regions,
    nations: [makeNation(0, 0), makeNation(1, 0)],
    month: 12,
    events: [],
    nextEvent: 0,
  } as unknown as World
}

test('an empty pocket spanning provinces is absorbed once by its surrounding state', () => {
  const w = fixture(['AAAAAA', 'AxyCCA', 'AxyCCA', 'AAAAAA'])
  assert.equal(absorbUnclaimedEnclaves(w), 2)
  assert(w.regions.every((r) => r.nation === 0))
  assert.equal(w.events.length, 1)
  assert.match(w.events[0].detail, /4\.19 km²/)
  assert.equal(w.events[0].month, w.month)
  assert.equal(w.events[0].nation, 0)
  const after = JSON.stringify(w)
  assert.equal(absorbUnclaimedEnclaves(w), 0)
  assert.equal(JSON.stringify(w), after)
})

test('the 16 km² cutoff uses physical area of the entire connected pocket', () => {
  assert.equal(UNCLAIMED_ENCLAVE_MAX_AREA_KM2, 16)
  assert(15 * CELL_METERS ** 2 < 16e6)
  assert(16 * CELL_METERS ** 2 > 16e6)
  const small = fixture(['AAAAAAA', 'AxxyyyA', 'AxxyyyA', 'AxxyyyA', 'AAAAAAA'])
  assert.equal(absorbUnclaimedEnclaves(small), 2)
  // Each province fits separately; their combined 16.78 km² must remain free.
  const large = fixture(['AAAAAA', 'AxxyyA', 'AxxyyA', 'AxxyyA', 'AxxyyA', 'AAAAAA'])
  const before = JSON.stringify(large)
  assert.equal(absorbUnclaimedEnclaves(large), 0)
  assert.equal(JSON.stringify(large), before)
  const single = fixture(['AAAAAA', 'AxxxxA', 'AxxxxA', 'AxxxxA', 'AxxxxA', 'AAAAAA'])
  assert.equal(absorbUnclaimedEnclaves(single), 0)
})

for (const [name, rows] of [
  ['a coastal pocket', ['AAAA', 'Ax.A', 'AAAA']],
  ['a map-edge pocket', ['AxAA', 'AAAA', 'AAAA']],
  ['a pocket bordering two states', ['AAAA', 'AxyB', 'AAAA']],
  ['an open corridor through another independent province', ['AAyAA', 'AAyAA', 'AAxxA', 'AAAAA']],
  ['an unclaimed island', ['.....', '..x..', '.....']],
  ['an already claimed enclave', ['AAA', 'ABA', 'AAA']],
  ['a disconnected province with land outside the pocket', ['AxAAA', 'AAAAA', 'AAxAA', 'AAAAA']],
] as const) {
  test(`${name} is not automatically absorbed`, () => {
    const w = fixture([...rows]),
      before = JSON.stringify(w)
    assert.equal(absorbUnclaimedEnclaves(w), 0)
    assert.equal(JSON.stringify(w), before)
  })
}

test('mountain and river cells count as territory, without requiring a pass or residents', () => {
  const w = fixture(['AAAA', 'AxyA', 'AAAA'])
  for (const c of w.cells) {
    c.terrain = 'mountains'
    c.elevation = 0.8
    c.river = true
  }
  assert.equal(absorbUnclaimedEnclaves(w), 2)
})

test('corner contacts do not create a shared border or an escape corridor', () => {
  const w = fixture(['ByAA', 'AxAA', 'AAAA'])
  assert.equal(absorbUnclaimedEnclaves(w), 0, 'x and y share a real edge')
  const diagonal = fixture(['yABA', 'AxAA', 'AAAA'])
  assert.equal(absorbUnclaimedEnclaves(diagonal), 1)
  assert.equal(diagonal.regions.find((r) => r.name === 'y')!.nation, -1)
  assert.equal(diagonal.regions.find((r) => r.name === 'x')!.nation, 0)
})

test('absorption responds to enclosure immediately, but never revives an extinct state', () => {
  const w = fixture(['AAAA', 'AxBA', 'AAAA'])
  assert.equal(absorbUnclaimedEnclaves(w), 0)
  w.regions.find((r) => r.name === 'B')!.nation = 0
  w.nations[0].extinct = w.month
  assert.equal(absorbUnclaimedEnclaves(w), 0)
  delete w.nations[0].extinct
  assert.equal(absorbUnclaimedEnclaves(w), 1)
})

function livingFixture() {
  const w = generateWorld('Enclave absorption', 3, 8, undefined, 'regional', 'frontier')
  const region = w.regions.find(
    (r) =>
      r.nation === -1 &&
      population(r) > 0 &&
      r.cells.length * CELL_METERS ** 2 < 16e6 &&
      r.cells.every((id) =>
        edgeNeighbors(id, w.width, w.height).every((next) => next >= 0 && w.cells[next].terrain !== 'water'),
      ) &&
      r.neighbors.every((id) => w.regions[id].nation <= 0),
  )!
  assert(region)
  for (const id of region.neighbors)
    if (w.regions[id].nation === -1) claimIndependentProvince(w, w.regions[id], 0, false)
  w.nations.forEach((n) => (n.ai = false))
  prepareSpatialWorld(w)
  summarize(w, false)
  validateWorld(w)
  return { w, region }
}

test('absorption conserves people, identities, goods, money and homes and updates local ownership', () => {
  const { w, region } = livingFixture()
  const before = {
    people: w.regions.map(population),
    groups: structuredClone(region.communities),
    goods: physicalStocks(w),
    money: balances(w),
    sites: structuredClone(w.adaptive!.sites),
  }
  ensureSovereignty(w).frontiers = [
    {
      region: region.id,
      since: 0,
      updated: 0,
      nation: 0,
      influence: 0,
      mandate: 0,
      prosperity: 0,
      city: null,
    },
  ]
  assert(absorbUnclaimedEnclaves(w) > 0)
  assert.equal(region.nation, 0)
  assert.deepEqual(w.regions.map(population), before.people)
  assert.deepEqual(
    region.communities,
    before.groups!.map((group) => ({ ...group, host: 0 })),
  )
  assert.deepEqual(physicalStocks(w), before.goods)
  assert.deepEqual(balances(w), before.money)
  assert.deepEqual(w.adaptive!.sites, before.sites)
  assert(!w.sovereignty!.frontiers.some((p) => p.region === region.id))
  const units = w
    .localEconomy!.active.map((id) => w.localEconomy!.units[id])
    .filter((u) => u.province === region.id)
  assert(units.length > 0)
  assert(units.every((u) => u.nation === 0 && u.communities!.every((g) => g.host === 0)))
  for (const level of ['province', 'municipality'])
    assert.equal(w.adaptive!.jurisdictions[`${level}:${region.id}`].nation, 0)
  summarize(w, false)
  auditLedger(w)
  auditGoods(w)
  validateWorld(w)
})

test('manual founding absorbs a newly enclosed pocket without advancing time', () => {
  const w = generateWorld('Enclave absorption', 3, 8, undefined, 'regional', 'frontier')
  const region = w.regions[9],
    gate = w.regions[171],
    nation = 1
  assert.equal(region.nation, -1)
  assert.equal(gate.nation, -1)
  assert(region.neighbors.includes(gate.id))
  for (const id of region.neighbors)
    if (id !== gate.id && w.regions[id].nation === -1)
      claimIndependentProvince(w, w.regions[id], nation, false)
  prepareSpatialWorld(w)
  absorbUnclaimedEnclaves(w)
  assert.equal(region.nation, -1, 'the open pocket must wait until the last surrounding province is claimed')
  const month = w.month
  applyCommand(w, { type: 'found-settlement', nation, cell: gate.center })
  assert.equal(w.month, month)
  assert.equal(gate.nation, nation)
  assert.equal(region.nation, nation)
  assert(w.events.some((e) => e.region === region.id && e.title.includes('unclaimed enclave')))
  validateWorld(w)
  auditLedger(w)
  auditGoods(w)
})

for (const months of [1, 6]) {
  test(`normal simulation absorbs enclaves and replays deterministically over ${months} month steps`, () => {
    const { w, region } = livingFixture()
    const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
    assert.equal(restored.regions[region.id].nation, -1, 'loading does not advance ownership')
    withSimulationPeriod(months, () => {
      tick(w, months === 1 ? 'monthly' : 'coarse')
      tick(restored, months === 1 ? 'monthly' : 'coarse')
    })
    assert.equal(region.nation, 0)
    assert(w.events.some((e) => e.region === region.id && e.title.includes('unclaimed enclave')))
    validateWorld(w)
    validateWorld(restored)
    assert.deepEqual(packWorldSave(w), packWorldSave(restored))
    const absorbedSave = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
    assert.equal(absorbedSave.regions[region.id].nation, 0)
  })
}
