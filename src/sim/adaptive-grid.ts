import { adaptiveMesh } from './adaptive-world'
import { MinHeap } from './heap'
import { SpatialBuckets } from './spatial-buckets'
import { nodeBounds, pointInPolygon, quadrant, rootBounds } from './physical-space'
import type {
  AdaptiveMesh,
  AdaptiveNode,
  PhysicalSite,
  PointMeters,
  SpatialBounds,
  SpatialInterface,
} from './adaptive-types'
import type { World } from './types'

interface Branch {
  id: string
  bounds: SpatialBounds
  children: number[]
  leaf?: AdaptiveNode
}
/** Runtime topology of the active numerical cells. Terrain sample IDs identify source geography only. */
export interface AdaptiveGrid {
  mesh: AdaptiveMesh
  leaves: readonly AdaptiveNode[]
  byId: ReadonlyMap<string, AdaptiveNode>
  adjacency: ReadonlyMap<string, readonly SpatialInterface[]>
}
interface Index extends AdaptiveGrid {
  branches: Branch[]
}
const cache = new WeakMap<World, { mesh: AdaptiveMesh; index: Index }>()
function index(w: World): Index {
  const mesh = adaptiveMesh(w),
    previous = cache.get(w)
  // A totals refresh mutates leaf membership in place. Reuse the topology: its
  // branches reference those live leaves, and no site lists are copied here.
  if (previous?.mesh === mesh) return previous.index
  const byId = new Map(mesh.leaves.map((n) => [n.id, n]))
  let adjacency: Map<string, SpatialInterface[]> | undefined
  const root = rootBounds(w)
  const branches: Branch[] = [{ id: 'r', bounds: root, children: [] }]
  const slots = new Map([['r', 0]])
  for (const leaf of mesh.leaves) {
    let parent = 0
    for (let length = 2; length <= leaf.id.length; length++) {
      const id = leaf.id.slice(0, length)
      if (!slots.has(id)) {
        slots.set(id, branches.length)
        branches[parent].children.push(branches.length)
        const bounds = branches[parent].bounds,
          q = Number(id.at(-1)),
          size = bounds.size / 2
        branches.push({
          id,
          bounds:
            length === leaf.id.length
              ? leaf.bounds
              : {
                  x: bounds.x + (q % 2) * size,
                  y: bounds.y + Math.floor(q / 2) * size,
                  size,
                },
          children: [],
        })
      }
      parent = slots.get(id)!
    }
    branches[parent].leaf = leaf
  }
  const result: Index = {
    mesh,
    leaves: mesh.leaves,
    byId,
    branches,
    get adjacency() {
      if (!adjacency) {
        adjacency = new Map(mesh.leaves.map((leaf) => [leaf.id, [] as SpatialInterface[]]))
        for (const face of mesh.interfaces) {
          adjacency.get(face.a)!.push(face)
          adjacency.get(face.b)!.push(face)
        }
      }
      return adjacency
    },
  }
  cache.set(w, { mesh, index: result })
  return result
}
export function adaptiveGrid(w: World): AdaptiveGrid {
  return index(w)
}

function validPoint(p: PointMeters) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('Invalid spatial point')
}
function validBounds(b: SpatialBounds) {
  validPoint(b)
  if (!Number.isFinite(b.size) || b.size <= 0) throw new Error('Invalid spatial bounds')
}
const intersects = (a: SpatialBounds, b: SpatialBounds) =>
  a.x <= b.x + b.size && a.x + a.size >= b.x && a.y <= b.y + b.size && a.y + a.size >= b.y
const distanceSquared = (p: PointMeters, b: SpatialBounds) =>
  Math.max(b.x - p.x, 0, p.x - b.x - b.size) ** 2 + Math.max(b.y - p.y, 0, p.y - b.y - b.size) ** 2

/** Recursive broad phase; boundary-touching leaves are included for exact point/segment tests. */
export function queryAdaptiveLeaves(w: World, bounds: SpatialBounds): AdaptiveNode[] {
  validBounds(bounds)
  const tree = index(w),
    result: AdaptiveNode[] = [],
    pending = [0]
  while (pending.length) {
    const branch = tree.branches[pending.pop()!]
    if (!intersects(branch.bounds, bounds)) continue
    if (branch.leaf) result.push(branch.leaf)
    else pending.push(...branch.children)
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

/** Exact source polygon membership; a leaf bounding square alone is never evidence of land. */
export function locateAdaptiveCell(w: World, point: PointMeters) {
  validPoint(point)
  const tree = index(w)
  let bounds = tree.branches[0].bounds,
    id = 'r'
  if (
    point.x < bounds.x ||
    point.y < bounds.y ||
    point.x > bounds.x + bounds.size ||
    point.y > bounds.y + bounds.size
  )
    return undefined
  while (!tree.byId.has(id) && id.length < 40) {
    const q = quadrant(point, bounds)
    id += q
    bounds = nodeBounds(bounds, 'r' + q)
  }
  const node = tree.byId.get(id)
  const onBoundary =
    !node ||
    Math.min(
      Math.abs(point.x - node.bounds.x),
      Math.abs(point.y - node.bounds.y),
      Math.abs(point.x - node.bounds.x - node.bounds.size),
      Math.abs(point.y - node.bounds.y - node.bounds.size),
    ) < 1e-7
  const candidates = onBoundary
    ? queryAdaptiveLeaves(w, { x: point.x - 1e-7, y: point.y - 1e-7, size: 2e-7 })
    : [node!]
  const matches = candidates.flatMap((leaf) =>
    leaf.fragments
      .filter((fragment) => pointInPolygon(point, fragment.polygon))
      .map((fragment) => ({ node: leaf, fragment, source: w.cells[fragment.cell] })),
  )
  // A point on a shared geographic edge has two valid owners; choose the same
  // source at every numerical resolution, including the closed outer boundary.
  return matches.sort((a, b) => a.source.id - b.source.id || a.node.id.localeCompare(b.node.id))[0]
}

export function queryAdaptiveSitesInBounds(
  w: World,
  bounds: SpatialBounds,
  predicate?: (s: PhysicalSite) => boolean,
): PhysicalSite[] {
  const sites = w.adaptive!.sites,
    result: PhysicalSite[] = []
  for (const node of queryAdaptiveLeaves(w, bounds))
    for (const id of node.sites) {
      const site = sites[id]
      if (
        site &&
        site.retired === undefined &&
        site.x >= bounds.x &&
        site.x <= bounds.x + bounds.size &&
        site.y >= bounds.y &&
        site.y <= bounds.y + bounds.size &&
        (!predicate || predicate(site))
      )
        result.push(site)
    }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

/** Exact radial query, with no province, market, terrain-sample or current-leaf boundary restriction. */
export function queryAdaptiveSites(
  w: World,
  point: PointMeters,
  radius: number,
  predicate?: (s: PhysicalSite) => boolean,
): PhysicalSite[] {
  validPoint(point)
  if (!Number.isFinite(radius) || radius < 0) throw new Error('Invalid spatial radius')
  const tree = index(w),
    result: PhysicalSite[] = [],
    pending = [0],
    maximum = radius ** 2
  while (pending.length) {
    const branch = tree.branches[pending.pop()!]
    if (distanceSquared(point, branch.bounds) > maximum) continue
    if (branch.leaf) {
      for (const id of branch.leaf.sites) {
        const site = w.adaptive!.sites[id]
        if (
          site &&
          site.retired === undefined &&
          (site.x - point.x) ** 2 + (site.y - point.y) ** 2 <= maximum &&
          (!predicate || predicate(site))
        )
          result.push(site)
      }
    } else pending.push(...branch.children)
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

/** A phase-local point index for repeated searches over a fixed set of sites.
 * Membership comes from the live mesh, including its exact land checks. Build a
 * new snapshot after moving, adding or retiring sites; never cache across phases. */
export function snapshotSiteSearch(w: World, predicate: (s: PhysicalSite) => boolean) {
  const buckets = new SpatialBuckets<PhysicalSite>(1024)
  const indexed = new Set<PhysicalSite>()
  for (const leaf of adaptiveMesh(w).leaves)
    for (const id of leaf.sites) {
      const site = w.adaptive!.sites[id]
      if (site && site.retired === undefined && !indexed.has(site) && predicate(site)) {
        indexed.add(site)
        buckets.insert(site, site.x, site.y)
      }
    }
  return (point: PointMeters, radius: number, accept?: (s: PhysicalSite) => boolean) => {
    validPoint(point)
    if (!Number.isFinite(radius) || radius < 0) throw new Error('Invalid spatial radius')
    const result: PhysicalSite[] = []
    buckets.visit(point.x - radius, point.y - radius, point.x + radius, point.y + radius, (site) => {
      if ((site.x - point.x) ** 2 + (site.y - point.y) ** 2 <= radius ** 2 && (!accept || accept(site)))
        result.push(site)
    })
    return result.sort((a, b) => a.id.localeCompare(b.id))
  }
}

/** Best-first search with a geometric lower bound, retaining ties for stable ID ordering. */
export function nearestAdaptiveSites(
  w: World,
  point: PointMeters,
  count: number,
  predicate?: (s: PhysicalSite) => boolean,
  maxDistance = Infinity,
): PhysicalSite[] {
  validPoint(point)
  if (!Number.isSafeInteger(count) || count < 0 || Number.isNaN(maxDistance) || maxDistance < 0)
    throw new Error('Invalid nearest-site query')
  if (!count) return []
  const tree = index(w),
    heap = new MinHeap(),
    candidates: { site: PhysicalSite; distance: number }[] = []
  let cutoff = maxDistance ** 2
  heap.push(0, distanceSquared(point, tree.branches[0].bounds))
  while (heap.size) {
    const next = heap.pop()
    if (next.cost > cutoff) break
    const branch = tree.branches[next.id]
    if (branch.leaf) {
      for (const id of branch.leaf.sites) {
        const site = w.adaptive!.sites[id]
        if (!site || site.retired !== undefined || (predicate && !predicate(site))) continue
        const distance = (site.x - point.x) ** 2 + (site.y - point.y) ** 2
        if (distance > cutoff) continue
        candidates.push({ site, distance })
        candidates.sort((a, b) => a.distance - b.distance || a.site.id.localeCompare(b.site.id))
        if (candidates.length > count) candidates.pop()
        if (candidates.length === count) cutoff = Math.min(cutoff, candidates.at(-1)!.distance)
      }
    } else
      for (const child of branch.children) {
        const distance = distanceSquared(point, tree.branches[child].bounds)
        if (distance <= cutoff) heap.push(child, distance)
      }
  }
  return candidates.map((c) => c.site)
}
