import type { World } from './types'
import { GOODS } from './types'
import { validateSettings } from './settings'

export function validatePressures(world: World) {
  if (world.simulation !== undefined) validateSettings(world.simulation)
  const p = world.pressures
  if (p === undefined) return
  const fail = (): never => {
      throw new Error('Invalid structural pressures in this save.')
    },
    integer = (x: unknown, low: number, high: number) =>
      typeof x === 'number' && Number.isInteger(x) && x >= low && x <= high,
    text = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max
  if (
    !p ||
    typeof p !== 'object' ||
    !integer(p.rng, 0, 0xffffffff) ||
    !integer(p.nextAt, 0, world.month + 120) ||
    !integer(p.nextId, 1, 1e12) ||
    !Number.isFinite(p.intensity) ||
    p.intensity < 0 ||
    p.intensity > 3 ||
    !Array.isArray(p.incidents) ||
    p.incidents.length > 64
  )
    fail()
  const ids = new Set<number>()
  for (const incident of p.incidents) {
    if (
      !incident ||
      typeof incident !== 'object' ||
      !integer(incident.id, 1, p.nextId - 1) ||
      ids.has(incident.id) ||
      !integer(incident.month, 0, world.month) ||
      !integer(incident.expires, incident.month + 1, world.month + 36) ||
      !['province', 'state', 'regional', 'international'].includes(incident.scope) ||
      !['harvest', 'extraction', 'epidemic', 'faction', 'border', 'concession', 'transit'].includes(
        incident.kind,
      ) ||
      !text(incident.title, 140) ||
      !text(incident.detail, 500) ||
      !Number.isFinite(incident.severity) ||
      incident.severity < 0 ||
      incident.severity > 1 ||
      !['', ...GOODS].includes(incident.good) ||
      !Array.isArray(incident.nations) ||
      !incident.nations.length ||
      incident.nations.length > world.nations.length ||
      new Set(incident.nations).size !== incident.nations.length ||
      incident.nations.some((id) => !integer(id, 0, world.nations.length - 1)) ||
      !Array.isArray(incident.regions) ||
      !incident.regions.length ||
      incident.regions.length > world.regions.length ||
      new Set(incident.regions).size !== incident.regions.length ||
      incident.regions.some((id) => !integer(id, 0, world.regions.length - 1))
    )
      fail()
    ids.add(incident.id)
  }
}
