import { population, type World } from './types'
import { expansionParameters } from './expansion-parameters'
import { settlementStructure, type SettlementStructure } from './settlement-topology'

/** Metropolitan opportunity cost of children rises with the developed
 * population within market reach of a household's home, read from the
 * agglomeration field. Place names and records never enter it, and homes in
 * open country have no developed neighbours to count. */
export function urbanOpportunityByDistrict(w: World, structure?: SettlementStructure) {
  const scale = expansionParameters().urbanOpportunityPopulation
  if (!w.localEconomy || !w.adaptive || !scale) return undefined
  const { sources, sourceReach } = structure ?? settlementStructure(w)
  const weighted = new Map<number, number>()
  sources.forEach((source, i) => {
    if (!source.people) return
    const opportunity = Math.min(1, sourceReach[i] / scale)
    weighted.set(source.pool, (weighted.get(source.pool) ?? 0) + source.people * opportunity)
  })
  return new Map(
    w.localEconomy.active.map((id) => [
      id,
      Math.min(1, (weighted.get(id) ?? 0) / Math.max(1, population(w.localEconomy!.units[id]))),
    ]),
  )
}
