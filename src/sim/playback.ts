export type PlaybackSpeed = number
export const PLAYBACK_SPEEDS = [1, 2] as const

/** The clock lives beside the engine. Painting, persistence and model latency cannot gate its next tick. */
export class Playback {
  private timer: ReturnType<typeof setTimeout> | undefined
  private active = false
  get running() {
    return this.active
  }
  private speed: PlaybackSpeed = 1
  private due = 0
  private lastPublished = -Infinity
  constructor(
    private tick: (speed: PlaybackSpeed) => boolean | void,
    private publish: () => void,
    private fail: (error: unknown) => void,
  ) {}
  start(speed: PlaybackSpeed) {
    this.stop()
    this.active = true
    // Old clients may still send 'max'. Unsupported values resume regular 1× playback.
    this.speed = Math.max(1, Math.min(60, Number.isFinite(speed) ? speed : 1))
    const interval = 1000 / this.speed
    this.due = performance.now() + interval
    this.lastPublished = -Infinity
    this.timer = setTimeout(this.advance, Math.max(1, interval))
  }
  stop() {
    this.active = false
    clearTimeout(this.timer)
    this.timer = undefined
  }
  private advance = () => {
    this.timer = undefined
    if (!this.active) return
    try {
      const started = performance.now(),
        interval = 1000 / this.speed
      let changed = false,
        steps = 0
      while (this.active && performance.now() >= this.due && performance.now() - started < 8 && steps < 6) {
        changed = this.tick(this.speed) !== false
        steps++
        // Bound catch-up debt. A slow machine never queues years of work or delays a pause command.
        this.due = Math.max(this.due + interval, performance.now() - interval * 2)
      }
      if (changed && performance.now() - this.lastPublished >= (this.speed > 12 ? 500 : 200)) {
        this.publish()
        this.lastPublished = performance.now()
      }
      if (this.active) this.timer = setTimeout(this.advance, Math.max(1, this.due - performance.now()))
    } catch (error) {
      this.stop()
      // A failed integration may have only partially settled its ledgers. Keep
      // the last complete snapshot visible; never publish it as a finished step.
      this.fail(error)
    }
  }
}
