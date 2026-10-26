/** Insertion-ordered string lookup split across small native tables. Large maps
 * otherwise need one multi-megabyte backing allocation in Chromium's shared
 * worker/page heap cage, even when ample total memory remains available. */
export class StringTable<T> {
  private shards = Array.from({ length: 64 }, () => new Map<string, Entry<T>>())
  private order: Entry<T>[][] = []
  private count = 0
  get size() {
    return this.count
  }
  private shard(key: string) {
    let hash = 2166136261
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
    return this.shards[hash & 63]
  }
  get(key: string) {
    return this.shard(key).get(key)?.value
  }
  has(key: string) {
    return this.shard(key).has(key)
  }
  set(key: string, value: T) {
    const shard = this.shard(key),
      prior = shard.get(key)
    if (prior) prior.value = value
    else {
      const entry = { key, value, live: true }
      shard.set(key, entry)
      if (!this.order.length || this.order.at(-1)!.length === 1024) this.order.push([])
      this.order.at(-1)!.push(entry)
      this.count++
    }
    return this
  }
  delete(key: string) {
    const shard = this.shard(key),
      entry = shard.get(key)
    if (!entry) return false
    entry.live = false
    shard.delete(key)
    this.count--
    return true
  }
  clear() {
    for (const shard of this.shards) shard.clear()
    this.order = []
    this.count = 0
  }
  *values(): IterableIterator<T> {
    for (const chunk of this.order) for (const entry of chunk) if (entry.live) yield entry.value
  }
}
interface Entry<T> {
  key: string
  value: T
  live: boolean
}
