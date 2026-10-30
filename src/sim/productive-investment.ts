import { fundFacilityProgram } from './facility-investment'
import { FACILITY_POLICY } from './productive-facilities'
import { fundLandDevelopmentProgram } from './land-investment'
import { LAND_WORK } from './productive-land'
import { activeDevelopment } from './development'
import { invest, regionalFirms } from './firms'
import { economicRegions, provinceId } from './local-units'
import { crossedPeriodMonth, simulationMonths } from './simulation-period'
import { recordWorldEvent } from './event-memory'
import { population, type Region, type World } from './types'

export type ProductiveActivity = 'food' | 'tools' | 'textiles'
export const ACTIVITY_NAMES = {
  food: 'farm equipment',
  tools: 'tool workshops',
  textiles: 'textile workshops',
}

/** Public subscriptions buy a stake in a working enterprise. The enterprise
 * builds with paid local labor/materials and returns only actual dividends. */
export function fundProductiveActivity(
  w: World,
  province: number,
  activity: ProductiveActivity,
  budget: number,
) {
  const p = w.regions[province]
  if (!p || p.nation < 0 || p.control || w.nations[p.nation].extinct !== undefined) return 0
  const candidates = economicRegions(w)
    .filter((r) => provinceId(r) === province && population(r) > 0)
    .flatMap((r) =>
      regionalFirms(w, r.id)
        .filter((f) => f.active)
        .map((f) => ({ r, f })),
    )
    .sort(
      (a, b) =>
        b.f.forecast[activity] - b.f.stocks[activity] - (a.f.forecast[activity] - a.f.stocks[activity]) ||
        a.f.id - b.f.id,
    )
  for (const { r, f } of candidates) {
    const cost = invest(w, r, f, { budget, activity })
    if (!cost) continue
    recordWorldEvent(w, {
      id: w.nextEvent++,
      month: w.month,
      type: 'economy',
      nation: p.nation,
      region: p.id,
      title: `${w.nations[p.nation].shortName} funds ${ACTIVITY_NAMES[activity]} in ${p.name}`,
      detail: `A ${cost.toFixed(3)}k public equity investment buys local materials and construction labor. Equipment takes six months to complete; earnings depend on sales after wages and inputs.`,
    })
    return cost
  }
  return 0
}

export function advanceProductiveInvestment(w: World) {
  const units = economicRegions(w),
    byNation = new Map<number, Region[]>()
  // Build domestic portfolios once; adding more states must not multiply the
  // full world scan for the new district-facility planner.
  for (const r of units) {
    const own = byNation.get(r.nation) ?? []
    own.push(r)
    byNation.set(r.nation, own)
  }
  for (const n of w.nations) {
    const own = byNation.get(n.id) ?? []
    const plan = activeDevelopment(w, n)
    if (!plan || !crossedPeriodMonth(w.month, n.id % 3, 3)) continue
    const prospects = own
      .filter((r) => !w.regions[provinceId(r)].control)
      .flatMap((r) =>
        (n.foodCoverage < 0.97 ? (['food'] as const) : (['food', 'tools', 'textiles'] as const)).map(
          (activity) => {
            const demand = regionalFirms(w, r.id)
              .filter((f) => f.active)
              .reduce((sum, f) => sum + f.forecast[activity], 0)
            const stock =
              r.stocks[activity] + regionalFirms(w, r.id).reduce((sum, f) => sum + f.stocks[activity], 0)
            return {
              region: provinceId(r),
              activity,
              score: Math.max(0, demand - stock) * r.prices[activity],
            }
          },
        ),
      )
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score || a.region - b.region)
    // Reserve most of the program for services; use idle savings only above a
    // six-month revenue buffer. No project is financed from assumed profits.
    const budget = Math.min(
      n.treasury,
      plan.appropriation * 0.3 +
        Math.max(0, n.treasury - plan.revenue * 6) * (1 - 0.98 ** Math.max(3, simulationMonths())),
    )
    // Food emergencies redirect capital to agricultural facilities and equipment.
    // Once basic needs are met, general land works can improve mature sites.
    const landSpent =
      n.foodCoverage >= 0.97 ? fundLandDevelopmentProgram(w, n, own, budget * LAND_WORK.budgetShare) : 0
    const facilitySpent = fundFacilityProgram(w, n, own, (budget - landSpent) * FACILITY_POLICY.budgetShare)
    plan.appropriation = Math.max(0, plan.appropriation - landSpent - facilitySpent)
    for (const p of prospects) {
      const spent = fundProductiveActivity(w, p.region, p.activity, budget - landSpent - facilitySpent)
      if (spent > 0) {
        plan.appropriation = Math.max(0, plan.appropriation - spent)
        break
      }
    }
  }
}

export function buildProductiveActivity(w: World, province: number, activity: ProductiveActivity) {
  const n = w.nations[w.regions[province]?.nation]
  if (!n) return 'Productive investment requires a governed province.'
  const cost = fundProductiveActivity(w, province, activity, n.treasury)
  return cost > 0
    ? `${ACTIVITY_NAMES[activity]} funded for ${cost.toFixed(3)}k crowns; equipment ready in six months. The state receives a share of future dividends.`
    : 'Investment requires an active enterprise, local timber, stone and tools, available construction workers and treasury funds. Occupied provinces cannot start projects.'
}
