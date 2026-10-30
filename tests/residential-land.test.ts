import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld } from '../src/sim/engine'
import { cellPosition } from '../src/sim/physical-space'
import { createResidentialParcel, findResidentialParcel } from '../src/sim/residential-sites'
import { habitableLand } from '../src/sim/terrain-access'
import { CELL_METERS } from '../src/sim/grid'
import { ensureUrbanFabric } from '../src/sim/urban-fabric'
import type { PhysicalSite } from '../src/sim/adaptive-types'
import { residentialParcelOnLand } from '../src/sim/residential-geometry'
import { urbanFixture } from './fixtures/urban-evolution'

test('parcel land checks retain legacy bounds and urban ownership and terrain restrictions', () => {
  const { w } = urbanFixture('boundary')
  const parcel = { x: 1016, y: 790, size: 20 }
  assert.equal(residentialParcelOnLand(w, 1, 0, parcel), false, 'legacy parcels stay in their source cell')
  ensureUrbanFabric(w)
  assert.equal(residentialParcelOnLand(w, 1, 0, parcel), true, 'urban plots may cross domestic cells')
  w.regions[0].nation = 1
  assert.equal(residentialParcelOnLand(w, 1, 0, parcel), false, 'foreign land remains excluded')
  w.regions[0].nation = 0
  w.cells[0].terrain = 'water'
  assert.equal(residentialParcelOnLand(w, 1, 0, parcel), false, 'water remains excluded')
  w.cells[0].terrain = 'plains'
  w.cells[0].elevation = 1
  assert.equal(residentialParcelOnLand(w, 1, 0, parcel), false, 'high mountains remain excluded')
  w.cells[0].elevation = 0.2
  w.regions[0].devastation = 0.91
  assert.equal(residentialParcelOnLand(w, 1, 0, parcel), false, 'devastated land remains excluded')
  w.regions[0].devastation = 0.9
  assert.equal(residentialParcelOnLand(w, 1, 0, parcel), true)
})

test('coarse housing surveys skip coastal edge plots rejected by construction', () => {
  const w = generateWorld('Residential coast', 3, 8, undefined, 'regional')
  prepareSpatialWorld(w)
  ensureUrbanFabric(w)
  assert(w.adaptive!.urban!.enabled)
  assert.equal(w.adaptive!.buildingVersion, undefined)
  const cell = w.cells.findIndex(
    (c, i) =>
      i % w.width < w.width - 1 &&
      habitableLand(c) &&
      w.regions[c.region].nation >= 0 &&
      w.cells[i + 1].terrain === 'water',
  )
  assert(cell >= 0)
  const pool = w.localEconomy!.active.find((id) => w.localEconomy!.units[id].cells.includes(cell))!
  const center = cellPosition(w, cell)
  // The nearest 128m plot ends exactly at the eastern shoreline. Inclusive
  // polygon membership used to offer it, while urban land assigns that edge
  // to the water cell and rejects it when the monthly tick starts building.
  const point = { x: center.x + CELL_METERS / 2 - 64, y: center.y + 64 }
  const near: PhysicalSite = {
    id: 'survey-origin',
    kind: 'residential',
    entity: `residents:${pool}`,
    pool,
    cell,
    ...point,
    capacity: 0,
    openingCapacity: 0,
    capitalReference: 0,
    founded: w.month,
    residents: 0,
  }
  const rejected = { x: point.x - 64, y: point.y - 64, size: 128 }
  assert.throws(() => createResidentialParcel(w, pool, cell, point, rejected), /crosses its source land/)
  const sequence = w.adaptive!.nextResidence
  const plot = findResidentialParcel(w, near, [])
  assert(plot, 'a safe inland alternative is available')
  assert.equal(w.adaptive!.nextResidence, sequence, 'surveying does not reserve or mutate housing')
  assert.doesNotThrow(() => createResidentialParcel(w, pool, plot.cell, plot.point, plot.parcel))
  assert.notDeepEqual(plot.parcel, rejected)
})
