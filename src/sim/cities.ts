/**
 * Monthly settlement physics for resident markets: activity, natural regrowth,
 * legacy built cover and the share of residents living under urban conditions.
 *
 * The urban share is read from the continuous settlement field, never from a
 * place record: a pool's `urban` is the occupant-weighted mean urbanity of its
 * homes, so a growing village becomes gradually more urban and a farm beside a
 * town is partly urban, with no threshold at which land changes kind. Named
 * places (`places.ts`) are an administrative reading of the same field.
 */
import { periodRate } from './simulation-period'
import { optimizeResidentialLocations, settlementAccess } from './settlement-access'
import { clamp, population, type World } from './types'
import { neighbors } from './grid'
import { landscapeAt } from './landscape'
import { localFirmRegion } from './local-units'
import { updateResidentCounts } from './districts'
import { regionalFirms } from './firms'
import type { DistrictActivity } from './district-types'
import { MODEL_PARAMETERS } from './model-parameters'
import { refreshPlaces } from './places'
import { settlementStructure, type SettlementStructure } from './settlement-topology'

/** Built land changes slowly. Population growth alone does not instantly pave a cell.
 * Returns the settlement structure of the resulting census for the place refresh. */
export function advanceSettlements(
  w: World,
  initialize = false,
  access?: ReturnType<typeof settlementAccess>,
  mobilityMonths = 1,
): SettlementStructure | undefined {
  const local = w.localEconomy
  if (!local) return
  const residents = new Float64Array(w.cells.length),
    jobs = new Float64Array(w.cells.length)
  for (const f of w.economy?.firms ?? [])
    if (f.active) {
      const u = local.units[localFirmRegion(f)]
      if (!u || u.retired !== undefined) continue
      jobs[f.cell ?? u.center] +=
        f.employment * (f.laborMix ? f.laborMix.tools + f.laborMix.textiles + f.laborMix.arms : 0.2)
    }
  for (const id of local.active) updateResidentCounts(local.units[id])
  if (w.adaptive && !initialize && mobilityMonths) optimizeResidentialLocations(w, access, mobilityMonths)
  for (const id of local.active)
    for (const c of local.units[id].cells) residents[c] = local.units[id].residents[c] ?? 0
  if (!initialize)
    for (const id of local.active)
      for (const c of local.units[id].cells) {
        const capacity = landscapeAt(w.cells[c]).resources.timber * 5000 * (1 - (local.built[c] ?? 0) * 0.8)
        const stock = local.reserves[c].timber
        local.reserves[c].timber = stock + Math.max(0, capacity - stock) * periodRate(0.002)
      }
  if (!initialize && !w.adaptive) {
    const oldBuilt = { ...local.built }
    for (const id of local.active)
      for (const c of local.units[id].cells) {
        const habitat = landscapeAt(w.cells[c]).habitat
        const adjacent = neighbors(c, w.width, w.height).filter((n) => w.cells[n].terrain !== 'water')
        const spread = adjacent.reduce((sum, n) => sum + (oldBuilt[n] ?? 0), 0) / Math.max(1, adjacent.length)
        const demand = clamp((residents[c] + jobs[c] * 2) / MODEL_PARAMETERS.fullBuiltPopulationPerCell)
        const target =
          habitat < 0.06 ? demand * 0.1 : clamp(demand + spread * 0.15 * Math.min(1, residents[c] / 1000))
        local.built[c] = clamp(oldBuilt[c] + clamp(target - oldBuilt[c], -0.003, 0.006))
      }
  }
  // The field is read after relocation and built-cover growth, so this month's
  // urban shares, activity and places all describe the same census.
  const structure = settlementStructure(w)
  const urban = new Map<number, number>()
  structure.sources.forEach((source, i) =>
    urban.set(source.pool, (urban.get(source.pool) ?? 0) + source.people * structure.sourceUrbanity[i]),
  )
  for (const id of local.active) {
    const u = local.units[id],
      people = population(u)
    u.urban = people ? clamp((urban.get(id) ?? 0) / people) : 0
    for (const g of u.communities ?? []) g.urban = u.urban
    u.activity = districtActivity(w, id, u.urban)
  }
  return structure
}

/** Descriptive activity of a resident market from its firms' labor mix and its
 * residents' urbanity. Labels only: production never reads them. */
function districtActivity(w: World, id: number, urban: number): DistrictActivity {
  const u = w.localEconomy!.units[id]
  if (!population(u)) return 'wilderness'
  const production = { food: 0, mining: 0, factory: 0 }
  for (const f of w.economy?.firms ? regionalFirms(w, id) : [])
    if (f.active) {
      production.food += f.employment * (f.laborMix?.food ?? 0)
      production.mining +=
        f.employment * ((f.laborMix?.iron ?? 0) + (f.laborMix?.coal ?? 0) + (f.laborMix?.stone ?? 0))
      production.factory +=
        f.employment * ((f.laborMix?.tools ?? 0) + (f.laborMix?.textiles ?? 0) + (f.laborMix?.arms ?? 0))
    }
  const labor = production.food + production.mining + production.factory
  return production.mining > labor * 0.45
    ? 'mining'
    : production.factory > labor * 0.4
      ? 'industrial'
      : urban >= 0.5
        ? 'urban'
        : production.food > labor * 0.5 || u.fertility > 0.5
          ? 'agricultural'
          : 'mixed'
}

/** Settlement physics followed by the place refresh, as one step (fixtures and conversion). */
export function evolveCities(w: World, initialize = false) {
  refreshPlaces(w, advanceSettlements(w, initialize))
}
