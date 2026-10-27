import test from 'node:test'
import assert from 'node:assert/strict'
import type { World } from '../src/sim/types'
import type { PhysicalSite } from '../src/sim/adaptive-types'
import { multiCentreHousingDemand, housingCentres, coarseHousingDemand } from '../src/sim/housing-demand'
import { urbanBlocks } from '../src/sim/urban-blocks'
import { SETTLEMENT } from '../src/sim/settlement-model'
function rectangularFootprint(p: { x: number; y: number }, width: number, depth: number, angle: number) {
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => ({ x: p.x+x*width/2*Math.cos(angle)-y*depth/2*Math.sin(angle), y: p.y+x*width/2*Math.sin(angle)+y*depth/2*Math.cos(angle) }))
}
import { partitionCentres } from '../src/sim/urban-centres'
import type { City } from '../src/sim/district-types'

function fixture() {
  const homes = [128, 512, 896].map(
    (x, i) =>
      ({
        id: `home:${i}`,
        cell: 0,
        pool: 0,
        x,
        y: 512,
        kind: 'residential',
        entity: 'residents:0',
        founded: 0,
        residents: i === 1 ? 1000 : 100,
        capacity: i === 1 ? 1150 : 115,
        openingCapacity: 0,
        capitalReference: 1,
        parcel: { x: x - 8, y: 504, size: 16 },
        building: rectangularFootprint({ x, y: 512 }, 8, 10, 0.2),
      }) as PhysicalSite,
  )
  const w = {
    width: 1,
    height: 1,
    month: 0,
    cells: [{ id: 0, x: 6, y: 6, region: 0, terrain: 'plains', elevation: 0.2 }],
    regions: [{ nation: 0, devastation: 0 }],
    adaptive: {
      metersPerMapUnit: 1024 / 12,
      sites: Object.fromEntries(homes.map((s) => [s.id, s])),
      construction: [],
      lanes: [
        {
          points: [
            { x: 100, y: 512 },
            { x: 900, y: 512 },
          ],
          width: 4,
          pool: 0,
          founded: 0,
        },
      ],
    },
    localEconomy: {
      active: [0],
      cities: [],
      units: [{ population: { children: 0, adults: 1200, elders: 0 }, nation: 0 }],
    },
    economy: { firms: [] },
  } as unknown as World
  const score = (s: PhysicalSite) => (s.id === 'home:1' ? 0.1 : 1)
  const access = {
    homes: () => homes,
    occupied: (s: PhysicalSite) => s.residents!,
    vacancy: (s: PhysicalSite) => Math.max(0, s.capacity - s.residents!),
    baseUtility: score,
    utility: score,
  }
  return { w, homes, access }
}

test('block summaries conserve counts, clipped area and lane length across scales without mutation', () => {
  const { w, homes } = fixture()
  w.adaptive!.construction!.push({ site: homes[0].id, capacity: 20, cost: 10, remaining: 3 })
  const before = JSON.stringify(w)
  for (const span of [32, 64, 128, 256, 512]) {
    const blocks = urbanBlocks(w, span)
    const sum = (key: 'residents' | 'capacity' | 'buildings' | 'builtArea' | 'laneMeters' | 'construction') =>
      blocks.reduce((n, b) => n + b[key], 0)
    assert.equal(sum('residents'), 1200)
    assert.equal(sum('capacity'), 1380)
    assert.equal(sum('buildings'), 3)
    assert.equal(sum('construction'), 20)
    assert(Math.abs(sum('builtArea') - 240) < 1e-7)
    assert(Math.abs(sum('laneMeters') - 800) < 1e-9, 'boundary-aligned lanes are counted once')
  }
  const blocks = urbanBlocks(w)
  assert.deepEqual(urbanBlocks({ viewOnly: true, viewUrbanBlocks: blocks } as World), blocks)
  assert.equal(JSON.stringify(w), before)
})

test('housing demand reaches both centres with one shared moving budget', () => {
  const { w, homes, access } = fixture()
  const demand = multiCentreHousingDemand(w, access)
  assert(demand.get(homes[0].id)! > 0)
  assert(demand.get(homes[2].id)! > 0)
  assert.equal(demand.get(homes[0].id), demand.get(homes[2].id))
  const budget = 1000 * (1 - Math.exp(-SETTLEMENT.annualMovingHazard / 12)) * 12 * 1.15
  assert([...demand.values()].reduce((a, b) => a + b, 0) <= budget)
  const renamed = structuredClone(w)
  renamed.localEconomy!.cities = [{ name: 'A cosmetic name' }] as never
  assert.deepEqual(multiCentreHousingDemand(renamed, access), demand)
})

test('pending works offset their own centre only and inaccessible centres attract no relocation', () => {
  const { w, homes, access } = fixture()
  const before = multiCentreHousingDemand(w, access)
  w.adaptive!.construction!.push({ site: homes[0].id, capacity: 100, cost: 10, remaining: 3 })
  const after = multiCentreHousingDemand(w, access)
  assert.equal(after.get(homes[0].id), 0)
  assert.equal(after.get(homes[2].id), before.get(homes[2].id))
  w.regions[0].devastation = 1
  assert([...multiCentreHousingDemand(w, access).values()].every((n) => n === 0))
})

test('growth is bounded by the pool shortage and projects offset it locally', () => {
  const { w, homes, access } = fixture()
  homes.forEach((s) => {
    s.capacity = s.residents! * 0.8
  })
  const equal = { ...access, baseUtility: () => 1, utility: () => 1 }
  const before = multiCentreHousingDemand(w, equal)
  assert(Math.abs([...before.values()].reduce((a, b) => a + b, 0) - 420) < 1e-9)
  w.adaptive!.construction!.push({ site: homes[0].id, capacity: 20, cost: 10, remaining: 3 })
  const after = multiCentreHousingDemand(w, equal)
  assert.equal(after.get(homes[0].id), before.get(homes[0].id)! - 20)
  assert.equal(after.get(homes[2].id), before.get(homes[2].id))
})

test('coarse housing demand conserves the pool shortage and deducts funded capacity once', () => {
  const { w, homes, access } = fixture()
  homes.forEach((s) => { s.capacity = s.residents! * 0.8 })
  const total = () => [...coarseHousingDemand(w, access).values()].reduce((a, b) => a + b, 0)
  assert(Math.abs(total() - 420) < 1e-9)
  w.adaptive!.construction!.push({ site: homes[0].id, capacity: 20, cost: 10, remaining: 3 })
  assert(Math.abs(total() - 400) < 1e-9)
  w.adaptive!.construction!.push({ site: homes[2].id, capacity: 1000, cost: 100, remaining: 3 })
  assert.equal(total(), 0)
})

test('nearby duplicate sites do not create extra demand centres', () => {
  const { w, homes, access } = fixture()
  const centres = housingCentres(w, homes, access).map((s) => s.id)
  homes.push({ ...homes[0], id: 'z-duplicate', x: homes[0].x + 32, capacity: 0, residents: 0 })
  assert.deepEqual(
    housingCentres(w, homes, access).map((s) => s.id),
    centres,
  )
})

test('physical centre catchments preserve both nuclei and distinguish broad frontage from a ribbon', () => {
  const { w } = fixture()
  const sites: PhysicalSite[] = []
  for (let y = 200; y <= 320; y += 30)
    for (let x = 200; x <= 410; x += 30) {
      const point = { x, y }
      sites.push({
        ...Object.values(w.adaptive!.sites)[0],
        ...point,
        id: `site:${x}:${y}`,
        residents: 100,
        parcel: { x: x - 8, y: y - 8, size: 16 },
        building: rectangularFootprint(point, 16, 16, 0),
      })
    }
  const cities = [sites[0], sites[7]].map((s, i) => ({ id: i, nucleusSite: s.id, nucleus: 0 })) as City[]
  w.localEconomy!.cities = cities
  const result = partitionCentres(w, sites, cities)
  assert.equal(new Set([...result.groups.values()].flat().map((s) => s.id)).size, sites.length)
  for (const city of cities) assert(result.groups.get(city.id)!.some((s) => s.id === city.nucleusSite))
  assert(result.contacts.get('0:1')!.a.size >= 3)
  assert(result.contacts.get('0:1')!.b.size >= 3)
  const reversed = partitionCentres(w, [...sites].reverse(), [...cities].reverse())
  for (const city of cities)
    assert.deepEqual(
      result.groups
        .get(city.id)!
        .map((s) => s.id)
        .sort(),
      reversed.groups
        .get(city.id)!
        .map((s) => s.id)
        .sort(),
    )
  const ribbon = partitionCentres(
    w,
    sites.filter((s) => s.y === 200),
    cities,
  )
  assert.equal(ribbon.contacts.get('0:1')!.a.size, 1)
})
