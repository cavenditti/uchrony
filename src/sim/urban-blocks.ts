import type { World } from './types'
import type { PointMeters, SpatialBounds } from './adaptive-types'
import { clipPolygon, polygonArea } from './physical-space'
import { residentialSites, occupiedResidents } from './residential-sites'
import { CELL_METERS } from './grid'
import { urbanCharacterName } from './urban-character'
import { floorUses } from './urban-fabric'
import { URBAN_USES, type FloorUses } from './urban-types'
import { urbanEmploymentIndex, urbanEmploymentLocations } from './urban-location'
import { activeUrbanProject } from './urban-projects'

import { URBAN_BLOCK_SPAN } from './simulation-invariants'
export { URBAN_BLOCK_SPAN } from './simulation-invariants'
export interface UrbanBlock {
  character?: string
  floorUses?: FloorUses
  id: string
  bounds: SpatialBounds
  residents: number
  capacity: number
  vacantCapacity: number
  construction: number
  jobs: number
  buildings: number
  builtArea: number
  laneMeters: number
  landArea: number
  coarseHousing: boolean
  centres: number[]
  use: 'housing' | 'employment' | 'mixed' | 'vacant' | 'construction' | 'access'
}
export function urbanBlockId(point: PointMeters, span = URBAN_BLOCK_SPAN) {
  return `${span}:${Math.floor(point.x / span)}:${Math.floor(point.y / span)}`
}

function clippedLength(a: PointMeters, b: PointMeters, bounds: SpatialBounds) {
  let lo = 0,
    hi = 1
  for (const axis of ['x', 'y'] as const) {
    const delta = b[axis] - a[axis]
    if (!delta) {
      if (a[axis] < bounds[axis] || a[axis] >= bounds[axis] + bounds.size) return 0
    } else {
      const t0 = (bounds[axis] - a[axis]) / delta,
        t1 = (bounds[axis] + bounds.size - a[axis]) / delta
      lo = Math.max(lo, Math.min(t0, t1))
      hi = Math.min(hi, Math.max(t0, t1))
    }
  }
  return Math.max(0, hi - lo) * Math.hypot(a.x - b.x, a.y - b.y)
}

/** Sparse, read-only urban summaries at a fixed physical scale. Remeshing,
 * camera movement and labels do not alter buildings, capacities or accounts.
 * Counts use recorded site positions; area/lanes are clipped across blocks. */
export function urbanBlocks(w: World, span = URBAN_BLOCK_SPAN): UrbanBlock[] {
  if (![32, 64, 128, 256, 512].includes(span)) throw new Error('Unsupported urban block span')
  if (w.viewOnly) return span === URBAN_BLOCK_SPAN ? (w.viewUrbanBlocks ?? []) : []
  if (!w.adaptive) return []
  const blocks = new Map<string, UrbanBlock>()
  const get = (point: PointMeters) => {
    const id = urbanBlockId(point, span)
    let block = blocks.get(id)
    if (!block) {
      const x = Math.floor(point.x / span) * span,
        y = Math.floor(point.y / span) * span
      const cell = w.cells[Math.floor(y / CELL_METERS) * w.width + Math.floor(x / CELL_METERS)]
      block = {
        id,
        bounds: { x, y, size: span },
        residents: 0,
        capacity: 0,
        vacantCapacity: 0,
        construction: 0,
        jobs: 0,
        buildings: 0,
        builtArea: 0,
        laneMeters: 0,
        landArea: cell && cell.terrain !== 'water' ? span ** 2 : 0,
        coarseHousing: false,
        centres: [],
        use: 'access',
      }
      blocks.set(id, block)
    }
    return block
  }
  const visit = (points: PointMeters[], fn: (block: UrbanBlock) => void) => {
    const left = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x)) / span))
    const top = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)) / span))
    const right = Math.min(
      (w.width * CELL_METERS) / span - 1,
      Math.floor(Math.max(...points.map((p) => p.x)) / span),
    )
    const bottom = Math.min(
      (w.height * CELL_METERS) / span - 1,
      Math.floor(Math.max(...points.map((p) => p.y)) / span),
    )
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) fn(get({ x: x * span, y: y * span }))
  }
  const centres = new Map<string, number>()
  for (const city of w.localEconomy?.cities ?? [])
    if (city.absorbedBy === undefined) for (const id of city.sites ?? []) centres.set(id, city.id)
  const pending = new Map<string, number>()
  for (const p of w.adaptive.construction ?? []) pending.set(p.site, (pending.get(p.site) ?? 0) + p.capacity)
  for (const p of w.adaptive.urban?.projects ?? [])
    if (activeUrbanProject(p))
      for (const s of p.after)
        pending.set(
          s.site,
          (pending.get(s.site) ?? 0) + Math.max(0, s.capacity - w.adaptive.sites[s.site].capacity),
        )
  for (const site of residentialSites(w)) {
    if (!(site.building || site.capacity || occupiedResidents(w, site) || pending.has(site.id))) continue
    const block = get(site),
      people = occupiedResidents(w, site)
    block.residents += people
    block.capacity += site.capacity
    block.vacantCapacity += Math.max(0, site.capacity - people)
    block.construction += pending.get(site.id) ?? 0
    block.coarseHousing ||= !site.building
    const centre = centres.get(site.id)
    if (centre !== undefined && !block.centres.includes(centre)) block.centres.push(centre)
    if (site.building) {
      block.floorUses ??= floorUses()
      if (site.fabric) for (const use of URBAN_USES) block.floorUses[use] += site.fabric.uses[use]
      block.buildings++
      visit(site.building, (b) => {
        b.builtArea += polygonArea(clipPolygon(site.building!, b.bounds))
      })
    }
  }
  const premises = urbanEmploymentIndex(w)
  for (const firm of w.economy?.firms ?? [])
    for (const placed of urbanEmploymentLocations(w, firm, premises)) get(placed.site).jobs += placed.workers
  for (const lane of w.adaptive.lanes ?? [])
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1],
        b = lane.points[i]
      visit([a, b], (block) => {
        block.laneMeters += clippedLength(a, b, block.bounds)
      })
    }
  return [...blocks.values()]
    .filter((b) => b.residents || b.capacity || b.construction || b.jobs || b.builtArea || b.laneMeters)
    .map((b) => {
      b.centres.sort((a, b) => a - b)
      b.character = urbanCharacterName(b.floorUses ?? floorUses())
      b.use =
        b.jobs > 0
          ? b.residents > 0
            ? 'mixed'
            : 'employment'
          : b.residents > 0
            ? 'housing'
            : b.construction > 0
              ? 'construction'
              : b.capacity > 0
                ? 'vacant'
                : 'access'
      return b
    })
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
}
