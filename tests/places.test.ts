import test from 'node:test'
import assert from 'node:assert/strict'
import { placeTree, refreshPlaces, significantAncestors } from '../src/sim/places'
import { PLACE_TOPOLOGY, type FieldMode, type SettlementTopology } from '../src/sim/settlement-topology'
import { CELL_METERS } from '../src/sim/grid'
import type { PhysicalSite } from '../src/sim/adaptive-types'
import type { World } from '../src/sim/types'
import { addRecord, addTown, livingPlaces, settlementWorld } from './fixtures/settlement-world'

const move = (from: PhysicalSite[], to: PhysicalSite[], share: number) => {
  for (let i = 0; i < from.length; i++) {
    const n = Math.floor(from[i].residents! * share)
    from[i].residents! -= n
    to[i % to.length].residents! += n
  }
}
const advance = (w: World, months: number) => {
  for (let i = 0; i < months; i++) {
    w.month++
    refreshPlaces(w)
  }
}

test('evenly developed land names one place at its centre of mass, not a grid of villages', () => {
  const w = settlementWorld(24, 24)
  for (let r = 6; r < 14; r++) for (let q = 6; q < 14; q++) addRecord(w, r * 24 + q, 3000, 0.05)
  refreshPlaces(w)
  const places = livingPlaces(w)
  assert.equal(places.length, 1)
  assert.equal(places[0].population, 64 * 3000)
  assert.equal(places[0].sites!.length, 64)
  // The label sits between terrain-sample centres, at the block's centre of mass.
  assert(Math.abs(places[0].field!.x - 10 * CELL_METERS) < 1e-6)
  assert(Math.abs(places[0].field!.y - 10 * CELL_METERS) < 1e-6)
})

test('a dominant centre draws the evenly settled land around it into one place', () => {
  const w = settlementWorld(24, 24)
  for (let r = 6; r < 14; r++) for (let q = 6; q < 14; q++) addRecord(w, r * 24 + q, 3000, 0.05)
  addTown(w, { x: 7.3 * CELL_METERS, y: 7.3 * CELL_METERS }, 30000, 512)
  refreshPlaces(w)
  const places = livingPlaces(w)
  assert.equal(places.length, 1)
  // The summit, and hence the label, moves toward the relevant centre.
  assert(places[0].field!.x < 10 * CELL_METERS && places[0].field!.y < 10 * CELL_METERS)
})

test('separate towns are separate places whose identities persist through growth and refreshes', () => {
  const w = settlementWorld(32, 32)
  const a = addTown(w, { x: 6000, y: 6000 }, 6000),
    b = addTown(w, { x: 20000, y: 20000 }, 2000)
  refreshPlaces(w)
  const [first, second] = livingPlaces(w)
  assert.equal(livingPlaces(w).length, 2)
  assert(!first.metropolis && !second.metropolis)
  const snapshot = JSON.stringify(w.localEconomy)
  refreshPlaces(w)
  assert.equal(JSON.stringify(w.localEconomy), snapshot, 'same-month refreshes change nothing')
  move(a, b, 0.5)
  advance(w, 3)
  const census = (sites: PhysicalSite[]) => sites.reduce((sum, s) => sum + s.residents!, 0)
  assert.deepEqual(
    livingPlaces(w).map((c) => [c.id, c.name, c.population]),
    [
      [second.id, second.name, census(b)],
      [first.id, first.name, census(a)],
    ],
  )
})

test('a satellite engulfed by infill links, becomes a quarter after the dwell, and is released', () => {
  const w = settlementWorld(32, 32)
  const city = addTown(w, { x: 6000, y: 6000 }, 20000, 512)
  addTown(w, { x: 9500, y: 6000 }, 5000)
  const infill = addTown(w, { x: 7750, y: 6000 }, 0)
  refreshPlaces(w)
  const satellite = livingPlaces(w)[1]
  assert(!satellite.metropolis)
  assert(satellite.field!.prominence >= PLACE_TOPOLOGY.release)
  move(city, infill, 0.15)
  advance(w, 1)
  assert(satellite.field!.prominence < PLACE_TOPOLOGY.incorporation)
  assert.deepEqual(satellite.metropolis, { centre: livingPlaces(w)[0].id, since: 1, pending: 1 })
  advance(w, PLACE_TOPOLOGY.transitionMonths - 1)
  assert.equal(satellite.metropolis!.incorporated, undefined, 'the dwell has not elapsed')
  advance(w, 1)
  assert.equal(satellite.metropolis!.incorporated, 1 + PLACE_TOPOLOGY.transitionMonths)
  move(infill, city, 1)
  advance(w, PLACE_TOPOLOGY.transitionMonths)
  assert.equal(satellite.metropolis!.incorporated, 1 + PLACE_TOPOLOGY.transitionMonths)
  advance(w, 1)
  assert.equal(satellite.metropolis, undefined)
  assert.deepEqual(
    satellite.history!.map((e) => e.kind),
    ['linked', 'incorporated', 'released'],
  )
  assert.equal(satellite.population, 5000, 'administration never moves residents')
})

test('sprawl that reaches a town makes it a shoulder of the city; it merges and survives as an alias', () => {
  const w = settlementWorld(32, 32)
  addTown(w, { x: 6000, y: 6000 }, 10000, 512)
  addTown(w, { x: 9500, y: 6000 }, 3000)
  refreshPlaces(w)
  const [large, small] = livingPlaces(w)
  assert(small.field!.prominence >= PLACE_TOPOLOGY.release, 'two independent towns 3.5 km apart')
  // Density alone does not swallow a neighbour; new fabric between them does.
  addTown(w, { x: 8000, y: 6000 }, 15000, 512)
  advance(w, 1)
  assert.equal(small.absorbedBy, large.id)
  assert(large.aliases.includes(small.name))
  assert(large.parents.includes(small.id))
  assert.equal(small.population, 0)
  assert.equal(large.population, 28000)
  assert.equal(small.history!.at(-1)!.kind, 'merged')
  assert.equal(livingPlaces(w).length, 1)
})

test('a coarse record founds a place only once enough of it is developed fabric', () => {
  const w = settlementWorld(8, 8)
  const record = addRecord(w, 27, 6000, 0.005)
  refreshPlaces(w)
  assert.equal(livingPlaces(w).length, 0, '240 developed residents are a hamlet, not a town of 6,000')
  record.openingBuilt = 0.02
  advance(w, 1)
  const [place] = livingPlaces(w)
  assert(place)
  assert.equal(place.population, 6000, 'once named, a place administers all its occupants')
})

test('a place below the label threshold persists until its last resident leaves', () => {
  const w = settlementWorld(8, 8)
  const town = addTown(w, { x: 3000, y: 3000 }, 2000)
  refreshPlaces(w)
  const [place] = livingPlaces(w)
  for (const site of town) site.residents = 0
  town[0].residents = 50
  advance(w, 1)
  assert.equal(place.population, 50)
  assert.equal(place.abandoned, undefined)
  assert.deepEqual(place.sites, [town[0].id])
  town[0].residents = 0
  advance(w, 1)
  assert.equal(place.abandoned, w.month)
  assert.deepEqual([place.population, place.cells.length, place.sites!.length], [0, 0, 0])
  const before = JSON.stringify(place)
  advance(w, 1)
  assert.equal(JSON.stringify(place), before)
})

test('legacy prestige and dominance fields are dropped without disturbing an incorporation', () => {
  const w = settlementWorld(32, 32)
  addTown(w, { x: 6000, y: 6000 }, 20000, 512)
  addTown(w, { x: 9000, y: 6000 }, 5000)
  refreshPlaces(w)
  const [, quarter] = livingPlaces(w)
  assert.equal(quarter.metropolis!.incorporated, 0, 'a new basin on a city flank is born a quarter')
  quarter.standing = { prestige: 3, wealthPerResident: 10 }
  quarter.metropolis!.dominantSince = 0
  quarter.metropolis!.overwhelmingSince = 0
  advance(w, 1)
  assert.equal(quarter.standing, undefined)
  assert.deepEqual(quarter.metropolis, { centre: livingPlaces(w)[0].id, since: 0, incorporated: 0 })
})

test('places never span a border', () => {
  const w = settlementWorld(16, 8, (cell) => (cell % 16 < 8 ? 0 : 1))
  addTown(w, { x: 8 * CELL_METERS - 300, y: 4000 }, 3000)
  addTown(w, { x: 8 * CELL_METERS + 300, y: 4000 }, 3000)
  refreshPlaces(w)
  const places = livingPlaces(w)
  assert.equal(places.length, 2)
  assert(places.every((p) => !p.metropolis))
  for (const place of places) assert.equal(new Set(place.cells.map((c) => w.cells[c].region)).size, 1)
})

test('the merge tree resolves ripples to ancestors and pools small basins into the place they join', () => {
  // Area 0: summit 0; mode 1 is a weak shoulder (prominence 1/6); mode 2 a clear
  // centre; mode 3 a ripple on mode 2. Area 1: a lone summit too small to name.
  const modes: FieldMode[] = [
    { node: 0, peak: 100, saddle: 0, parent: -1, area: 0 },
    { node: 1, peak: 60, saddle: 50, parent: 0, area: 0 },
    { node: 2, peak: 40, saddle: 5, parent: 0, area: 0 },
    { node: 3, peak: 10, saddle: 9.5, parent: 2, area: 0 },
    { node: 4, peak: 20, saddle: 0, parent: -1, area: 1 },
  ]
  const topology = { modes, summits: [0, 4], modeAt: () => -1 } as SettlementTopology
  const none = new Uint8Array(5)
  assert.deepEqual([...significantAncestors(modes, none)], [0, 0, 2, 2, 4])
  // A held shoulder keeps its own peak until it drops below the retirement prominence.
  assert.deepEqual([...significantAncestors(modes, Uint8Array.from([0, 1, 0, 0, 0]))], [0, 1, 2, 2, 4])
  const rep = significantAncestors(modes, none)
  const tree = placeTree(topology, rep, Float64Array.from([400, 300, 200, 400, 100]), () => false)
  assert.deepEqual([...tree.isPlace], [1, 0, 1, 0, 0])
  assert.deepEqual([...tree.principal], [0, -1])
  assert.equal(tree.placeOf[2], 2)
  assert.equal(tree.placeOf[4], -1, 'an unnamed lone summit is open country')
  // Without the ripple's residents, mode 2 is too small to name and joins the summit's place.
  const pooled = placeTree(topology, rep, Float64Array.from([300, 0, 200, 0, 100]), () => false)
  assert.deepEqual([...pooled.isPlace], [1, 0, 0, 0, 0])
  assert.equal(pooled.placeOf[2], 0)
  // An owned basin is a place whatever its size.
  assert.equal(placeTree(topology, rep, new Float64Array(5), (m) => m === 4).isPlace[4], 1)
})
