/** Stable minimum queue used by drainage and terrain-cost expansion. */
export class MinHeap {
  private items: { id: number; cost: number }[] = []
  get size() {
    return this.items.length
  }
  push(id: number, cost: number) {
    const item = { id, cost }
    let i = this.items.length
    this.items.push(item)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.items[p].cost <= cost) break
      this.items[i] = this.items[p]
      i = p
    }
    this.items[i] = item
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!
    if (this.items.length) {
      let i = 0
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1
        if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost) child++
        if (this.items[child].cost >= last.cost) break
        this.items[i] = this.items[child]
        i = child
      }
      this.items[i] = last
    }
    return first
  }
}
