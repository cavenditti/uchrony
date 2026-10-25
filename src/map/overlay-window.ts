export interface OverlayWindow {
  x: number
  y: number
  width: number
  height: number
  pixelsWide: number
  pixelsHigh: number
}
interface View {
  w: number
  h: number
  scale: number
  x: number
  y: number
  tilt: boolean
}

/** Conservative height bounds for small terrain blocks. Only columns crossing
 * the view are queried, so distant mountains cannot dilute close-up linework.
 */
export class TerrainCoverage {
  private cols: number
  private rows: number
  private lower: Float32Array
  private upper: Float32Array
  private blockWidth: number
  private blockHeight: number

  constructor(
    width: number,
    private height: number,
    columns: number,
    rows: number,
    heightAt: (column: number, row: number) => number,
  ) {
    this.cols = Math.ceil(columns / 4)
    this.rows = Math.ceil(rows / 4)
    this.blockWidth = (width / columns) * 4
    this.blockHeight = (height / rows) * 4
    this.lower = new Float32Array(this.cols * this.rows).fill(Infinity)
    this.upper = new Float32Array(this.cols * this.rows).fill(-Infinity)
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const index = r * this.cols + c
        for (let y = r * 4; y <= Math.min(rows, (r + 1) * 4); y++)
          for (let x = c * 4; x <= Math.min(columns, (c + 1) * 4); x++) {
            const elevation = heightAt(x, y)
            this.lower[index] = Math.min(this.lower[index], elevation)
            this.upper[index] = Math.max(this.upper[index], elevation)
          }
      }
  }

  visibleRange(left: number, right: number, top: number, bottom: number, cotangent: number) {
    let min = Infinity,
      max = -Infinity
    const first = Math.max(0, Math.floor(left / this.blockWidth)),
      last = Math.min(this.cols - 1, Math.floor(right / this.blockWidth))
    for (let c = first; c <= last; c++)
      for (let r = 0; r < this.rows; r++) {
        const index = r * this.cols + c,
          lo = Math.max(r * this.blockHeight, top + this.lower[index] * cotangent),
          hi = Math.min(this.height, (r + 1) * this.blockHeight, bottom + this.upper[index] * cotangent)
        if (lo > hi) continue
        min = Math.min(min, lo)
        max = Math.max(max, hi)
      }
    return Number.isFinite(min) ? { top: min, bottom: max } : undefined
  }
}

/** A world-aligned decal covering the visible terrain, at display resolution.
 * Include elevated terrain displaced into view by the tilted camera, and retain
 * an overscan margin so small pans reuse the same bitmap. Storage is bounded.
 */
export function overlayWindow(
  worldWidth: number,
  worldHeight: number,
  view: View,
  maximumHeight: number,
  pixelRatio: number,
  maximumTextureSize: number,
  previous?: OverlayWindow,
  terrain?: TerrainCoverage,
): OverlayWindow {
  const angle = view.tilt ? Math.PI * 0.29 : Math.PI / 2,
    centerX = worldWidth / 2 - view.x / view.scale,
    centerY = worldHeight / 2 - view.y / (view.scale * Math.sin(angle)),
    halfX = view.w / view.scale / 2,
    halfY = view.h / view.scale / (2 * Math.sin(angle)),
    raised = view.tilt ? maximumHeight / Math.tan(angle) : 0,
    margin = 96 / view.scale,
    clampX = (x: number) => Math.max(0, Math.min(worldWidth, x)),
    clampY = (y: number) => Math.max(0, Math.min(worldHeight, y)),
    left = clampX(centerX - halfX),
    right = clampX(centerX + halfX),
    range = terrain?.visibleRange(
      left,
      right,
      centerY - halfY,
      centerY + halfY,
      view.tilt ? 1 / Math.tan(angle) : 0,
    ),
    top = clampY(range?.top ?? centerY - halfY),
    bottom = clampY(range?.bottom ?? centerY + halfY + raised),
    x = clampX(left - margin),
    y = clampY(top - margin),
    width = Math.max(1, clampX(right + margin) - x),
    height = Math.max(1, clampY(bottom + margin) - y),
    requested = 2 ** Math.ceil(Math.log2(Math.max(0.01, view.scale * pixelRatio))),
    limit = Math.min(4096, maximumTextureSize),
    area = width * height,
    baseRatio = Math.min(requested, limit / width, limit / height, Math.sqrt(8_388_608 / area)),
    // Spend any remaining storage on the unconstrained axis without sacrificing
    // the density already available on the other one.
    ratioX = Math.min(requested, limit / width, 8_388_608 / (area * baseRatio)),
    ratioY = Math.min(requested, limit / height, 8_388_608 / (area * ratioX))
  if (
    previous &&
    previous.x <= left &&
    previous.y <= top &&
    previous.x + previous.width >= right &&
    previous.y + previous.height >= bottom &&
    previous.pixelsWide / previous.width >= ratioX * 0.98 &&
    previous.pixelsWide / previous.width <= ratioX * 2 &&
    previous.pixelsHigh / previous.height >= ratioY * 0.98 &&
    previous.pixelsHigh / previous.height <= ratioY * 2
  )
    return previous
  return {
    x,
    y,
    width,
    height,
    pixelsWide: Math.max(1, Math.floor(width * ratioX)),
    pixelsHigh: Math.max(1, Math.floor(height * ratioY)),
  }
}
