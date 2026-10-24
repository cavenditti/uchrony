import { neighbors } from './hex'
import { relation, clamp, type World, type RouteLeg } from './types'

const cache = new WeakMap<World, { month: number; revision: number; pressure: Map<number, Float64Array> }>()
export function navalPressure(world: World) {
  const revision = world.warfare?.revision ?? 0
  const prior = cache.get(world)
  if (prior?.month === world.month && prior.revision === revision) return prior.pressure
  const pressure = new Map<number, Float64Array>()
  for (const f of world.warfare?.fleets ?? []) {
    if (!f.soldiers || !f.warships || f.hull < 0.1) continue
    if (!pressure.has(f.nation)) pressure.set(f.nation, new Float64Array(world.cells.length))
    const strength =
      f.warships *
      f.hull *
      f.morale *
      Math.min(1, f.soldiers / Math.max(1, f.warships * 90 + f.transports * 30)) *
      (1 + world.nations[f.nation].technologies.military * 0.15)
    const visited = new Set([f.cell]),
      queue = [{ cell: f.cell, distance: 0 }]
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i]
      pressure.get(f.nation)![at.cell] += strength * (1 - at.distance / 6)
      if (at.distance >= 4) continue
      for (const cell of neighbors(at.cell, world.width, world.height))
        if (!visited.has(cell) && world.cells[cell].terrain === 'water') {
          visited.add(cell)
          queue.push({ cell, distance: at.distance + 1 })
        }
    }
  }
  cache.set(world, { month: world.month, revision, pressure })
  return pressure
}
export function seaPassageFactor(world: World, nation: number, legs: RouteLeg[]) {
  if (
    !world.warfare?.fleets.length ||
    !world.relations.some((rel) => rel.treaty === 'war' && (rel.a === nation || rel.b === nation))
  )
    return 1
  const pressure = navalPressure(world)
  let factor = 1
  for (const leg of legs)
    if (leg.mode === 'sea')
      for (const cell of leg.cells) {
        if (world.cells[cell].terrain !== 'water') continue
        let friendly = pressure.get(nation)?.[cell] ?? 0,
          hostile = 0
        for (const [other, values] of pressure)
          if (other !== nation) {
            const treaty = relation(world, nation, other)?.treaty
            if (treaty === 'war') hostile += values[cell]
            else if (treaty === 'alliance') friendly += values[cell]
          }
        const excess = Math.max(0, hostile - friendly)
        factor = Math.min(factor, excess > 2.5 ? 0 : clamp(1 - excess * 0.32, 0.05, 1))
      }
  return factor
}
