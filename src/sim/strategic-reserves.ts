import { simulationMonths } from './simulation-period'
import { activeDevelopment } from './development'
import { MODEL_PARAMETERS } from './model-parameters'
import { GOODS, type Good, type Region, type World } from './types'
import type { CompetitiveFirm } from './economic-types'

export const STRATEGIC_MATERIALS: Good[] = ['timber', 'stone', 'iron', 'coal', 'tools']
/** Targets are physical stocks, not sales. Firms still pay wages, finance inputs,
 * face storage losses and stop accumulating once their target is filled. */
export function targetInventoryMonths(w: World, r: Region, g: Good) {
  const n = w.nations[r.nation]
  if (!n || n.foodCoverage < 0.97 || !activeDevelopment(w, n)) return MODEL_PARAMETERS.inventoryMonths
  return STRATEGIC_MATERIALS.includes(g)
    ? Math.max(MODEL_PARAMETERS.inventoryMonths, 6 / simulationMonths())
    : MODEL_PARAMETERS.inventoryMonths
}
/** Relief is capped at a quarter of profit tax and earned by physical delivery
 * into a useful reserve. Holding old stock alone earns no subsidy or rebate. */
export function reserveTaxRelief(w: World, r: Region, f: CompetitiveFirm) {
  const n = w.nations[r.nation]
  if (!n || n.foodCoverage < 0.97 || !activeDevelopment(w, n)) return 0
  const total = GOODS.reduce((sum, g) => sum + f.production[g] * f.prices[g], 0)
  const useful = STRATEGIC_MATERIALS.reduce((sum, g) => {
    const goal = f.forecast[g] * targetInventoryMonths(w, r, g)
    const productive = f.production[g] >= f.forecast[g] && f.production[g] > 0
    const retained = Math.max(0, f.production[g] - f.sold[g])
    return (
      sum + (productive ? Math.min(retained, Math.max(0, goal - f.stocks[g] + retained)) * f.prices[g] : 0)
    )
  }, 0)
  return total > 0 ? 0.25 * Math.min(1, useful / total) : 0
}
