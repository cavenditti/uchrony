/** One retained clock for scenery. Pauses do not accumulate catch-up time. */
export class SceneryMotion {
  readonly time = { value: 0 }
  private previous: number | null = null

  advance(now: number, active: boolean) {
    if (active && this.previous !== null)
      this.time.value += Math.max(0, Math.min(0.1, (now - this.previous) / 1000))
    this.previous = active ? now : null
  }
}
