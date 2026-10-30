/** Durable, cell-addressed site improvements. The economic mesh may split or
 * merge without granting new improvements or erasing work after conquest. */
import { parameterGroup } from './configuration-context'
import { withWorldConfiguration } from './configuration'
import type { Nation, Region, World } from './types'

export const LAND_WORK = parameterGroup('productiveLand')
/** Structural save bound; technology and live parameters can impose lower limits. */
export const MAX_LAND_LEVEL = 6
/** A paid, dated refinement of one original terrain sample. */
export interface LandProject {
  nation: number
  cell: number
  funded: number
  completes: number
  /** Exactly one level may be in construction at a given site. */
  level: number
  cost: number
}
/** Sparse commissioned capital and construction, absent in legacy worlds. */
export interface ProductiveLand {
  levels: Record<number, number>
  projects: LandProject[]
}

/** Site works combine cultivation, fabrication and access knowledge. Research
 * unlocks a ceiling; it never grants the built capital beneath that ceiling. */
export function landDevelopmentLimit(n: Nation) {
  return Math.min(
    MAX_LAND_LEVEL,
    1 + Math.floor(Math.min(n.technologies.agriculture, n.technologies.industry, n.technologies.logistics)),
  )
}

/** Successive refinements yield smaller gains while their real input costs rise. */
export function landProductivity(level: number) {
  return 1 + LAND_WORK.productivity * Math.log1p(level)
}

// Capacity is queried repeatedly by hiring and production. Cache the area mean
// once per immutable district cell list; commissioning explicitly invalidates it.
const means = new WeakMap<World, { state: World['productiveLand']; values: WeakMap<number[], number> }>()
/** Area mean across the district's equal-sized original terrain samples. */
export function regionalLandProductivity(w: World, r: Region) {
  if (!w.productiveLand) return 1
  let cache = means.get(w)
  if (!cache || cache.state !== w.productiveLand) {
    cache = { state: w.productiveLand, values: new WeakMap() }
    means.set(w, cache)
  }
  let mean = cache.values.get(r.cells)
  if (mean === undefined) {
    mean =
      r.cells.reduce((sum, c) => sum + Math.log1p(w.productiveLand!.levels[c] ?? 0), 0) /
      Math.max(1, r.cells.length)
    cache.values.set(r.cells, mean)
  }
  // Cache geometry/commissioned levels only; live productivity tuning must take
  // effect immediately without changing either the month or district topology.
  return 1 + LAND_WORK.productivity * mean
}

/** Read-only province dossier totals, independent of economic remeshing. */
export function provinceLandDevelopment(w: World, r: Region) {
  return withWorldConfiguration(w, () => {
    const cells = new Set(r.cells)
    return {
      level:
        r.cells.reduce((sum, id) => sum + (w.productiveLand?.levels[id] ?? 0), 0) /
        Math.max(1, r.cells.length),
      multiplier: regionalLandProductivity(w, r),
      pending: w.productiveLand?.projects.filter((p) => cells.has(p.cell)).length ?? 0,
      limit: w.nations[r.nation] ? landDevelopmentLimit(w.nations[r.nation]) : 0,
    }
  })
}

/** Paid capital survives a technology regression or change of sovereign owner. */
export function completeLandProjects(w: World) {
  const state = w.productiveLand
  if (!state || !state.projects.some((p) => p.completes <= w.month)) return
  for (const p of state.projects)
    if (p.completes <= w.month) state.levels[p.cell] = Math.max(state.levels[p.cell] ?? 0, p.level)
  state.projects = state.projects.filter((p) => p.completes > w.month)
  means.delete(w)
}
