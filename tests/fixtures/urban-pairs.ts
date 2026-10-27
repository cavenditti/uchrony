import type { World } from '../../src/sim/types'
import type { City } from '../../src/sim/district-types'
import type { PhysicalSite } from '../../src/sim/adaptive-types'
import { integrateCentres, partitionCentres, URBAN_INTEGRATION } from '../../src/sim/urban-centres'

export interface PairScenario {
  name: string
  populations: [number, number]
  wealth: [number, number]
  ages?: [number, number]
  annualGrowth?: [number, number]
  shock?: { from: number; to: number; wealth: [number, number] }
  narrow?: boolean
}
/** Controlled neighbourhoods, not a complete economy. Real occupied-footprint
 * connectivity and monthly identity rules; population/wealth paths are inputs. */
export function urbanPair(spec: PairScenario) {
  const ages = spec.ages ?? [0, 0]
  const startMonth = Math.max(...ages) * 12
  const sites: PhysicalSite[] = []
  for (let side = 0; side < 2; side++) {
    for (let col = 0; col < 3; col++)
      for (let row = 0; row < (spec.narrow ? 1 : 5); row++) {
        const x = 300 + (side * 3 + col) * 32,
          y = 300 + row * 32
        sites.push({
          id: `pair:${side}:${col}:${row}`,
          cell: 0,
          pool: side,
          kind: 'residential',
          entity: `residents:${side}`,
          x,
          y,
          founded: 0,
          capacity: 0,
          openingCapacity: 0,
          capitalReference: 1,
          residents: 0,
          investedValue: 0,
          parcel: { x: x - 16, y: y - 16, size: 32 },
          building: [
            { x: x - 12, y: y - 12 },
            { x: x + 12, y: y - 12 },
            { x: x + 12, y: y + 12 },
            { x: x - 12, y: y + 12 },
          ],
        })
      }
  }
  const cities: City[] = [0, 1].map((i) => ({
    id: i,
    name: i ? 'Mere' : 'Ford',
    aliases: [],
    parents: [],
    nucleus: 0,
    nucleusSite: `pair:${i}:${i ? 2 : 0}:${spec.narrow ? 0 : 2}`,
    cells: [0],
    sites: sites.filter((s) => s.pool === i).map((s) => s.id),
    founded: startMonth - ages[i] * 12,
    lastNameChange: 0,
    population: spec.populations[i],
    kind: 'town',
  }))
  const w = {
    width: 1,
    height: 1,
    month: startMonth,
    cells: [{ id: 0, x: 6, y: 6, region: 0, terrain: 'plains', elevation: 0.2 }],
    regions: [{ nation: 0, devastation: 0 }],
    nations: [],
    adaptive: { sites: Object.fromEntries(sites.map((s) => [s.id, s])) },
    localEconomy: {
      cities,
      units: [0, 1].map((i) => ({
        nation: 0,
        population: { children: 0, adults: spec.populations[i], elders: 0 },
      })),
    },
  } as unknown as World
  function review(elapsed: number) {
    w.month = startMonth + elapsed
    for (const side of [0, 1]) {
      const pop = Math.round(
        spec.populations[side] * Math.exp(((spec.annualGrowth?.[side] ?? 0) * elapsed) / 12),
      )
      const homes = sites.filter((s) => s.pool === side)
      const wealth =
        spec.shock && elapsed >= spec.shock.from && elapsed < spec.shock.to
          ? spec.shock.wealth[side]
          : spec.wealth[side]
      w.localEconomy!.units[side].population.adults = pop
      homes.forEach((s, i) => {
        s.residents = Math.floor(pop / homes.length) + (i < pop % homes.length ? 1 : 0)
        s.capacity = s.residents * 1.15
        s.investedValue = s.residents * wealth
      })
    }
    const active = cities.filter((c) => c.absorbedBy === undefined)
    integrateCentres(w, active, partitionCentres(w, sites, active))
    return cities
  }
  return { w, cities, sites, review, startMonth }
}

export const PAIR_SCENARIOS: PairScenario[] = [
  { name: 'equal peers', populations: [5000, 5000], wealth: [30, 30] },
  { name: 'large but poor', populations: [20000, 500], wealth: [10, 30] },
  { name: 'wealth without prestige', populations: [5000, 5000], wealth: [90, 30] },
  { name: 'modestly richer neighbour', populations: [10000, 2500], wealth: [36, 30] },
  { name: 'clear regional leader', populations: [10000, 2500], wealth: [60, 30] },
  { name: 'dominant metropolis', populations: [20000, 1250], wealth: [90, 30] },
  { name: 'dominant with twice the wealth', populations: [20000, 1250], wealth: [60, 30] },
  { name: 'dominant with moderate wealth', populations: [20000, 1250], wealth: [45, 30] },
  { name: 'overwhelming metropolis', populations: [50000, 500], wealth: [90, 30] },
  { name: 'old independent centre', populations: [10000, 2500], wealth: [90, 30], ages: [0, 200] },
  { name: 'narrow ribbon', populations: [20000, 1250], wealth: [90, 30], narrow: true },
  {
    name: 'four year wealth boom',
    populations: [20000, 1250],
    wealth: [30, 30],
    shock: { from: 0, to: 48, wealth: [90, 30] },
  },
  {
    name: 'eight year wealth boom',
    populations: [20000, 1250],
    wealth: [30, 30],
    shock: { from: 0, to: 96, wealth: [90, 30] },
  },
  {
    name: 'dominance interrupted',
    populations: [20000, 1250],
    wealth: [90, 30],
    shock: { from: 48, to: 96, wealth: [30, 30] },
  },
  {
    name: 'growing satellite catches up',
    populations: [20000, 1250],
    wealth: [90, 30],
    annualGrowth: [0, 0.04],
  },
]
export function runUrbanPair(spec: PairScenario, months = 600) {
  const pair = urbanPair(spec)
  const ratios: { month: number; prestige: number; wealth: number }[] = []
  for (let month = 0; month <= months; month++) {
    pair.review(month)
    if (month % 120 === 0 && pair.cities.every((c) => c.absorbedBy === undefined))
      ratios.push({
        month,
        prestige: pair.cities[0].standing!.prestige / pair.cities[1].standing!.prestige,
        wealth:
          (1 + pair.cities[0].standing!.wealthPerResident) / (1 + pair.cities[1].standing!.wealthPerResident),
      })
  }
  return {
    name: spec.name,
    thresholds: { ...URBAN_INTEGRATION },
    months,
    ratios,
    events: pair.cities.flatMap((c) =>
      (c.history ?? []).map((e) => ({ centre: c.id, ...e, month: e.month - pair.startMonth })),
    ),
    activeCentres: pair.cities.filter((c) => c.absorbedBy === undefined).length,
  }
}
