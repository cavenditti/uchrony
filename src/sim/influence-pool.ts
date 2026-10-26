import { solveInfluence, type InfluenceInput, type SharedInfluenceJob } from './influence-kernel'

export interface InfluenceWorker {
  ready?: Promise<void>
  postMessage(job: SharedInfluenceJob): void
  terminate(): unknown
}
/** Synchronous barrier runs only inside the simulation worker. UI and snapshot ownership
 * remain unchanged; commands cannot interleave with an unfinished economic month. */
export class InfluencePool {
  private workers: InfluenceWorker[] = []
  private disabled = false
  lastRun = { workers: 0, batches: 0, fallback: false, reason: '' }
  constructor(
    private createWorker: () => InfluenceWorker,
    private concurrency: number,
    private timeoutMs = 10000,
  ) {}
  async warmup() {
    const count = Math.min(32, Math.max(0, Math.floor(this.concurrency)))
    try {
      while (this.workers.length < count) this.workers.push(this.createWorker())
      await Promise.all(this.workers.map((worker) => worker.ready))
    } catch {
      this.dispose()
      this.disabled = true
    }
  }
  dispose() {
    for (const worker of this.workers) worker.terminate()
    this.workers = []
  }
  solve(input: InfluenceInput) {
    const batches = input.batches.length - 1
    this.lastRun = { workers: 0, batches, fallback: false, reason: '' }
    const count = Math.min(32, Math.max(0, Math.floor(this.concurrency)), Math.ceil(batches / 8))
    if (
      this.disabled ||
      count < 2 ||
      input.targets.length / 4 < 512 ||
      typeof SharedArrayBuffer === 'undefined'
    )
      return solveInfluence(input)
    let control: Int32Array | undefined
    try {
      while (this.workers.length < count) this.workers.push(this.createWorker())
      const share = <T extends Int32Array | Float64Array>(array: T): T => {
        const copy =
          array instanceof Int32Array
            ? new Int32Array(new SharedArrayBuffer(array.byteLength))
            : new Float64Array(new SharedArrayBuffer(array.byteLength))
        copy.set(array)
        return copy as T
      }
      const shared: InfluenceInput = {
        ...input,
        offsets: share(input.offsets),
        edges: share(input.edges),
        costs: share(input.costs),
        terrain: share(input.terrain),
        roots: share(input.roots),
        nodes: share(input.nodes),
        targets: share(input.targets),
        batches: share(input.batches),
      }
      control = new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT))
      const output = new Float64Array(
        new SharedArrayBuffer((input.targets.length / 4) * 2 * Float64Array.BYTES_PER_ELEMENT),
      )
      const job = { input: shared, output, control }
      for (const worker of this.workers.slice(0, count)) worker.postMessage(job)
      let deadline = performance.now() + this.timeoutMs,
        progress = 0
      // Completion belongs to the work, not to every dispatched worker. A browser
      // may defer an idle worker even after its peers finish all batches.
      while (Atomics.load(control, 3) < batches) {
        const completed = Atomics.load(control, 3)
        if (completed !== progress) {
          progress = completed
          deadline = performance.now() + this.timeoutMs
        }
        const finished = Atomics.load(control, 1),
          remaining = deadline - performance.now()
        if (remaining <= 0 || Atomics.load(control, 2))
          throw new Error(`Spatial worker did not finish (${Array.from(control).join(',')})`)
        if (Atomics.load(control, 3) < batches) Atomics.wait(control, 1, finished, remaining)
      }
      if (Atomics.load(control, 2)) throw new Error('Spatial worker failed')
      this.lastRun.workers = count
      return output
    } catch (error) {
      // Never consume partial results or reuse buffers that a late worker can still write.
      if (control) Atomics.store(control, 2, 1)
      this.dispose()
      this.disabled = true
      this.lastRun.fallback = true
      this.lastRun.reason = error instanceof Error ? error.message : String(error)
      return solveInfluence(input)
    }
  }
}
