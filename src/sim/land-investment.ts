/** Public land development extends productive capacity after basic settlement.
 * Projects compete on observed output and paid construction cost, not targets. */
import { recordWorldEvent } from './event-memory'
import { economicRegions, provinceId } from './local-units'
import { fundPublicConstruction, publicConstructionQuote } from './public-construction'
import {
  LAND_WORK,
  landDevelopmentLimit,
  landProductivity,
  regionalLandProductivity,
} from './productive-land'
import { GOODS, population, type Nation, type Region, type World } from './types'

/** A single terrain tile receives one complete, increasingly costly refinement. */
export function landDevelopmentQuote(w: World, r: Region, cell: number) {
  const level = w.productiveLand?.levels[cell] ?? 0,
    scale = 1 + level * LAND_WORK.costGrowth
  const recipe = {
    timber: LAND_WORK.timber * scale,
    stone: LAND_WORK.stone * scale,
    tools: LAND_WORK.tools * scale,
  }
  return { level, ...publicConstructionQuote(w, r, recipe, LAND_WORK.laborMonths * scale) }
}

/** No overlapping or partial levels: repeated orders cannot book the same land
 * twice, and a tiny appropriation cannot unlock an entire productivity tier. */
export function fundLandDevelopment(w: World, r: Region, cell: number, budget: number) {
  return fundTile(w, r, cell, budget, new Set(w.productiveLand?.projects.map((p) => p.cell)))
}

function fundTile(w: World, r: Region, cell: number, budget: number, pending: Set<number>) {
  const n = w.nations[r.nation]
  if (!n || !r.cells.includes(cell) || !population(r) || w.regions[provinceId(r)].control) return 0
  const q = landDevelopmentQuote(w, r, cell)
  if (q.level >= landDevelopmentLimit(n) || pending.has(cell)) return 0
  const { cost } = fundPublicConstruction(w, r, q, 1, budget, 'productive land works', 1 - 1e-9)
  if (!cost) return 0
  const state = (w.productiveLand ??= { levels: {}, projects: [] })
  state.projects.push({
    nation: n.id,
    cell,
    funded: w.month,
    completes: w.month + LAND_WORK.duration,
    level: q.level + 1,
    cost,
  })
  pending.add(cell)
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: w.month,
    type: 'economy',
    nation: n.id,
    region: provinceId(r),
    title: `${n.shortName} refines productive land in ${r.name}`,
    detail: `Level ${q.level + 1} site works cost ${cost.toFixed(3)}k crowns in local materials and wages and take ${LAND_WORK.duration} months. Better field layouts, drainage, work yards and access raise output from existing labor and equipment with diminishing returns.`,
  })
  return cost
}

/** Scan each eligible district once and rank its least developed site by the
 * marginal gain on current output per crown. One project per district per review
 * lets investment scale with the productive geography while bounding the scan.
 * The shared pending index avoids rescanning every funded project per candidate. */
export function fundLandDevelopmentProgram(
  w: World,
  n: Nation,
  units: Region[],
  budget: number,
  projectLimit = Infinity,
) {
  if (budget <= 0) return 0
  const pending = new Set(w.productiveLand?.projects.map((p) => p.cell)),
    limit = landDevelopmentLimit(n),
    candidates: { r: Region; cell: number; cost: number; score: number }[] = []
  for (const r of units) {
    if (r.nation !== n.id || !population(r) || w.regions[provinceId(r)].control) continue
    const output = GOODS.reduce((sum, g) => sum + (r.production[g] * r.prices[g]) / 1000, 0)
    if (output <= 0) continue
    let cell = -1,
      level = limit
    for (const id of r.cells) {
      const current = w.productiveLand?.levels[id] ?? 0
      if (current < level && !pending.has(id)) {
        cell = id
        level = current
      }
    }
    if (cell < 0) continue
    const q = landDevelopmentQuote(w, r, cell)
    if (
      q.available < q.labor ||
      q.cost <= 0 ||
      budget < q.laborCost ||
      Object.entries(q.recipe).some(([g, amount]) => r.stocks[g as keyof typeof r.stocks] + 1e-9 < amount)
    )
      continue
    const gain = landProductivity(level + 1) - landProductivity(level)
    if (gain <= 0) continue
    // Observed output already includes commissioned site capital. Divide out
    // that mean before valuing the next tile's absolute multiplier increment.
    candidates.push({
      r,
      cell,
      cost: q.cost,
      score: (output * gain) / (regionalLandProductivity(w, r) * r.cells.length * q.cost),
    })
  }
  candidates.sort((a, b) => b.score - a.score || a.cell - b.cell)
  let spent = 0,
    projects = 0
  for (const { r, cell, cost: quoted } of candidates) {
    // Program appropriations bound total capital commitments, including unpaid
    // supplier claims. Manual orders use an open commitment limit below, while
    // settlement still enforces the actual treasury and supplier-credit room.
    if (quoted > budget - spent + 1e-9) continue
    const cost = fundTile(w, r, cell, budget - spent, pending)
    if (cost <= 0) continue
    spent += cost
    if (++projects >= projectLimit) break
  }
  return spent
}

/** Manual orders use the same supply, technology and financing checks as AI. */
export function buildLandDevelopment(w: World, province: number) {
  const p = w.regions[province],
    n = w.nations[p?.nation]
  if (!n) return 'Land development requires a governed province.'
  const units = economicRegions(w).filter((r) => provinceId(r) === province)
  const spent = fundLandDevelopmentProgram(w, n, units, Infinity, 1)
  return spent > 0
    ? `Productive land works funded for ${spent.toFixed(3)}k crowns; ready in ${LAND_WORK.duration} months.`
    : `Land works need active production, local timber, stone and tools, available construction workers and funding. Agriculture, industry and logistics research unlock further levels, up to ${landDevelopmentLimit(n)} at current technology.`
}
