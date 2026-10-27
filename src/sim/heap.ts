/** Stable minimum queue used by drainage and terrain-cost expansion. */
export class MinHeap {
  private ids: number[] = []
  private costs: number[] = []
  private count = 0
  get size() {
    return this.count
  }
  push(id: number, cost: number) {
    let i = this.count++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.costs[p] <= cost) break
      this.ids[i] = this.ids[p]
      this.costs[i] = this.costs[p]
      i = p
    }
    this.ids[i] = id
    this.costs[i] = cost
  }
  pop() {
    if (!this.count) return undefined!
    const first = { id: 0, cost: 0 }
    this.popInto(first)
    return first
  }
  /** Reuse the caller's cursor in hot shortest-path loops. Equal-cost ordering
   * is exactly the same as pop(), including the original left-child tie rule. */
  popInto(first: { id: number; cost: number }) {
    first.id = this.ids[0]
    first.cost = this.costs[0]
    const last = --this.count,
      lastId = this.ids[last],
      lastCost = this.costs[last]
    if (this.count) {
      let i = 0
      while (i * 2 + 1 < this.count) {
        let child = i * 2 + 1
        if (child + 1 < this.count && this.costs[child + 1] < this.costs[child]) child++
        if (this.costs[child] >= lastCost) break
        this.ids[i] = this.ids[child]
        this.costs[i] = this.costs[child]
        i = child
      }
      this.ids[i] = lastId
      this.costs[i] = lastCost
    }
  }
}
