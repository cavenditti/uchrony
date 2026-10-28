import type { World } from './types'
import type { PhysicalSite } from './adaptive-types'
import {
  residentialSites,
  compactResidence,
  syncResidentialPopulation,
  createResidentialParcel,
} from './residential-sites'
import { subdivideHousing } from './building-lots'
import { crossedPeriodMonth } from './simulation-period'
import { ensureUrbanFabric } from './urban-fabric'
import { surveyBuildingPlots } from './urban-growth'
import { polygonArea } from './physical-space'
import { divideStock } from './districts'
import { apportion } from './allocation'
import { URBAN_USES } from './urban-types'

function surveyPart(w: World, source: PhysicalSite, neighbors: PhysicalSite[]) {
  const { plots, lanes } = surveyBuildingPlots(w, source, 8, true, neighbors)
  const fabric = structuredClone(source.fabric!),
    weight = plots.reduce((n, p) => n + p.weight, 0)
  const share = Math.min(
    64 / source.capacity,
    ...plots.map((p) => (polygonArea(p.building) * 4) / ((fabric.floorArea * p.weight) / weight)),
  )
  if (!(share > 0 && share < 1)) return
  const fractions = [1 - share, ...plots.map((p) => (share * p.weight) / weight)]
  const capacities = divideStock(source.capacity, fractions),
    opening = divideStock(source.openingCapacity, fractions),
    built = divideStock(source.openingBuilt ?? 0, fractions),
    invested = divideStock(source.investedValue ?? 0, fractions),
    people = apportion(source.residents ?? 0, fractions),
    areas = divideStock(fabric.floorArea, fractions),
    uses = Object.fromEntries(URBAN_USES.map((use) => [use, divideStock(fabric.uses[use], fractions)]))
  const children = plots.map((p) => createResidentialParcel(w, source.pool, p.cell, p.point, p.parcel))
  for (const [i, site] of [source, ...children].entries()) {
    site.capacity = capacities[i]
    site.openingCapacity = opening[i]
    site.openingBuilt = built[i]
    site.investedValue = invested[i]
    site.residents = people[i]
    site.founded = source.founded
    site.capitalOwner = source.capitalOwner
    if (i) site.building = plots[i - 1].building
    site.fabric = {
      ...structuredClone(fabric),
      floorArea: areas[i],
      uses: Object.fromEntries(URBAN_USES.map((use) => [use, uses[use][i]])) as typeof fabric.uses,
      survey: i ? 'recorded' : 'aggregate',
      predecessors: i ? [...fabric.predecessors, source.id] : fabric.predecessors,
      successors: i ? [] : [...fabric.successors, ...children.map((s) => s.id)],
    }
  }
  w.adaptive!.lanes ??= []
  w.adaptive!.lanes!.push(...lanes)
  w.adaptive!.revision++
}

/** Survey existing compact supports gradually. This resolves already
 * recorded assets into plots; it is not construction or a population increase.
 * Large supports retain their unsurveyed remainder and release at most eight
 * buildings each, instead of becoming towers or millions of objects in one tick. */
export function advanceUrbanSurvey(w: World) {
  const a = w.adaptive
  if (!a?.urban?.enabled || a.buildingVersion === 1 || w.viewOnly || !crossedPeriodMonth(w.month, 0, 6))
    return false
  const homes = residentialSites(w)
  const pending = new Set((a.construction ?? []).map((p) => p.site))
  const candidates = homes
    .filter((s) => !s.building && s.capacity > 0 && compactResidence(s) && !pending.has(s.id))
    .sort((a, b) => (b.residents ?? 0) - (a.residents ?? 0) || a.id.localeCompare(b.id))
  const before = a.revision
  const offset = (Math.floor(w.month / 6) * 2) % Math.max(1, candidates.length)
  for (let i = 0; i < Math.min(2, candidates.length); i++) {
    const source = candidates[(offset + i) % candidates.length]
    const neighbors = residentialSites(w).filter((s) => s.pool === source.pool)
    try {
      if (source.capacity <= 256) subdivideHousing(w, source, neighbors)
      else surveyPart(w, source, neighbors)
    } catch (error) {
      // Planning is read-only. A dense or blocked parcel can wait for a later
      // survey; unrelated failures must still reach the simulation's validator.
      if (!(error instanceof Error && error.message.startsWith('Insufficient accessible frontage for ')))
        throw error
    }
  }
  if (a.revision === before) return false
  ensureUrbanFabric(w)
  syncResidentialPopulation(w)
  return true
}
