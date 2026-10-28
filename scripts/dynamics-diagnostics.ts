import { economicRegions } from '../src/sim/local-units'
import { regionalFirms } from '../src/sim/firms'
import { STRATA } from '../src/sim/economic-types'
import { population, type World } from '../src/sim/types'
import { perceivedPower } from '../src/sim/intelligence'
import { foreignPolicyMandate } from '../src/sim/institutions'

export function dynamicsDiagnostics(w: World) {
  const pools = economicRegions(w).map((r) => {
    const firms = regionalFirms(w, r.id).filter((f) => f.active)
    const households = w.economy!.households[r.id]
    const labor = STRATA.reduce((s, k) => s + households[k].laborForce, 0)
    const jobs = STRATA.reduce((s, k) => s + households[k].employed, 0)
    return {
      id: r.id,
      province: r.name,
      nation: r.nation,
      population: population(r),
      labor,
      jobs,
      unemployed: Math.max(0, labor - jobs),
      food: r.foodCoverage,
      material: r.materialCoverage,
      cash: STRATA.reduce((s, k) => s + households[k].cash, 0),
      merchantCash: w.economy!.producers[r.id].cash,
      capital: firms.reduce((s, f) => s + f.capital, 0),
      investment: w.economy!.producers[r.id].investment,
      stocks: r.stocks,
      prices: r.prices,
      firms: firms.map((f) => ({
        id: f.id,
        cash: f.cash,
        capital: f.capital,
        employment: f.employment,
        desired: f.desiredEmployment,
        wage: f.wage,
        sales: f.sales,
        profit: f.profit,
        payroll: f.payroll,
        purchases: f.purchases,
        projects: f.projects.length,
        labor: f.labor,
        mix: f.laborMix,
        stocks: f.stocks,
      })),
    }
  })
  return {
    month: w.month,
    population: w.totals.population,
    unemployment: w.economy?.totals.unemployment,
    labor: pools.reduce((s, p) => s + p.labor, 0),
    jobs: pools.reduce((s, p) => s + p.jobs, 0),
    desired: pools.reduce((s, p) => s + p.firms.reduce((s, f) => s + f.desired, 0), 0),
    capital: pools.reduce((s, p) => s + p.capital, 0),
    investment: pools.reduce((s, p) => s + p.investment, 0),
    nations: w.nations
      .filter((n) => n.extinct === undefined && n.population > 0)
      .map((n) => ({
        id: n.id,
        people: n.population,
        treasury: n.treasury,
        gdp: n.gdp,
        food: n.foodCoverage,
        stability: n.stability,
        military: n.budget.military,
        policies: n.policies,
        power: perceivedPower(w, n.id, n.id),
        mandate: foreignPolicyMandate(w, n.id, [n.id]),
        assertiveness: n.character?.effective.assertiveness,
        drives: n.character?.leader.politics?.drives,
        neighbors: [
          ...new Set(
            w.regions
              .filter((r) => r.nation === n.id)
              .flatMap((r) => r.neighbors.map((id) => w.regions[id].nation))
              .filter((id) => id >= 0 && id !== n.id),
          ),
        ],
        armies: w.armies
          .filter((a) => a.nation === n.id)
          .map((a) => ({ soldiers: a.soldiers, supply: a.supply })),
      })),
    pools: pools.sort((a, b) => b.unemployed - a.unemployed).slice(0, 12),
  }
}
