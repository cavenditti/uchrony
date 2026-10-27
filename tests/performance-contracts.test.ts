import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import {
  balance,
  setBalance,
  transfer,
  borrow,
  beginLedgerMonth,
  auditLedger,
  withBatchedLedgerEntries,
} from '../src/sim/ledger'
import { adjacentCells, geographicNeighbors, movementNeighbors } from '../src/sim/grid'
import { highMountain } from '../src/sim/terrain-access'
import {
  meshInterfaces,
  nodeBounds,
  unbalancedMeshNodes,
  splitFragments,
  clipPolygon,
  polygonArea,
} from '../src/sim/physical-space'
import type { AdaptiveNode } from '../src/sim/adaptive-types'
import { SpatialBuckets } from '../src/sim/spatial-buckets'
import { snapshotSiteSearch, queryAdaptiveSites } from '../src/sim/adaptive-grid'
import { ensureAdaptiveWorld, refreshAdaptiveTotals, rebuildAdaptiveMesh } from '../src/sim/adaptive-world'
import { communityKey } from '../src/sim/population'
import { commuteSiteRoute, commuteSiteMinutes, canCommuteSites } from '../src/sim/commuting'
import { cellPosition } from '../src/sim/physical-space'
import { prepareSpatialWorld } from '../src/sim/engine'

const fixture = () => generateWorld('performance-contracts', 3, 4, undefined, 'regional')

test('batched transaction tails match immediate settlement across wraparound, deposits and month changes', () => {
  const initial = fixture()
  for (const count of [0, 1023, 1024, 1025, 3075]) {
    const ordinary = structuredClone(initial),
      batched = structuredClone(initial)
    const settle = (w: typeof initial) => {
      for (let i = 0; i < count; i++) {
        const from = i % 2 ? 'producer:0' : 'household:0:laborer',
          to = i % 2 ? 'household:0:laborer' : 'producer:0'
        transfer(w, from, to, 0.001, `payment ${i}`)
        if (i % 73 === 0) borrow(w, 'producer:0', 0.01, 100)
        if (i === 1500) beginLedgerMonth(w)
      }
    }
    settle(ordinary)
    withBatchedLedgerEntries(batched, () => settle(batched))
    assert.deepEqual(batched, ordinary)
    assert(batched.economy!.ledger.entries.length <= 1024)
    auditLedger(batched)
    auditLedger(ordinary)
    assert.deepEqual(structuredClone(batched), structuredClone(ordinary))
  }
})

test('a failed batched operation restores chronological history before later commands', () => {
  const ordinary = fixture(),
    batched = structuredClone(ordinary)
  const fail = (w: typeof ordinary) => {
    for (let i = 0; i < 2100; i++) transfer(w, 'producer:0', 'household:0:laborer', 0.001, `payment ${i}`)
    throw new Error('interrupted tick')
  }
  assert.throws(() => fail(ordinary), /interrupted tick/)
  assert.throws(() => withBatchedLedgerEntries(batched, () => fail(batched)), /interrupted tick/)
  transfer(ordinary, 'producer:0', 'household:0:laborer', 0.001, 'subsequent command')
  transfer(batched, 'producer:0', 'household:0:laborer', 0.001, 'subsequent command')
  assert.deepEqual(batched, ordinary)
})

test('account lookups follow replacement account objects without reusing stale balances', () => {
  const w = fixture()
  balance(w, 'producer:0')
  balance(w, 'household:0:laborer')
  w.economy!.producers[0] = { ...w.economy!.producers[0], cash: 17 }
  w.economy!.households[0].laborer = { ...w.economy!.households[0].laborer, cash: 23 }
  assert.equal(balance(w, 'producer:0'), 17)
  assert.equal(balance(w, 'household:0:laborer'), 23)
  setBalance(w, 'producer:0', 31)
  assert.equal(w.economy!.producers[0].cash, 31)
  assert.equal(balance(structuredClone(w), 'producer:0'), 31)
  assert.throws(() => balance(w, 'unknown:0'), /Unknown settlement account/)
})

test('fast neighbor traversal preserves historical ordering, coasts and blocked mountain corners', () => {
  for (const [width, height] of [
    [1, 1],
    [1, 7],
    [7, 1],
    [7, 5],
  ]) {
    const cells = Array.from({ length: width * height }, (_, id) => ({
      terrain: id % 5 === 0 ? 'water' : id % 7 === 0 ? 'mountains' : 'plains',
      elevation: id % 11 === 0 ? 0.6 : 0.1,
    }))
    for (let id = 0; id < cells.length; id++) {
      const q = id % width,
        r = Math.floor(id / width)
      const expected = [
        [0, -1],
        [1, -1],
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
        [-1, 0],
        [-1, -1],
      ].map(([dx, dy]) => {
        const x = q + dx,
          y = r + dy
        return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x
      })
      assert.deepEqual(adjacentCells(id, width, height), expected)
      const geographic = expected.filter((n, i) => i % 2 === 0 && n >= 0)
      const water = cells[id].terrain === 'water'
      for (const next of expected) {
        if (next < 0 || geographic.includes(next) || (cells[next].terrain === 'water') !== water) continue
        const x = next % width,
          y = Math.floor(next / width)
        if (
          (cells[r * width + x].terrain === 'water') === water &&
          (cells[y * width + q].terrain === 'water') === water
        )
          geographic.push(next)
      }
      assert.deepEqual(geographicNeighbors(cells, id, width, height), geographic)
      const movement = highMountain(cells[id])
        ? []
        : geographic.filter((next) => {
            const x = next % width,
              y = Math.floor(next / width)
            return (
              !highMountain(cells[next]) &&
              (q === x ||
                r === y ||
                (!highMountain(cells[r * width + x]) && !highMountain(cells[y * width + q])))
            )
          })
      assert.deepEqual(movementNeighbors(cells, id, width, height), movement)
    }
  }
})

test('Morton balance detection agrees with physical face sweeps for irregular and sparse trees', () => {
  let random = 17
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) / 2 ** 32
  const makeNode = (id: string): AdaptiveNode => ({
    id,
    bounds: nodeBounds({ x: 0, y: 0, size: 2 ** 20 }, id),
    fragments: [],
    sites: [],
    pools: [],
    population: 0,
    jobs: 0,
    landArea: 0,
    indicator: 0,
  })
  for (const depth of [0, 1, 4, 8, 16, 17]) {
    const nodes: AdaptiveNode[] = []
    const visit = (id: string) => {
      if (id.length - 1 < depth && (id.endsWith('0') || id === 'r' || next() < 0.35)) {
        for (let q = 0; q < 4; q++) visit(id + q)
      } else if (next() > 0.08) nodes.push(makeNode(id))
    }
    visit('r')
    const byId = new Map(nodes.map((n) => [n.id, n])),
      expected = new Set<string>()
    for (const edge of meshInterfaces(nodes, false)) {
      const a = byId.get(edge.a)!,
        b = byId.get(edge.b)!
      if (a.bounds.size > b.bounds.size * 2) expected.add(a.id)
      if (b.bounds.size > a.bounds.size * 2) expected.add(b.id)
    }
    assert.deepEqual([...unbalancedMeshNodes(nodes)].sort(), [...expected].sort(), `depth ${depth}`)
  }
})

test('fine square fragments retain exact areas and polygons through repeated subdivision', () => {
  let bounds = { x: 0, y: 0, size: 1024 }
  let fragments = [
    {
      cell: 7,
      water: false,
      area: 1024 ** 2,
      polygon: [
        { x: 0, y: 0 },
        { x: 1024, y: 0 },
        { x: 1024, y: 1024 },
        { x: 0, y: 1024 },
      ],
    },
  ]
  const sorted = (points: { x: number; y: number }[]) => [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  for (let level = 0; level < 7; level++) {
    const children = splitFragments(fragments, bounds)
    for (let q = 0; q < 4; q++) {
      const expected = clipPolygon(fragments[0].polygon, nodeBounds(bounds, `r${q}`))
      assert.deepEqual(sorted(children[q][0].polygon), sorted(expected))
      assert.equal(children[q][0].area, polygonArea(expected))
      assert.equal(children[q][0].cell, 7)
    }
    fragments = children[level % 4]
    bounds = nodeBounds(bounds, `r${level % 4}`)
  }
})

test('physical broad phase includes shared boundaries, negative coordinates and spanning obstacles once', () => {
  const index = new SpatialBuckets<string>(128)
  index.insert('crossing', -140, -140, 140, 140)
  index.insert('edge', 128, 0)
  index.insert('distant', 1024, 1024)
  assert.deepEqual([...index.query(-128, -128, 128, 128)].sort(), ['crossing', 'edge'])
  assert.deepEqual([...index.query(128, 0, 128, 0)].sort(), ['crossing', 'edge'])
  assert.equal(index.query(-1024, 0, -900, 100).size, 0)
})

test('phase-local site searches match numerical tree queries across moves, retirement and refinement', () => {
  const w = fixture()
  ensureAdaptiveWorld(w)
  const homes = Object.values(w.adaptive!.sites).filter((s) => s.kind === 'residential')
  const moved = homes[0]
  moved.x += 10
  moved.y += 10
  homes[1].retired = w.month
  for (const mode of ['coarse', 'fine'] as const) {
    rebuildAdaptiveMesh(w, mode)
    refreshAdaptiveTotals(w)
    const accept = (s: typeof moved) => s.kind === 'residential' && s.pool % 2 === 0
    const search = snapshotSiteSearch(w, accept)
    for (const point of [moved, ...homes.filter((_, i) => i % 47 === 0)])
      for (const radius of [0, 1024, 6000])
        assert.deepEqual(
          search(point, radius).map((s) => s.id),
          queryAdaptiveSites(w, point, radius, accept).map((s) => s.id),
        )
    assert(!search(homes[1], 0).some((s) => s === homes[1]))
  }
})

test('cached community identities follow every mutable identity and locality field', () => {
  const group = fixture().regions[0].communities![0]
  const expected = () =>
    `${group.culture}:${group.language}:${group.belief}:${group.movement}:${group.allegiance}:${group.stratum ?? 'laborer'}${group.locality === undefined ? '' : ':local:' + group.locality}`
  assert.equal(communityKey(group), expected())
  for (const field of ['culture', 'language', 'belief', 'movement', 'allegiance'] as const) {
    group[field]++
    assert.equal(communityKey(group), expected())
  }
  group.locality = 999
  assert.equal(communityKey(group), expected())
  group.stratum = 'owner'
  assert.equal(communityKey(group), expected())
  delete group.locality
  delete group.stratum
  assert.equal(communityKey(group), expected())
  assert.equal(communityKey(structuredClone(group)), expected())
})

test('accessibility and time-only searches retain exact door-to-door routes, limits and blocked destinations', () => {
  const w = fixture()
  ensureAdaptiveWorld(w)
  const origins = w.cells.filter((c) => c.terrain !== 'water').filter((_, i) => i % 127 === 0)
  for (const origin of origins)
    for (const delta of [0, 1, w.width + 1, 2 * w.width + 2, 5 * w.width + 4]) {
      const cell = origin.id + delta
      if (!w.cells[cell]) continue
      const from = { cell: origin.id, ...cellPosition(w, origin.id) },
        to = { cell, ...cellPosition(w, cell) }
      from.x += 200
      to.y -= 150
      for (const limit of [0, 10, 60, 90]) {
        const expected = commuteSiteRoute(w, from, to, limit)
        assert.equal(commuteSiteMinutes(w, from, to, limit), expected?.minutes ?? null)
        assert.equal(canCommuteSites(w, from, to, limit), expected !== null)
      }
    }
})

test('retained mesh geometry agrees with a full rebuild through activity changes, dwell expiry and geography edits', () => {
  const w = fixture()
  prepareSpatialWorld(w)
  const geometry = (mesh: ReturnType<typeof rebuildAdaptiveMesh>) =>
    mesh.leaves.map((n) => ({
      ...n,
      fragments: n.fragments.map((f) => ({ cell: f.cell, water: f.water, area: f.area, polygon: f.polygon })),
    }))
  for (const month of [1, 2, 3, 13, 14]) {
    w.month = month
    const home = Object.values(w.adaptive!.sites).find((s) => s.kind === 'residential' && s.capacity > 0)!
    home.residents = (home.residents ?? 0) + 1
    home.x += 1
    if (month === 3) w.adaptive!.minimumSpan *= 2
    if (month === 14) w.cells[0].terrain = w.cells[0].terrain === 'water' ? 'plains' : 'water'
    const cold = structuredClone(w)
    const actual = rebuildAdaptiveMesh(w),
      expected = rebuildAdaptiveMesh(cold)
    assert.deepEqual(geometry(actual), geometry(expected), `month ${month}`)
    assert.deepEqual(w.adaptive!.tree, cold.adaptive!.tree)
  }
})
