import { economicRegion } from './local-units'
import { recordService, recordGoodsSale, marketStore, economicNation } from './national-accounts'
import type { Good } from './types'
import { inventory, population, type World } from './types'
import { ensureBanking, settleBankTransfer, issueBankLoan, auditBanks } from './banking'
import { STRATA, type EconomicStratum, type HouseholdAccount, type ProducerAccount } from './economic-types'
const household = (cash: number): HouseholdAccount => ({
  cash,
  income: 0,
  taxes: 0,
  transfers: 0,
  expenditure: 0,
  employed: 0,
  laborForce: 0,
  foodCoverage: 1,
  materialCoverage: 1,
  consumption: inventory(),
})
export const governmentAccount = (id: number) => `government:${id}`
export const producerAccount = (id: number) => `producer:${id}`
export const firmAccount = (id: number) => `firm:${id}`
export const householdAccount = (id: number, stratum: EconomicStratum) => `household:${id}:${stratum}`
export function stratumPeople(w: World, region: number, stratum: EconomicStratum) {
  return (economicRegion(w, region).communities ?? []).reduce(
    (sum, g) =>
      sum +
      ((g.stratum ?? 'laborer') === stratum
        ? g.population.children + g.population.adults + g.population.elders
        : 0),
    0,
  )
}
export function ensureEconomy(w: World) {
  if (w.economy?.producers[w.regions.length - 1]) {
    ensureBanking(w)
    return w.economy
  }
  if (!w.economy)
    w.economy = {
      version: 1,
      initialized: w.month,
      households: {},
      producers: {},
      credit: { cash: 0, loans: [], nextId: 1, losses: 0 },
      ledger: {
        month: w.month,
        opening: {},
        net: {},
        entries: [],
        transactions: 0,
        volume: 0,
        discrepancy: 0,
      },
      national: {},
      totals: {
        gdp: 0,
        realOutput: 0,
        consumption: 0,
        investment: 0,
        priceIndex: 1,
        unemployment: 0,
        money: 0,
        debt: 0,
      },
    }
  const e = w.economy
  for (const r of w.regions) {
    if (!e.households[r.id]) {
      e.households[r.id] = Object.fromEntries(
        STRATA.map((s) => [s, household(stratumPeople(w, r.id, s) * (s === 'owner' ? 0.012 : 0.002))]),
      ) as Record<EconomicStratum, HouseholdAccount>
      const p: ProducerAccount = {
        cash: population(r) * 0.004,
        wage: 0.0015,
        payroll: 0,
        sales: 0,
        purchases: 0,
        freight: 0,
        taxes: 0,
        interest: 0,
        profit: 0,
        capital: r.industry,
        investment: 0,
        projects: [],
        forecast: inventory(),
        planned: inventory(),
        sold: inventory(),
        inputTargets: inventory(),
        openingStocks: { ...r.stocks },
        losses: inventory(),
        intermediate: inventory(),
        grossOutput: 0,
        valueAdded: 0,
        realOutput: 0,
        publicServices: 0,
        realServices: 0,
        desiredEmployment: 0,
      }
      e.producers[r.id] = p
      e.credit.cash += population(r) * 0.003
    }
  }
  // Existing sovereign debt is an opening asset of the intermediary, not newly borrowed money.
  if (!Object.keys(e.ledger.opening).length) {
    for (const n of w.nations)
      if (n.debt > 0 && !e.credit.loans.some((l) => l.borrower === governmentAccount(n.id)))
        e.credit.loans.push({
          id: e.credit.nextId++,
          borrower: governmentAccount(n.id),
          principal: n.debt,
          arrears: 0,
          originated: w.month,
        })
    e.ledger.opening = balances(w)
  }
  ensureBanking(w)
  return e
}
export function balance(w: World, account: string): number {
  const [kind, id, group] = account.split(':')
  const i = Number(id)
  if (kind === 'government') return w.nations[i]?.treasury ?? 0
  if (kind === 'province') return w.regions[i]?.delegation?.treasury ?? 0
  if (kind === 'institution') return w.institutions?.organizations.find((o) => o.id === i)?.treasury ?? 0
  if (kind === 'producer') return w.economy?.producers[i]?.cash ?? 0
  if (kind === 'firm') return w.economy?.firms?.[i]?.cash ?? 0
  if (kind === 'household') return w.economy?.households[i]?.[group as EconomicStratum]?.cash ?? 0
  if (kind === 'credit') return w.economy?.credit.cash ?? 0
  throw new Error(`Unknown settlement account: ${account}`)
}
export function setBalance(w: World, account: string, value: number) {
  const [kind, id, group] = account.split(':')
  const i = Number(id)
  if (kind === 'government') w.nations[i].treasury = value
  else if (kind === 'province') w.regions[i].delegation!.treasury = value
  else if (kind === 'institution') w.institutions!.organizations.find((o) => o.id === i)!.treasury = value
  else if (kind === 'producer') w.economy!.producers[i].cash = value
  else if (kind === 'firm') w.economy!.firms![i].cash = value
  else if (kind === 'household') w.economy!.households[i][group as EconomicStratum].cash = value
  else if (kind === 'credit') w.economy!.credit.cash = value
  else throw new Error(`Unknown settlement account: ${account}`)
}
export function balances(w: World): Record<string, number> {
  const accounts: Record<string, number> = { credit: w.economy?.credit.cash ?? 0 }
  for (const n of w.nations) accounts[governmentAccount(n.id)] = n.treasury
  for (const r of w.regions) if (r.delegation) accounts[`province:${r.id}`] = r.delegation.treasury
  for (const [id, p] of Object.entries(w.economy?.producers ?? {})) accounts[producerAccount(+id)] = p.cash
  for (const [id, hs] of Object.entries(w.economy?.households ?? {}))
    for (const s of STRATA) accounts[householdAccount(+id, s)] = hs[s].cash
  for (const o of w.institutions?.organizations ?? []) accounts[`institution:${o.id}`] = o.treasury
  for (const f of w.economy?.firms ?? []) accounts[firmAccount(f.id)] = f.cash
  return accounts
}
/** Explicit deposit issue/extinguishment; only the banking subsystem calls this primitive. */
export function changeDeposit(
  w: World,
  account: string,
  delta: number,
  counterparty: string,
  category: string,
) {
  const e = w.economy!,
    old = balance(w, account)
  if (!Number.isFinite(delta) || old + delta < -1e-8) throw new Error('Invalid deposit mutation')
  if (e.ledger.opening[account] === undefined) e.ledger.opening[account] = old
  setBalance(w, account, Math.max(0, old + delta))
  e.ledger.net[account] = (e.ledger.net[account] ?? 0) + delta
  const kind = delta > 0 ? 'created' : 'destroyed'
  e.ledger[kind] = (e.ledger[kind] ?? 0) + Math.abs(delta)
  e.banking![kind] += Math.abs(delta)
  e.ledger.transactions++
  e.ledger.volume += Math.abs(delta)
  e.ledger.entries.push({
    from: delta > 0 ? counterparty : account,
    to: delta > 0 ? account : counterparty,
    amount: Math.abs(delta),
    category,
  })
  if (e.ledger.entries.length > 1024) e.ledger.entries.splice(0, e.ledger.entries.length - 1024)
}
/** The only runtime cash mutation primitive. Partial settlement is explicit in its return value. */
export function transfer(w: World, from: string, to: string, requested: number, category: string): number {
  const e = ensureEconomy(w)
  if (!Number.isFinite(requested) || requested < 0)
    throw new Error('Payments must be finite and nonnegative.')
  if (from === to || requested === 0) return 0
  const source = balance(w, from),
    destination = balance(w, to),
    amount = Math.min(source, requested)
  if (!(amount > 0)) return 0
  settleBankTransfer(w, from, to, amount)
  for (const [key, value] of [
    [from, source],
    [to, destination],
  ] as const)
    if (e.ledger.opening[key] === undefined) e.ledger.opening[key] = value
  setBalance(w, from, source - amount)
  setBalance(w, to, destination + amount)
  e.ledger.net[from] = (e.ledger.net[from] ?? 0) - amount
  e.ledger.net[to] = (e.ledger.net[to] ?? 0) + amount
  e.ledger.transactions++
  e.ledger.volume += amount
  e.ledger.entries.push({ from, to, amount, category })
  if (e.ledger.entries.length > 1024) e.ledger.entries.splice(0, e.ledger.entries.length - 1024)
  return amount
}
export function beginLedgerMonth(w: World) {
  const e = ensureEconomy(w)
  e.ledger = {
    month: w.month,
    opening: balances(w),
    net: {},
    entries: [],
    transactions: 0,
    volume: 0,
    discrepancy: 0,
    created: 0,
    destroyed: 0,
  }
  for (const bank of e.banking!.banks) bank.income = 0
}
export function auditLedger(w: World) {
  const e = ensureEconomy(w),
    current = balances(w)
  let discrepancy = 0
  for (const key of new Set([...Object.keys(e.ledger.opening), ...Object.keys(current)]))
    discrepancy = Math.max(
      discrepancy,
      Math.abs((current[key] ?? 0) - (e.ledger.opening[key] ?? 0) - (e.ledger.net[key] ?? 0)),
    )
  const imbalance = Math.abs(
    Object.values(e.ledger.net).reduce((sum, x) => sum + x, 0) -
      (e.ledger.created ?? 0) +
      (e.ledger.destroyed ?? 0),
  )
  e.ledger.discrepancy = Math.max(discrepancy, imbalance)
  const scale = Object.values(e.ledger.opening).reduce((largest, value) => Math.max(largest, value), 1)
  if (e.ledger.discrepancy > 1e-8 * scale)
    throw new Error(`Unreconciled financial transaction: ${e.ledger.discrepancy}`)
  e.totals.money = Object.values(current).reduce((sum, x) => sum + x, 0)
  e.totals.debt = e.credit.loans.reduce((sum, l) => sum + l.principal, 0)
  auditBanks(w)
  return e.ledger.discrepancy
}
export function publicExpense(
  w: World,
  nation: number,
  amount: number,
  category: string,
  region = w.nations[nation].capital,
) {
  const paid = transfer(w, governmentAccount(nation), producerAccount(region), Math.max(0, amount), category)
  recordService(w, region, nation, producerAccount(region), paid, category.includes('construction'))
  w.economy!.producers[region].sales += paid
  w.nations[nation].spending += paid
  return paid
}
export function publicTransfer(w: World, from: number, to: number, amount: number, category: string) {
  return transfer(w, governmentAccount(from), governmentAccount(to), Math.max(0, amount), category)
}
export function borrow(w: World, borrower: string, requested: number, limit: number) {
  return issueBankLoan(w, borrower, requested, limit)
}
/** Debt claims follow the legal successor alongside the existing public cash transfer. */
export function transferDebt(w: World, from: number, to: number) {
  if (w.economy)
    for (const loan of w.economy.credit.loans)
      if (loan.borrower === governmentAccount(from)) loan.borrower = governmentAccount(to)
  w.nations[to].debt += w.nations[from].debt
  w.nations[from].debt = 0
}

/** Government stock purchases enter inventories; final consumption is recorded when used. */
export function publicGoods(
  w: World,
  nation: number,
  region: number,
  good: Good,
  quantity: number,
  destination: string,
  price = economicRegion(w, region).prices[good] / 1000,
) {
  const paid = transfer(
    w,
    governmentAccount(nation),
    producerAccount(region),
    quantity * price,
    'public goods purchase',
  )
  if (Math.abs(paid - quantity * price) > 1e-7) throw new Error('Unfunded public goods order')
  const targetRegion = destination.startsWith('market:') ? Number(destination.split(':')[1]) : undefined
  recordGoodsSale(
    w,
    marketStore(region),
    good,
    quantity,
    paid,
    targetRegion === undefined
      ? { kind: 'government', nation, store: destination }
      : {
          kind: 'business',
          nation: economicNation(w, targetRegion),
          account: producerAccount(targetRegion),
          store: destination,
        },
  )
  w.economy!.producers[region].sales += paid
  w.economy!.producers[region].sold[good] += quantity
  w.nations[nation].spending += paid
  return paid
}
