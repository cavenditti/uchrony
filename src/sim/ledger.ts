import { expeditionAccount } from './overseas-types'
/** Conserved transfers connect household, firm and government books. Address caches
 * survive account replacement; transaction batching retains a bounded public tail. */
import {
  accountBank,
  auditBanks,
  ensureBanking,
  issueBankLoan,
  settleBankAccounts,
  settleBankTransfer,
} from './banking'
import {
  STRATA,
  type Bank,
  type EconomicStratum,
  type HouseholdAccount,
  type LedgerEntry,
  type ProducerAccount,
} from './economic-types'
import { economicRegion } from './local-units'
import { economicNation, marketStore, recordGoodsSale, recordService } from './national-accounts'
import { supplierDebt } from './supplier-credit'
import type { Good } from './types'
import { inventory, population, type World } from './types'

/** Parsed stable identity; account holders themselves may be replaced by remeshing. */
export type AccountAddress = Readonly<{
  kind: string
  id: number
  group: EconomicStratum
  field: 'cash' | 'treasury'
}>
const addresses = new WeakMap<World, Map<string, AccountAddress>>()
/** Cache parsed addresses only; never retain replaceable account objects. */
export function accountAddress(w: World, account: string) {
  let index = addresses.get(w)
  if (!index) addresses.set(w, (index = new Map()))
  let address = index.get(account)
  if (!address) {
    const [kind, id, group] = account.split(':')
    address = {
      kind,
      id: Number(id),
      group: group as EconomicStratum,
      field: kind === 'government' || kind === 'province' || kind === 'institution' ? 'treasury' : 'cash',
    }
    index.set(account, address)
  }
  return address
}
// Cache addresses only: account objects can be replaced by district remapping,
// government changes, or restored state, even within the same month.
function accountHolder(w: World, address: AccountAddress): { cash?: number; treasury?: number } | undefined {
  const { kind, id, group } = address
  if (kind === 'government') return w.nations[id]
  if (kind === 'province') return w.regions[id]?.delegation
  if (kind === 'institution') return w.institutions?.organizations.find((o) => o.id === id)
  if (kind === 'producer') return w.economy?.producers[id]
  if (kind === 'firm') return w.economy?.firms?.[id]
  if (kind === 'household') return w.economy?.households[id]?.[group]
  if (kind === 'expedition') return w.overseas?.expeditions.find((e) => e.id === id)?.accounts[group]
  if (kind === 'credit') return w.economy?.credit
  throw new Error(`Unknown settlement account: ${kind}:${id}`)
}

interface EntryBatch {
  count: number
  from: string[]
  to: string[]
  amount: number[]
  category: string[]
}
const entryBatches = new WeakMap<World, Map<LedgerEntry[], EntryBatch>>()
/** A synchronous tick never exposes intermediate history. Keep its bounded
 * transaction tail in reusable columns and materialize entries before returning,
 * including on failure. Intermediate history must not be read inside this scope.
 * Ad-hoc commands still expose their entries immediately. */
export function withBatchedLedgerEntries<T>(w: World, run: () => T): T {
  if (entryBatches.has(w)) return run()
  const batches = new Map<LedgerEntry[], EntryBatch>()
  entryBatches.set(w, batches)
  try {
    return run()
  } finally {
    for (const [entries, batch] of batches) {
      entries.splice(0, Math.max(0, entries.length + batch.count - 1024))
      for (let i = Math.max(0, batch.count - 1024); i < batch.count; i++) {
        const slot = i % 1024
        entries.push({
          from: batch.from[slot],
          to: batch.to[slot],
          amount: batch.amount[slot],
          category: batch.category[slot],
        })
      }
    }
    entryBatches.delete(w)
  }
}
function appendEntry(w: World, from: string, to: string, amount: number, category: string) {
  const entries = w.economy!.ledger.entries,
    batch = entryBatches.get(w)
  if (batch) {
    let tail = batch.get(entries)
    if (!tail) batch.set(entries, (tail = { count: 0, from: [], to: [], amount: [], category: [] }))
    const next = tail.count++ % 1024
    tail.from[next] = from
    tail.to[next] = to
    tail.amount[next] = amount
    tail.category[next] = category
  } else {
    entries.push({ from, to, amount, category })
    if (entries.length > 1024) entries.splice(0, entries.length - 1024)
  }
}
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
      if (
        n.debt > supplierDebt(w, n.id) &&
        !e.credit.loans.some((l) => l.borrower === governmentAccount(n.id))
      )
        e.credit.loans.push({
          id: e.credit.nextId++,
          borrower: governmentAccount(n.id),
          principal: n.debt - supplierDebt(w, n.id),
          arrears: 0,
          originated: w.month,
        })
    e.ledger.opening = balances(w)
  }
  ensureBanking(w)
  return e
}
export function balance(w: World, account: string): number {
  const address = accountAddress(w, account)
  return accountHolder(w, address)?.[address.field] ?? 0
}
export function setBalance(w: World, account: string, value: number) {
  const address = accountAddress(w, account)
  accountHolder(w, address)![address.field] = value
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
  for (const e of w.overseas?.expeditions ?? [])
    for (const s of [...STRATA, 'construction'] as const)
      accounts[expeditionAccount(e.id, s)] = e.accounts[s].cash
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
  appendEntry(
    w,
    delta > 0 ? counterparty : account,
    delta > 0 ? account : counterparty,
    Math.abs(delta),
    category,
  )
}
interface PaymentAccount {
  name: string
  holder: ReturnType<typeof accountHolder>
  field: AccountAddress['field']
  bank?: Bank
}
/** A synchronous payroll/retail phase may resolve its participants once. These
 * handles must not survive account replacement, bank reassignment or remapping.
 * Bank enrollment stays lazy, at the first positive payment, exactly as transfer. */
export function preparePayments(w: World) {
  const e = ensureEconomy(w)
  return {
    account(name: string): PaymentAccount {
      const address = accountAddress(w, name)
      return { name, holder: accountHolder(w, address), field: address.field }
    },
    transfer(from: PaymentAccount, to: PaymentAccount, requested: number, category: string): number {
      if (!Number.isFinite(requested) || requested < 0)
        throw new Error('Payments must be finite and nonnegative.')
      if (from.name === to.name || requested === 0) return 0
      const source = from.holder?.[from.field] ?? 0,
        destination = to.holder?.[to.field] ?? 0,
        amount = Math.min(source, requested)
      if (!(amount > 0)) return 0
      from.bank ??= accountBank(w, from.name)
      to.bank ??= accountBank(w, to.name)
      settleBankAccounts(w, from.bank, to.bank, amount)
      if (e.ledger.opening[from.name] === undefined) e.ledger.opening[from.name] = source
      if (e.ledger.opening[to.name] === undefined) e.ledger.opening[to.name] = destination
      from.holder![from.field] = source - amount
      to.holder![to.field] = destination + amount
      recordTransfer(w, from.name, to.name, amount, category)
      return amount
    },
  }
}
function recordTransfer(w: World, from: string, to: string, amount: number, category: string) {
  const ledger = w.economy!.ledger
  ledger.net[from] = (ledger.net[from] ?? 0) - amount
  ledger.net[to] = (ledger.net[to] ?? 0) + amount
  ledger.transactions++
  ledger.volume += amount
  appendEntry(w, from, to, amount, category)
}
/** The only runtime cash mutation primitive. Partial settlement is explicit in its return value. */
export function transfer(w: World, from: string, to: string, requested: number, category: string): number {
  const e = ensureEconomy(w)
  if (!Number.isFinite(requested) || requested < 0)
    throw new Error('Payments must be finite and nonnegative.')
  if (from === to || requested === 0) return 0
  const sourceAddress = accountAddress(w, from),
    destinationAddress = accountAddress(w, to),
    sourceHolder = accountHolder(w, sourceAddress),
    destinationHolder = accountHolder(w, destinationAddress),
    source = sourceHolder?.[sourceAddress.field] ?? 0,
    destination = destinationHolder?.[destinationAddress.field] ?? 0,
    amount = Math.min(source, requested)
  if (!(amount > 0)) return 0
  settleBankTransfer(w, from, to, amount)
  if (e.ledger.opening[from] === undefined) e.ledger.opening[from] = source
  if (e.ledger.opening[to] === undefined) e.ledger.opening[to] = destination
  sourceHolder![sourceAddress.field] = source - amount
  destinationHolder![destinationAddress.field] = destination + amount
  recordTransfer(w, from, to, amount, category)
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
  e.totals.debt =
    e.credit.loans.reduce((sum, l) => sum + l.principal, 0) +
    w.nations.reduce((sum, n) => sum + supplierDebt(w, n.id), 0)
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
  const claims = w.economy?.supplierCredit?.[from]
  if (claims) {
    const target = (w.economy!.supplierCredit![to] ??= {})
    for (const [creditor, value] of Object.entries(claims)) target[creditor] = (target[creditor] ?? 0) + value
    delete w.economy!.supplierCredit![from]
  }
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
