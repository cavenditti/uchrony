/** Integer apportionment with explicit capacities; no people disappear in rounding. */
export function apportion(total: number, weights: number[], limits = weights.map(() => Infinity)) {
  const result = weights.map(() => 0)
  let left = Math.min(
    Math.max(0, Math.floor(total)),
    limits.reduce((sum, limit) => sum + limit, 0),
  )
  while (left > 0) {
    const active = weights
        .map((weight, index) => ({ index, weight: Math.max(0, weight) }))
        .filter(({ index }) => result[index] < limits[index]),
      sum = active.reduce((value, item) => value + item.weight, 0)
    if (!active.length) break
    const shares = active.map(({ index, weight }) => ({
      index,
      exact: left * (sum ? weight / sum : 1 / active.length),
    }))
    let granted = 0
    for (const share of shares) {
      const amount = Math.min(limits[share.index] - result[share.index], Math.floor(share.exact))
      result[share.index] += amount
      granted += amount
    }
    left -= granted
    if (left <= 0) break
    shares.sort(
      (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.index - b.index,
    )
    let remainder = 0
    for (const { index } of shares)
      if (left && result[index] < limits[index]) {
        result[index]++
        left--
        remainder++
      }
    if (!remainder && !granted) break
  }
  return result
}
