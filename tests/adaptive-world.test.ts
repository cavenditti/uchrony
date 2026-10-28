import { commuteFlows } from '../src/sim/commute-ledger'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { generateWorld } from '../src/sim/generate'
import { ensureDistrictEconomy } from '../src/sim/districts'
import { ensureFirms } from '../src/sim/firms'
import {
  ensureAdaptiveWorld,
  rebuildAdaptiveMesh,
  adaptiveMesh,
  adaptivePopulation,
} from '../src/sim/adaptive-world'
import { applyAdministrativeReform, activeJurisdictions } from '../src/sim/jurisdictions'
import { inspectWorld, inspectionAround } from '../src/sim/inspection'
import { polygonArea, cellPolygon, cellPosition } from '../src/sim/physical-space'
import { balances, borrow, householdAccount } from '../src/sim/ledger'
import { physicalStocks } from '../src/sim/goods-accounting'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { tick } from '../src/sim/engine'
import { refreshSpatial } from '../src/sim/spatial'
import { neighbors } from '../src/sim/grid'
import type { World } from '../src/sim/types'
import { submitStandingOffer } from '../src/sim/statecraft'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fixture(seed = 'Adaptive conservation') {
  const w = generateWorld(seed, 3, 8, undefined, 'regional')
  ensureDistrictEconomy(w)
  ensureFirms(w)
  return w
}
function assets(w: World) {
  return {
    people: w.regions.map((r) => r.communities),
    money: balances(w),
    goods: physicalStocks(w),
    loans: w.economy!.credit.loans,
    banks: w.economy!.banking,
    firms: w.economy!.firms,
    producers: w.economy!.producers,
    household: w.economy!.households,
    reserves: w.localEconomy!.reserves,
    forces: [w.armies, w.warfare],
    legal: [w.statecraft, w.relations, w.institutions],
    rng: w.rng,
  }
}

test('migration and 12 alternating mesh refinements retain every owner, cohort, stock and debt term', () => {
  const w = fixture()
  borrow(w, householdAccount(0, 'laborer'), 11, 20)
  const before = digest(assets(w))
  ensureAdaptiveWorld(w)
  assert.equal(digest(assets(w)), before)
  const expectedArea = w.cells
    .filter((c) => c.terrain !== 'water')
    .reduce((sum, c) => sum + polygonArea(cellPolygon(w, c.id)), 0)
  for (let i = 0; i < 12; i++) {
    const mesh = rebuildAdaptiveMesh(w, i % 2 ? 'fine' : 'coarse')
    assert.equal(digest(assets(w)), before)
    assert.equal(
      mesh.leaves.reduce((sum, n) => sum + n.population, 0),
      adaptivePopulation(w),
    )
    assert(
      Math.abs(mesh.leaves.reduce((sum, n) => sum + n.landArea, 0) - expectedArea) < expectedArea * 1e-10,
    )
    const nodes = new Map(mesh.leaves.map((n) => [n.id, n]))
    assert.equal(new Set(mesh.interfaces.map((i) => i.id)).size, mesh.interfaces.length)
    for (const edge of mesh.interfaces) {
      const ratio = nodes.get(edge.a)!.bounds.size / nodes.get(edge.b)!.bounds.size
      assert(ratio >= 0.5 && ratio <= 2)
    }
  }
})

test('administrative merger and split are atomic, preserve legal claims and reject annexation or missing land', () => {
  const w = fixture('Administrative succession')
  ensureAdaptiveWorld(w)
  const jurisdictions = activeJurisdictions(w, 'province')
  const first = jurisdictions.find((j) =>
    jurisdictions.some(
      (k) =>
        j.id !== k.id &&
        j.nation === k.nation &&
        j.cells.some((c) => neighbors(c, w.width, w.height).some((n) => k.cells.includes(n))),
    ),
  )!
  const second = jurisdictions.find(
    (k) =>
      k.id !== first.id &&
      k.nation === first.nation &&
      k.cells.some((c) => neighbors(c, w.width, w.height).some((n) => first.cells.includes(n))),
  )!
  submitStandingOffer(
    w,
    first.nation,
    {
      title: 'Outstanding supply agreement',
      parties: [first.nation, w.nations.find((n) => n.id !== first.nation)!.id],
      visibility: 'public',
      duration: 12,
      supersedes: 0,
      terms: [
        {
          kind: 'goods',
          from: first.nation,
          to: w.nations.find((n) => n.id !== first.nation)!.id,
          amount: 1,
          good: 'food',
          field: '',
          regions: [],
          duration: 12,
          text: 'One unit each month.',
        },
      ],
    },
    true,
  )
  const before = digest(assets(w)),
    history = digest(w.history)
  const merged = applyAdministrativeReform(w, {
    level: 'province',
    from: [first.id, second.id],
    replacements: [{ name: 'Joint province', cells: [...first.cells, ...second.cells], seat: first.seat }],
    reason: 'Test service consolidation',
  })
  assert.equal(digest(assets(w)), before)
  assert.equal(digest(w.history), history)
  assert.equal(first.retired, w.month)
  assert.equal(first.successors[0], merged[0].id)
  const snapshot = digest(w)
  assert.throws(() =>
    applyAdministrativeReform(w, {
      level: 'province',
      from: [merged[0].id],
      replacements: [{ name: 'Abandoned land', cells: first.cells, seat: first.seat }],
      reason: 'invalid',
    }),
  )
  assert.equal(digest(w), snapshot)
  applyAdministrativeReform(w, {
    level: 'province',
    from: [merged[0].id],
    replacements: [
      { name: first.name, cells: first.cells, seat: first.seat },
      { name: second.name, cells: second.cells, seat: second.seat },
    ],
    reason: 'Test service division',
  })
  assert.equal(digest(assets(w)), before)
  refreshSpatial(w)
  validateWorld(w)
})

test('inspection reconstruction, cache loss and repeated zoom cannot mutate authoritative state', () => {
  const w = fixture('Observer independence')
  ensureAdaptiveWorld(w)
  const before = digest(w),
    bounds = inspectionAround(w, w.regions[0].center)
  const first = inspectWorld(w, { id: 1, bounds, detail: 'street' })
  for (let i = 0; i < 30; i++)
    inspectWorld(w, {
      id: i,
      bounds: inspectionAround(w, w.regions[i % w.regions.length].center, 500 + i * 100),
      detail: 'street',
    })
  assert.equal(digest(w), before)
  assert.deepEqual(inspectWorld(w, { id: 1, bounds, detail: 'street' }), first)
  const clone = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  assert.deepEqual(inspectWorld(clone, { id: 1, bounds, detail: 'street' }), first)
  assert.equal(digest(clone.adaptive), digest(w.adaptive))
})

test('a representative commute starts at its sampled home and uses its own travel time', () => {
  const w = fixture('Inspection physical journey')
  ensureAdaptiveWorld(w)
  const sites = Object.values(w.adaptive!.sites)
  const home = sites.find(
    (s) =>
      s.kind === 'residential' && (s.residents ?? w.localEconomy!.units[s.pool].residents[s.cell] ?? 0) > 0,
  )!
  const workplace = sites.find((s) => s.kind === 'establishment')!
  assert(home && workplace)
  const center = cellPosition(w, home.cell)
  Object.assign(home, { x: center.x - 200, y: center.y })
  Object.assign(workplace, { cell: home.cell, x: center.x + 200, y: center.y })
  w.cells[home.cell].terrain = 'plains'
  // Publish the fixture's moved sites before querying cached mesh membership,
  // just as the simulation does after a physical change.
  w.adaptive!.revision++
  w.adaptive!.commutingRows = []
  w.adaptive!.commuting = [
    {
      residence: home.pool,
      workplace: workplace.id,
      route: 'display-fixture',
      stratum: 'laborer',
      workers: 1,
      wage: 1,
      minutes: 60,
      mode: 'walk',
    },
  ]
  const before = digest(w)
  const view = inspectWorld(w, {
    id: 1,
    detail: 'street',
    bounds: { x: home.x - 1, y: home.y - 1, size: 2 },
  })
  const routine = view.routines.find((r) => r.home === home.id && r.workplace === workplace.id)!
  assert(routine)
  assert.deepEqual(routine.journeys![0].points, [
    { x: home.x, y: home.y },
    { x: workplace.x, y: workplace.y },
  ])
  assert(Math.abs((routine.journeys![0].end - routine.journeys![0].start) * 60 - 6) < 1e-9)
  assert.equal(routine.activities[1].label, 'Travel to work · 6 min')
  assert.deepEqual(routine.journeys![1].points, [...routine.journeys![0].points].reverse())
  assert.equal(digest(w), before)
})

test('coarse, fine and adaptive partitioning execute the same retained heterogeneous economic closure', () => {
  const source = fixture('Closure comparison')
  ensureAdaptiveWorld(source)
  refreshSpatial(source)
  const worlds = ['coarse', 'fine', 'adaptive'].map((mode) => {
    const w = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(source))))
    rebuildAdaptiveMesh(w, mode as 'coarse' | 'fine' | 'adaptive')
    return w
  })
  for (let month = 0; month < 2; month++) {
    for (const w of worlds) tick(w)
    assert.equal(digest(assets(worlds[0])), digest(assets(worlds[1])))
    assert.equal(digest(assets(worlds[0])), digest(assets(worlds[2])))
  }
})

test('commuting totals equal paid enterprise employment; construction and save continuation reconcile', () => {
  const w = fixture('Commuter accounting')
  tick(w)
  const allCommutes = [...commuteFlows(w)]
  for (const firm of w.economy!.firms!) {
    const flows = allCommutes.filter((f) => f.workplace === `firm:${firm.id}`)
    const jobs = flows.reduce((sum, f) => sum + f.workers, 0)
    // Firms can exit after the completed production period; their dated wage flow remains recorded.
    if (firm.active) assert(Math.abs(jobs - firm.employment) < 1e-7 * Math.max(1, jobs))
  }
  validateWorld(w)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  tick(w)
  tick(restored)
  assert.deepEqual(assets(restored), assets(w))
  assert.deepEqual(restored.adaptive, w.adaptive)
  assert.equal(
    adaptiveMesh(restored).leaves.reduce((sum, n) => sum + n.population, 0),
    adaptivePopulation(restored),
  )
})

test('untrusted adaptive saves reject parent/child overlap and missing residential ownership', () => {
  const w = fixture('Adaptive validation')
  ensureAdaptiveWorld(w)
  refreshSpatial(w)
  validateWorld(w)
  const broken = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  broken.adaptive!.tree.leaves.push('r')
  assert.throws(() => validateWorld(broken), /overlapping/)
  const home = Object.values(w.adaptive!.sites).find((s) => s.kind === 'residential')!
  delete w.adaptive!.sites[home.id]
  assert.throws(() => validateWorld(w), /home site/)
})

test('saved shipments cannot change ownership or inject negative inventory', () => {
  const w = fixture('Freight save validation')
  ensureAdaptiveWorld(w)
  const from = w.localEconomy!.active[0],
    to = w.localEconomy!.active[1]
  w.adaptive!.nextTransit = 1
  w.adaptive!.transit = [
    {
      id: 0,
      from,
      to,
      owner: `household:${to}:owner`,
      dispatched: 0,
      arrives: 2,
      goods: { food: 1, timber: 0, stone: 0, iron: 0, coal: 0, tools: 0, textiles: 0, arms: 0 },
      legs: [{ mode: 'land', cells: [w.localEconomy!.units[from].center, w.localEconomy!.units[to].center] }],
    },
  ]
  assert.throws(() => validateWorld(w), /freight ownership/)
  w.adaptive!.transit[0].owner = `producer:${to}`
  w.adaptive!.transit[0].goods.food = -1
  assert.throws(() => validateWorld(w), /freight ownership/)
})

test('restoration rejects a rewound jurisdiction sequence before it can overwrite legal succession', () => {
  const w = fixture('Legal identity sequence')
  ensureAdaptiveWorld(w)
  const original = activeJurisdictions(w, 'province')[0]
  applyAdministrativeReform(w, {
    level: 'province',
    from: [original.id],
    replacements: [{ name: original.name, cells: [...original.cells], seat: original.seat }],
    reason: 'Legal succession fixture',
  })
  validateWorld(w)
  const before = digest(assets(w))
  w.adaptive!.nextJurisdiction = 0
  assert.throws(() => restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w)))), /overwrite.*legal identity/)
  assert.equal(digest(assets(w)), before)
})

test('long freight remains owned inventory in transit and arrives exactly once', async () => {
  const { deliverFreight, arriveFreight } = await import('../src/sim/freight-transit')
  const { beginEconomyMonth } = await import('../src/sim/macroeconomy')
  const { recordGift, marketStore } = await import('../src/sim/national-accounts')
  const w = fixture('Transit conservation')
  ensureAdaptiveWorld(w)
  beginEconomyMonth(w)
  const a = w.localEconomy!.units[w.localEconomy!.active[0]],
    b = w.localEconomy!.units[w.localEconomy!.active[1]]
  const amount = Math.min(10, a.stocks.timber),
    before = physicalStocks(w),
    opening = b.stocks.timber
  const adjacent = neighbors(a.center, w.width, w.height).find((c) => w.cells[c].terrain !== 'water')!
  const cells = Array.from({ length: 3000 }, (_, i) => (i % 2 ? adjacent : a.center))
  recordGift(w, marketStore(a.id), marketStore(b.id), 'timber', amount)
  a.stocks.timber -= amount
  deliverFreight(w, a.id, b.id, 'timber', amount, [{ mode: 'land', cells }])
  assert.equal(b.stocks.timber, opening)
  assert.equal(w.adaptive!.transit!.length, 1)
  assert.deepEqual(physicalStocks(w), before)
  w.month = w.adaptive!.transit![0].arrives
  arriveFreight(w)
  arriveFreight(w)
  assert.equal(b.stocks.timber, opening + amount)
  assert.deepEqual(physicalStocks(w), before)
})
