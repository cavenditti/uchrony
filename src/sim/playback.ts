/** The clock lives beside the engine. Painting, persistence and model latency cannot gate its next tick. */
export class Playback {
  private timer: ReturnType<typeof setTimeout> | undefined
  private active = false
  get running() {
    return this.active
  }
  private speed = 1
  private due = 0
  private lastPublished = -Infinity
  constructor(
    private tick: () => void,
    private publish: () => void,
    private fail: (error: unknown) => void,
  ) {}
  start(speed: number) {
    this.stop()
    this.active = true
    this.speed = Math.max(1, Math.min(60, Number.isFinite(speed) ? speed : 1))
    this.due = performance.now() + 1000 / this.speed
    this.lastPublished = -Infinity
    this.timer = setTimeout(this.advance, 1000 / this.speed)
  }
  stop() {
    this.active = false
    clearTimeout(this.timer)
    this.timer = undefined
  }
  private advance = () => {
    this.timer = undefined
    try {
      const started = performance.now(),
        interval = 1000 / this.speed
      let changed = false
      while (performance.now() >= this.due && performance.now() - started < 8) {
        this.tick()
        changed = true
        // Bound catch-up debt. A slow machine never queues years of work or delays a pause command.
        this.due = Math.max(this.due + interval, performance.now() - interval * 2)
      }
      if (changed && performance.now() - this.lastPublished >= (this.speed > 12 ? 500 : 200)) {
        this.publish()
        this.lastPublished = performance.now()
      }
      this.timer = setTimeout(this.advance, Math.max(1, this.due - performance.now()))
    } catch (error) {
      this.stop()
      this.publish()
      this.fail(error)
    }
  }
}
