import { parameterGroup } from './configuration-context'
import { nativeDomesticControl } from './domestic-policy'
import { economicRegions, provinceId } from './local-units'
import { fundPublicConstruction, publicConstructionQuote } from './public-construction'
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
  const area = Math.max(1, r.cells.length),
    timber = FARM_WORK.timber * area,
    stone = FARM_WORK.stone * area
  const room = Math.max(0, Math.min(1, (1.2 - r.fertility - pending(w, r)) / FARM_WORK.fertility))
  return {
    ...publicConstructionQuote(w, r, { timber, stone }, FARM_WORK.laborMonths * area),
    timber,
    stone,
    room,
  }
}

/** The state pays real sellers and available workers. Quoted future yields do
 * not supply funds; a project can neither mint money nor double-book labor. */
export function fundFarm(w: World, r: Region, budget: number) {
  if (r.nation < 0 || !population(r) || w.nations[r.nation].extinct !== undefined) return 0
  if ((w.farmProjects?.length ?? 0) >= w.cells.length) return 0
  const q = farmQuote(w, r),
    n = w.nations[r.nation]
  const { amount, cost: spent } = fundPublicConstruction(w, r, q, q.room, budget, 'farm construction')
  if (!spent) return 0
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
