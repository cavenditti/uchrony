import test from 'node:test'
import assert from 'node:assert/strict'
import { generateGeography, SEA_LEVEL } from '../src/sim/geography'
import { erodeDrainage } from '../src/sim/hydrology'
import { HEX, neighbors } from '../src/sim/hex'
import type { Cell } from '../src/sim/types'

function basin(width: number, height: number): Cell[] {
  return Array.from({ length: width * height }, (_, id) => {
    const q = id % width,
      r = Math.floor(id / width),
      ocean = q === 0 || r === 0 || q === width - 1 || r === height - 1
    return {
      id,
      q,
      r,
      x: (q + (r % 2) / 2) * Math.sqrt(3) * HEX,
      y: r * HEX * 1.5,
      elevation: ocean ? 0.05 : Math.min(q, r, width - q - 1, height - r - 1) <= 2 ? 0.4 : 0.2,
      moisture: 0.5,
      terrain: ocean ? 'water' : 'plains',
      region: -1,
      river: false,
    }
  })
}

function checkDrainage(cells: Cell[], width: number, height: number) {
  const incoming = new Float64Array(cells.length)
  for (const c of cells) {
    assert(Number.isFinite(c.elevation))
    assert(Number.isFinite(c.riverFlow) && c.riverFlow! >= 0)
    if (c.terrain === 'water') {
      assert.equal(c.downstream, undefined)
      continue
    }
    assert(c.downstream !== undefined)
    assert(neighbors(c.id, width, height).includes(c.downstream))
    const next = cells[c.downstream]
    assert(next.elevation < c.elevation, 'strict descent also rules out all cycles')
    assert(next.riverFlow! >= c.riverFlow!)
    if (c.river && next.terrain !== 'water') assert(next.river, 'no broken channels')
    incoming[next.id] += c.riverFlow!
  }
  return incoming
}

test('closed depressions acquire deterministic, descending outlets without losing runoff or moving the ocean', () => {
  const cells = basin(36, 28),
    original = structuredClone(cells),
    second = structuredClone(cells)
  erodeDrainage(cells, 36, 28, 'Lake outlet', SEA_LEVEL)
  erodeDrainage(second, 36, 28, 'Lake outlet', SEA_LEVEL)
  assert.deepEqual(cells, second)
  const incoming = checkDrainage(cells, 36, 28)
  let rain = 0,
    discharge = 0
  for (const c of cells) {
    const local = c.terrain === 'water' ? 0 : 0.4 + original[c.id].moisture
    assert(Math.abs(c.riverFlow! - incoming[c.id] - local) < 1e-8)
    rain += local
    if (c.terrain === 'water') {
      assert.equal(c.elevation, original[c.id].elevation)
      discharge += c.riverFlow!
    }
    assert.equal(c.region, -1)
    assert.equal(c.x, original[c.id].x)
    assert.equal(c.y, original[c.id].y)
  }
  assert(Math.abs(rain - discharge) < 1e-8)
  assert(
    cells.some((c) => c.elevation < original[c.id].elevation - 0.01),
    'channels incise actual terrain',
  )
})

test('largest-map regression: drainage branches instead of hundreds of long grid canals', () => {
  const cells = generateGeography('Map memory stress fixture', 3, 448, 288)
  checkDrainage(cells, 448, 288)
  let longRuns = 0
  const tributaries = new Uint8Array(cells.length)
  for (const c of cells) {
    if (!c.river) continue
    tributaries[c.downstream!]++
    const next = cells[c.downstream!],
      angle = Math.atan2(next.y - c.y, next.x - c.x)
    let node = c,
      run = 0
    while (node.river && node.downstream !== undefined) {
      const receiver = cells[node.downstream]
      if (Math.abs(Math.atan2(receiver.y - node.y, receiver.x - node.x) - angle) > 0.001) break
      run++
      node = receiver
    }
    if (run >= 12) longRuns++
  }
  // The reported defect yielded 1,472 such runs on this seed. Leave generous room
  // for evolution without permitting a return to the systematic parallel canals.
  assert(longRuns < 150, `${longRuns} straight runs of 12+ cells`)
  assert(tributaries.filter((n) => n > 1).length > 200, 'visible branching watersheds')
})

test('an all-ocean map remains valid and a land-only input fails explicitly', () => {
  const sea = basin(3, 3)
  for (const c of sea) {
    c.terrain = 'water'
    c.elevation = 0.02
  }
  erodeDrainage(sea, 3, 3, 'Ocean', SEA_LEVEL)
  checkDrainage(sea, 3, 3)
  const land = basin(3, 3)
  for (const c of land) c.terrain = 'plains'
  assert.throws(() => erodeDrainage(land, 3, 3, 'No outlet', SEA_LEVEL), /outlet/)
})
