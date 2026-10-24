import { neighbors } from './hex'
import { clamp, type World, type RouteLeg } from './types'

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
/** One immutable naval/diplomatic view for a transport phase. */
export function seaPassageView(world: World) {
  const opponents = world.nations.map(() => [] as number[]),
    allies = world.nations.map((n) => [n.id]),
    fields = new Map<number, { friendly: Float64Array[]; hostile: Float64Array[] }>()
  for (const rel of world.relations) {
    const groups = rel.treaty === 'war' ? opponents : rel.treaty === 'alliance' ? allies : null
    if (groups) {
      groups[rel.a].push(rel.b)
      groups[rel.b].push(rel.a)
    }
  }
  return (nation: number, legs: RouteLeg[]) => {
    if (!world.warfare?.fleets.length || !opponents[nation].length || !legs.some((leg) => leg.mode === 'sea'))
      return 1
    let view = fields.get(nation)
    if (!view) {
      const pressure = navalPressure(world)
      const select = (ids: number[]) =>
        ids.flatMap((id) => {
          const values = pressure.get(id)
          return values ? [values] : []
        })
      view = { friendly: select(allies[nation]), hostile: select(opponents[nation]) }
      fields.set(nation, view)
    }
    if (!view.hostile.length) return 1
    let factor = 1
    for (const leg of legs)
      if (leg.mode === 'sea')
        for (const cell of leg.cells) {
          if (world.cells[cell].terrain !== 'water') continue
          let friendly = 0,
            hostile = 0
          for (const values of view.friendly) friendly += values[cell]
          for (const values of view.hostile) hostile += values[cell]
          const excess = Math.max(0, hostile - friendly)
          factor = Math.min(factor, excess > 2.5 ? 0 : clamp(1 - excess * 0.32, 0.05, 1))
        }
    return factor
  }
}

export function seaPassageFactor(world: World, nation: number, legs: RouteLeg[]) {
  return seaPassageView(world)(nation, legs)
}
