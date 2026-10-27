/** A short-lived broad phase for physical objects. Callers retain exact geometry
 * tests and ordering; numerical mesh refinement does not multiply the search. */
export class SpatialBuckets<T> {
  private buckets = new Map<number, Map<number, T[]>>()
  constructor(private span: number) {}
  insert(value: T, x: number, y: number, right = x, bottom = y) {
    for (let q = Math.floor(x / this.span); q <= Math.floor(right / this.span); q++) {
      let column = this.buckets.get(q)
      if (!column) this.buckets.set(q, (column = new Map()))
      for (let r = Math.floor(y / this.span); r <= Math.floor(bottom / this.span); r++) {
        let bucket = column.get(r)
        if (!bucket) column.set(r, (bucket = []))
        bucket.push(value)
      }
    }
  }
  query(x: number, y: number, right: number, bottom: number): Set<T> {
    const result = new Set<T>()
    for (let q = Math.floor(x / this.span); q <= Math.floor(right / this.span); q++) {
      const column = this.buckets.get(q)
      if (!column) continue
      for (let r = Math.floor(y / this.span); r <= Math.floor(bottom / this.span); r++)
        for (const value of column.get(r) ?? []) result.add(value)
    }
    return result
  }
  /** Point indexes insert each value once. Their broad phase can visit directly
   * without allocating and populating a deduplication set on every query. */
  visit(x: number, y: number, right: number, bottom: number, accept: (value: T) => void) {
    for (let q = Math.floor(x / this.span); q <= Math.floor(right / this.span); q++) {
      const column = this.buckets.get(q)
      if (!column) continue
      for (let r = Math.floor(y / this.span); r <= Math.floor(bottom / this.span); r++) {
        const bucket = column.get(r)
        if (bucket) for (const value of bucket) accept(value)
      }
    }
  }
}
