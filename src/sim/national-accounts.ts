import { economicRegions, economicRegion, localFirmRegion } from './local-units'
import { GOODS, inventory, type Good, type Inventory, type World } from './types'
import type { GDPAccount } from './economic-types'
import { BASE_PRICE } from './economy'

export const emptyGDP = (): GDPAccount => ({
  output: 0,
  intermediate: 0,
  wages: 0,
  mixedIncome: 0,
  operatingSurplus: 0,
  productTaxes: 0,
  consumption: 0,
  government: 0,
  fixedInvestment: 0,
  inventoryChange: 0,
  exports: 0,
  imports: 0,
  holdingGains: 0,
  otherAssetChanges: 0,
  productionGDP: 0,
  expenditureGDP: 0,
  incomeGDP: 0,
  discrepancy: 0,
})
export const marketStore = (region: number) => `market:${region}`
export const firmStore = (id: number) => `firm:${id}`
export const armyStore = (id: number) => `army:${id}`
export const fleetStore = (id: number) => `fleet:${id}`
export function economicNation(w: World, region: number) {
  return w.economy?.accounts?.territories[region] ?? economicRegion(w, region).nation
}
function national(w: World, nation: number) {
  const a = w.economy!.accounts!
  a.complete = false
  return a.nations[nation] ?? (a.nations[nation] = emptyGDP())
}
function business(w: World, owner: string, nation: number) {
  const a = w.economy!.accounts!
  return (
    a.businesses[owner] ??
    (a.businesses[owner] = { nation, receipts: 0, purchases: 0, wages: 0, ownAccount: 0, inventoryChange: 0 })
  )
}
function valueAdded(w: World, region: number, amount: number) {
  const a = w.economy!.accounts!
  a.regionalValueAdded[region] = (a.regionalValueAdded[region] ?? 0) + amount
}
function businessRegion(w: World, account: string) {
  const [kind, id] = account.split(':')
  return kind === 'firm' ? localFirmRegion(w.economy!.firms![Number(id)]) : Number(id)
}
function currentStore(w: World, key: string) {
  const [kind, text] = key.split(':'),
    id = Number(text)
  if (kind === 'market') {
    const r = economicRegion(w, id)
    return {
      region: id,
      nation: economicNation(w, id),
      owner: `producer:${id}`,
      government: false,
      quantity: r.stocks,
      prices: r.prices,
    }
  }
  if (kind === 'firm') {
    const f = w.economy!.firms![id]
    return {
      region: localFirmRegion(f),
      nation: economicNation(w, localFirmRegion(f)),
      owner: key,
      government: false,
      quantity: f.stocks,
      prices: f.prices,
    }
  }
  const unit =
    kind === 'army' ? w.armies.find((a) => a.id === id) : w.warfare?.fleets.find((f) => f.id === id)
  if (!unit) return undefined
  const stock =
    kind === 'army'
      ? (unit as World['armies'][number]).operations
      : (unit as NonNullable<World['warfare']>['fleets'][number])
  return {
    region: unit.region,
    nation: unit.nation,
    owner: `government:${unit.nation}`,
    government: true,
    quantity: { ...inventory(), food: stock?.food ?? 0, arms: stock?.arms ?? 0 },
    prices: w.regions[unit.region].prices,
  }
}
function addStore(w: World, key: string, opening = true) {
  const a = w.economy!.accounts!,
    s = currentStore(w, key)
  if (!s) throw new Error(`Unknown inventory owner ${key}`)
  const quantity = opening ? { ...s.quantity } : inventory()
  const quoted = Object.fromEntries(GOODS.map((g) => [g, (s.prices[g] || BASE_PRICE[g]) / 1000])) as Inventory
  // Carry the last acquisition/replacement quote across months. A retailer's selling
  // markup is output when goods sell, never a revaluation of its unsold inventory.
  const oldPrices = w.economy!.inventoryPrices?.[key] ?? quoted
  const price = { ...oldPrices }
  const { prices: _quotes, ...owner } = s
  const store = {
    ...owner,
    opening: { ...quantity },
    quantity,
    price,
    openingValue: GOODS.reduce((sum, g) => sum + quantity[g] * oldPrices[g], 0),
    flows: 0,
    other: 0,
  }
  a.stores[key] = store
  return store
}
export function beginNationalAccounts(w: World) {
  w.economy!.accounts = {
    month: w.month,
    territories: Array.from(
      { length: w.localEconomy?.nextId ?? w.regions.length },
      (_, id) => economicRegion(w, id)?.nation ?? w.regions[w.localEconomy!.archive![id].province].nation,
    ),
    nations: {},
    world: emptyGDP(),
    regionalValueAdded: {},
    businesses: {},
    stores: {},
  }
  for (const r of economicRegions(w)) addStore(w, marketStore(r.id))
  for (const f of w.economy!.firms ?? []) addStore(w, firmStore(f.id))
  for (const a of w.armies) addStore(w, armyStore(a.id))
  for (const f of w.warfare?.fleets ?? []) addStore(w, fleetStore(f.id))
}
function store(w: World, key: string) {
  return w.economy!.accounts!.stores[key] ?? addStore(w, key, false)
}
/** Inventory entries are transaction flows, not the residual needed to make GDP agree. */
export function inventoryFlow(
  w: World,
  key: string,
  good: Good,
  quantity: number,
  value?: number,
  other = false,
) {
  if (!w.economy?.accounts || !quantity) return 0
  const s = store(w, key),
    amount = value ?? quantity * s.price[good]
  s.quantity[good] += quantity
  if (s.quantity[good] < -1e-6) throw new Error(`Inventory flow overdraw: ${key} ${good}`)
  s.quantity[good] = Math.max(0, s.quantity[good])
  const n = national(w, s.nation)
  if (other) {
    s.other += amount
    n.otherAssetChanges += amount
  } else {
    s.flows += amount
    n.inventoryChange += amount
    if (!s.government) business(w, s.owner, s.nation).inventoryChange += amount
  }
  return Math.abs(amount)
}
export function inventoryQuote(w: World, key: string, good: Good, price: number) {
  if (w.economy?.accounts) {
    w.economy.accounts.complete = false
    store(w, key).price[good] = price
  }
}
export function recordProduction(w: World, key: string, good: Good, amount: number, price: number) {
  if (!w.economy?.accounts) return
  const s = store(w, key),
    value = amount * price
  inventoryQuote(w, key, good, price)
  inventoryFlow(w, key, good, amount, value)
  national(w, s.nation).output += value
  valueAdded(w, s.region, value)
}
export function recordWages(w: World, region: number, payer: string, amount: number, publicService = false) {
  if (!w.economy?.accounts) return
  const nation = economicNation(w, region),
    n = national(w, nation)
  n.wages += amount
  if (publicService) {
    n.output += amount
    n.government += amount
    valueAdded(w, region, amount)
  } else business(w, payer, nation).wages += amount
}
export function recordService(
  w: World,
  region: number,
  payerNation: number,
  owner: string,
  value: number,
  capital = false,
) {
  if (!w.economy?.accounts || !value) return
  const nation = economicNation(w, region)
  national(w, nation).output += value
  valueAdded(w, region, value)
  business(w, owner, nation).receipts += value
  national(w, payerNation)[capital ? 'fixedInvestment' : 'government'] += value
  recordExternal(w, nation, payerNation, value)
}
function recordExternal(w: World, from: number, to: number, value: number) {
  if (from === to) return
  national(w, from).exports += value
  national(w, to).imports += value
}
/** Retail/wholesale margin = receipt less the current replacement value withdrawn. */
export function recordGoodsSale(
  w: World,
  fromStore: string,
  good: Good,
  amount: number,
  paid: number,
  buyer: { kind: 'household' | 'business' | 'government'; nation: number; account?: string; store?: string },
  extraCost = 0,
) {
  if (!w.economy?.accounts || !amount) return
  const s = store(w, fromStore)
  const cost = inventoryFlow(w, fromStore, good, -amount)
  business(w, s.owner, s.nation).receipts += paid
  if (fromStore.startsWith('market:')) {
    national(w, s.nation).output += paid - cost
    valueAdded(w, s.region, paid - cost)
  }
  // A firm's own goods sell at its quote. Any changed quote is a holding gain, not new output.
  else if (Math.abs(cost - paid) > 1e-7) throw new Error('Firm sale must use its quoted inventory price')
  recordExternal(w, s.nation, buyer.nation, paid)
  if (buyer.kind === 'household') national(w, buyer.nation).consumption += paid
  if (buyer.kind === 'business' && buyer.account)
    business(w, buyer.account, buyer.nation).purchases += paid + extraCost
  if (buyer.store) {
    inventoryQuote(w, buyer.store, good, (paid + extraCost) / amount)
    inventoryFlow(w, buyer.store, good, amount, paid + extraCost)
  } else if (buyer.kind === 'business') {
    national(w, buyer.nation).intermediate += paid
    if (buyer.account) valueAdded(w, businessRegion(w, buyer.account), -paid)
  }
}
export function recordTransport(w: World, from: number, to: number, freight: number, tariff: number) {
  if (!w.economy?.accounts) return
  const origin = economicNation(w, from),
    destination = economicNation(w, to)
  national(w, origin).output += freight
  national(w, origin).mixedIncome += freight
  national(w, destination).productTaxes += tariff
  valueAdded(w, from, freight)
  valueAdded(w, to, tariff)
  recordExternal(w, origin, destination, freight)
}
export function recordUse(
  w: World,
  key: string,
  good: Good,
  amount: number,
  kind: 'intermediate' | 'government' | 'loss' | 'other' = 'intermediate',
) {
  if (!w.economy?.accounts || !amount) return 0
  const s = store(w, key),
    value = inventoryFlow(w, key, good, -amount, undefined, kind === 'other')
  if (kind !== 'other') {
    national(w, s.nation).intermediate += value
    if (kind !== 'government') valueAdded(w, s.region, -value)
    if (kind === 'government') {
      national(w, s.nation).output += value
      national(w, s.nation).government += value
    }
  }
  return value
}
export function recordOwnCapital(w: World, region: number, owner: string, value: number) {
  if (!w.economy?.accounts) return
  const nation = economicNation(w, region)
  national(w, nation).output += value
  valueAdded(w, region, value)
  national(w, nation).fixedInvestment += value
  business(w, owner, nation).ownAccount += value
}
export function recordGift(w: World, from: string, to: string, good: Good, amount: number) {
  if (!w.economy?.accounts || !amount) return
  const value = inventoryFlow(w, from, good, -amount, undefined, true)
  inventoryQuote(w, to, good, value / amount)
  inventoryFlow(w, to, good, amount, value, true)
}
/** Read-only validation of completed accounts, including their independent supporting records. */
export function auditNationalAccounts(w: World) {
  const a = w.economy!.accounts!
  const surplus: Record<number, number> = {},
    gains: Record<number, number> = {}
  for (const b of Object.values(a.businesses))
    surplus[b.nation] =
      (surplus[b.nation] ?? 0) + b.receipts - b.purchases - b.wages + b.ownAccount + b.inventoryChange
  for (const [key, s] of Object.entries(a.stores)) {
    const actual = currentStore(w, key)?.quantity ?? inventory()
    for (const g of GOODS)
      if (Math.abs(actual[g] - s.quantity[g]) > 1e-7 * Math.max(1, s.opening[g], actual[g]))
        throw new Error(`Unrecorded inventory flow ${key} ${g}`)
    const closing = GOODS.reduce((sum, g) => sum + actual[g] * s.price[g], 0)
    gains[s.nation] = (gains[s.nation] ?? 0) + closing - s.openingValue - s.flows - s.other
  }
  const total = emptyGDP()
  for (const [id, n] of Object.entries(a.nations)) {
    const scale = Math.max(1, Math.abs(n.output))
    if (
      Math.abs(n.operatingSurplus - (surplus[Number(id)] ?? 0)) > 1e-7 * scale ||
      Math.abs(n.holdingGains - (gains[Number(id)] ?? 0)) > 1e-7 * scale
    )
      throw new Error('Invalid GDP supporting records')
    for (const key of Object.keys(total) as (keyof GDPAccount)[]) total[key] += n[key]
  }
  for (const key of Object.keys(total) as (keyof GDPAccount)[])
    if (
      key !== 'discrepancy' &&
      Math.abs(a.world[key] - total[key]) > 1e-7 * Math.max(1, Math.abs(total[key]))
    )
      throw new Error(`Invalid world GDP aggregation: ${key}`)
}
export function reconcileGDP(w: World) {
  const e = w.economy!,
    a = e.accounts
  if (!a) return
  for (const n of Object.values(a.nations)) {
    n.operatingSurplus = 0
    n.holdingGains = 0
  }
  for (const b of Object.values(a.businesses))
    national(w, b.nation).operatingSurplus +=
      b.receipts - b.purchases - b.wages + b.ownAccount + b.inventoryChange
  e.inventoryPrices = {}
  for (const [key, s] of Object.entries(a.stores)) {
    const actual = currentStore(w, key)?.quantity ?? inventory()
    for (const g of GOODS)
      if (Math.abs(actual[g] - s.quantity[g]) > 1e-7 * Math.max(1, s.opening[g], actual[g]))
        throw new Error(`Unrecorded inventory flow ${key} ${g}: ${actual[g] - s.quantity[g]}`)
    const closingValue = GOODS.reduce((sum, g) => sum + actual[g] * s.price[g], 0)
    national(w, s.nation).holdingGains += closingValue - s.openingValue - s.flows - s.other
    if (currentStore(w, key)) e.inventoryPrices[key] = { ...s.price }
  }
  a.world = emptyGDP()
  for (const n of Object.values(a.nations)) {
    n.productionGDP = n.output - n.intermediate + n.productTaxes
    n.expenditureGDP =
      n.consumption + n.government + n.fixedInvestment + n.inventoryChange + n.exports - n.imports
    n.incomeGDP = n.wages + n.operatingSurplus + n.mixedIncome + n.productTaxes
    n.discrepancy = Math.max(
      Math.abs(n.productionGDP - n.expenditureGDP),
      Math.abs(n.productionGDP - n.incomeGDP),
    )
    if (
      n.discrepancy >
      1e-7 * Math.max(1, Math.abs(n.output), n.consumption + n.government + n.fixedInvestment)
    )
      throw new Error(`GDP approaches disagree: ${JSON.stringify(n)}`)
    for (const key of Object.keys(a.world) as (keyof GDPAccount)[]) a.world[key] += n[key]
  }
  a.world.discrepancy = Math.max(
    Math.abs(a.world.productionGDP - a.world.expenditureGDP),
    Math.abs(a.world.productionGDP - a.world.incomeGDP),
  )
  for (const r of economicRegions(w)) r.gdp = a.regionalValueAdded[r.id] ?? 0
  a.complete = true
  return a.world
}

/** Requisition is an in-kind capital transfer into government stores, then final use. */
export function recordRequisition(w: World, region: number, good: Good, amount: number) {
  if (!w.economy?.accounts || !amount) return
  const value = inventoryFlow(w, marketStore(region), good, -amount, undefined, true)
  const n = national(w, economicNation(w, region))
  n.otherAssetChanges += value
  n.inventoryChange -= value
  n.output += value
  n.intermediate += value
  n.government += value
}
