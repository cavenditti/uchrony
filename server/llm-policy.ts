import { randomUUID } from 'node:crypto'
import type { LlmPolicySnapshot } from '../src/sim/llm-policy'

/** One dispatch barrier for every role and retry in this application server. */
export class LlmPolicy {
  private readonly instance = randomUUID()
  private enabled = true
  private generation = 0
  private dispatched = 0
  private cancelled = 0
  private requests = new Set<AbortController>()
  private listeners = new Set<(snapshot: LlmPolicySnapshot) => void>()
  constructor(
    private readonly forcedOff: () => boolean = () =>
      /^(1|true|off)$/i.test(process.env.UCHRONY_LLM_OFF ?? ''),
  ) {}
  snapshot(): LlmPolicySnapshot {
    return {
      instance: this.instance,
      enabled: this.enabled && !this.forcedOff(),
      forcedOff: this.forcedOff(),
      generation: this.generation,
      dispatched: this.dispatched,
      cancelled: this.cancelled,
      active: this.requests.size,
    }
  }
  set(enabled: boolean) {
    if (enabled && this.forcedOff()) throw new Error('LLM assistance is disabled by the server.')
    if (enabled !== this.enabled) {
      this.enabled = enabled
      this.generation++
      if (!enabled) {
        this.cancelled += this.requests.size
        for (const controller of this.requests) controller.abort()
        this.requests.clear()
      }
      this.emit()
    }
    return this.snapshot()
  }
  allowed(generation: number) {
    return this.enabled && !this.forcedOff() && generation === this.generation
  }
  begin(generation: number, controller: AbortController) {
    if (!this.allowed(generation)) throw new Error('LLM assistance is off or this request is stale.')
    this.requests.add(controller)
  }
  /** There is no await between the last permission check and provider dispatch. */
  dispatch<T>(generation: number, controller: AbortController, request: () => Promise<T>): Promise<T> {
    if (!this.allowed(generation) || controller.signal.aborted)
      throw new Error('LLM assistance is off or this request is stale.')
    this.dispatched++
    return request()
  }
  finish(controller: AbortController) {
    this.requests.delete(controller)
  }
  subscribe(listener: (snapshot: LlmPolicySnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }
  private emit() {
    for (const listener of this.listeners) listener(this.snapshot())
  }
}

export const globalLlmPolicy = new LlmPolicy()
