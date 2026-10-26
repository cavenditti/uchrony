import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { neighbors, CELL_METERS } from '../src/sim/grid'
import { ensureAdaptiveWorld } from '../src/sim/adaptive-world'
import { routeDistance } from '../src/map/trade'

test('freight distance labels use the same physical scale as inspection and the map bar', () => {
  const w = generateWorld('Physical display scale')
  const first = w.regions[0].center,
    next = neighbors(first, w.width, w.height)[0]
  const route = { legs: [{ mode: 'land' as const, cells: [first, next, first] }] }
  assert(Math.abs(routeDistance(w, route)! - (2 * CELL_METERS) / 1000) < 1e-12)
  ensureAdaptiveWorld(w)
  assert(Math.abs(routeDistance(w, route)! - (2 * CELL_METERS) / 1000) < 1e-12)
  w.adaptive!.metersPerMapUnit *= 2
  assert(Math.abs(routeDistance(w, route)! - (4 * CELL_METERS) / 1000) < 1e-12)
  assert.equal(routeDistance(w, {}), undefined)
})
