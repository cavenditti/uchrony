import { movementNeighbors, stepDistance } from './grid'
import { MinHeap } from './heap'
import { transportNetwork } from './transport'
import type { Fleet } from './military-types'
import { clamp, relation, type World, type RouteLeg } from './types'

/** Bounded water-only reach prevents pressure crossing islands or narrow land barriers. */
export function fleetReach(world: World, fleet: Fleet) {
  const distances = new Map<number, number>(),
    queue = new MinHeap()
  if (world.cells[fleet.cell]?.terrain !== 'water') return distances
  distances.set(fleet.cell, 0)
  queue.push(fleet.cell, 0)
  while (queue.size) {
    const at = queue.pop()
    if (at.cost !== distances.get(at.id)) continue
    for (const cell of movementNeighbors(world.cells, at.id, world.width, world.height)) {
      const distance = at.cost + stepDistance(world.cells[at.id], world.cells[cell])
      if (
        world.cells[cell].terrain === 'water' &&
        distance <= 4 &&
        distance < (distances.get(cell) ?? Infinity)
      ) {
        distances.set(cell, distance)
        queue.push(cell, distance)
      }
    }
  }
  return distances
}

/** Readiness and carried ammunition matter as much as the nominal hull count. */
export function fleetPower(world: World, f: Fleet) {
  if (!f.soldiers || !f.warships || f.hull < 0.1) return 0
  return (
    f.warships *
    f.hull *
    f.morale *
    f.supply *
    Math.min(1, f.arms / Math.max(0.1, f.warships * 0.25)) *
    Math.min(1, f.soldiers / Math.max(1, f.warships * 90 + f.transports * 30)) *
    (1 + world.nations[f.nation].technologies.military * 0.15)
  )
}

const cache = new WeakMap<World, { month: number; revision: number; pressure: Map<number, Float64Array> }>()
const controlCache = new WeakMap<
  World,
  { month: number; revision: number; pressure: Map<number, Float64Array> }
>()
export function navalPressure(world: World, excludeRaiders = false) {
  const selectedCache = excludeRaiders ? controlCache : cache
  const revision = world.warfare?.revision ?? 0
  const prior = selectedCache.get(world)
  if (prior?.month === world.month && prior.revision === revision) return prior.pressure
  const pressure = new Map<number, Float64Array>()
  for (const f of world.warfare?.fleets ?? []) {
    // Raiders leave a risky lane open so consignments can actually be intercepted.
    // Patrols and blockades contest passage; raids steal from traffic that sails.
    if (excludeRaiders && f.mission === 'raid') continue
    if (!f.soldiers || !f.warships || f.hull < 0.1) continue
    if (!pressure.has(f.nation)) pressure.set(f.nation, new Float64Array(world.cells.length))
    const strength = fleetPower(world, f)
    for (const [cell, distance] of fleetReach(world, f))
      pressure.get(f.nation)![cell] += strength * (1 - distance / 6)
  }
  selectedCache.set(world, { month: world.month, revision, pressure })
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
  const portPassage = portBlockadeView(world)
  return (nation: number, legs: RouteLeg[]) => {
    let factor = 1
    for (const leg of legs)
      if (leg.mode === 'sea')
        for (const cell of [leg.cells[0], leg.cells.at(-1)!]) {
          const province = world.cells[cell]?.region
          if (province !== undefined && province >= 0)
            factor = Math.min(factor, portPassage(nation, province))
        }
    if (!factor) return 0
    if (
      !world.warfare?.fleets.length ||
      !opponents[nation]?.length ||
      !legs.some((leg) => leg.mode === 'sea')
    )
      return factor
    let view = fields.get(nation)
    if (!view) {
      const pressure = navalPressure(world, true)
      const select = (ids: number[]) =>
        ids.flatMap((id) => {
          const values = pressure.get(id)
          return values ? [values] : []
        })
      view = { friendly: select(allies[nation]), hostile: select(opponents[nation]) }
      fields.set(nation, view)
    }
    if (!view.hostile.length) return factor
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

/** A declared blockade closes its target harbor even to neutral shipping. Only
 * nearby, supplied warships count; escorts contest the cordon with real strength. */
export function portBlockadeView(world: World) {
  const cordons = new Map<number, Map<number, number>>()
  for (const fleet of world.warfare?.fleets ?? []) {
    if (fleet.mission !== 'blockade' || fleet.target === null || !fleetPower(world, fleet)) continue
    const host = world.regions[fleet.target]?.nation
    if (host === undefined || relation(world, fleet.nation, host)?.treaty !== 'war') continue
    const harbor = transportNetwork(world).harbors.find((h) => h.region === fleet.target)
    if (!harbor) continue
    const distance = fleetReach(world, fleet).get(harbor.water)
    if (distance === undefined) continue
    if (!cordons.has(fleet.target)) cordons.set(fleet.target, new Map())
    const entry = cordons.get(fleet.target)!
    entry.set(fleet.nation, (entry.get(fleet.nation) ?? 0) + fleetPower(world, fleet) * (1 - distance / 6))
  }
  const pressure = cordons.size ? navalPressure(world) : new Map<number, Float64Array>()
  return (traveler: number, port: number) => {
    const cordon = cordons.get(port)
    if (!cordon) return 1
    const harbor = transportNetwork(world).harbors.find((h) => h.region === port)!
    let blocking = 0,
      defending = 0
    for (const value of cordon.values()) blocking += value
    for (const [nation, values] of pressure)
      if (
        !cordon.has(nation) &&
        (nation === traveler ||
          nation === world.regions[port].nation ||
          relation(world, traveler, nation)?.treaty === 'alliance')
      )
        defending += values[harbor.water]
    const excess = Math.max(0, blocking - defending)
    return excess >= 0.5 ? 0 : clamp(1 - excess * 2)
  }
}

export function seaPassageFactor(world: World, nation: number, legs: RouteLeg[]) {
  return seaPassageView(world)(nation, legs)
}
