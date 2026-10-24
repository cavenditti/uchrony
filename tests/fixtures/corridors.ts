import { HEX } from '../../src/sim/hex'
import { inventory, type Cell, type Region, type Route, type World } from '../../src/sim/types'

/** Small maps keep geographic feedback experiments independent of demographic changes. */
export function corridorWorld(rows: string[]): World {
  const width = rows[0].length,
    height = rows.length,
    names = [...new Set(rows.join('').replaceAll('.', ''))].sort(),
    cells: Cell[] = rows.flatMap((row, r) =>
      [...row].map((name, q) => ({
        id: r * width + q,
        q,
        r,
        x: (q + (r % 2) / 2) * Math.sqrt(3) * HEX,
        y: r * HEX * 1.5,
        terrain: name === '.' ? 'water' : 'plains',
        region: names.indexOf(name),
        elevation: name === '.' ? 0 : 0.3,
        moisture: 0.5,
        river: false,
      })),
    ),
    regions = names.map((name, id) => ({
      id,
      name,
      nation: 0,
      center: cells.find((cell) => cell.region === id)!.id,
      cells: cells.filter((cell) => cell.region === id).map((cell) => cell.id),
      infrastructure: 0.5,
      devastation: 0,
      population: { children: 1000, adults: 8000, elders: 1000 },
      urban: 0.3,
      industry: 0.5,
      production: inventory(),
      stocks: inventory(),
      prices: inventory(10),
    })) as Region[]
  return {
    width,
    height,
    cells,
    regions,
    month: 0,
    routes: [],
    relations: [],
    nations: [{ technologies: { logistics: 0 }, treasury: 1e9, policies: { tariff: 0 } }],
  } as unknown as World
}

export function completedFreight(
  link: { from: number; to: number; legs: NonNullable<Route['legs']> },
  volume = 1000,
): Route {
  return {
    ...link,
    id: `${link.from}-${link.to}`,
    path: [link.from, link.to],
    goods: { ...inventory(), coal: volume },
    volume,
    value: volume,
    capacity: 10000,
    sea: link.legs.some((leg) => leg.mode === 'sea'),
    international: false,
  }
}

export function parallelHarbors() {
  const rows = Array.from({ length: 7 }, () => Array<string>(40).fill('.'))
  rows[2][1] = 'A'
  rows[2][38] = 'B'
  rows[4][1] = 'C'
  rows[4][38] = 'D'
  return corridorWorld(rows.map((row) => row.join('')))
}
