import { hashSeed } from '../sim/random'
import { urbanForm, type UrbanForm } from './urban-form'
import type { World } from '../sim/types'
import { spatialState, type Settlement } from '../sim/spatial'
import { isVisibleSettlement } from '../sim/settlement-model'

export type SettlementPlace = Settlement & {
  form?: UrbanForm
  capacity?: number
  civic?: boolean
  parcel?: import('../sim/adaptive-types').SpatialBounds
}

/** One named settlement can have many connected residential patches. Spare
 * housing in the countryside is never promoted to a village by the renderer.
 */
export function settlementPlaces(world: World): SettlementPlace[] {
  const cities = spatialState(world).settlements.filter((s) => isVisibleSettlement(s.population))
  if (!world.adaptive) return cities
  const homes = new Map(
    (
      world.viewHomes ??
      Object.values(world.adaptive.sites).filter((s) => s.kind === 'residential' && s.retired === undefined)
    ).map((s) => [s.id, s]),
  )
  if (world.adaptive.buildingVersion === 1) {
    const labels = new Map(cities.flatMap((city) => (city.siteIds ?? []).map((id) => [id, city] as const)))
    return [...homes.values()]
      .filter((home) => home.building)
      .map((home) => {
        const city = labels.get(home.id)
        return {
          id: `building:${home.id}`,
          name: city?.name ?? 'Independent home',
          region: world.cells[home.cell].region,
          cell: home.cell,
          population: home.residents ?? 0,
          kind: city?.kind ?? 'village',
          capital: false,
          civic: false,
          nucleusSite: home.id,
          position: { x: home.x!, y: home.y! },
          parcel: home.parcel,
          capacity: home.capacity,
        }
      })
  }
  return cities.flatMap((city) => {
    const cells = city.cells?.length ? city.cells : [city.cell]
    const ids = city.siteIds ?? cells.map((c) => `home:${c}`)
    const nucleus = homes.get(city.nucleusSite ?? `home:${city.cell}`)
    const center = {
      x: nucleus?.x ?? city.position?.x ?? world.cells[city.cell].x * world.adaptive!.metersPerMapUnit,
      y: nucleus?.y ?? city.position?.y ?? world.cells[city.cell].y * world.adaptive!.metersPerMapUnit,
    }
    const reach = Math.max(
      0,
      ...ids.map((id) => {
        const home = homes.get(id)
        return home?.x !== undefined && home.y !== undefined
          ? Math.hypot(home.x - center.x, home.y - center.y)
          : 0
      }),
    )
    const planSeed = hashSeed(`${world.seed}:street-plan:${city.id}`)
    const angle = ((planSeed % 360) * Math.PI) / 180
    const buckets = new Map<string, NonNullable<SettlementPlace['parcel']>[]>()
    for (const id of ids) {
      const p = homes.get(id)?.parcel
      if (!p) continue
      const key = `${Math.floor((p.x + p.size / 2) / 1024)}:${Math.floor((p.y + p.size / 2) / 1024)}`
      const list = buckets.get(key) ?? []
      list.push(p)
      buckets.set(key, list)
    }
    return ids.flatMap((id) => {
      const home = homes.get(id)
      const people = home && (home.residents ?? world.localEconomy?.units[home.pool]?.residents[home.cell])
      if (!home || !people) return []
      const cell = home.cell,
        civic = city.nucleusSite ? id === city.nucleusSite : cell === city.cell
      const nearby: NonNullable<SettlementPlace['parcel']>[] = []
      if (home.parcel) {
        const p = home.parcel,
          bx = Math.floor((p.x + p.size / 2) / 1024),
          by = Math.floor((p.y + p.size / 2) / 1024)
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const other of buckets.get(`${bx + dx}:${by + dy}`) ?? [])
              if (
                other !== p &&
                Math.hypot(
                  other.x + other.size / 2 - p.x - p.size / 2,
                  other.y + other.size / 2 - p.y - p.size / 2,
                ) <
                  (p.size + other.size) * 0.8
              )
                nearby.push(other)
      }
      return [
        {
          ...city,
          id: ids.length === 1 ? city.id : `${city.id}:patch:${id}`,
          cell,
          region: world.cells[cell].region,
          capacity: home.capacity,
          ...(home.x !== undefined && home.y !== undefined ? { position: { x: home.x, y: home.y } } : {}),
          parcel: home.parcel,
          ...(home.parcel
            ? {
                form: {
                  ...urbanForm(
                    home.capacity,
                    home.parcel,
                    center,
                    world.adaptive!.metersPerMapUnit,
                    world.localEconomy?.units[home.pool]?.activity,
                    civic,
                    Math.hypot((home.x ?? center.x) - center.x, (home.y ?? center.y) - center.y),
                    reach,
                  ),
                  angle,
                  planSeed,
                  neighbors: nearby,
                },
              }
            : {}),
          // Civic form belongs to the urban nucleus; administrative seats in
          // unincorporated countryside do not create a townscape.
          civic,
          capital: city.capital && civic,
        },
      ]
    })
  })
}
