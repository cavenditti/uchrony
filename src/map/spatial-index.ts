/** Read-only render quadtree. Bounds include whole objects, so a road or building
 * crossing a quadrant remains visible from either side without duplicate draws. */
import { nodeBounds, quadrant } from '../sim/physical-space'
import type { SpatialBounds } from '../sim/adaptive-types'

/** A rectangle in the caller's coordinate system (physical metres or map units). */
export interface RenderBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Span is the object's resolvable size, independently of its culling bounds. */
export interface RenderEntry<T> {
  value: T
  bounds: RenderBounds
  span: number
}

type Branch<T> = {
  bounds: RenderBounds
  maximumSpan: number
  entries: readonly RenderEntry<T>[]
  children: Branch<T>[]
}

const intersects = (a: RenderBounds, b: RenderBounds) =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y

/** Rebuild on content changes; camera queries prune by both extent and size.
 * Each object belongs to one leaf. Tight content bounds, rather than quadrant
 * bounds, make centre-based subdivision safe for long/crossing geometry. */
export class RenderQuadtree<T> {
  private root?: Branch<T>

  constructor(entries: readonly RenderEntry<T>[]) {
    if (!entries.length) return
    const bounds = enclosingBounds(entries)
    this.root = branch(entries, { ...bounds, size: Math.max(bounds.width, bounds.height) }, 0)
  }

  /** Whole subtrees below the display threshold cost one bounds/size test. */
  query(window: RenderBounds, minimumSpan = 0): T[] {
    const result: T[] = []
    if (!(window.width > 0 && window.height > 0)) return result
    const visit = (node: Branch<T>) => {
      if (node.maximumSpan < minimumSpan || !intersects(node.bounds, window)) return
      for (const entry of node.entries)
        if (entry.span >= minimumSpan && intersects(entry.bounds, window)) result.push(entry.value)
      for (const child of node.children) visit(child)
    }
    if (this.root) visit(this.root)
    return result
  }
}

function enclosingBounds<T>(entries: readonly RenderEntry<T>[]): RenderBounds {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const { bounds: b } of entries) {
    left = Math.min(left, b.x)
    top = Math.min(top, b.y)
    right = Math.max(right, b.x + b.width)
    bottom = Math.max(bottom, b.y + b.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function branch<T>(entries: readonly RenderEntry<T>[], square: SpatialBounds, depth: number): Branch<T> {
  let maximumSpan = 0
  for (const entry of entries) maximumSpan = Math.max(maximumSpan, entry.span)
  const node: Branch<T> = { bounds: enclosingBounds(entries), maximumSpan, entries, children: [] }
  // Coincident points and degenerate lines must terminate too. Leaves keep a
  // small linear scan; splitting further would cost more than testing them.
  if (entries.length <= 16 || depth >= 24 || square.size === 0) return node
  const bins: RenderEntry<T>[][] = [[], [], [], []]
  for (const entry of entries) {
    const b = entry.bounds
    bins[quadrant({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, square)].push(entry)
  }
  node.entries = []
  for (let q = 0; q < 4; q++)
    if (bins[q].length) node.children.push(branch(bins[q], nodeBounds(square, `r${q}`), depth + 1))
  return node
}
