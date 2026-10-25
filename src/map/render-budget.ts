/** Canvas dimension assignment reallocates backing storage, even when unchanged. */
export function resizeCanvas(canvas: { width: number; height: number }, width: number, height: number) {
  const w = Math.max(1, Math.ceil(width)),
    h = Math.max(1, Math.ceil(height))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
}

/** Retain world-coordinate content until it changes or its coverage is replaced. */
export class OverlayUpdates {
  private revision: object | null = null
  private paintedAt = -Infinity

  invalidate() {
    this.revision = null
    this.paintedAt = -Infinity
  }

  shouldPaint(revision: object, time: number, animated: boolean) {
    if (revision === this.revision && (!animated || time - this.paintedAt < 80)) return false
    this.revision = revision
    this.paintedAt = time
    return true
  }
}
