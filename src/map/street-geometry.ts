import type { CityPoint } from './city-layout'

/** Shared edge vertices keep paving continuous around bends. Bounded miters
 * avoid spikes at acute corners; repeated samples never create NaN geometry. */
export function streetRibbon(points: readonly CityPoint[], width: number): CityPoint[][] {
  const path = points.filter(
    (p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > 1e-8,
  )
  if (path.length < 2 || width <= 0) return []
  const normals = path.slice(1).map((b, i) => {
    const a = path[i],
      length = Math.hypot(b.x - a.x, b.z - a.z)
    return { x: -(b.z - a.z) / length, z: (b.x - a.x) / length }
  })
  const edges = path.map((p, i) => {
    const before = normals[Math.max(0, i - 1)],
      after = normals[Math.min(i, normals.length - 1)]
    const length = Math.hypot(before.x + after.x, before.z + after.z)
    const normal =
      length < 1e-8 ? after : { x: (before.x + after.x) / length, z: (before.z + after.z) / length }
    const reach = Math.min(width, width / (2 * Math.max(0.5, normal.x * after.x + normal.z * after.z)))
    return [
      { x: p.x + normal.x * reach, z: p.z + normal.z * reach },
      { x: p.x - normal.x * reach, z: p.z - normal.z * reach },
    ]
  })
  return edges.slice(1).map((edge, i) => [edges[i][0], edge[0], edge[1], edges[i][1]])
}
