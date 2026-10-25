import type { World } from './types'
import type { Loan } from './economic-types'

/** Reunite portions of one original claim, never unrelated credit contracts. */
export function consolidateClaims(w: World) {
  const claims = new Map<string, Loan>(),
    result: Loan[] = []
  for (const loan of w.economy!.credit.loans) {
    if (loan.principal === 0) continue
    const key = `${loan.contract ?? loan.id}:${loan.borrower}:${loan.bank}:${loan.rate}:${loan.originated}:${loan.arrears}`
    const existing = claims.get(key)
    if (existing) existing.principal += loan.principal
    else {
      claims.set(key, loan)
      result.push(loan)
    }
  }
  w.economy!.credit.loans = result
}

/** Migration changes the location of a household's liabilities and ownership too.
 * Plans use opening population shares; incoming assets cannot migrate twice this month. */
export function relocateHouseholdClaims(w: World, moves: { from: string; to: string; fraction: number }[]) {
  const e = w.economy
  if (!e || !moves.length) return
  const bySource = new Map<string, Map<string, number>>()
  for (const move of moves) {
    if (move.from === move.to || move.fraction <= 0) continue
    const targets = bySource.get(move.from) ?? new Map<string, number>()
    targets.set(move.to, (targets.get(move.to) ?? 0) + move.fraction)
    bySource.set(move.from, targets)
  }
  const allocation = (from: string) => {
    const targets = bySource.get(from)
    if (!targets) return [{ to: from, share: 1 }]
    const sum = [...targets.values()].reduce((a, b) => a + b, 0)
    if (sum > 1 + 1e-9) throw new Error('Household claims moved more than once')
    return [{ to: from, share: Math.max(0, 1 - sum) }, ...[...targets].map(([to, share]) => ({ to, share }))]
  }
  const old = e.credit.loans
  e.credit.loans = []
  for (const loan of old) {
    if (!bySource.has(loan.borrower)) {
      e.credit.loans.push(loan)
      continue
    }
    const targets = allocation(loan.borrower)
    let left = loan.principal,
      used = false
    targets.forEach(({ to, share }, i) => {
      const principal = i === targets.length - 1 ? left : Math.min(left, loan.principal * share)
      left -= principal
      if (principal > 0) {
        e.credit.loans.push({
          ...loan,
          id: used ? e.credit.nextId++ : loan.id,
          contract: loan.contract ?? loan.id,
          borrower: to,
          principal,
        })
        used = true
      }
    })
  }
  for (const owners of [
    ...(e.banking?.banks ?? []).map((b) => b.owners),
    ...(e.firms ?? []).flatMap((f) => (f.owners ? [f.owners] : [])),
  ]) {
    const old = { ...owners }
    for (const key of Object.keys(owners)) delete owners[key]
    for (const [from, shares] of Object.entries(old)) {
      let left = shares
      const targets = allocation(from)
      targets.forEach(({ to, share }, i) => {
        const part = i === targets.length - 1 ? left : Math.min(left, shares * share)
        left -= part
        if (part) owners[to] = (owners[to] ?? 0) + part
      })
    }
  }
  consolidateClaims(w)
}
