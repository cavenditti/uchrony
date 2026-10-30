/** Shared settlement for land works: materials leave real stores, unemployed
 * people receive wages, and only completed purchases enter capital formation. */
import { STRATA } from './economic-types'
import { WAGE_SKILL } from './firms'
import { governmentAccount, householdAccount, producerAccount, transfer } from './ledger'
import { provinceId } from './local-units'
import { collectedTaxRate } from './macroeconomy'
import { marketStore, recordGoodsSale, recordOwnCapital, recordWages } from './national-accounts'
import { simulationMonths } from './simulation-period'
import { issueSupplierCredit, quoteMaterialFinancing } from './supplier-credit'
import { population, type Good, type Region, type World } from './types'

/** Prices and labor availability for one unit of a public construction recipe. */
export function publicConstructionQuote(
  w: World,
  r: Region,
  recipe: Partial<Record<Good, number>>,
  laborMonths: number,
) {
  const labor = laborMonths / simulationMonths(),
    wage = w.economy!.producers[r.id].wage,
    households = w.economy!.households[r.id]
  const slots = STRATA.map((s) => ({
    s,
    jobs: Math.max(0, households[s].laborForce - households[s].employed),
    wage: wage * WAGE_SKILL[s],
  }))
  const available = slots.reduce((sum, slot) => sum + slot.jobs, 0)
  const averageWage = available
    ? slots.reduce((sum, slot) => sum + slot.jobs * slot.wage, 0) / available
    : wage
  const laborCost = labor * averageWage
  const cost =
    laborCost +
    (Object.entries(recipe) as [Good, number][]).reduce((sum, [g, q]) => sum + (q * r.prices[g]) / 1000, 0)
  return { recipe, cost, labor, laborCost, slots, available }
}

/** The returned fraction is fully paid and physically supplied. Supplier credit
 * can finance protected material surplus; it never substitutes for paid labor. */
export function fundPublicConstruction(
  w: World,
  r: Region,
  quote: ReturnType<typeof publicConstructionQuote>,
  maximum: number,
  budget: number,
  purpose: string,
  minimum = 0.01,
) {
  const n = w.nations[r.nation]
  if (
    !n ||
    n.extinct !== undefined ||
    w.regions[provinceId(r)].control ||
    !population(r) ||
    quote.cost <= 0 ||
    quote.laborCost <= 0 ||
    quote.available <= 0
  )
    return { amount: 0, cost: 0 }
  // A live preset may make a material optional. Excluding zero coefficients
  // avoids a 0 / 0 supply bound when its store is also empty.
  const inputs = (Object.entries(quote.recipe) as [Good, number][]).filter(([, quantity]) => quantity > 0)
  const target = Math.min(maximum, quote.available / quote.labor)
  // A fully funded recipe needs no supplier-credit survey of every domestic
  // market. This keeps cash-funded district batches linear in their own inputs.
  const needsCredit = Math.min(budget, n.treasury) + 1e-9 < quote.cost * target
  const financing = quoteMaterialFinancing(
    w,
    r,
    Object.fromEntries(inputs),
    quote.laborCost,
    target,
    budget,
    needsCredit,
  )
  const { amount } = financing
  if (amount < minimum) return { amount: 0, cost: 0 }
  const account = governmentAccount(n.id),
    merchant = w.economy!.producers[r.id]
  let cost = 0
  for (const [g, quantity] of inputs) {
    const used = Math.min(r.stocks[g], amount * quantity),
      deferred = (Math.min(used, financing.deferred[g] ?? 0) * r.prices[g]) / 1000
    issueSupplierCredit(w, r, deferred)
    const paid = transfer(
      w,
      account,
      producerAccount(r.id),
      (used * r.prices[g]) / 1000 - deferred,
      `${purpose} materials`,
    )
    recordGoodsSale(w, marketStore(r.id), g, used, paid + deferred, {
      kind: 'business',
      nation: n.id,
      account,
    })
    r.stocks[g] -= used
    r.consumption[g] += used
    merchant.sales += paid
    merchant.sold[g] += used
    cost += paid + deferred
  }
  for (const slot of quote.slots) {
    const h = w.economy!.households[r.id][slot.s],
      jobs = (amount * quote.labor * slot.jobs) / quote.available
    const paid = transfer(w, account, householdAccount(r.id, slot.s), jobs * slot.wage, `${purpose} wages`)
    const tax = transfer(
      w,
      householdAccount(r.id, slot.s),
      account,
      paid * collectedTaxRate(w, r),
      'construction wage income tax',
    )
    h.employed += slot.wage > 0 ? paid / slot.wage : 0
    h.income += paid
    h.taxes += tax
    n.income += tax
    recordWages(w, r.id, account, paid)
    cost += paid
  }
  n.spending += cost
  n.capitalSpending = (n.capitalSpending ?? 0) + cost
  merchant.investment += cost
  recordOwnCapital(w, r.id, account, cost)
  return { amount, cost }
}
