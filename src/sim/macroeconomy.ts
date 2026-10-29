/** Monthly household and government clearing transfers existing deposits against
 * real goods and services before final GDP and bank reconciliation. */
import { settleBanks, updateMonetaryPolicy, withBorrowerLoanIndex } from './banking'
import { competitivePressure } from './competitive-pressure'
import { parameterGroup } from './configuration-context'
import { decisionPolicy } from './decision-policy'
import { activeDevelopment } from './development'
import { archiveRetiredDistricts } from './districts'
import { STRATA, type EconomicStratum } from './economic-types'
import { BASE_PRICE, foodEquivalentPeople, householdNeed } from './economy'
import { effectMultiplier } from './effects'
import { expansionParameters } from './expansion-parameters'
import { beginFirmMonth, ensureFirms, finishFirms, hireFirms, regionalFirms, retailDecay } from './firms'
import { auditGoods, beginGoodsMonth } from './goods-accounting'
import { governance } from './governance'
import {
  auditLedger,
  beginLedgerMonth,
  borrow,
  ensureEconomy,
  firmAccount,
  governmentAccount,
  householdAccount,
  preparePayments,
  producerAccount,
  stratumPeople,
  transfer,
} from './ledger'
import { economicRegion, economicRegions, provinceId } from './local-units'
import { MODEL_PARAMETERS as P } from './model-parameters'
import {
  beginNationalAccounts,
  economicNation,
  firmStore,
  marketStore,
  reconcileGDP,
  recordGoodsSale,
  recordTransport,
  recordUse,
  recordWages,
} from './national-accounts'
import { communitySize, peopleByStratum } from './population'
import { refreshRetailQuote } from './retail-pricing'
import { periodFlow, periodRate, simulationMonths } from './simulation-period'
import { repaySuppliers } from './supplier-credit'
import { territorialIndex } from './territory-index'
import {
  clamp,
  GOODS,
  inventory,
  population,
  type Good,
  type Inventory,
  type Region,
  type World,
} from './types'
const skill: Record<EconomicStratum, number> = parameterGroup('wageSkills')
const budgetShares: Inventory = parameterGroup('consumptionBudget')
const materialWeights: Inventory = parameterGroup('materialCoverage')
/** Collection capacity changes actual withholding, never creates revenue without a payer. */
export function collectedTaxRate(w: World, r: Region) {
  if (w.regions[provinceId(r)].control) return 0
  const n = governance(w, r.nation)
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
  const months = simulationMonths(),
    previous = e.periodMonths ?? 1
  // Forecasts and last sales share the new interval's units before smoothing.
  if (months !== previous) {
    const ratio = months / previous
    for (const f of [...Object.values(e.producers), ...e.firms!])
      for (const g of GOODS) {
        f.forecast[g] *= ratio
        f.sold[g] *= ratio
      }
  }
  if (months !== 1 || e.periodMonths !== undefined) e.periodMonths = months
  if (months !== 1) {
    for (const f of Object.values(e.producers)) f.wage *= months
    for (const f of e.firms!) f.wage *= months
  }
  beginLedgerMonth(w)
  beginGoodsMonth(w)
  for (const n of w.nations) {
    n.income = 0
    n.spending = 0
    n.capitalSpending = 0
    n.enterpriseIncome = 0
  }
  for (const r of economicRegions(w)) {
    const f = e.producers[r.id]
    for (const g of GOODS)
      f.forecast[g] =
        f.forecast[g] > 0
          ? (1 - periodRate(P.forecastAdjustment)) * f.forecast[g] +
            periodRate(P.forecastAdjustment) * f.sold[g]
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
    f.previousResearchServices = f.researchServices ?? 0
    f.educationServices = f.administrationServices = f.infrastructureServices = 0
    f.researchServices = f.militaryServices = f.provincialServices = 0
    f.previousLabor = STRATA.reduce((sum, s) => sum + e.households[r.id][s].laborForce, 0)
    f.previousJobs = STRATA.reduce((sum, s) => sum + e.households[r.id][s].employed, 0)
    f.capital = Math.max(
      0,
      f.capital * (1 - periodRate(P.depreciationMonthly)) * (1 - periodRate(r.devastation * 0.002)),
    )
    for (const project of f.projects) if ((project.remaining -= months) <= 0) f.capital += project.capital
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
  // Materials can sell before a market restocks. Repair inherited offers before
  // the first transaction, using the newly opened inventory books and forecasts.
  withBorrowerLoanIndex(w, () => {
    for (const r of economicRegions(w)) for (const good of GOODS) refreshRetailQuote(w, r, good)
  })
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
    // Editable weights are relative preferences, not independent budget claims.
    // A food-only preference leaves satiation savings unspent rather than
    // dividing by an empty non-food basket.
    const totalWeight = GOODS.reduce((sum, g) => sum + budgetShares[g], 0)
    const nonFoodWeight = GOODS.reduce((sum, g) => sum + (g === 'food' ? 0 : budgetShares[g]), 0)
    for (const g of GOODS)
      result[g] =
        subsistence[g] + ((budgetShares[g] / totalWeight) * extra) / Math.max(1e-9, prices[g] / 1000)
    const satiation = decisionPolicy().foodSatiation
    if (satiation !== undefined) {
      const limit = subsistence.food * satiation
      const released = (Math.max(0, result.food - limit) * prices.food) / 1000
      result.food = Math.min(result.food, limit)
      // Diet quantity saturates. Additional purchasing power bids for other
      // goods, or remains saved when those goods cannot be supplied.
      for (const g of GOODS)
        if (g !== 'food' && nonFoodWeight > 0)
          result[g] += (released * budgetShares[g]) / nonFoodWeight / Math.max(1e-9, prices[g] / 1000)
    }
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
  const e = ensureEconomy(w),
    payments = preparePayments(w)
  const totalMaterialWeight = GOODS.reduce((sum, g) => sum + materialWeights[g], 0)
  for (const r of economicRegions(w)) {
    const f = e.producers[r.id],
      total = Math.max(1, population(r))
    // Households can buy from local firms when a wholesaler cannot fund its stock.
    // All sellers compete on actual available offers; no intermediary loan is required.
    // Factory receipts must not overwrite the merchant's independent offer for
    // its remaining, potentially dearer inventory after households have bought.
    const sellers = [
      {
        stocks: r.stocks,
        prices: r.prices,
        account: payments.account(producerAccount(r.id)),
        store: marketStore(r.id),
        seller: f,
      },
      ...(e.firms ? regionalFirms(w, r.id) : [])
        .filter((firm) => firm.active)
        .map((firm) => ({
          stocks: firm.stocks,
          prices: firm.prices,
          account: payments.account(firmAccount(firm.id)),
          store: firmStore(firm.id),
          seller: firm,
        })),
    ]
    const offers = new Map(GOODS.map((g) => [g, [...sellers].sort((a, b) => a.prices[g] - b.prices[g])]))
    const foodWeights = Object.fromEntries(STRATA.map((s) => [s, 0])) as Record<EconomicStratum, number>
    const peopleCounts = Object.fromEntries(STRATA.map((s) => [s, 0])) as Record<EconomicStratum, number>
    for (const group of r.communities ?? []) {
      const stratum = group.stratum ?? 'laborer'
      foodWeights[stratum] += foodEquivalentPeople(group.population)
      peopleCounts[stratum] += communitySize(group)
    }
    const heir = STRATA.find((stratum) => peopleCounts[stratum] > 0)
    const foodTotal = Object.values(foodWeights).reduce((sum, x) => sum + x, 0)
    const orders: {
      s: EconomicStratum
      account: ReturnType<typeof payments.account>
      people: number
      needs: Inventory
      requested: Inventory
      remainingBudget: number
    }[] = []
    for (const s of STRATA) {
      const h = e.households[r.id][s],
        people = peopleCounts[s]
      if (!people) {
        if (heir && h.cash > 0)
          transfer(
            w,
            householdAccount(r.id, s),
            householdAccount(r.id, heir),
            h.cash,
            'unclaimed household estate',
          )
        h.foodCoverage = h.materialCoverage = 1
        continue
      }
      const needs = inventory()
      for (const g of GOODS)
        needs[g] =
          householdNeed(r, g) * (g === 'food' && foodTotal > 0 ? foodWeights[s] / foodTotal : people / total)
      const prices = Object.fromEntries(
        GOODS.map((g) => [g, offers.get(g)!.find((o) => o.stocks[g] > 1e-9)?.prices[g] ?? r.prices[g]]),
      ) as Inventory
      const minimum = GOODS.reduce((sum, g) => sum + (needs[g] * prices[g]) / 1000, 0)
      const disposable = Math.max(0, h.income - h.taxes + h.transfers)
      const spending = Math.min(
        h.cash,
        Math.max(
          minimum,
          disposable * 0.85 + Math.max(0, h.cash - (minimum * 3) / simulationMonths()) * periodRate(0.05),
        ),
      )
      orders.push({
        s,
        account: payments.account(householdAccount(r.id, s)),
        people,
        needs,
        requested: householdDemand(prices, needs, spending),
        remainingBudget: spending,
      })
    }
    // All strata bid at the same quoted offer. A scarce lot is rationed in
    // proportion to affordable orders, never by the stratum's array position.
    for (const g of GOODS)
      for (const offer of offers.get(g)!) {
        const price = offer.prices[g] / 1000
        const quantities = orders.map((o) =>
          Math.max(
            0,
            Math.min(
              o.requested[g] - e.households[r.id][o.s].consumption[g],
              Math.min(e.households[r.id][o.s].cash, o.remainingBudget) / Math.max(1e-12, price),
            ),
          ),
        )
        const demand = quantities.reduce((sum, q) => sum + q, 0)
        // The wholesaler retains a bounded working inventory for next period's
        // workshop orders. Otherwise retail can empty every input each period,
        // permanently shutting tools -> arms and replacement-capital chains.
        // Food is never withheld from residents for this purpose.
        const reserved =
          decisionPolicy().renewal && offer.seller === f && g !== 'food'
            ? Math.min(offer.stocks[g] * 0.5, f.inputTargets[g])
            : 0
        const fill = demand > 0 ? Math.min(1, Math.max(0, offer.stocks[g] - reserved) / demand) : 0
        orders.forEach((o, i) => {
          const amount = Math.min(offer.stocks[g], quantities[i] * fill)
          if (amount <= 1e-9) return
          const h = e.households[r.id][o.s]
          const paid = payments.transfer(o.account, offer.account, amount * price, 'household consumption')
          const quantity = price > 0 ? Math.min(amount, paid / price) : 0
          recordGoodsSale(w, offer.store, g, quantity, paid, {
            kind: 'household',
            nation: economicNation(w, r.id),
          })
          offer.stocks[g] = Math.max(0, offer.stocks[g] - quantity)
          offer.seller.sales += paid
          offer.seller.sold[g] += quantity
          h.expenditure += paid
          o.remainingBudget = Math.max(0, o.remainingBudget - paid)
          r.consumption[g] += quantity
          h.consumption[g] += quantity
        })
      }
    let food = 0,
      material = 0
    for (const o of orders) {
      const h = e.households[r.id][o.s]
      h.foodCoverage = o.needs.food > 0 ? Math.min(1, h.consumption.food / o.needs.food) : 1
      h.materialCoverage = clamp(
        GOODS.reduce(
          (sum, g) =>
            sum + (o.needs[g] > 0 ? Math.min(1, h.consumption[g] / o.needs[g]) : 1) * materialWeights[g],
          0,
        ) / totalMaterialWeight,
      )
      food += h.foodCoverage * o.people
      material += h.materialCoverage * o.people
    }
    r.foodCoverage = food / total
    r.materialCoverage = material / total
    for (const g of GOODS) {
      const loss = r.stocks[g] * retailDecay(g)
      recordUse(w, marketStore(r.id), g, loss, 'loss')
      r.stocks[g] -= loss
      f.losses[g] += loss
    }
    if (r.materialCoverage < 0.7)
      r.infrastructure = Math.max(0.05, r.infrastructure - periodFlow((0.7 - r.materialCoverage) * 0.002))
  }
}
export function fundGovernment(w: World) {
  const e = ensureEconomy(w),
    territory = territorialIndex(w)
  const unitsByNation = new Map<number, Region[]>()
  for (const unit of economicRegions(w)) {
    if (w.regions[provinceId(unit)].control) continue
    let units = unitsByNation.get(unit.nation)
    if (!units) unitsByNation.set(unit.nation, (units = []))
    units.push(unit)
  }
  for (const n of w.nations) {
    const own = unitsByNation.get(n.id) ?? [],
      people = own.reduce((sum, r) => sum + population(r), 0)
    if (!own.length) {
      for (const k of Object.keys(n.budget) as (keyof typeof n.budget)[]) n.budget[k] = 0
      continue
    }
    const plan = activeDevelopment(w, n)
    const intended = plan
      ? plan.appropriation
      : Math.max(n.income * 0.95, periodFlow(people * 0.00002)) +
        Math.max(0, n.treasury - (n.income * 12) / simulationMonths()) * periodRate(0.02)
    if (!plan && n.treasury < intended)
      borrow(w, governmentAccount(n.id), intended - n.treasury, Math.max(1000, n.gdp * 24))
    const expansion = expansionParameters()
    const compete =
      n.ai &&
      expansion.peerWeight > 0 &&
      n.foodCoverage >= expansion.minimumFood &&
      n.stability >= expansion.minimumStability
        ? competitivePressure(w, n)
        : undefined
    const frontier = territory.bordering(-1, n.id)
    const savings = frontier && compete ? expansion.savingShare * compete.urgency : 0
    const development = compete ? expansion.developmentShare * (compete.urgency + compete.peer) : 0
    const available = Math.min(n.treasury, intended) * (1 - savings),
      weights = {
        welfare: n.policies.welfare,
        education: n.policies.education + development * 12,
        military: n.policies.military,
        research: n.policies.research + development * 16 + (plan ? 12 : 0),
        administration: 12,
        infrastructure: 18 + development * 24 + (plan ? 18 : 0),
      }
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    for (const key of Object.keys(weights) as (keyof typeof weights)[])
      n.budget[key] = (available * weights[key]) / sum
    let needTotal = 0
    const eligible = own.flatMap((r) => {
      const counts = peopleByStratum(r.communities ?? [])
      return STRATA.map((s) => ({
        r,
        s,
        need: counts[s] * (s === 'owner' ? 0.1 : 1) * (1 + 1 - e.households[r.id][s].foodCoverage),
      }))
    })
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
    // Apply a common staffing fill ratio to all services. Category iteration must
    // not let schooling consume every worker before research/administration hire.
    const serviceKeys = ['education', 'military', 'research', 'administration', 'infrastructure'] as const
    // Keep an explicit share of the military appropriation available for actual
    // recruitment and supplies; staffing must not spend the same allocation first.
    const militaryReserve = decisionPolicy().realCosts ? n.budget.military * 0.5 : 0
    const requestedServices = serviceKeys.reduce((sum, key) => sum + n.budget[key], 0) - militaryReserve
    const staffing = new Map(
      own.map((r) => {
        const f = e.producers[r.id],
          hh = e.households[r.id]
        const capacity = STRATA.reduce(
          (sum, s) => sum + Math.max(0, hh[s].laborForce - hh[s].employed) * f.wage * skill[s],
          0,
        )
        const request = (requestedServices * population(r)) / Math.max(1, people)
        return [r.id, request > 0 ? Math.min(1, capacity / request) : 0]
      }),
    )
    for (const key of ['education', 'military', 'research', 'administration', 'infrastructure'] as const) {
      const allocation = n.budget[key] - (key === 'military' ? militaryReserve : 0)
      let delivered = 0
      for (const r of own) {
        delivered += purchasePublicLabor(
          w,
          r,
          governmentAccount(n.id),
          ((allocation * population(r)) / Math.max(1, people)) * staffing.get(r.id)!,
          `public ${key} services`,
        )
      }
      n.budget[key] = delivered + (key === 'military' ? militaryReserve : 0)
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
    n = governance(w, r.nation)
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
    if (n.id >= 0) n.income += tax
    delivered += paid
    order -= paid
    recordWages(w, r.id, payer, paid, true)
    f.publicServices += paid
    f.realServices += real
    const service =
      category === 'provincial services'
        ? 'provincialServices'
        : category === 'public education services'
          ? 'educationServices'
          : category === 'public administration services'
            ? 'administrationServices'
            : category === 'public infrastructure services'
              ? 'infrastructureServices'
              : category === 'public research services'
                ? 'researchServices'
                : category === 'public military services'
                  ? 'militaryServices'
                  : undefined
    if (service) f[service] = (f[service] ?? 0) + real
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
  if (economicRegion(w, to).nation >= 0) w.nations[economicRegion(w, to).nation].income += value * tariff
}
export function settleCredit(w: World) {
  repaySuppliers(w)
  settleBanks(w)
}
export function finishEconomyMonth(w: World) {
  const e = ensureEconomy(w)
  settleCredit(w)
  if (simulationMonths() > 1) withBorrowerLoanIndex(w, () => finishFirms(w))
  else finishFirms(w)
  for (const r of economicRegions(w)) {
    const f = e.producers[r.id],
      nation = governance(w, r.nation)
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
    if (nation.id >= 0) nation.income += tax
    f.profit -= tax
    if (stratumPeople(w, r.id, 'owner')) {
      const dividends = transfer(
        w,
        producerAccount(r.id),
        householdAccount(r.id, 'owner'),
        Math.max(0, f.profit) * P.dividendShare +
          Math.max(
            0,
            f.cash -
              ((f.purchases + f.freight + f.interest) * 6) / simulationMonths() -
              f.projects.reduce((sum, project) => sum + project.cost, 0),
          ) *
            periodRate(decisionPolicy().merchantRelease),
        'dividends',
      )
      e.households[r.id].owner.income += dividends
    }
    finishProduction(w, r)
  }
  reconcileGDP(w)
  for (const r of economicRegions(w)) e.producers[r.id].valueAdded = r.gdp
  summarizeEconomy(w)
  updateMonetaryPolicy(w)
  auditLedger(w)
  auditGoods(w)
  const months = simulationMonths()
  if (months !== 1) {
    // Payroll used period wages so employment always remained physical FTE.
    for (const f of Object.values(e.producers)) f.wage /= months
    for (const f of e.firms!) f.wage /= months
    for (const n of w.nations) {
      n.income /= months
      n.spending /= months
      if (n.capitalSpending !== undefined) n.capitalSpending /= months
      if (n.enterpriseIncome !== undefined) n.enterpriseIncome /= months
      for (const key of Object.keys(n.budget) as (keyof typeof n.budget)[]) n.budget[key] /= months
    }
  }
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
  const months = e.periodMonths ?? 1
  if (months !== 1) {
    for (const data of Object.values(e.national))
      for (const key of [
        'gdp',
        'realOutput',
        'consumption',
        'investment',
        'income',
        'welfarePerPerson',
      ] as const)
        data[key] /= months
    for (const key of ['gdp', 'realOutput', 'consumption', 'investment'] as const) e.totals[key] /= months
  }
  e.totals.unemployment = totalLabor ? clamp(1 - totalJobs / totalLabor) : 0
  e.totals.priceIndex = totalBaseBasket ? totalBasket / totalBaseBasket : 1
}
