/** Publicly constructed premises serve the firms and merchants in their actual
 * local market. Their durable sector capital survives administrative remeshing. */
import { parameterGroup } from './configuration-context'
import {
  FACILITY_DEFINITIONS,
  FACILITY_KINDS,
  MAX_FACILITY_LEVELS,
  type FacilityKind,
} from './facility-types'
import type { DistrictActivity } from './district-types'
import { GOODS, type Inventory, type Nation, type Region, type World } from './types'

export const FACILITY_POLICY = parameterGroup('facilities')
export const FACILITY_RECIPES = parameterGroup('facilityRecipes')
const EMPTY_LEVELS: Readonly<Record<FacilityKind, number>> = Object.freeze(
  Object.fromEntries(FACILITY_KINDS.map((kind) => [kind, 0])) as Record<FacilityKind, number>,
)
const regional = new WeakMap<
  World,
  { state: World['facilities']; values: WeakMap<number[], Readonly<Record<FacilityKind, number>>> }
>()
const pending = new WeakMap<
  World,
  { projects: NonNullable<World['facilities']>['projects']; length: number; cells: Set<number> }
>()

/** The first tier needs the recipe's technology; further research unlocks upgrades. */
export function facilityLevelLimit(n: Nation, kind: FacilityKind) {
  const technology = n.technologies[FACILITY_DEFINITIONS[kind].research]
  return Math.max(
    0,
    Math.min(MAX_FACILITY_LEVELS, 1 + Math.floor(technology - FACILITY_RECIPES[kind].technology)),
  )
}

/** Incremental append indexing avoids rescanning all pending sites for every
 * candidate in a large country's construction batch. Commissioning replaces the array. */
export function pendingFacilityCells(w: World): ReadonlySet<number> {
  const projects = w.facilities?.projects
  if (!projects) return EMPTY_PENDING
  let cache = pending.get(w)
  if (!cache || cache.projects !== projects || cache.length > projects.length) {
    cache = { projects, length: 0, cells: new Set() }
    pending.set(w, cache)
  }
  for (; cache.length < projects.length; cache.length++) cache.cells.add(projects[cache.length].cell)
  return cache.cells
}
const EMPTY_PENDING: ReadonlySet<number> = new Set()

/** Equal-area terrain means are cached independently of live tuning. The zero
 * path is allocation-free for worlds and districts without commissioned facilities. */
export function regionalFacilityLevels(w: World, r: Region): Readonly<Record<FacilityKind, number>> {
  if (!w.facilities) return EMPTY_LEVELS
  let cache = regional.get(w)
  if (!cache || cache.state !== w.facilities) {
    cache = { state: w.facilities, values: new WeakMap() }
    regional.set(w, cache)
  }
  let result = cache.values.get(r.cells)
  if (!result) {
    const totals = { ...EMPTY_LEVELS }
    for (const cell of r.cells)
      for (const [kind, level] of Object.entries(w.facilities.sites[cell] ?? {}))
        totals[kind as FacilityKind] += level / Math.max(1, r.cells.length)
    result = totals
    cache.values.set(r.cells, result)
  }
  return result
}

/** Bias a fresh labor plan toward installed premises, then normalize once.
 * Hiring still adjusts it to solvent demand, available inputs and paid workers. */
export function weightFacilityLabor(w: World, r: Region, mix: Inventory) {
  if (!w.facilities) return mix
  const levels = regionalFacilityLevels(w, r)
  let total = 0,
    changed = false
  for (const kind of FACILITY_KINDS) {
    const sector = FACILITY_DEFINITIONS[kind].sector
    if (sector !== 'market' && levels[kind] > 0) {
      mix[sector] *= 1 + FACILITY_POLICY.laborBias * levels[kind]
      changed = true
    }
  }
  if (!changed) return mix
  for (const good of GOODS) total += mix[good]
  if (total > 0) for (const good of GOODS) mix[good] /= total
  return mix
}

/** Paid workshop space is shared across active firms, rather than copied to
 * every entrant. Private establishment capacity remains a separate asset. */
export function publicWorkshopJobs(w: World, r: Region, active: number) {
  const levels = regionalFacilityLevels(w, r)
  return (
    ((levels['tool-industry'] + levels['textile-industry'] + levels['arms-industry']) *
      r.cells.length *
      FACILITY_POLICY.jobsPerTier) /
    Math.max(1, active)
  )
}

/** Installed specialization is descriptive; it does not book jobs or output. */
export function facilityDistrictActivity(w: World, r: Region): DistrictActivity | undefined {
  if (!w.facilities) return undefined
  const levels = regionalFacilityLevels(w, r),
    // Commissioned tiers are integers. Recover their counts from cached means
    // before a majority test, so summation order cannot break an exact tie.
    farming = Math.round(levels['farm-estate'] * r.cells.length),
    mining = Math.round(
      (levels['timber-yard'] + levels.quarry + levels['iron-mine'] + levels['coal-mine']) * r.cells.length,
    ),
    industry = Math.round(
      (levels['tool-industry'] + levels['textile-industry'] + levels['arms-industry']) * r.cells.length,
    ),
    market = Math.round(levels.market * r.cells.length),
    total = farming + mining + industry + market,
    largest = Math.max(farming, mining, industry, market)
  if (!total) return undefined
  if (largest <= total * 0.5) return 'mixed'
  return largest === farming
    ? 'agricultural'
    : largest === mining
      ? 'mining'
      : largest === industry
        ? 'industrial'
        : 'urban'
}

/** Completion changes durable capacity once, without granting cash, inventories,
 * ore, equipment in another district, or an instant change in the paid workforce. */
export function completeFacilityProjects(w: World) {
  const state = w.facilities
  if (!state || !state.projects.some((p) => p.completes <= w.month)) return
  for (const p of state.projects)
    if (p.completes <= w.month) {
      const site = (state.sites[p.cell] ??= {})
      site[p.kind] = Math.max(site[p.kind] ?? 0, p.level)
    }
  state.projects = state.projects.filter((p) => p.completes > w.month)
  regional.delete(w)
}
