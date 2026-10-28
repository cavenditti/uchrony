import test from 'node:test'
import assert from 'node:assert/strict'
import { urbanFixture } from './fixtures/urban-evolution'
import { ensureUrbanFabric } from '../src/sim/urban-fabric'
import { urbanCharacter } from '../src/sim/urban-character'
import { mapHomesSnapshot } from '../src/sim/map-snapshot'
import { describeCity } from '../src/map/city-layout'
import type { Settlement } from '../src/sim/spatial'
import { urbanBlocks } from '../src/sim/urban-blocks'

test('neighbourhood character describes actual floor uses without mutating the city', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  sites[0].fabric!.uses = { housing: 80, production: 280, market: 0, logistics: 0, civic: 0 }
  const before = JSON.stringify(w)
  assert.equal(urbanCharacter(w, [sites[0]]).name, 'Workshop quarter')
  assert.equal(urbanCharacter(w, sites).name, 'Residential neighbourhood')
  assert.equal(JSON.stringify(w), before)
  assert.equal(
    urbanBlocks(w).reduce((n, b) => n + b.residents, 0),
    96,
  )
})

test('map projection retains converted premises and disruptive construction at zero capacity', () => {
  const { w, sites } = urbanFixture()
  ensureUrbanFabric(w)
  const s = sites[0]
  s.capacity = 0
  s.residents = 0
  s.fabric!.uses = { housing: 0, production: 0, market: 0, logistics: 360, civic: 0 }
  const home = mapHomesSnapshot(w).find((h) => h.id === s.id)!
  assert.ok(home)
  assert.equal(home.fabric!.uses.logistics, 360)
  home.works = { stage: 'construction', progress: 0.5, disruptive: true }
  const view = { ...w, viewHomes: [home] }
  const city = describeCity(view, {
    id: 'test',
    cell: s.cell,
    region: 0,
    kind: 'village',
    capital: false,
    nucleusSite: s.id,
  } as Settlement)
  assert.equal(city.building!.use, 'logistics')
  assert.equal(city.building!.roof, 'flat')
  assert.equal(city.building!.works, true)
  assert.ok(city.building!.height > 0)
  assert.equal(city.building!.representedCapacity, 0)
})
