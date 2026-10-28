import { population, type World } from './types'
import { expansionParameters } from './expansion-parameters'
import { settlementComponents } from './settlement-morphology'
import { occupiedResidents } from './residential-sites'

/** Compact housing is not metropolitan opportunity cost. Weight occupied,
 * connected physical footprints by population; names and city records are
 * observer data and must never affect births. Tiny unnamed camps count too. */
export function urbanOpportunityByDistrict(w: World) {
  const scale = expansionParameters().urbanOpportunityPopulation
  if (!w.localEconomy || !w.adaptive || !scale) return undefined
  const weighted = new Map<number, number>()
  for (const component of settlementComponents(w, undefined, 1)) {
    const opportunity = Math.min(1, component.population / scale)
    for (const site of component.sites)
      weighted.set(site.pool, (weighted.get(site.pool) ?? 0) + occupiedResidents(w, site) * opportunity)
  }
  return new Map(
    w.localEconomy.active.map((id) => [
      id,
      Math.min(1, (weighted.get(id) ?? 0) / Math.max(1, population(w.localEconomy!.units[id]))),
    ]),
  )
}
