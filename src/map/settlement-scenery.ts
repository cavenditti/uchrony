import type { World } from '../sim/types'
import { spatialState, type Settlement } from '../sim/spatial'
import { isVisibleSettlement } from '../sim/settlement-model'

export type SettlementPlace = Settlement & {
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
  return cities.flatMap((city) => {
    const cells = city.cells?.length ? city.cells : [city.cell]
    const ids = city.siteIds ?? cells.map((c) => `home:${c}`)
    return ids.flatMap((id) => {
      const home = homes.get(id)
      const people = home && (home.residents ?? world.localEconomy?.units[home.pool]?.residents[home.cell])
      if (!home || !people) return []
      const cell = home.cell,
        civic = city.nucleusSite ? id === city.nucleusSite : cell === city.cell
      return [
        {
          ...city,
          id: ids.length === 1 ? city.id : `${city.id}:patch:${id}`,
          cell,
          region: world.cells[cell].region,
          capacity: home.capacity,
          ...(home.x !== undefined && home.y !== undefined ? { position: { x: home.x, y: home.y } } : {}),
          parcel: home.parcel,
          // Civic form belongs to the urban nucleus; administrative seats in
          // unincorporated countryside do not create a townscape.
          civic,
          capital: city.capital && civic,
        },
      ]
    })
  })
}
