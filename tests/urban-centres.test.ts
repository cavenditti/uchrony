import test from 'node:test'
import assert from 'node:assert/strict'
import { integrateCentres, separateCentre } from '../src/sim/urban-centres'
import type { World } from '../src/sim/types'
import type { City } from '../src/sim/district-types'
import type { PhysicalSite } from '../src/sim/adaptive-types'

function fixture(large = 50000, small = 500, wealth = 100) {
  const sites = [large, small].map(
    (residents, i) =>
      ({
        id: `residence:${i}`,
        cell: 0,
        pool: i,
        x: 100 + i * 20,
        y: 100,
        kind: 'residential',
        entity: `residents:${i}`,
        founded: 0,
        capacity: residents,
        openingCapacity: residents,
        capitalReference: 1,
        residents,
        investedValue: residents * (i ? 0 : wealth),
        parcel: { x: 90 + i * 20, y: 90, size: 16 },
      }) as PhysicalSite,
  )
  const cities: City[] = sites.map((s, i) => ({
    id: i,
    name: i ? 'Mere' : 'Ford',
    aliases: [],
    parents: [],
    nucleus: 0,
    nucleusSite: s.id,
    cells: [0],
    sites: [s.id],
    population: s.residents!,
    founded: 0,
    lastNameChange: 0,
    kind: 'town',
  }))
  const w = {
    month: 0,
    cells: [{ region: 0 }],
    nations: [],
    adaptive: { sites: Object.fromEntries(sites.map((s) => [s.id, s])) },
    localEconomy: {
      cities,
      units: sites.map((s) => ({ population: { adults: s.residents, children: 0, elders: 0 } })),
    },
  } as unknown as World
  const partition = () => ({
    groups: new Map(
      cities
        .filter((c) => c.absorbedBy === undefined)
        .map((c) => [c.id, sites.filter((s) => c.sites!.includes(s.id))]),
    ),
    contacts: new Map([
      [
        '0:1',
        {
          a: new Set([0, 1, 2]),
          b: new Set([3, 4, 5]),
          points: [
            { x: 100, y: 0 },
            { x: 100, y: 128 },
          ] as PhysicalSite[],
        },
      ],
    ]),
  })
  const review = (month: number) => {
    w.month = month
    integrateCentres(
      w,
      cities.filter((c) => c.absorbedBy === undefined),
      partition(),
    )
  }
  return { w, cities, sites, partition, review }
}

test('wealth and prestige dominance can incorporate, then fully merge, while retaining history', () => {
  const { w, cities, sites, review } = fixture()
  const physical = JSON.stringify(sites)
  review(0)
  assert.equal(cities[1].metropolis?.centre, 0)
  for (let i = 0; i < 10; i++) review(0)
  assert.equal(cities[1].history!.length, 1)
  review(59)
  assert.equal(cities[1].metropolis?.incorporated, undefined)
  review(60)
  assert.equal(cities[1].metropolis?.incorporated, 60)
  review(239)
  assert.equal(cities[1].absorbedBy, undefined)
  review(240)
  assert.equal(cities[1].absorbedBy, 0)
  assert.equal(cities[0].population, 50500)
  assert.equal(cities[1].population, 0)
  assert.deepEqual(
    cities[1].history!.map((e) => e.kind),
    ['linked', 'incorporated', 'merged'],
  )
  assert.equal(cities[1].name, 'Mere')
  assert(cities[0].aliases.includes('Mere'))
  assert.equal(JSON.stringify(sites), physical)
  review(241)
  assert.equal(w.localEconomy!.cities.length, 2)
})

test('comparable centres stay distinct and a large but poor centre cannot absorb its neighbour', () => {
  for (const args of [
    [5000, 5000, 100],
    [50000, 500, 0],
  ]) {
    const { cities, review } = fixture(...args)
    review(0)
    review(600)
    assert(cities.every((c) => c.absorbedBy === undefined && c.metropolis?.incorporated === undefined))
  }
})

test('loss of dominance restarts the clock; a narrow connection never incorporates', () => {
  const { w, cities, sites, review, partition } = fixture()
  review(0)
  sites[0].investedValue = 0
  review(59)
  assert.equal(cities[1].metropolis?.dominantSince, undefined)
  sites[0].investedValue = 5000000
  review(60)
  review(119)
  assert.equal(cities[1].metropolis?.incorporated, undefined)
  const narrow = partition()
  narrow.contacts.get('0:1')!.a = new Set([0])
  w.month = 300
  integrateCentres(w, cities, narrow)
  assert.equal(cities[1].metropolis?.dominantSince, undefined)
  assert.equal(cities[1].absorbedBy, undefined)
  separateCentre(w, cities[1])
  assert.equal(cities[1].metropolis, undefined)
  assert.equal(cities[1].history!.at(-1)!.kind, 'separated')
})

test('an old prestigious centre resists a richer neighbour and a richer centre can lead a shared area', () => {
  const { cities, review } = fixture(5000, 5000, 100)
  cities[0].founded = 1200
  review(1200)
  assert(cities[1].standing!.prestige > cities[0].standing!.prestige)
  assert.equal(cities[1].metropolis?.centre, 0, 'wealth affects metropolitan leadership')
  review(1800)
  assert.equal(cities[1].absorbedBy, undefined)
  assert.equal(cities[1].metropolis?.incorporated, undefined)
})
