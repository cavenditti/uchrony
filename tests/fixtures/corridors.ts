import { HEX } from '../../src/sim/hex'
import { corridorGeography } from '../../src/sim/corridors'
import { MinHeap } from '../../src/sim/heap'
import { transportNetwork } from '../../src/sim/transport'
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
    nations: [{ id: 0, income: 0, technologies: { logistics: 0 }, treasury: 1e9, policies: { tariff: 0 } }],
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

export function parallelHarbors({ gap = 2, width = 40 } = {}) {
  const rows = Array.from({ length: gap + 5 }, () => Array<string>(width).fill('.'))
  rows[2][1] = 'A'
  rows[2][width - 2] = 'B'
  rows[2 + gap][1] = 'C'
  rows[2 + gap][width - 2] = 'D'
  return corridorWorld(rows.map((row) => row.join('')))
}

/** A saved pre-backbone survey, for testing migration and annual path tenure.
 * New worlds now share shipping corridors from their initial survey.
 */
export function independentHarbors(options: { gap?: number; width?: number } = {}) {
  const world = parallelHarbors(options),
    geo = corridorGeography(world)
  world.corridorPlan = {
    month: 0,
    links: transportNetwork(world).links.map((link) => ({
      from: link.from,
      to: link.to,
      changedAt: 0,
      legs: link.legs.map((leg) => {
        if (leg.mode === 'land') return leg
        const start = leg.cells[1],
          end = leg.cells.at(-2)!,
          distance = new Map([[start, 0]]),
          previous = new Map<number, number>(),
          queue = new MinHeap()
        queue.push(start, 0)
        while (queue.size) {
          const at = queue.pop()
          if (at.cost !== distance.get(at.id)) continue
          if (at.id === end) break
          for (const next of geo.adjacent[at.id]) {
            if (world.cells[next].terrain !== 'water') continue
            const cost = at.cost + geo.segments[geo.index(at.id, next)].effort
            if (cost >= (distance.get(next) ?? Infinity)) continue
            distance.set(next, cost)
            previous.set(next, at.id)
            queue.push(next, cost)
          }
        }
        const cells = [end]
        while (cells.at(-1) !== start) cells.push(previous.get(cells.at(-1)!)!)
        return { mode: 'sea' as const, cells: [leg.cells[0], ...cells.reverse(), leg.cells.at(-1)!] }
      }),
    })),
  }
  return world
}
