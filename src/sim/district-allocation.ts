/** Residual allocation keeps extensive assets conserved across district boundaries. */
const fractions = (weights: number[]) => {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0)
  return weights.map((x) => (sum ? Math.max(0, x) / sum : 1 / weights.length))
}
/** The final recipient receives the residual, so no stock disappears through rounding. */
export function divideStock(amount: number, weights: number[]) {
  const shares = fractions(weights)
  let left = amount
  return shares.map((share, i) => {
    const part = i === shares.length - 1 ? left : Math.min(left, amount * share)
    left -= part
    return part
  })
}
