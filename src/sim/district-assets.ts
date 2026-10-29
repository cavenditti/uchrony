/** Boundary changes relocate existing assets. Capture every opening balance before
 * transfers so receipts cannot be redistributed in a simultaneous split and merge. */
import { divideStock } from './district-allocation'
import type { ProducerAccount } from './economic-types'
import { transfer } from './ledger'
import { GOODS, inventory, type Inventory, type World } from './types'

/** A partition's weights are cohort counts or physical overlap, never money received. */
export interface AccountPartition {
  from: string
  recipients: string[]
  weights: number[]
  cash: number
}
const intensiveFields = new Set(['cash', 'wage', 'previousPriceIndex'])

/** Clear extensive stocks/counters while retaining cash and intensive prices. */
export function clearProducerAssets(producer: ProducerAccount) {
  const fields = producer as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(producer)) {
    if (typeof value === 'number' && !intensiveFields.has(key)) fields[key] = 0
    else if (Array.isArray(value)) fields[key] = []
    else if (value && typeof value === 'object') fields[key] = inventory()
  }
}
/** Add an opening snapshot to already cleared destinations; final recipients get residuals. */
export function distributeProducerAssets(
  original: ProducerAccount,
  targets: ProducerAccount[],
  weights: number[],
) {
  for (const [key, value] of Object.entries(original)) {
    if (intensiveFields.has(key) || key === 'projects') continue
    if (typeof value === 'number')
      divideStock(value, weights).forEach((part, i) => {
        const target = targets[i] as unknown as Record<string, number>
        target[key] += part
      })
    else if (value && !Array.isArray(value))
      for (const good of GOODS)
        divideStock((value as Inventory)[good], weights).forEach((part, i) => {
          ;(targets[i] as unknown as Record<string, Inventory>)[key][good] += part
        })
  }
  for (const project of original.projects) {
    const capital = divideStock(project.capital, weights),
      cost = divideStock(project.cost, weights)
    targets.forEach((target, i) => {
      if (capital[i] || cost[i]) target.projects.push({ ...project, capital: capital[i], cost: cost[i] })
    })
  }
}
/** Novate cash, contracts and equity together. Initial conversion preserves the
 * source loan's ID; later remeshing preserves the first nonempty successor's ID,
 * matching historical save references in both entry paths. */
export function transferAccountPartitions(w: World, plans: AccountPartition[], initial = false) {
  const e = w.economy!,
    byAccount = new Map(plans.map((plan) => [plan.from, plan]))
  // Initial conversion partitions one existing account at a time. Snapshot only
  // its claims, avoiding quadratic copying of unrelated household ownership books.
  const affectedLoans = initial
    ? e.credit.loans.filter((loan) => byAccount.has(loan.borrower))
    : e.credit.loans
  const loans = affectedLoans.map((loan) => ({ ...loan }))
  const originals = initial ? new Map(affectedLoans.map((loan) => [loan.id, loan])) : undefined
  const owners = [
    ...e.banking!.banks.map((bank) => bank.owners),
    ...Object.values(e.supplierCredit ?? {}),
    ...(e.firms ?? []).flatMap((f) => (f.owners ? [f.owners] : [])),
  ]
  const openingOwners = owners.map((owner) =>
    initial
      ? Object.fromEntries(
          plans
            .filter((plan) => Object.hasOwn(owner, plan.from))
            .map((plan) => [plan.from, owner[plan.from]]),
        )
      : { ...owner },
  )
  for (const plan of plans) {
    if (initial)
      for (const to of plan.recipients)
        if (to !== plan.from) e.banking!.accounts[to] ??= e.banking!.accounts[plan.from]
    divideStock(plan.cash, plan.weights).forEach((amount, i) => {
      const to = plan.recipients[i]
      if (to !== plan.from) transfer(w, plan.from, to, amount, 'district boundary asset transfer')
    })
  }
  if (!initial) e.credit.loans = []
  for (const loan of loans) {
    const plan = byAccount.get(loan.borrower)
    if (!plan) {
      if (!initial) e.credit.loans.push(loan)
      continue
    }
    const original = originals?.get(loan.id)
    if (original) original.principal = 0
    let used = false
    divideStock(loan.principal, plan.weights).forEach((principal, i) => {
      if (!principal) return
      const borrower = plan.recipients[i]
      if (original && borrower === plan.from) {
        original.principal = principal
        original.contract ??= original.id
      } else
        e.credit.loans.push({
          ...loan,
          contract: loan.contract ?? loan.id,
          borrower,
          principal,
          id: initial || used ? e.credit.nextId++ : loan.id,
        })
      used = true
    })
  }
  owners.forEach((owner, i) => {
    for (const key of Object.keys(openingOwners[i])) delete owner[key]
    for (const [from, shares] of Object.entries(openingOwners[i])) {
      const plan = byAccount.get(from)
      if (!plan) {
        if (!initial) owner[from] = (owner[from] ?? 0) + shares
        continue
      }
      divideStock(shares, plan.weights).forEach((part, j) => {
        const to = plan.recipients[j]
        if (part) owner[to] = (owner[to] ?? 0) + part
      })
    }
  })
}
