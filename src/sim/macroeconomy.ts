import { archiveRetiredDistricts } from './districts'
import { economicRegions, economicRegion } from './local-units'
import {
  GOODS,
  inventory,
  population,
  clamp,
  type Good,
  type Region,
  type World,
  type Inventory,
} from './types'
import { STRATA, type EconomicStratum } from './economic-types'
import { MODEL_PARAMETERS as P } from './model-parameters'
import { settleBanks } from './banking'
import { ensureFirms, beginFirmMonth, finishFirms, hireFirms, regionalFirms, retailDecay } from './firms'
import {
  beginNationalAccounts,
  reconcileGDP,
  economicNation,
  marketStore,
  firmStore,
  recordGoodsSale,
  recordTransport,
  recordUse,
  recordWages,
} from './national-accounts'
import { effectMultiplier } from './effects'
import {
  ensureEconomy,
  transfer,
  governmentAccount,
  producerAccount,
  firmAccount,
  householdAccount,
  stratumPeople,
  borrow,
  beginLedgerMonth,
  auditLedger,
} from './ledger'
import { BASE_PRICE, householdNeed } from './economy'
import { beginGoodsMonth, auditGoods } from './goods-accounting'
const skill: Record<EconomicStratum, number> = {
  smallholder: 0.9,
  laborer: 1,
  artisan: 1.25,
  professional: 1.7,
  owner: 0.8,
}
const budgetShares: Inventory = {
  food: 0.5,
  timber: 0.08,
  stone: 0.02,
  iron: 0.01,
  coal: 0.08,
  tools: 0.1,
  textiles: 0.2,
  arms: 0.01,
}
const materialWeights: Inventory = {
  food: 0,
  timber: 0.15,
  stone: 0.1,
  iron: 0.05,
  coal: 0.1,
  tools: 0.35,
  textiles: 0.25,
  arms: 0,
}
/** Collection capacity changes actual withholding, never creates revenue without a payer. */
export function collectedTaxRate(w: World, r: Region) {
  const n = w.nations[r.nation]
  const collection = clamp(
    (0.6 + n.technologies.governance * 0.045) *
      (0.5 + n.stability / 200) *
      effectMultiplier(w, 'taxIncome', n.id, r.id),
  )
  return clamp(n.policies.tax / 100) * collection
}
export function beginEconomyMonth(w: World) {
  const e = ensureEconomy(w)
  archiveRetiredDistricts(w)
  ensureFirms(w)
  beginLedgerMonth(w)
  beginGoodsMonth(w)
  for (const n of w.nations) {
    n.income = 0
    n.spending = 0
  }
  for (const r of economicRegions(w)) {
    const f = e.producers[r.id]
    for (const g of GOODS)
      f.forecast[g] =
        f.forecast[g] > 0
          ? (1 - P.forecastAdjustment) * f.forecast[g] + P.forecastAdjustment * f.sold[g]
          : householdNeed(r, g)
    f.openingStocks = { ...r.stocks }
    f.sold = inventory()
    f.intermediate = inventory()
    f.losses = inventory()
    f.payroll = 0
    f.sales = 0
    f.purchases = 0
    f.freight = 0
    f.taxes = 0
    f.interest = 0
    f.investment = 0
    f.publicServices = 0
    f.realServices = 0
    f.capital = Math.max(0, f.capital * (1 - P.depreciationMonthly) * (1 - r.devastation * 0.002))
    for (const project of f.projects) if (--project.remaining <= 0) f.capital += project.capital
    f.projects = f.projects.filter((p) => p.remaining > 0)
    r.industry = f.capital
    for (const s of STRATA) {
      const h = e.households[r.id][s]
      h.income = 0
      h.taxes = 0
      h.transfers = 0
      h.expenditure = 0
      h.employed = 0
      h.laborForce = 0
      h.consumption = inventory()
    }
  }
  beginFirmMonth(w)
  beginNationalAccounts(w)
}
/** Hire from actual working-age participation, subject to a paid wage bill. */
export function hireLabor(w: World, r: Region) {
  ensureFirms(w)
  return hireFirms(w, r)
}
/** A subsistence-first LES, with an explicit affordable rationing extension below subsistence. */
export function householdDemand(prices: Inventory, subsistence: Inventory, budget: number): Inventory {
  const result = inventory(),
    minimum = GOODS.reduce((sum, g) => sum + (prices[g] / 1000) * subsistence[g], 0)
  if (budget >= minimum) {
    const extra = budget - minimum
    for (const g of GOODS)
      result[g] = subsistence[g] + (budgetShares[g] * extra) / Math.max(1e-9, prices[g] / 1000)
  } else {
    let left = Math.max(0, budget)
    for (const g of GOODS) {
      const cost = prices[g] / 1000
      const amount = Math.min(subsistence[g], left / Math.max(1e-9, cost))
      result[g] = amount
      left -= amount * cost
    }
  }
  return result
}
export function consumeHouseholds(w: World) {
  const e = ensureEconomy(w)
  for (const r of economicRegions(w)) {
    const f = e.producers[r.id],
      total = Math.max(1, population(r))
    // Households can buy from local firms when a wholesaler cannot fund its stock.
    // All sellers compete on actual available offers; no intermediary loan is required.
    const sellers = [
      {
        stocks: r.stocks,
        prices: r.prices,
        account: producerAccount(r.id),
        store: marketStore(r.id),
        seller: f,
      },
      ...(e.firms ? regionalFirms(w, r.id) : [])
        .filter((firm) => firm.active)
        .map((firm) => ({
          stocks: firm.stocks,
          prices: firm.prices,
          account: firmAccount(firm.id),
          store: firmStore(firm.id),
          seller: firm,
        })),
    ]
    const offers = new Map(GOODS.map((g) => [g, [...sellers].sort((a, b) => a.prices[g] - b.prices[g])]))
    const salesQuantity = inventory(),
      salesValue = inventory()
    let food = 0,
      material = 0
    for (const s of STRATA) {
      const h = e.households[r.id][s],
        people = stratumPeople(w, r.id, s)
      if (!people) {
        const heir = STRATA.find((other) => stratumPeople(w, r.id, other) > 0)
        if (heir && h.cash > 0)
          transfer(
            w,
            householdAccount(r.id, s),
            householdAccount(r.id, heir),
            h.cash,
            'unclaimed household estate',
          )
        h.foodCoverage = 1
        h.materialCoverage = 1
        continue
      }
      const needs = inventory()
      for (const g of GOODS) needs[g] = (householdNeed(r, g) * people) / total
      const prices = Object.fromEntries(
        GOODS.map((g) => [g, offers.get(g)!.find((o) => o.stocks[g] > 1e-9)?.prices[g] ?? r.prices[g]]),
      ) as Inventory
      const minimum = GOODS.reduce((sum, g) => sum + (needs[g] * prices[g]) / 1000, 0)
      const disposable = Math.max(0, h.income - h.taxes + h.transfers)
      const spending = Math.min(
        h.cash,
        Math.max(minimum, disposable * 0.85 + Math.max(0, h.cash - minimum * 3) * 0.05),
      )
      const requested = householdDemand(prices, needs, spending)
      let remainingBudget = spending
      let coverage = 0
      for (const g of GOODS) {
        let delivered = 0
        for (const offer of offers.get(g)!) {
          const price = offer.prices[g] / 1000
          const amount = Math.max(
            0,
            Math.min(
              requested[g] - delivered,
              offer.stocks[g],
              Math.min(h.cash, remainingBudget) / Math.max(1e-12, price),
            ),
          )
          if (amount <= 1e-9) continue
          const paid = transfer(
            w,
            householdAccount(r.id, s),
            offer.account,
            amount * price,
            'household consumption',
          )
          const quantity = price > 0 ? Math.min(amount, paid / price) : 0
          recordGoodsSale(w, offer.store, g, quantity, paid, {
            kind: 'household',
            nation: economicNation(w, r.id),
          })
          offer.stocks[g] = Math.max(0, offer.stocks[g] - quantity)
          offer.seller.sales += paid
          offer.seller.sold[g] += quantity
          h.expenditure += paid
          remainingBudget = Math.max(0, remainingBudget - paid)
          salesQuantity[g] += quantity
          salesValue[g] += paid
          delivered += quantity
        }
        r.consumption[g] += delivered
        h.consumption[g] += delivered
        const fraction = needs[g] > 0 ? Math.min(1, delivered / needs[g]) : 1
        if (g === 'food') h.foodCoverage = fraction
        else coverage += fraction * materialWeights[g]
      }
      h.materialCoverage = clamp(coverage)
      food += h.foodCoverage * people
      material += h.materialCoverage * people
    }
    r.foodCoverage = food / total
    r.materialCoverage = material / total
    for (const g of GOODS) {
      if (salesQuantity[g] > 0) r.prices[g] = (salesValue[g] * 1000) / salesQuantity[g]
      const loss = r.stocks[g] * retailDecay(g)
      recordUse(w, marketStore(r.id), g, loss, 'loss')
      r.stocks[g] -= loss
      f.losses[g] += loss
    }
    if (r.materialCoverage < 0.7)
      r.infrastructure = Math.max(0.05, r.infrastructure - (0.7 - r.materialCoverage) * 0.002)
  }
}
export function fundGovernment(w: World) {
  const e = ensureEconomy(w)
  for (const n of w.nations) {
    const own = economicRegions(w).filter((r) => r.nation === n.id),
      people = own.reduce((sum, r) => sum + population(r), 0)
    if (!own.length) {
      for (const k of Object.keys(n.budget) as (keyof typeof n.budget)[]) n.budget[k] = 0
      continue
    }
    const intended =
      Math.max(n.income * 0.95, people * 0.00002) + Math.max(0, n.treasury - n.income * 12) * 0.02
    if (n.treasury < intended)
      borrow(w, governmentAccount(n.id), intended - n.treasury, Math.max(1000, n.gdp * 24))
    const available = Math.min(n.treasury, intended),
      weights = {
        welfare: n.policies.welfare,
        education: n.policies.education,
        military: n.policies.military,
        research: n.policies.research,
        administration: 12,
        infrastructure: 18,
      }
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    for (const key of Object.keys(weights) as (keyof typeof weights)[])
      n.budget[key] = (available * weights[key]) / sum
    let needTotal = 0
    const eligible = own.flatMap((r) =>
      STRATA.map((s) => ({
        r,
        s,
        need:
          stratumPeople(w, r.id, s) *
          (s === 'owner' ? 0.1 : 1) *
          (1 + 1 - e.households[r.id][s].foodCoverage),
      })),
    )
    for (const item of eligible) needTotal += item.need
    let welfarePaid = 0
    for (const { r, s, need } of eligible) {
      const paid = transfer(
        w,
        governmentAccount(n.id),
        householdAccount(r.id, s),
        (n.budget.welfare * need) / Math.max(1, needTotal),
        'welfare transfer',
      )
      e.households[r.id][s].transfers += paid
      n.spending += paid
      welfarePaid += paid
    }
    // Public services purchase local labor; recipients have ordinary household accounts.
    for (const key of ['education', 'military', 'research', 'administration', 'infrastructure'] as const) {
      const allocation = n.budget[key]
      let delivered = 0
      for (const r of own) {
        delivered += purchasePublicLabor(
          w,
          r,
          governmentAccount(n.id),
          (allocation * population(r)) / Math.max(1, people),
          `public ${key} services`,
        )
      }
      n.budget[key] = delivered
      n.spending += delivered
    }
    n.budget.welfare = welfarePaid
  }
}
/** Non-market output is measured by funded labor cost; one person cannot hold two full-time jobs. */
export function purchasePublicLabor(
  w: World,
  r: Region,
  payer: string,
  budget: number,
  category: string,
): number {
  if (w.localEconomy && r.province === undefined) {
    const locals = economicRegions(w).filter((u) => u.province === r.id)
    const total = Math.max(
      1,
      locals.reduce((sum, u) => sum + population(u), 0),
    )
    return locals.reduce(
      (sum, u) => sum + purchasePublicLabor(w, u, payer, (budget * population(u)) / total, category),
      0,
    )
  }
  const e = ensureEconomy(w),
    f = e.producers[r.id],
    n = w.nations[r.nation]
  let order = Math.max(0, budget),
    delivered = 0
  for (const s of ['professional', 'artisan', 'laborer', 'smallholder', 'owner'] as const) {
    const h = e.households[r.id][s],
      wage = f.wage * skill[s]
    const jobs = Math.min(Math.max(0, h.laborForce - h.employed), Math.max(0, order) / Math.max(1e-9, wage))
    const paid = transfer(w, payer, householdAccount(r.id, s), jobs * wage, category)
    const tax = transfer(
      w,
      householdAccount(r.id, s),
      governmentAccount(n.id),
      paid * collectedTaxRate(w, r),
      'public wage income tax',
    )
    const actualJobs = paid / Math.max(1e-9, wage),
      real = actualJobs * 0.0015 * skill[s]
    h.income += paid
    h.taxes += tax
    h.employed += actualJobs
    n.income += tax
    delivered += paid
    order -= paid
    recordWages(w, r.id, payer, paid, true)
    f.publicServices += paid
    f.realServices += real
    f.valueAdded += paid
    f.realOutput += real
    r.gdp = f.valueAdded
  }
  return delivered
}
export function finishProduction(w: World, r: Region) {
  const f = ensureEconomy(w).producers[r.id]
  f.grossOutput = GOODS.reduce((sum, g) => sum + (r.production[g] * r.prices[g]) / 1000, 0)
  f.valueAdded =
    f.grossOutput -
    GOODS.reduce((sum, g) => sum + (f.intermediate[g] * r.prices[g]) / 1000, 0) +
    f.publicServices
  f.realOutput =
    GOODS.reduce((sum, g) => sum + ((r.production[g] - f.intermediate[g]) * BASE_PRICE[g]) / 1000, 0) +
    f.realServices
  r.gdp = f.valueAdded
}
export function recordTrade(
  w: World,
  from: number,
  to: number,
  good: Good,
  amount: number,
  price: number,
  freight: number,
  tariff: number,
) {
  const e = ensureEconomy(w),
    buyer = producerAccount(to),
    seller = producerAccount(from),
    value = amount * price
  transfer(w, buyer, seller, value, 'goods purchase')
  if (tariff)
    transfer(w, buyer, governmentAccount(economicRegion(w, to).nation), value * tariff, 'import tariff')
  if (freight) transfer(w, buyer, householdAccount(from, 'laborer'), freight, 'freight service')
  const a = e.producers[from],
    b = e.producers[to]
  recordGoodsSale(
    w,
    marketStore(from),
    good,
    amount,
    value,
    { kind: 'business', nation: economicNation(w, to), account: buyer, store: marketStore(to) },
    value * tariff + freight,
  )
  recordTransport(w, from, to, freight, value * tariff)
  a.sales += value
  a.sold[good] += amount
  b.purchases += value * (1 + tariff)
  b.freight += freight
  e.households[from].laborer.income += freight
  w.nations[economicRegion(w, to).nation].income += value * tariff
}
export function settleCredit(w: World) {
  settleBanks(w)
}
export function finishEconomyMonth(w: World) {
  const e = ensureEconomy(w)
  settleCredit(w)
  finishFirms(w)
  for (const r of economicRegions(w)) {
    const f = e.producers[r.id],
      nation = w.nations[r.nation]
    // Cash-basis operating surplus: purchases are expensed on settlement.
    // Consuming the producer's own intermediate output is not another cash cost.
    f.profit = f.sales - f.purchases - f.freight - f.interest
    const tax = transfer(
      w,
      producerAccount(r.id),
      governmentAccount(r.nation),
      Math.max(0, f.profit) * collectedTaxRate(w, r),
      'profit tax',
    )
    f.taxes = tax
    nation.income += tax
    f.profit -= tax
    if (stratumPeople(w, r.id, 'owner')) {
      const dividends = transfer(
        w,
        producerAccount(r.id),
        householdAccount(r.id, 'owner'),
        Math.max(0, f.profit) * P.dividendShare,
        'dividends',
      )
      e.households[r.id].owner.income += dividends
    }
    finishProduction(w, r)
  }
  reconcileGDP(w)
  for (const r of economicRegions(w)) e.producers[r.id].valueAdded = r.gdp
  summarizeEconomy(w)
  auditLedger(w)
  auditGoods(w)
}
export function summarizeEconomy(w: World) {
  const e = ensureEconomy(w)
  let totalLabor = 0,
    totalJobs = 0,
    totalBaseBasket = 0,
    totalBasket = 0
  e.totals.gdp = 0
  e.totals.realOutput = 0
  e.totals.consumption = 0
  e.totals.investment = 0
  for (const n of w.nations) {
    const own = economicRegions(w).filter((r) => r.nation === n.id)
    let gdp = 0,
      real = 0,
      consumption = 0,
      investment = 0,
      income = 0,
      labor = 0,
      jobs = 0,
      basket = 0,
      baseBasket = 0
    const distribution: { people: number; income: number }[] = []
    for (const r of own) {
      const f = e.producers[r.id]
      gdp += f.valueAdded
      real += f.realOutput
      investment += f.investment
      for (const s of STRATA) {
        const h = e.households[r.id][s],
          people = stratumPeople(w, r.id, s)
        consumption += h.expenditure
        income += h.income + h.transfers - h.taxes
        labor += h.laborForce
        jobs += h.employed
        if (people)
          distribution.push({ people, income: Math.max(0, h.income + h.transfers - h.taxes) / people })
      }
      for (const g of GOODS) {
        const need = householdNeed(r, g)
        basket += need * r.prices[g]
        baseBasket += need * BASE_PRICE[g]
      }
    }
    distribution.sort((a, b) => a.income - b.income)
    const people = distribution.reduce((sum, x) => sum + x.people, 0),
      earnings = distribution.reduce((sum, x) => sum + x.income * x.people, 0)
    let cumulative = 0,
      area = 0
    for (const x of distribution) {
      const previous = cumulative
      cumulative += x.income * x.people
      area += (previous + cumulative) * x.people
    }
    const inequality = earnings > 0 && people > 0 ? clamp(1 - area / (people * earnings)) : 0
    if (e.accounts?.complete) gdp = e.accounts.nations[n.id]?.productionGDP ?? 0
    e.national[n.id] = {
      gdp,
      realOutput: real,
      priceIndex: baseBasket ? basket / baseBasket : 1,
      unemployment: labor ? clamp(1 - jobs / labor) : 0,
      consumption,
      investment,
      income,
      inequality,
      welfarePerPerson: n.budget.welfare / Math.max(1, people),
    }
    e.totals.gdp += gdp
    e.totals.realOutput += real
    e.totals.consumption += consumption
    e.totals.investment += investment
    totalLabor += labor
    totalJobs += jobs
    totalBasket += basket
    totalBaseBasket += baseBasket
  }
  e.totals.unemployment = totalLabor ? clamp(1 - totalJobs / totalLabor) : 0
  e.totals.priceIndex = totalBaseBasket ? totalBasket / totalBaseBasket : 1
}
