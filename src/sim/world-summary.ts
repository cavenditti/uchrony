import { expeditionPeople } from './overseas-types'
/** National summaries read one territorial snapshot after local books and population settle. */
import { withWorldConfiguration } from './configuration'
import { militaryPeople } from './forces'
import { territorialIndex } from './territory-index'
import { type World, population } from './types'

/** Refresh totals and optionally append a bounded-detail historical observation. */
export function summarize(w: World, record = true) {
  return withWorldConfiguration(w, () => summarizeConfigured(w, record))
}

function summarizeConfigured(w: World, record = true) {
  const territory = territorialIndex(w)
  for (const n of w.nations) {
    const regions = territory.regions(n.id)
    n.population =
      regions.reduce((s, r) => s + population(r), 0) + militaryPeople(w, n.id) + expeditionPeople(w, n.id)
    n.gdp = w.economy?.accounts?.complete
      ? (w.economy.accounts.nations[n.id]?.productionGDP ?? 0)
      : regions.reduce((s, r) => s + r.gdp, 0)
  }
  if ((w.economy?.periodMonths ?? 1) !== 1) for (const n of w.nations) n.gdp /= w.economy!.periodMonths!
  w.totals.population =
    w.nations.reduce((s, n) => s + n.population, 0) +
    w.regions.filter((r) => r.nation < 0).reduce((s, r) => s + population(r), 0)
  w.totals.gdp =
    w.nations.reduce((s, n) => s + n.gdp, 0) +
    w.regions.filter((r) => r.nation < 0).reduce((s, r) => s + r.gdp, 0) / (w.economy?.periodMonths ?? 1)
  w.totals.trade = w.routes.reduce((s, r) => s + r.volume, 0) / (w.economy?.periodMonths ?? 1)
  w.totals.wars = w.relations.filter(
    (r) => r.treaty === 'war' && territory.alive(r.a) && territory.alive(r.b),
  ).length
  if (record) {
    w.history.push({
      month: w.month,
      population: w.totals.population,
      gdp: w.totals.gdp,
      trade: w.totals.trade,
      wars: w.totals.wars,
      food:
        w.regions.reduce((s, r) => s + r.foodCoverage * population(r), 0) /
        Math.max(
          1,
          w.regions.reduce((s, r) => s + population(r), 0),
        ),
      nations: w.nations.map((n) => ({
        id: n.id,
        population: n.population,
        gdp: n.gdp,
        treasury: n.treasury,
        territory: territory.regions(n.id).length,
      })),
    })
    // Retain annual history indefinitely, plus monthly detail for the last ten years.
    w.history = w.history.filter((p) => p.month >= w.month - 120 || p.month % 12 === 0)
  }
}
