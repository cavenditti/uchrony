import { Box3, Vector3, type PlaneGeometry, type Ray } from 'three'

/** Exact triangle picking restricted to the regular-grid cells crossed by the ray.
 * The map camera looks down, so only the narrow segment between peak height and
 * sea level can intersect terrain. No walk over the entire world mesh is needed.
 */
export class TerrainPicker {
  private bounds: Box3
  private start = new Vector3()
  private end = new Vector3()
  private a = new Vector3()
  private b = new Vector3()
  private c = new Vector3()
  private candidate = new Vector3()
  private hit = new Vector3()

  constructor(private geometry: PlaneGeometry) {
    geometry.computeBoundingBox()
    this.bounds = geometry.boundingBox!.clone()
    // Flat maps must still have an intersectable slab.
    this.bounds.max.y = Math.max(0.001, this.bounds.max.y)
  }

  intersect(ray: Ray) {
    if (ray.direction.y >= -1e-6 || !ray.intersectsBox(this.bounds)) return null
    const upper = Math.max(0, (this.bounds.max.y - ray.origin.y) / ray.direction.y)
    const lower = (this.bounds.min.y - ray.origin.y) / ray.direction.y
    if (lower < upper) return null
    ray.at(upper, this.start)
    ray.at(lower, this.end)
    const { width, height, widthSegments: cols, heightSegments: rows } = this.geometry.parameters
    const minCol = Math.max(0, Math.floor((Math.min(this.start.x, this.end.x) / width) * cols - 1e-7))
    const maxCol = Math.min(cols - 1, Math.floor((Math.max(this.start.x, this.end.x) / width) * cols))
    const minRow = Math.max(0, Math.floor((Math.min(this.start.z, this.end.z) / height) * rows - 1e-7))
    const maxRow = Math.min(rows - 1, Math.floor((Math.max(this.start.z, this.end.z) / height) * rows))
    const positions = this.geometry.attributes.position,
      indices = this.geometry.index!
    let closest = Infinity
    for (let row = minRow; row <= maxRow; row++)
      for (let col = minCol; col <= maxCol; col++) {
        const offset = (row * cols + col) * 6
        for (let triangle = offset; triangle < offset + 6; triangle += 3) {
          this.a.fromBufferAttribute(positions, indices.getX(triangle))
          this.b.fromBufferAttribute(positions, indices.getX(triangle + 1))
          this.c.fromBufferAttribute(positions, indices.getX(triangle + 2))
          if (!ray.intersectTriangle(this.a, this.b, this.c, true, this.candidate)) continue
          const distance = ray.origin.distanceToSquared(this.candidate)
          if (distance < closest) {
            closest = distance
            this.hit.copy(this.candidate)
          }
        }
      }
    return Number.isFinite(closest) ? this.hit : null
  }
}
