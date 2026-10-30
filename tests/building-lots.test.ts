import { settlementPlaces } from '../src/map/settlement-scenery'
import { describeCity, cityLayout } from '../src/map/city-layout'
import { activityLayout } from '../src/map/activity-layout'
import { economicLandscape } from '../src/sim/economic-landscape'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensureAdaptiveWorld, rebuildAdaptiveMesh, refreshAdaptiveTotals } from '../src/sim/adaptive-world'
import {
  ensureResidentialSites,
  residentialSites,
  syncResidentialPopulation,
} from '../src/sim/residential-sites'
import { ensureBuildingLots, buildingFootprint } from '../src/sim/building-lots'
import { findOrganicParcel } from '../src/sim/urban-growth'
import { prepareSpatialWorld } from '../src/sim/engine'
import { cellPosition, pointInPolygon, cellPolygon } from '../src/sim/physical-space'
import { mapLeafAt, mapBuildingAt } from '../src/map/quadtree'
import { mapHomesSnapshot } from '../src/sim/map-snapshot'
import { balances } from '../src/sim/ledger'
import { physicalStocks } from '../src/sim/goods-accounting'
import { settlementStructure } from '../src/sim/settlement-topology'
import { refreshPlaces } from '../src/sim/places'
import { planHousingInvestment } from '../src/sim/housing-investment'
import { settlementAccess } from '../src/sim/settlement-access'
import { apportion } from '../src/sim/allocation'
import { population } from '../src/sim/types'
import { validateWorld } from '../src/sim/persistence'

function fixture() {
  const w = generateWorld('Building lots', 3, 8, undefined, 'regional', 'frontier')
  prepareSpatialWorld(w)
  return w
}

test('building subdivision conserves physical and financial totals while keeping coarse economic pools', () => {
  const w = generateWorld('Building lots', 3, 8, undefined, 'regional', 'frontier')
  ensureAdaptiveWorld(w)
  ensureResidentialSites(w)
  const holdings = () =>
    JSON.stringify({
      people: w.regions.map((r) => r.communities),
      money: balances(w),
      stocks: physicalStocks(w),
      units: w.localEconomy!.active,
      producers: w.economy!.producers,
      households: w.economy!.households,
      loans: w.economy!.credit.loans,
    })
  const before = holdings()
  const capacity = residentialSites(w).reduce((n, s) => n + s.capacity, 0)
  assert(ensureBuildingLots(w))
  syncResidentialPopulation(w)
  rebuildAdaptiveMesh(w)
  assert.equal(holdings(), before)
  assert(Math.abs(residentialSites(w).reduce((n, s) => n + s.capacity, 0) - capacity) < 1e-7)
  const buildings = residentialSites(w).filter((s) => s.building)
  assert(buildings.length > w.localEconomy!.active.length * 5)
  assert.equal(w.adaptive!.minimumSpan, 8)
  for (const site of buildings) {
    assert(site.parcel!.size >= 10 && site.parcel!.size <= 40)
    assert(site.building!.every((point) => pointInPolygon(point, cellPolygon(w, site.cell))))
    if (site.residents) {
      assert.equal(mapLeafAt(w, site)!.bounds.size, 8)
      assert.equal(mapBuildingAt(w, site)?.id, site.id)
      assert.notEqual(mapBuildingAt(w, { x: site.parcel!.x + 0.1, y: site.parcel!.y + 0.1 })?.id, site.id)
    }
  }
  assert(!ensureBuildingLots(w), 'conversion is idempotent')
  assert(new Set(buildings.map((s) => Math.round(s.parcel!.size))).size > 12)
  assert(new Set(buildings.map((s) => Math.floor(s.capacity))).size > 10)
  validateWorld(w)
})

test('building geometry and occupancy survive coarse/fine numerical remeshing and display projection', () => {
  const w = fixture()
  const before = JSON.stringify(w.adaptive!.sites)
  const pools = [...w.localEconomy!.active]
  rebuildAdaptiveMesh(w, 'coarse')
  rebuildAdaptiveMesh(w, 'adaptive')
  assert.equal(JSON.stringify(w.adaptive!.sites), before)
  assert.deepEqual(w.localEconomy!.active, pools)
  const shown = mapHomesSnapshot(w)
  for (const s of residentialSites(w).filter((s) => s.building)) {
    const copy = shown.find((h) => h.id === s.id)!
    assert.deepEqual(copy.building, s.building)
    assert.notEqual(copy.building, s.building)
  }
  const places = settlementPlaces(w)
  assert.equal(places.length, residentialSites(w).filter((s) => s.building && s.capacity > 0).length)
  const place = places[0],
    source = w.adaptive!.sites[place.nucleusSite!]
  const layout = cityLayout(w, describeCity(w, place))
  assert.equal(layout.buildings.length, 1)
  assert.equal(layout.buildings[0].representedCapacity, source.capacity)
  assert.equal(layout.streets.length, 0)
  const activity = activityLayout(w, economicLandscape(w), place.cell)
  assert.equal(activity.pieces.length, 0, 'economic activity does not invent extra buildings')
  assert.equal(activity.motions.length, 0, 'coarse activity does not invent building-scale residents')
  assert(
    Math.abs(
      layout.buildings[0].width * w.adaptive!.metersPerMapUnit -
        Math.hypot(
          source.building![1].x - source.building![0].x,
          source.building![1].y - source.building![0].y,
        ),
    ) < 1e-8,
  )
  validateWorld(w)
})

test('occupied buildings in a gap become urban fabric; empty ones add none; nearby clusters share one place', () => {
  const w = fixture(),
    unit = w.localEconomy!.units[w.nations[0].capital]
  const homes = residentialSites(w).filter((s) => s.pool === unit.id && s.building)
  const center = cellPosition(w, unit.center),
    total = population(unit)
  homes.forEach((s) => {
    s.residents = 0
    s.capacity = 0
  })
  const place = (site: (typeof homes)[number], x: number, y: number, residents: number) => {
    site.x = center.x + x
    site.y = center.y + y
    site.cell = unit.center
    site.parcel = { x: site.x - 8, y: site.y - 8, size: 16 }
    site.building = buildingFootprint(w.seed, site)
    site.residents = residents
    site.capacity = Math.max(24, residents)
  }
  const parts = apportion(total, Array(144).fill(1))
  for (let i = 0; i < 144; i++) {
    const j = i % 72
    place(homes[i], (i < 72 ? -360 : 160) + (j % 8) * 16, Math.floor(j / 8) * 16 - 64, parts[i])
  }
  const bridges = homes.slice(144, 168)
  bridges.forEach((s, i) => place(s, -232 + i * 16, 0, 0))
  syncResidentialPopulation(w)
  rebuildAdaptiveMesh(w)
  // Neighbourhood urbanity of the buildings in the gap, and the market-scale places.
  const gap = () => {
    const structure = settlementStructure(w)
    return bridges.map((b) => {
      const i = structure.sources.findIndex((s) => s.id === b.id)
      return { urban: structure.sourceUrbanity[i], developed: structure.sources[i].developed }
    })
  }
  const vacant = gap()
  assert(
    vacant.every((b) => b.urban === 0 && b.developed === 0),
    'empty capacity is not fabric',
  )
  refreshPlaces(w)
  const ours = () =>
    w.localEconomy!.cities.filter(
      (c) => c.absorbedBy === undefined && c.abandoned === undefined && c.sites!.includes(homes[0].id),
    )
  assert.equal(ours().length, 1, 'clusters 400 m apart are one place at market scale')
  const identity = ours()[0].id
  bridges.forEach((s, i) => {
    homes[i].residents! -= 4
    s.residents = 4
  })
  syncResidentialPopulation(w)
  refreshAdaptiveTotals(w)
  assert(gap().every((b) => b.urban > 0 && b.developed === 4))
  w.month++
  refreshPlaces(w)
  assert.deepEqual(
    ours().map((c) => c.id),
    [identity],
  )
  assert(homes.slice(0, 168).every((s) => ours()[0].sites!.includes(s.id)))
})

test('outward housing investment surveys one building lot with finite material and labor costs', () => {
  const w = fixture(),
    unit = w.localEconomy!.units[w.nations[0].capital]
  const homes = residentialSites(w).filter((s) => s.pool === unit.id)
  for (const home of homes) if (home.building) home.capacity = 100
  unit.stocks.timber = 1000
  unit.stocks.stone = 1000
  w.economy!.producers[unit.id].cash = 1000
  const target = homes.find((s) => s.building)!
  const plan = planHousingInvestment(w, target, 10, homes, 1000, settlementAccess(w))!
  assert(plan?.plot)
  assert(plan.plot.building)
  assert(plan.plot.parcel.size >= 10 && plan.plot.parcel.size <= 40)
  assert(plan.spaces > 0 && plan.spaces <= 10)
  assert(plan.inputs.timber > 0 && plan.inputs.stone > 0 && plan.inputs.labor > 0)
})

test('older building saves without lanes can expand without relocating existing houses', () => {
  const w = fixture(),
    home = residentialSites(w).find((s) => s.building)!
  delete w.adaptive!.lanes
  const before = JSON.stringify(w)
  const plot = findOrganicParcel(w, home, [home])
  assert(plot?.building && plot.lanes.length > 0)
  assert.equal(JSON.stringify(w), before)
})
