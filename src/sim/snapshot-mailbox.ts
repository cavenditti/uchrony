/** One unacknowledged UI snapshot; bursts coalesce without retaining old worlds. */
export class SnapshotMailbox {
  private waiting = false
  private dirty = false
  private message: string | undefined
  private acknowledgement = false
  constructor(private deliver: (message?: string, acknowledgement?: boolean) => void) {}
  publish(message?: string, acknowledgement = false) {
    this.dirty = true
    this.message = message ?? this.message
    this.acknowledgement ||= acknowledgement
    if (this.waiting) return
    this.waiting = true
    this.dirty = false
    const text = this.message,
      ack = this.acknowledgement
    this.message = undefined
    this.acknowledgement = false
    this.deliver(text, ack)
  }
  acknowledge() {
    this.waiting = false
    if (this.dirty) this.publish()
  }
  reset() {
    this.waiting = this.dirty = this.acknowledgement = false
    this.message = undefined
  }
}
