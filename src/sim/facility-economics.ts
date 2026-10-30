/** Synthetic local opportunity estimates; these rank investment alternatives,
 * never create orders, guarantee a transport route or book future revenue. */
import { householdNeed, marketNeed } from './economy'
import { FACILITY_DEFINITIONS, type FacilityKind } from './facility-types'
import { regionalFirms } from './firms'
import { plannedInputDemand, productionRecipe } from './production-chains'
import { economicRegion, provinceId } from './local-units'
import { FACILITY_POLICY, regionalFacilityLevels } from './productive-facilities'
import { retailDecay } from './retail-pricing'
import { simulationMonths } from './simulation-period'
import { clamp, GOODS, type Good, type Region, type World } from './types'

/** Adjacent domestic demand is an access-weighted prospect, not an order or a
 * guarantee of a transport route. Actual trade still clears through the network. */
function neighboringMarkets(w: World, r: Region) {
  return r.neighbors.flatMap((id) => {
    const other = economicRegion(w, id)
    return other && other.nation === r.nation && !w.regions[provinceId(other)].control
      ? [
          {
            r: other,
            access: clamp((r.infrastructure + other.infrastructure) / 3) * FACILITY_POLICY.neighborDemand,
          },
        ]
      : []
  })
}

export function facilityEconomicCase(w: World, r: Region, kind: FacilityKind, potential: number) {
  const neighbors = neighboringMarkets(w, r),
    levels = regionalFacilityLevels(w, r),
    next = levels[kind] + 1 / r.cells.length,
    good = FACILITY_DEFINITIONS[kind].sector,
    merchant = w.economy!.producers[r.id],
    firms = regionalFirms(w, r.id)
  if (good === 'market') {
    const inventory = GOODS.reduce(
      (sum, g) => sum + (((r.stocks[g] * r.prices[g]) / 1000) * retailDecay(g)) / simulationMonths(),
      0,
    )
    const turnover = Math.max(
      (merchant.sales + merchant.purchases) / simulationMonths(),
      GOODS.reduce((sum, g) => sum + (householdNeed(r, g) * r.prices[g]) / 1000, 0),
    )
    const preservation =
      1 / (1 + FACILITY_POLICY.marketPreservation * levels.market) -
      1 / (1 + FACILITY_POLICY.marketPreservation * next)
    const handling =
      1 / (1 + FACILITY_POLICY.marketHandling * levels.market) -
      1 / (1 + FACILITY_POLICY.marketHandling * next)
    return {
      benefit: inventory * preservation + turnover * 0.04 * handling,
      reason: 'Market turnover and stored goods support better handling and lower physical storage losses.',
    }
  }
  const localDemand = Math.max(
    marketNeed(r, good),
    plannedInputDemand(r.plannedProduction ?? r.production, good, r),
    merchant.forecast[good],
    firms.reduce((sum, f) => sum + (f.active ? f.forecast[good] : 0), 0),
  )
  // Upstream producers have business customers even when households never buy
  // their output. The same bill of materials drives procurement and investment.
  const demand =
    localDemand +
    neighbors.reduce(
      (sum, n) =>
        sum +
        Math.max(
          householdNeed(n.r, good),
          plannedInputDemand(n.r.plannedProduction ?? n.r.production, good, n.r),
        ) *
          n.access,
      0,
    )
  const stock = r.stocks[good] + firms.reduce((sum, f) => sum + f.stocks[good], 0)
  const pressure = clamp(demand / Math.max(1, stock + r.production[good] * 3), 0, 2)
  const inputs = Object.entries(productionRecipe(r, good)) as [Good, number][]
  const margin = Math.max(0, r.prices[good] - inputs.reduce((sum, [g, rate]) => sum + rate * r.prices[g], 0))
  let supply = 1
  for (const [g, rate] of inputs)
    if (rate > 0) {
      const available = r.stocks[g] + neighbors.reduce((sum, n) => sum + n.r.stocks[g] * n.access, 0)
      supply = Math.min(supply, clamp(available / Math.max(1, demand * rate)))
    }
  const industrial = inputs.length > 0
  const gain = industrial
    ? (FACILITY_POLICY.equipment / r.cells.length) *
      (0.25 + r.urban + r.literacy + Math.min(1, r.infrastructure))
    : FACILITY_POLICY.productivity * (Math.log1p(next) - Math.log1p(levels[kind])) * Math.min(4, potential)
  return {
    benefit: ((demand * margin) / 1000) * pressure * gain * supply,
    reason: industrial
      ? supply > 0.5
        ? 'Local or adjacent inputs, customer demand and existing skills support this industry.'
        : 'Industrial inputs are scarce here; the facility may remain idle until supplies arrive.'
      : good === 'food' || good === 'wool'
        ? 'Cultivable land and local or neighboring food demand favor agriculture.'
        : `Remaining ${good} deposits and local or neighboring demand favor extraction.`,
  }
}
