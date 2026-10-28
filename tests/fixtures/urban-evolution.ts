import { inventory, type World } from '../../src/sim/types'
import type { PhysicalSite } from '../../src/sim/adaptive-types'
import { rectangularFootprint } from '../../src/sim/urban-growth'

export const URBAN_SCENARIOS = ['market', 'bridge', 'boundary', 'recovery'] as const
export type UrbanScenario = (typeof URBAN_SCENARIOS)[number]

/** Prescribed physical neighbourhood, not a generated economy or historical fit.
 * Account tests use a complete generated world separately. */
export function urbanFixture(scenario: UrbanScenario = 'market') {
  const sites: PhysicalSite[] = []
  for (let i = 0; i < 24; i++) {
    const x = 800 + (i % 8) * 55,
      y = 400 + Math.floor(i / 8) * 60
    const cell = Math.floor(x / 1024),
      pool = scenario === 'boundary' ? cell : 0
    sites.push({
      id: `fixture:${i}`,
      kind: 'residential',
      entity: `residents:${pool}`,
      cell,
      pool,
      x,
      y,
      founded: 0,
      capacity: 8,
      openingCapacity: 8,
      capitalReference: 0,
      residents: 4,
      investedValue: 0,
      parcel: { x: x - 20, y: y - 20, size: 40 },
      building: rectangularFootprint({ x, y }, 18, 20, 0),
    })
  }
  const cells = Array.from({ length: 6 }, (_, id) => ({
    id,
    q: id % 3,
    r: Math.floor(id / 3),
    x: ((id % 3) + 0.5) * 12,
    y: (Math.floor(id / 3) + 0.5) * 12,
    region: scenario === 'boundary' ? id % 3 : 0,
    terrain: 'plains',
    elevation: 0.2,
    landscape: { habitat: 0.7 },
  }))
  const regions = [0, 1, 2].map((id) => ({
    id,
    nation: 0,
    devastation: 0,
    infrastructure: 1,
    center: id,
    cells: scenario === 'boundary' ? [id, id + 3] : cells.map((c) => c.id),
    population: { children: 0, adults: sites.filter((s) => s.pool === id).length * 4, elders: 0 },
    residents: Object.fromEntries(
      cells.map((c) => [c.id, sites.filter((s) => s.cell === c.id && s.pool === id).length * 4]),
    ),
    prices: inventory(1),
    stocks: inventory(1000),
  }))
  const w = {
    seed: `Urban ${scenario}`,
    width: 3,
    height: 2,
    month: 240,
    cells,
    regions,
    nations: [{ id: 0, technologies: { logistics: 1 }, policies: {}, treasury: 100 }],
    adaptive: {
      sites: Object.fromEntries(sites.map((s) => [s.id, s])),
      construction: [],
      metersPerMapUnit: 1024 / 12,
      revision: 0,
      residentialVersion: 1,
      buildingVersion: 1,
      nextResidence: 0,
      lanes: [
        {
          pool: 0,
          founded: 0,
          width: 4,
          points: [
            { x: 760, y: 430 },
            { x: 1240, y: 430 },
          ],
        },
      ],
      jurisdictions: {},
      commuting: [],
      migration: { source: 'legacy', month: 0, assumptions: [] },
    },
    localEconomy: {
      active: scenario === 'boundary' ? [0, 1] : [0],
      units: regions,
      cities: [],
      built: {},
      nextId: 3,
    },
    economy: { firms: [] },
    corridors: [],
    routes: [],
    armies: [],
  } as unknown as World
  if (scenario === 'bridge')
    w.adaptive!.lanes = [
      {
        pool: 0,
        founded: 0,
        width: 4,
        points: [
          { x: 760, y: 430 },
          { x: 760, y: 750 },
          { x: 1240, y: 750 },
          { x: 1240, y: 430 },
        ],
      },
    ]
  return { w, sites }
}
