import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, neighbors } from '../src/sim/generate'
import { buildGeometry, contains, geographyKey, zoomAt } from '../src/map/geometry'
import { validateWorld } from '../src/sim/persistence'
import type { World } from '../src/sim/types'

function landmasses(w: World) {
  const seen = new Set<number>(),
    groups: number[][] = []
  for (const c of w.cells) {
    if (c.terrain === 'water' || seen.has(c.id)) continue
    const group = [c.id]
    seen.add(c.id)
    for (let i = 0; i < group.length; i++)
      for (const n of neighbors(group[i], w.width, w.height))
        if (w.cells[n].terrain !== 'water' && !seen.has(n)) {
          seen.add(n)
          group.push(n)
        }
    groups.push(group)
  }
  return groups.sort((a, b) => b.length - a.length)
}

test('continental settings produce distinct major landmasses, offshore islands, and an ocean frame', () => {
  for (const seed of ['A world unwritten', 'North and south', 'Ridgewater'])
    for (const count of [1, 2, 3, 5]) {
      const w = generateWorld(seed, count, 12)
      validateWorld(w)
      const groups = landmasses(w),
        major = groups.filter((g) => g.length >= 300)
      assert.equal(major.length, count, `${seed}, setting ${count}: ${groups.map((g) => g.length)}`)
      assert(
        groups.some((g) => g.length >= 2 && g.length < 100),
        'offshore islands',
      )
      const land = w.cells.filter((c) => c.terrain !== 'water').length
      assert(land > 2000 && land < 6000, 'useful land/ocean balance')
      assert(
        w.cells
          .filter((c) => c.q === 0 || c.r === 0 || c.q === w.width - 1 || c.r === w.height - 1)
          .every((c) => c.terrain === 'water'),
      )
    }
})

test('drainage always descends to the sea, runoff accumulates, and visible rivers do not stop inland', () => {
  const w = generateWorld('Watersheds')
  assert(w.cells.filter((c) => c.river).length > 100)
  for (const c of w.cells)
    if (c.terrain !== 'water') {
      let node = c,
        steps = 0
      while (node.terrain !== 'water') {
        assert(node.downstream !== undefined)
        assert(neighbors(node.id, w.width, w.height).includes(node.downstream))
        const next = w.cells[node.downstream]
        assert(next.elevation < node.elevation)
        assert((next.riverFlow ?? 0) >= (node.riverFlow ?? 0))
        if (node.river && next.terrain !== 'water') assert(next.river)
        node = next
        assert(++steps < w.cells.length)
      }
    }
})

test('provinces remain connected and rendered polygons contain their simulation cell centers', () => {
  const w = generateWorld('Rugged borders', 5),
    geometry = buildGeometry(w.cells, w.width, w.height, w.regions.length)
  for (const r of w.regions) {
    const seen = new Set([r.center]),
      queue = [r.center]
    for (let i = 0; i < queue.length; i++)
      for (const n of neighbors(queue[i], w.width, w.height))
        if (w.cells[n].region === r.id && !seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
    assert.equal(seen.size, r.cells.length, `province ${r.id}`)
    for (const id of r.cells) {
      const c = w.cells[id]
      assert(contains(geometry.provinces[r.id], c.x, c.y), `cell ${id}`)
    }
  }
  assert(!contains(geometry.coast, 0, 0))
})

test('geographic cache keys ignore economic changes but reflect different loaded geography', () => {
  const w = generateWorld('Cache'),
    key = geographyKey(w.cells)
  w.regions[0].population.adults++
  assert.equal(geographyKey(w.cells), key)
  w.cells[100].elevation += 0.01
  assert.notEqual(geographyKey(w.cells), key)
})

test('zoom holds the geographic point under the cursor fixed, including clamped limits', () => {
  const view = { zoom: 1.4, x: 45, y: -20 },
    point = { x: 700, y: 200 },
    size = { w: 900, h: 650 }
  for (const factor of [1.1, 0.91, 100, 0.001]) {
    const next = zoomAt(view, factor, point, size)
    const beforeX = (point.x - size.w / 2 - view.x) / view.zoom,
      beforeY = (point.y - size.h / 2 - view.y) / view.zoom
    assert(Math.abs((point.x - size.w / 2 - next.x) / next.zoom - beforeX) < 1e-10)
    assert(Math.abs((point.y - size.h / 2 - next.y) / next.zoom - beforeY) < 1e-10)
  }
})

test('legacy saves remain loadable and malformed drainage is rejected', () => {
  const w = generateWorld('Legacy')
  delete w.generatorVersion
  for (const c of w.cells) {
    delete c.downstream
    delete c.riverFlow
  }
  validateWorld(w)
  const c = w.cells.find((c) => c.terrain !== 'water')!
  c.downstream = c.id
  assert.throws(() => validateWorld(w), /downstream/)
  delete c.downstream
  c.riverFlow = -1
  assert.throws(() => validateWorld(w), /runoff/)
})
