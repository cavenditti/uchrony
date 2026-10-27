import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, tick } from '../src/sim/engine'
import { inRiverChannel, riverCurves, riverPoint, riverHalfWidth } from '../src/map/rivers'

test('the rendered channel test covers crossings, containment and setbacks', () => {
  const w = generateWorld('River lots', 3, 8, undefined, 'regional', 'frontier')
  const curve = riverCurves(w).find((c) => riverHalfWidth(c, 0.5) > 0.5)!
  const p = riverPoint(curve, 0.5),
    r = riverHalfWidth(curve, 0.5)
  const square = (x: number, y: number, s: number) => [
    { x: x - s, y: y - s },
    { x: x + s, y: y - s },
    { x: x + s, y: y + s },
    { x: x - s, y: y + s },
  ]
  // A house smaller than the river, standing in it, touches no channel vertex.
  assert(inRiverChannel(w, square(p.x, p.y, r * 0.2)))
  // A house wider than the river straddles it without any corner in the water.
  assert(inRiverChannel(w, square(p.x, p.y, r * 3)))
  const t = 0.55,
    q = riverPoint(curve, t),
    dx = q.x - p.x,
    dy = q.y - p.y,
    n = Math.hypot(dx, dy),
    bank = { x: p.x - (dy / n) * (r + 0.3), y: p.y + (dx / n) * (r + 0.3) }
  assert(!inRiverChannel(w, square(bank.x, bank.y, 0.05)))
  assert(inRiverChannel(w, square(bank.x, bank.y, 0.05), 0.4))
})

test('frontier lot surveys keep every house out of the rendered river', () => {
  const w = generateWorld('Frontier probe', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  for (let month = 0; month < 3; month++) tick(w)
  const scale = w.adaptive!.metersPerMapUnit
  const homes = Object.values(w.adaptive!.sites).filter((s) => s.building)
  assert(homes.length > 1000)
  const wet = homes.filter((s) =>
    inRiverChannel(
      w,
      s.building!.map((p) => ({ x: p.x / scale, y: p.y / scale })),
    ),
  )
  assert.deepEqual(
    wet.map((s) => s.id),
    [],
  )
})
