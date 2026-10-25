import { extractDistrictResource } from './districts'
import { economicRegions, economicRegion, localFirmRegion, provinceId } from './local-units'
import {
  GOODS,
  inventory,
  population,
  clamp,
  type World,
  type Region,
  type Good,
  type Inventory,
} from './types'
import { STRATA, type CompetitiveFirm, type EconomicStratum } from './economic-types'
import {
  balance,
  borrow,
  ensureEconomy,
  firmAccount,
  householdAccount,
  producerAccount,
  transfer,
} from './ledger'
import { BASE_PRICE, householdNeed, reserveTarget } from './economy'
import { participatingLabor } from './age-cohorts'
import { collectedTaxRate } from './macroeconomy'
import { MODEL_PARAMETERS as P } from './model-parameters'
import { effectMultiplier } from './effects'
import { simulationSettings } from './settings'
import { hashSeed } from './random'
import { writeDownLoan, payBank } from './banking'
import {
  economicNation,
  firmStore,
  inventoryQuote,
  marketStore,
  recordGoodsSale,
  recordOwnCapital,
  recordProduction,
  recordUse,
  recordWages,
} from './national-accounts'

const SLOTS = 4
export const WAGE_SKILL: Record<EconomicStratum, number> = {
  smallholder: 0.9,
  laborer: 1,
  artisan: 1.25,
  professional: 1.7,
  owner: 0.8,
}
const recipes: Partial<Record<Good, Partial<Inventory>>> = {
  tools: { iron: 0.65, coal: 0.3, timber: 0.25 },
  textiles: { timber: 0.3, food: 0.12 },
  arms: { iron: 0.9, coal: 0.5, tools: 0.3 },
}
const firmIndexes = new WeakMap<
  World,
  { firms: CompetitiveFirm[]; length: number; revision: number; index: Map<number, CompetitiveFirm[]> }
>()
export function regionalFirms(w: World, region: number) {
  const firms = w.economy!.firms ?? [],
    revision = w.localEconomy?.revision ?? 0
  let cached = firmIndexes.get(w)
  if (!cached || cached.firms !== firms || cached.length !== firms.length || cached.revision !== revision) {
    const index = new Map<number, CompetitiveFirm[]>()
    for (const f of firms) {
      const id = localFirmRegion(f),
        list = index.get(id) ?? []
      list.push(f)
      index.set(id, list)
    }
    cached = { firms, length: firms.length, revision, index }
    firmIndexes.set(w, cached)
  }
  return cached.index.get(region) ?? []
}
function newFirm(w: World, r: Region, id: number): CompetitiveFirm {
  const quality = (hashSeed(`${w.seed}:firm:${id}`) % 10000) / 10000
  const f: CompetitiveFirm = {
    id,
    region: provinceId(r),
    ...(r.province === undefined
      ? {}
      : { locality: r.id, cell: r.center, owners: { [householdAccount(r.id, 'owner')]: 1 } }),
    generation: 0,
    active: false,
    cash: 0,
    capital: 0,
    productivity: 0.85 + quality * 0.3,
    wage: 0.0015 * (0.97 + quality * 0.06),
    markup: 0.12 + quality * 0.08,
    employment: 0,
    desiredEmployment: 0,
    payroll: 0,
    sales: 0,
    purchases: 0,
    interest: 0,
    taxes: 0,
    profit: 0,
    distress: 0,
    stocks: inventory(),
    prices: { ...BASE_PRICE },
    production: inventory(),
    planned: inventory(),
    forecast: inventory(),
    sold: inventory(),
    projects: [],
    ...(r.province === undefined
      ? {}
      : {
          specialization:
            r.urban > 0.5
              ? 'industrial'
              : r.deposits.iron + r.deposits.coal > 1.2
                ? 'mining'
                : r.fertility > 0.25
                  ? 'agricultural'
                  : 'mixed',
        }),
  }
  for (const g of GOODS) f.forecast[g] = householdNeed(r, g) / 3
  return f
}
export function ensureFirms(w: World) {
  const e = ensureEconomy(w)
  const first = !e.firms
  if (first) {
    e.firms = []
    e.firmEntries = 0
    e.firmExits = 0
  }
  if (!first) return e.firms!
  for (const r of economicRegions(w)) {
    if (regionalFirms(w, r.id).length) continue
    const opening = w.localEconomy ? Math.min(3, Math.ceil(population(r) / 10000)) : 3
    if (!opening) continue
    const funds = e.producers[r.id].cash * 0.6,
      privateCapital = e.producers[r.id].capital * 0.75
    e.producers[r.id].capital -= privateCapital
    for (let slot = 0; slot < (w.localEconomy ? opening + 1 : SLOTS); slot++) {
      const id = e.firms!.length,
        f = newFirm(w, r, id)
      f.active = slot < opening
      f.capital = slot < opening ? privateCapital / opening : 0
      e.firms!.push(f)
      if (f.active)
        transfer(w, producerAccount(r.id), firmAccount(id), funds / opening, 'opening enterprise equity')
    }
  }
  return e.firms!
}
export function beginFirmMonth(w: World) {
  ensureFirms(w)
  for (const f of w.economy!.firms!) {
    if (!f.active) continue
    for (const g of GOODS)
      f.forecast[g] = (1 - P.forecastAdjustment) * f.forecast[g] + P.forecastAdjustment * f.sold[g]
    f.capital *= 1 - P.depreciationMonthly
    for (const p of f.projects) if (--p.remaining <= 0) f.capital += p.capital
    f.projects = f.projects.filter((p) => p.remaining > 0)
    f.payroll = f.sales = f.purchases = f.interest = f.taxes = f.employment = 0
    f.production = inventory()
    f.planned = inventory()
    f.sold = inventory()
  }
  for (const r of economicRegions(w))
    r.industry =
      w.economy!.producers[r.id].capital + regionalFirms(w, r.id).reduce((s, f) => s + f.capital, 0)
}
/** Wage offers compete for a shared local labor pool; firms pay every job they obtain. */
export function hireFirms(w: World, r: Region) {
  const e = ensureEconomy(w),
    firms = regionalFirms(w, r.id).filter((f) => f.active),
    hh = e.households[r.id]
  for (const s of STRATA) hh[s].laborForce = 0
  for (const c of r.communities ?? []) hh[c.stratum ?? 'laborer'].laborForce += participatingLabor(c)
  const labor = STRATA.reduce((sum, s) => sum + hh[s].laborForce, 0)
  const basket = GOODS.reduce((sum, g) => sum + householdNeed(r, g) * r.prices[g], 0)
  const reference = GOODS.reduce((sum, g) => sum + householdNeed(r, g) * BASE_PRICE[g], 0)
  const index = reference > 0 ? basket / reference : 1,
    p = e.producers[r.id]
  const inflation = Math.log(Math.max(0.001, index) / Math.max(0.001, p.previousPriceIndex ?? index))
  p.previousPriceIndex = index
  const n = w.nations[r.nation]
  const serviceShare =
    (n.policies.education + n.policies.military + n.policies.research + 30) /
    Math.max(1, n.policies.education + n.policies.military + n.policies.research + n.policies.welfare + 30)
  const averageWage = firms.length ? firms.reduce((sum, f) => sum + f.wage, 0) / firms.length : p.wage
  // Anticipated public hiring has a funded wage budget and competes for people.
  // Unused reservations remain unemployment; they never count as a paid service.
  const publicFunds = Math.min(
    (n.treasury * population(r)) / Math.max(1, n.population),
    labor * averageWage * collectedTaxRate(w, r) * serviceShare,
  )
  const privateLabor = Math.max(0, labor - publicFunds / Math.max(1e-9, averageWage))
  for (const f of firms) {
    const benchmarkJobs = privateLabor / Math.max(1, firms.length)
    const oldEmployment = f.employment
    f.employment = benchmarkJobs
    const baseline = baseLaborMix(w, r, f)
    const { q } = firmCapacity(w, r, f, firms.length, baseline)
    f.employment = oldEmployment
    const required = inventory()
    for (const g of GOODS) {
      // Unsatisfied subsistence/input orders remain visible even after a cash-constrained month.
      const demand = Math.max(
        f.forecast[g],
        p.forecast[g] / Math.max(1, firms.length),
        reserveTarget(r, g) / (g === 'food' ? 2.4 : 3) / Math.max(1, firms.length),
      )
      const plan = Math.max(0, demand + 0.25 * (demand * P.inventoryMonths - f.stocks[g]))
      f.planned[g] = plan
      // Idle raw-material-dependent jobs cannot produce anything this month.
      // Keep the unconstrained order for procurement, but share available inputs
      // across firms before assigning scarce workers to workshops.
      let executable = plan
      for (const [input, rate] of Object.entries(recipes[g] ?? {}))
        executable = Math.min(executable, r.stocks[input as Good] / rate / Math.max(1, firms.length))
      required[g] = q[g] > 1e-9 ? baseline[g] * clamp(executable / q[g], 0, 4) : 0
    }
    const needed = GOODS.reduce((sum, g) => sum + required[g], 0)
    const utilization = clamp(needed, 0.05, 0.98)
    f.laborMix = inventory()
    for (const g of GOODS) f.laborMix[g] = needed > 0 ? required[g] / needed : baseline[g]
    f.desiredEmployment = benchmarkJobs * utilization * (1 - r.devastation * 0.5)
    // Bargaining responds to realized employment, including public jobs. Desired
    // utilization is not evidence that labor is scarce or that wages were funded.
    const employmentRate = p.previousLabor
      ? (p.previousJobs ?? 0) / p.previousLabor
      : 1 - P.referenceUnemployment
    f.wage *= Math.exp(
      P.wageBargainingAdjustment * (employmentRate - (1 - P.referenceUnemployment)) +
        P.wagePriceIndexation * inflation,
    )
    f.wage = Math.max(0.00005, f.wage)
  }
  let jobs = 0,
    payroll = 0
  for (const f of [...firms].sort((a, b) => b.wage - a.wage || a.id - b.id)) {
    const available = STRATA.reduce((sum, s) => sum + Math.max(0, hh[s].laborForce - hh[s].employed), 0)
    const wanted = Math.min(f.desiredEmployment, available)
    const averageSkill =
      STRATA.reduce((sum, s) => sum + Math.max(0, hh[s].laborForce - hh[s].employed) * WAGE_SKILL[s], 0) /
      Math.max(1, available)
    const bill = wanted * f.wage * averageSkill
    const sales = GOODS.reduce((sum, g) => sum + (f.forecast[g] * f.prices[g]) / 1000, 0)
    if (f.cash < bill) borrow(w, firmAccount(f.id), bill - f.cash, Math.max(1, sales * 4, f.capital * 30))
    const funded = Math.min(1, f.cash / Math.max(1e-12, bill))
    for (const s of STRATA) {
      const h = hh[s],
        count = available ? (Math.max(0, h.laborForce - h.employed) / available) * wanted * funded : 0
      const paid = transfer(
        w,
        firmAccount(f.id),
        householdAccount(r.id, s),
        count * f.wage * WAGE_SKILL[s],
        'enterprise wages',
      )
      const actual = paid / Math.max(1e-12, f.wage * WAGE_SKILL[s])
      const tax = transfer(
        w,
        householdAccount(r.id, s),
        `government:${r.nation}`,
        paid * collectedTaxRate(w, r),
        'income tax',
      )
      h.employed += actual
      h.income += paid
      h.taxes += tax
      w.nations[r.nation].income += tax
      f.employment += actual
      f.payroll += paid
      recordWages(w, r.id, firmAccount(f.id), paid)
    }
    jobs += f.employment
    payroll += f.payroll
  }
  p.payroll = payroll
  p.desiredEmployment = firms.reduce((sum, f) => sum + f.desiredEmployment, 0)
  p.wage = firms.reduce((sum, f) => sum + f.wage * f.employment, 0) / Math.max(1, jobs)
  p.wage = Math.max(0.00005, p.wage)
  r.employed = jobs
  return jobs
}
function baseLaborMix(w: World, r: Region, f?: CompetitiveFirm): Inventory {
  const n = w.nations[r.nation]
  const farm = clamp(
    0.58 -
      r.urban * 0.18 +
      (n.policies.priority === 'agriculture' ? 0.15 : n.policies.priority === 'industry' ? -0.1 : 0),
    0.3,
    0.78,
  )
  const mix = {
    food: farm,
    timber: ((1 - farm) * 0.11) / 0.52,
    stone: ((1 - farm) * 0.08) / 0.52,
    iron: ((1 - farm) * 0.075) / 0.52,
    coal: ((1 - farm) * 0.065) / 0.52,
    tools: (1 - farm) * (0.19 / 0.52) * 0.35,
    textiles: (1 - farm) * (0.19 / 0.52) * 0.5,
    arms: (1 - farm) * (0.19 / 0.52) * 0.15,
  }
  if (r.province !== undefined) {
    mix.food *= Math.max(0.03, r.fertility) * (f?.specialization === 'agricultural' ? 3 : 1)
    for (const g of ['timber', 'stone', 'iron', 'coal'] as const)
      mix[g] *= r.deposits[g] * (f?.specialization === 'mining' ? 3 : 1)
    for (const g of ['tools', 'textiles', 'arms'] as const)
      mix[g] *= (0.15 + r.urban * 2) * (f?.specialization === 'industrial' ? 3 : 1)
    const sum = GOODS.reduce((n, g) => n + mix[g], 0)
    for (const g of GOODS) mix[g] /= Math.max(1e-12, sum)
  }
  return mix
}
export function firmCapacity(
  w: World,
  r: Region,
  f: CompetitiveFirm,
  active: number,
  mix = f.laborMix ?? baseLaborMix(w, r, f),
) {
  const n = w.nations[r.nation],
    t = n.technologies,
    abundance = simulationSettings(w).abundance
  const eff =
    (1 + r.literacy * 0.35 + t.industry * 0.13) *
    (1 - r.devastation * 0.55) *
    (0.75 + 0.25 * (r.materialCoverage ?? 1)) *
    f.productivity
  const land = Math.max(1, r.cells.length * 1800 * (0.35 + r.fertility * 0.65)) / Math.max(1, active)
  const season = 1 + Math.sin((((w.month % 12) - 4) / 12) * Math.PI * 2) * 0.23
  const q = inventory()
  q.food =
    land *
    (1 - Math.exp((-f.employment * mix.food) / land)) *
    (0.105 + r.fertility * 0.125) *
    abundance *
    (1 + t.agriculture * 0.19) *
    season *
    w.climate *
    eff *
    effectMultiplier(w, 'harvest', n.id, r.id)
  for (const [g, rate] of [
    ['timber', 0.13],
    ['stone', 0.12],
    ['iron', 0.07],
    ['coal', 0.1],
  ] as const)
    q[g] =
      f.employment *
      mix[g] *
      rate *
      r.deposits[g] *
      eff *
      abundance *
      effectMultiplier(w, 'extraction', n.id, r.id)
  const capital =
    (w.economy!.producers[r.id].capital + f.capital * active) *
    (r.capitalReference === undefined ? 1 : r.capitalReference / Math.max(500, population(r)))
  const agglomeration =
    r.province === undefined
      ? 1
      : Math.min(1.4, 1 + 0.04 * Math.log1p(population(r) / Math.max(1, r.cells.length) / 1000))
  const factory =
    f.employment * capital * eff * agglomeration * effectMultiplier(w, 'manufacturing', n.id, r.id)
  q.tools = factory * mix.tools * (0.007 / 0.19 / 0.35)
  q.textiles = factory * mix.textiles * (0.013 / 0.19 / 0.5)
  q.arms = factory * mix.arms * (0.0025 / 0.19 / 0.15) * (n.policies.priority === 'military' ? 2 : 1)
  return { q }
}
/** Producers quote replacement-cost prices with bounded markups, not unbounded inventory inflation. */
export function produceFirms(w: World, r: Region) {
  const e = ensureEconomy(w),
    firms = regionalFirms(w, r.id).filter((f) => f.active),
    merchant = e.producers[r.id]
  r.production = inventory()
  r.plannedProduction = inventory()
  hireFirms(w, r)
  for (const f of firms) {
    const { q } = firmCapacity(w, r, f, firms.length)
    const laborShares = f.laborMix ?? baseLaborMix(w, r, f)
    for (const g of GOODS) {
      f.planned[g] = Math.max(f.planned[g], q[g])
      r.plannedProduction[g] += f.planned[g]
      if (q[g] <= 1e-9) continue
      const recipe = recipes[g] ?? {}
      const unitInput = Object.entries(recipe).reduce(
        (s, [input, rate]) => s + r.prices[input as Good] * rate,
        0,
      )
      const laborCost = (f.payroll * 1000 * laborShares[g]) / q[g]
      const targetPrice = Math.max(0.01, (laborCost + unitInput) * (1 + f.markup))
      f.prices[g] = Math.max(
        0.01,
        f.prices[g] * Math.exp(clamp(Math.log(targetPrice / f.prices[g]), -0.06, 0.06)),
      )
      inventoryQuote(w, firmStore(f.id), g, f.prices[g] / 1000)
      let made = q[g]
      for (const [input, rate] of Object.entries(recipe))
        made = Math.min(made, r.stocks[input as Good] / rate)
      const perUnit = unitInput / 1000
      if (perUnit > 0) {
        const desiredCash = made * perUnit
        if (f.cash < desiredCash) {
          const expectedSales = GOODS.reduce((s, good) => s + (f.forecast[good] * f.prices[good]) / 1000, 0)
          borrow(w, firmAccount(f.id), desiredCash - f.cash, Math.max(1, expectedSales * 4, f.capital * 30))
        }
        made = Math.min(made, f.cash / perUnit)
      }
      made = Math.max(0, made)
      if (g === 'timber' || g === 'stone' || g === 'iron' || g === 'coal')
        made = extractDistrictResource(w, r, g, made)
      for (const [input, rate] of Object.entries(recipe)) {
        const good = input as Good,
          quantity = made * rate
        const paid = transfer(
          w,
          firmAccount(f.id),
          producerAccount(r.id),
          (quantity * r.prices[good]) / 1000,
          'enterprise material purchase',
        )
        recordGoodsSale(w, marketStore(r.id), good, quantity, paid, {
          kind: 'business',
          nation: economicNation(w, r.id),
          account: firmAccount(f.id),
        })
        r.stocks[good] = Math.max(0, r.stocks[good] - quantity)
        r.consumption[good] += quantity
        merchant.intermediate[good] += quantity
        merchant.sales += paid
        merchant.sold[good] += quantity
        f.purchases += paid
      }
      f.production[g] = made
      f.stocks[g] += made
      r.production[g] += made
      recordProduction(w, firmStore(f.id), g, made, f.prices[g] / 1000)
    }
  }
  merchant.planned = { ...r.plannedProduction }
  for (const g of GOODS)
    merchant.inputTargets[g] = Math.max(
      0,
      reserveTarget(r, g) - householdNeed(r, g) * (g === 'food' ? 2.4 : 3),
    )
  restockMarket(w, r)
}
export function restockMarket(w: World, r: Region) {
  const e = ensureEconomy(w),
    merchant = e.producers[r.id],
    firms = regionalFirms(w, r.id).filter((f) => f.active)
  // Order food first. Lending finances inventories, subject to genuine bank capital and borrower limits.
  for (const g of GOODS) {
    // Merchants carry one additional month for export offers. Filling only the domestic
    // reserve target leaves zero exportable surplus and accidentally shuts all trade.
    const need = Math.max(
      0,
      reserveTarget(r, g) + Math.max(householdNeed(r, g), merchant.forecast[g]) - r.stocks[g],
    )
    let left = need,
      bought = 0,
      value = 0
    const offers = firms
      .filter((f) => f.stocks[g] > 1e-9)
      .sort((a, b) => a.prices[g] - b.prices[g] || a.id - b.id)
    for (const f of offers) {
      const price = f.prices[g] / 1000
      const desired = Math.min(left, f.stocks[g])
      if (merchant.cash < desired * price) {
        const revenue = GOODS.reduce((s, good) => s + (householdNeed(r, good) * r.prices[good]) / 1000, 0)
        borrow(w, producerAccount(r.id), desired * price - merchant.cash, Math.max(1, revenue * 6))
      }
      const quantity = Math.min(desired, merchant.cash / price)
      if (quantity <= 1e-9) continue
      const paid = transfer(
        w,
        producerAccount(r.id),
        firmAccount(f.id),
        quantity * price,
        'competitive wholesale purchase',
      )
      recordGoodsSale(w, firmStore(f.id), g, quantity, paid, {
        kind: 'business',
        nation: economicNation(w, r.id),
        account: producerAccount(r.id),
        store: marketStore(r.id),
      })
      f.stocks[g] = Math.max(0, f.stocks[g] - quantity)
      r.stocks[g] += quantity
      f.sales += paid
      f.sold[g] += quantity
      merchant.purchases += paid
      bought += quantity
      value += paid
      left -= quantity
      if (left <= 1e-9) break
    }
    if (bought > 0) r.prices[g] = Math.max(0.01, ((value * 1000) / bought) * (1 + retailMarkup(w, r, g)))
    // An inactive market retains its quote; nonexistent output cannot bid up wages indefinitely.
  }
}
export const retailDecay = (good: Good) =>
  good === 'food' ? 0.035 : good === 'timber' || good === 'textiles' ? 0.006 : 0.001
/** Recover expected inventory loss and finance costs per sale, plus a trading margin. */
export function retailMarkup(w: World, r: Region, good: Good) {
  const merchant = w.economy!.producers[r.id]
  const sales = Math.max(1, householdNeed(r, good), merchant.forecast[good])
  const target = reserveTarget(r, good) + householdNeed(r, good)
  const loans = w.economy!.credit.loans.filter((l) => l.borrower === producerAccount(r.id))
  const principal = loans.reduce((sum, l) => sum + l.principal, 0)
  const rate =
    principal > 0
      ? loans.reduce((sum, l) => sum + l.principal * (l.rate ?? P.policyRateMonthly + P.bankLoanSpread), 0) /
        principal
      : (w.economy!.banking?.centralBank.rate ?? P.policyRateMonthly) + P.bankLoanSpread
  return 0.04 + (Math.max(0, target - sales) * retailDecay(good) + target * rate) / sales
}
function invest(w: World, r: Region, f: CompetitiveFirm) {
  const hh = w.economy!.households[r.id].artisan,
    merchant = w.economy!.producers[r.id]
  const wage = f.wage * WAGE_SKILL.artisan,
    labor = 1000,
    recipe = { timber: 300, stone: 400, tools: 40 }
  const materials = Object.entries(recipe).reduce((s, [g, q]) => s + (q * r.prices[g as Good]) / 1000, 0)
  const unitCost = materials + labor * wage
  const target =
    Math.max(0, f.employment / Math.max(1, f.desiredEmployment) - 0.75) * P.investmentAdjustment +
    f.capital * P.depreciationMonthly
  const amount = Math.max(
    0,
    Math.min(
      target,
      (f.cash * 0.25) / Math.max(1e-9, unitCost),
      Math.max(0, hh.laborForce - hh.employed) / labor,
      r.stocks.timber / 300,
      r.stocks.stone / 400,
      r.stocks.tools / 40,
    ),
  )
  if (amount <= 1e-7) return
  for (const [input, quantity] of Object.entries(recipe)) {
    const g = input as Good,
      // Division followed by multiplication can exceed the limiting stock by one ULP.
      // Bound the actual withdrawal too, so empty stores cannot become negative dust.
      used = Math.min(r.stocks[g], amount * quantity)
    const paid = transfer(
      w,
      firmAccount(f.id),
      producerAccount(r.id),
      (used * r.prices[g]) / 1000,
      'capital materials',
    )
    recordGoodsSale(w, marketStore(r.id), g, used, paid, {
      kind: 'business',
      nation: economicNation(w, r.id),
      account: firmAccount(f.id),
    })
    r.stocks[g] -= used
    r.consumption[g] += used
    merchant.sales += paid
    merchant.sold[g] += used
  }
  const paid = transfer(
    w,
    firmAccount(f.id),
    householdAccount(r.id, 'artisan'),
    amount * labor * wage,
    'enterprise capital wages',
  )
  const tax = transfer(
    w,
    householdAccount(r.id, 'artisan'),
    `government:${r.nation}`,
    paid * collectedTaxRate(w, r),
    'construction wage income tax',
  )
  hh.income += paid
  hh.taxes += tax
  hh.employed += amount * labor
  w.nations[r.nation].income += tax
  recordWages(w, r.id, firmAccount(f.id), paid)
  const cost = amount * unitCost
  recordOwnCapital(w, r.id, firmAccount(f.id), cost)
  f.projects.push({ remaining: P.constructionMonths, capital: amount, cost })
  merchant.investment += cost
}
export function finishFirms(w: World) {
  const e = ensureEconomy(w)
  for (const r of economicRegions(w)) {
    const firms = regionalFirms(w, r.id),
      merchant = e.producers[r.id]
    for (const f of firms) {
      if (!f.active) continue
      const inventoryValue = GOODS.reduce((s, g) => s + (f.stocks[g] * f.prices[g]) / 1000, 0)
      const expectedSales = GOODS.reduce((s, g) => s + (f.forecast[g] * f.prices[g]) / 1000, 0)
      f.profit = f.sales - f.payroll - f.purchases - f.interest
      f.taxes = transfer(
        w,
        firmAccount(f.id),
        `government:${r.nation}`,
        Math.max(0, f.profit) * collectedTaxRate(w, r),
        'enterprise profit tax',
      )
      w.nations[r.nation].income += f.taxes
      const owners = f.owners ?? { [householdAccount(r.id, 'owner')]: 1 },
        shares = Object.values(owners).reduce((a, b) => a + b, 0)
      const distribution = Math.max(0, f.profit - f.taxes) * 0.45
      for (const [owner, share] of Object.entries(owners)) {
        const dividend = transfer(
          w,
          firmAccount(f.id),
          owner,
          (distribution * share) / Math.max(1e-12, shares),
          'enterprise dividend',
        )
        const [, unit, stratum] = owner.split(':')
        if (owner.startsWith('household:')) e.households[+unit][stratum as EconomicStratum].income += dividend
      }
      f.distress =
        (f.desiredEmployment > 1 && f.employment < f.desiredEmployment * 0.05) ||
        (f.cash < Math.max(0.01, f.payroll) && f.profit < 0)
          ? f.distress + 1
          : Math.max(0, f.distress - 1)
      f.markup = clamp(f.markup + (inventoryValue > expectedSales * 2 ? -0.002 : 0.001), 0.04, 0.3)
      invest(w, r, f)
      // Unsold inventories spoil physically and reduce operating surplus; financial defaults do not erase goods.
      for (const g of GOODS) {
        const loss = f.stocks[g] * (g === 'food' ? 0.035 : 0.001)
        recordUse(w, firmStore(f.id), g, loss, 'loss')
        f.stocks[g] -= loss
        merchant.losses[g] += loss
      }
      if (f.distress < 18) continue
      // The retailer buys a liquidation lot at the current quote if it can fund it.
      restockMarket(w, r)
      for (const loan of e.credit.loans.filter((l) => l.borrower === firmAccount(f.id))) {
        loan.principal -= payBank(
          w,
          firmAccount(f.id),
          loan.bank!,
          loan.principal,
          'enterprise liquidation recovery',
        )
        writeDownLoan(w, loan, loan.principal)
      }
      liquidateFirm(w, f)
      e.firmExits = (e.firmExits ?? 0) + 1
    }
    if (
      (w.month % 12 === r.id % 12 || (w.localEconomy && !firms.some((f) => f.active))) &&
      population(r) > 500
    ) {
      const active = firms.filter((f) => f.active)
      let slot = firms.find((f) => !f.active)
      const target = w.localEconomy
        ? Math.min(24, Math.max(2, Math.ceil(Math.sqrt(population(r) / 15000))))
        : 3
      const owner = householdAccount(r.id, 'owner'),
        seed = Math.max(1, population(r) * 0.00015)
      if (!slot && w.localEconomy && active.length < target && balance(w, owner) >= seed * 2) {
        slot = newFirm(w, r, e.firms!.length)
        e.firms!.push(slot)
      }
      if (slot && active.length < target && balance(w, owner) >= seed * 2) {
        slot.active = true
        if (w.localEconomy) slot.owners = { [owner]: 1 }
        slot.generation++
        slot.distress = 0
        slot.profit = 0
        slot.wage = merchant.wage
        slot.markup = 0.1
        slot.productivity = 0.95 + (hashSeed(`${w.seed}:${slot.id}:${slot.generation}`) % 200) / 1000
        for (const g of GOODS) {
          slot.prices[g] = Math.max(0.01, r.prices[g] / (1 + retailMarkup(w, r, g)))
          slot.forecast[g] = householdNeed(r, g) / 3
        }
        transfer(w, owner, firmAccount(slot.id), seed, 'entrepreneur equity subscription')
        e.firmEntries = (e.firmEntries ?? 0) + 1
      }
    }
    r.industry = merchant.capital + firms.reduce((s, f) => s + f.capital, 0)
  }
}
import { recordGift } from './national-accounts'
function liquidateFirm(w: World, f: CompetitiveFirm) {
  const r = economicRegion(w, localFirmRegion(f))
  for (const g of GOODS) {
    recordGift(w, firmStore(f.id), marketStore(r.id), g, f.stocks[g])
    r.stocks[g] += f.stocks[g]
    f.stocks[g] = 0
  }
  // Physical equipment survives as shared local capacity. Creditors recognize the unrecovered financial claim.
  w.economy!.producers[r.id].capital += f.capital
  w.economy!.producers[r.id].projects.push(...f.projects)
  f.projects = []
  f.capital = 0
  f.active = false
  f.employment = 0
  const owners = f.owners ?? { [householdAccount(r.id, 'owner')]: 1 },
    shares = Object.values(owners).reduce((a, b) => a + b, 0),
    cash = f.cash
  for (const [owner, share] of Object.entries(owners))
    transfer(
      w,
      firmAccount(f.id),
      owner,
      (cash * share) / Math.max(1e-12, shares),
      'liquidation residual equity',
    )
}
