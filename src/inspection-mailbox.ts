import type { InspectionRequest } from './sim/inspection'

/** At most one worker query and one latest viewport; camera movement cannot queue obsolete work. */
export class InspectionMailbox {
  private flight: number | null = null
  private pending: InspectionRequest | null = null
  constructor(private send: (request: InspectionRequest) => void) {}
  submit(request: InspectionRequest) {
    if (this.flight !== null) {
      this.pending = request
      return
    }
    this.flight = request.id
    this.send(request)
  }
  settle(id: number) {
    if (id !== this.flight) return
    this.flight = null
    const next = this.pending
    this.pending = null
    if (next) this.submit(next)
  }
  clear() {
    this.pending = null
  }
}
