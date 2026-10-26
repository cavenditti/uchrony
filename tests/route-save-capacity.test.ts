import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { inventory } from '../src/sim/types'

test('route-summary capacity follows the number of region pairs and retains every recorded shipment', () => {
  const w = generateWorld('Route summary capacity', 3, 8, undefined, 'regional')
  // The original summary-only format remains supported; these records do not
  // manufacture inventory, money or new physical routes during restoration.
  for (const from of w.regions) {
    for (const to of w.regions) {
      if (from.id === to.id || w.routes.length >= 20001) continue
      w.routes.push({
        id: `${from.id}-${to.id}`,
        from: from.id,
        to: to.id,
        path: [from.id, to.id],
        goods: { ...inventory(), food: 1 },
        volume: 1,
        value: 1,
        capacity: 1,
        sea: false,
        international: from.nation !== to.nation,
      })
    }
  }
  assert.equal(w.routes.length, 20001)
  validateWorld(w)
  const restored = restoreWorld(structuredClone(w))
  assert.deepEqual(restored, w)
  w.routes = Array(w.regions.length * (w.regions.length - 1) + 1).fill(w.routes[0])
  assert.throws(() => validateWorld(w), /invalid routes/)
})
