import { economicRegions, provinceId } from './local-units'
import { governmentAccount, producerAccount, transfer } from './ledger'
import { simulationMonths, periodRate } from './simulation-period'
import { reserveTarget } from './economy'
import { type Good, type Region, type World } from './types'

/** Nominal compensation claims are financial assets, never spendable crowns. */
export function supplierDebt(w: World, nation: number) {
  return Object.values(w.economy?.supplierCredit?.[nation] ?? {}).reduce((sum, v) => sum + v, 0)
}
export function supplierCreditRoom(w: World, nation: number) {
  const n = w.nations[nation]
  if (!n || n.extinct !== undefined) return 0
  const payroll = economicRegions(w)
    .filter((r) => r.nation === nation && !w.regions[provinceId(r)].control)
    .reduce(
      (sum, r) =>
        sum +
        (w.economy!.producers[r.id].wage / simulationMonths()) *
          Object.values(w.economy!.households[r.id]).reduce((sum, h) => sum + h.laborForce, 0),
      0,
    )
  const revenue = Math.max(
    n.development?.revenue ?? 0,
    n.income / simulationMonths(),
    ((payroll * n.policies.tax) / 100) * 0.35,
  )
  return Math.max(0, revenue * 12 - supplierDebt(w, nation))
}
export function materialSurplus(w: World, r: Region, good: Good) {
  // Protect ordinary consumption, production inputs and already observed sales.
  const p = w.economy!.producers[r.id]
  return Math.max(0, r.stocks[good] - Math.max(reserveTarget(r, good), p.forecast[good] * 2))
}
export interface MaterialFinancing {
  amount: number
  deferred: Partial<Record<Good, number>>
  credit: number
  cash: number
  cost: number
}
/** Cash buys any offered stock; credit can only draw on the protected surplus.
 * Labor is still paid in crowns. A shortage of either cannot be wished away. */
export function quoteMaterialFinancing(
  w: World,
  r: Region,
  recipe: Partial<Record<Good, number>>,
  laborCost: number,
  maximum: number,
  cashBudget: number,
  useCredit = true,
): MaterialFinancing {
  const inputs = Object.entries(recipe) as [Good, number][]
  const unitCost = laborCost + inputs.reduce((sum, [g, q]) => sum + (q * r.prices[g]) / 1000, 0)
  const cash = Math.max(0, Math.min(cashBudget, w.nations[r.nation]?.treasury ?? 0))
  const room = useCredit ? supplierCreditRoom(w, r.nation) : 0
  const top = Math.max(0, Math.min(maximum, ...inputs.map(([g, q]) => r.stocks[g] / q)))
  const surplus = Object.fromEntries(inputs.map(([g]) => [g, materialSurplus(w, r, g)]))
  const creditFor = (amount: number) =>
    Math.min(
      room,
      inputs.reduce((sum, [g, q]) => sum + (Math.min(q * amount, surplus[g]) * r.prices[g]) / 1000, 0),
    )
  let low = 0,
    high = top
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2
    if (mid * unitCost - creditFor(mid) <= cash) low = mid
    else high = mid
  }
  const amount = low,
    cost = amount * unitCost
  let needed = Math.max(0, cost - cash)
  const deferred: Partial<Record<Good, number>> = {}
  for (const [g, q] of inputs) {
    const price = r.prices[g] / 1000
    const quantity = Math.min(q * amount, materialSurplus(w, r, g), price > 0 ? needed / price : 0)
    deferred[g] = quantity
    needed = Math.max(0, needed - quantity * price)
  }
  const credit = inputs.reduce((sum, [g]) => sum + ((deferred[g] ?? 0) * r.prices[g]) / 1000, 0)
  return { amount, deferred, credit, cash: Math.max(0, cost - credit), cost }
}
export function issueSupplierCredit(w: World, r: Region, value: number) {
  if (value <= 1e-12) return
  if (value > supplierCreditRoom(w, r.nation) + 1e-7)
    throw new Error('Supplier compensation exceeds the current revenue limit')
  const registry = (w.economy!.supplierCredit ??= {})
  const claims = (registry[r.nation] ??= {})
  const creditor = producerAccount(r.id)
  claims[creditor] = (claims[creditor] ?? 0) + value
  w.nations[r.nation].debt += value
}
export function repaySuppliers(w: World) {
  for (const [id, claims] of Object.entries(w.economy?.supplierCredit ?? {})) {
    const n = w.nations[+id]
    for (const [creditor, amount] of Object.entries(claims)) {
      const paid = transfer(
        w,
        governmentAccount(n.id),
        creditor,
        amount * periodRate(1 / 60),
        'supplier credit repayment',
      )
      claims[creditor] = Math.max(0, amount - paid)
      n.debt = Math.max(0, n.debt - paid)
      // Receipts become cash revenue only when compensation is paid, so unpaid
      // claims cannot fund dividends, tax payments or another purchase.
      const [kind, target] = creditor.split(':')
      if (kind === 'producer') w.economy!.producers[+target].sales += paid
      if (claims[creditor] < 1e-10) delete claims[creditor]
    }
  }
}
