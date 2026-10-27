/** Integer apportionment with explicit capacities; no people disappear in rounding. */
export function apportion(total: number, weights: number[], limits = weights.map(() => Infinity)) {
  const result = weights.map(() => 0)
  let left = Math.min(
    Math.max(0, Math.floor(total)),
    limits.reduce((sum, limit) => sum + limit, 0),
  )
  if (weights.length === 1 && Number.isFinite(weights[0]) && Number.isSafeInteger(left)) {
    if (left > 0) result[0] = left
    return result
  }
  if (left <= 0) return result
  // Sex splits dominate cohort transfers. Keep their exact largest-remainder
  // arithmetic and index ties without allocating shares or sorting two objects.
  if (
    weights.length === 2 &&
    Number.isSafeInteger(left) &&
    weights.every(Number.isFinite) &&
    limits.length === 2 &&
    limits.every((n) => n === Infinity || (Number.isSafeInteger(n) && n >= 0))
  ) {
    const a = Math.max(0, weights[0]),
      b = Math.max(0, weights[1])
    while (left > 0) {
      const openA = result[0] < limits[0],
        openB = result[1] < limits[1]
      if (!openA && !openB) break
      const count = Number(openA) + Number(openB),
        sum = (openA ? a : 0) + (openB ? b : 0)
      const exactA = openA ? left * (sum ? a / sum : 1 / count) : 0
      const exactB = openB ? left * (sum ? b / sum : 1 / count) : 0
      const floorA = Math.floor(exactA),
        floorB = Math.floor(exactB)
      const giveA = openA ? Math.min(limits[0] - result[0], floorA) : 0
      const giveB = openB ? Math.min(limits[1] - result[1], floorB) : 0
      result[0] += giveA
      result[1] += giveB
      left -= giveA + giveB
      if (left <= 0) break
      const first = exactB - floorB > exactA - floorA ? 1 : 0,
        second = 1 - first
      if (result[first] < limits[first]) {
        result[first]++
        left--
      }
      if (left && result[second] < limits[second]) {
        result[second]++
        left--
      }
    }
    return result
  }
  const exact = new Array<number>(weights.length),
    floors = new Array<number>(weights.length)
  while (left > 0) {
    const active: number[] = []
    let sum = 0
    for (let i = 0; i < weights.length; i++)
      if (result[i] < limits[i]) {
        active.push(i)
        sum += Math.max(0, weights[i])
      }
    if (!active.length) break
    let granted = 0
    for (const i of active) {
      exact[i] = left * (sum ? Math.max(0, weights[i]) / sum : 1 / active.length)
      floors[i] = Math.floor(exact[i])
      const amount = Math.min(limits[i] - result[i], floors[i])
      result[i] += amount
      granted += amount
    }
    left -= granted
    if (left <= 0) break
    active.sort((a, b) => exact[b] - floors[b] - (exact[a] - floors[a]) || a - b)
    let remainder = 0
    for (const i of active)
      if (left && result[i] < limits[i]) {
        result[i]++
        left--
        remainder++
      }
    if (!remainder && !granted) break
  }
  return result
}
