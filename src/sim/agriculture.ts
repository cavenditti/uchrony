import { parameterGroup } from './configuration-context'
import { quoteMaterialFinancing, issueSupplierCredit } from './supplier-credit'
import { nativeDomesticControl } from './domestic-policy'
import { economicRegions, provinceId } from './local-units'
import { governmentAccount, householdAccount, producerAccount, transfer } from './ledger'
import { marketStore, recordGoodsSale, recordOwnCapital, recordWages } from './national-accounts'
import { collectedTaxRate } from './macroeconomy'
import { STRATA } from './economic-types'
import { WAGE_SKILL } from './firms'
import { crossedPeriodMonth, simulationMonths } from './simulation-period'
import { recordWorldEvent } from './event-memory'
import { population, type Region, type World } from './types'

export interface FarmProject {
  nation: number
  cells: number[]
  funded: number
  completes: number
  fertility: number
  cost: number
}
// One complete improvement per terrain cell: drainage/soil works, with equipment
// investment handled by productive firms. Small districts can fund a fraction.
export const FARM_WORK = parameterGroup('farming')

function pending(w: World, r: Region) {
  const cells = new Set(r.cells)
  return (w.farmProjects ?? []).reduce(
    (sum, p) =>
      sum + (p.fertility * p.cells.filter((c) => cells.has(c)).length) / Math.max(1, r.cells.length),
    0,
  )
}

export function farmQuote(w: World, r: Region) {
  const producer = w.economy!.producers[r.id],
    hh = w.economy!.households[r.id]
  const area = Math.max(1, r.cells.length)
  const labor = (FARM_WORK.laborMonths * area) / simulationMonths()
  const wage = producer.wage
  const slots = STRATA.map((s) => ({
    s,
    jobs: Math.max(0, hh[s].laborForce - hh[s].employed),
    wage: wage * WAGE_SKILL[s],
  }))
  const available = slots.reduce((sum, s) => sum + s.jobs, 0)
  const averageWage = available ? slots.reduce((sum, s) => sum + s.jobs * s.wage, 0) / available : wage
  const timber = FARM_WORK.timber * area,
    stone = FARM_WORK.stone * area
  const cost = (timber * r.prices.timber + stone * r.prices.stone) / 1000 + labor * averageWage
  const room = Math.max(0, Math.min(1, (1.2 - r.fertility - pending(w, r)) / FARM_WORK.fertility))
  return { cost, labor, slots, available, timber, stone, room }
}

/** The state pays real sellers and available workers. Quoted future yields do
 * not supply funds; a project can neither mint money nor double-book labor. */
export function fundFarm(w: World, r: Region, budget: number) {
  if (r.nation < 0 || !population(r) || w.nations[r.nation].extinct !== undefined) return 0
  const q = farmQuote(w, r),
    n = w.nations[r.nation],
    merchant = w.economy!.producers[r.id]
  if (q.cost <= 0 || merchant.wage <= 0) return 0
  const financing = quoteMaterialFinancing(
    w,
    r,
    { timber: q.timber, stone: q.stone },
    q.cost - (q.timber * r.prices.timber + q.stone * r.prices.stone) / 1000,
    Math.min(q.room, q.available / q.labor),
    budget,
  )
  const amount = financing.amount
  if (amount < 0.01 || (w.farmProjects?.length ?? 0) >= w.cells.length) return 0
  const account = governmentAccount(n.id)
  let spent = 0
  for (const g of ['timber', 'stone'] as const) {
    const quantity = Math.min(r.stocks[g], amount * q[g])
    const deferred = (Math.min(quantity, financing.deferred[g] ?? 0) * r.prices[g]) / 1000
    issueSupplierCredit(w, r, deferred)
    const paid = transfer(
      w,
      account,
      producerAccount(r.id),
      (quantity * r.prices[g]) / 1000 - deferred,
      'farm construction materials',
    )
    recordGoodsSale(w, marketStore(r.id), g, quantity, paid + deferred, {
      kind: 'business',
      nation: n.id,
      account,
    })
    r.stocks[g] -= quantity
    r.consumption[g] += quantity
    merchant.sales += paid
    merchant.sold[g] += quantity
    spent += paid + deferred
  }
  for (const slot of q.slots) {
    const h = w.economy!.households[r.id][slot.s]
    const jobs = (amount * q.labor * slot.jobs) / q.available
    const paid = transfer(
      w,
      account,
      householdAccount(r.id, slot.s),
      jobs * slot.wage,
      'farm construction wages',
    )
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
    spent += paid
  }
  n.spending += spent
  merchant.investment += spent
  recordOwnCapital(w, r.id, account, spent)
  ;(w.farmProjects ??= []).push({
    nation: n.id,
    cells: [...r.cells],
    funded: w.month,
    completes: w.month + FARM_WORK.duration,
    fertility: amount * FARM_WORK.fertility,
    cost: spent,
  })
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: w.month,
    type: 'economy',
    nation: n.id,
    region: provinceId(r),
    title: `${n.shortName} funds farmland improvements in ${r.name}`,
    detail: `Local materials and construction wages cost ${spent.toFixed(3)}k crowns. Soil and drainage works take six months.`,
  })
  return spent
}

/** Projects follow their land through conquest and district boundary changes. */
export function completeFarmProjects(w: World) {
  if (!w.farmProjects?.length) return
  const due = w.farmProjects.filter((p) => p.completes <= w.month)
  if (!due.length) return
  const gains = new Map<number, number>()
  for (const p of due) for (const c of p.cells) gains.set(c, (gains.get(c) ?? 0) + p.fertility)
  for (const r of economicRegions(w))
    r.fertility = Math.min(
      1.2,
      r.fertility + r.cells.reduce((sum, c) => sum + (gains.get(c) ?? 0), 0) / Math.max(1, r.cells.length),
    )
  w.farmProjects = w.farmProjects.filter((p) => p.completes > w.month)
}

export function advanceAgriculturalInvestment(w: World) {
  const units = economicRegions(w)
  for (const n of w.nations) {
    if (!nativeDomesticControl(w, n) || n.foodCoverage >= 0.97 || !crossedPeriodMonth(w.month, n.id % 3, 3))
      continue
    // Two percent of existing treasury per month, integrated over the review
    // interval. No borrowing or raid on future taxes is assumed for these works.
    const budget = n.treasury * (1 - 0.98 ** Math.max(3, simulationMonths()))
    const candidates = units
      .filter((r) => r.nation === n.id && population(r) > 0 && r.foodCoverage < 0.97)
      .sort(
        (a, b) => (1 - b.foodCoverage) * population(b) - (1 - a.foodCoverage) * population(a) || a.id - b.id,
      )
    for (const r of candidates) if (fundFarm(w, r, budget) > 0) break
  }
}

export function buildFarm(w: World, province: number) {
  const p = w.regions[province]
  if (!p || p.nation < 0) return 'Farmland improvements require a governed province.'
  const units = economicRegions(w)
    .filter((r) => provinceId(r) === province && population(r) > 0)
    .sort((a, b) => a.foodCoverage - b.foodCoverage || a.id - b.id)
  for (const r of units) {
    const spent = fundFarm(w, r, w.nations[p.nation].treasury)
    if (spent > 0) return `Farmland improvements funded for ${spent.toFixed(3)}k crowns; ready in six months.`
  }
  return 'Farmland works need local timber and stone, available construction workers, treasury funds and room for improvement.'
}
