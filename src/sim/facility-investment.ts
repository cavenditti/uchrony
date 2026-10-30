/** Resource-aware district investment. Opportunity scores compare the marginal
 * capacity or distribution saving per construction crown, never promised profits. */
import { facilityEconomicCase } from './facility-economics'
import { withWorldConfiguration } from './configuration'
import { recordWorldEvent } from './event-memory'
import {
  FACILITY_DEFINITIONS,
  FACILITY_KINDS,
  MAX_FACILITY_LEVELS,
  type FacilityKind,
} from './facility-types'
import { cellResourcePotential, landscapeAt } from './landscape'
import { economicRegion, economicRegions, provinceId } from './local-units'
import {
  FACILITY_POLICY,
  FACILITY_RECIPES,
  facilityLevelLimit,
  pendingFacilityCells,
  regionalFacilityLevels,
} from './productive-facilities'
import { fundPublicConstruction, publicConstructionQuote } from './public-construction'
import { quoteMaterialFinancing } from './supplier-credit'
import { habitableLand } from './terrain-access'
import { population, type Good, type Nation, type Region, type World } from './types'

const RAW_GOODS = new Set<Good>(['timber', 'stone', 'iron', 'coal'])

export interface FacilityQuote {
  kind: FacilityKind
  district: number
  province: number
  cell?: number
  level: number
  limit: number
  installed: number
  cost: number
  workerMonths: number
  duration: number
  score: number
  reason: string
  obstacle: string
  construction?: ReturnType<typeof publicConstructionQuote>
}

/** Physical suitability reads remaining endowments, not merely a terrain label. */
export function facilitySitePotential(w: World, cell: number, kind: FacilityKind) {
  const c = w.cells[cell]
  if (!c || !habitableLand(c)) return 0
  const good = FACILITY_DEFINITIONS[kind].sector
  if (good === 'food')
    return landscapeAt(c).habitat >= FACILITY_POLICY.minimumHabitat ? landscapeAt(c).habitat : 0
  if (good !== 'market' && RAW_GOODS.has(good)) {
    const value = cellResourcePotential(w, cell, good as keyof Region['deposits'])
    return value >= FACILITY_POLICY.minimumDeposit ? value : 0
  }
  return 1
}

/** Pick an upgradeable, unoccupied physical site without allocating a sorted
 * terrain list. Richer remaining endowments win, discounted for existing tiers. */
function selectSite(w: World, r: Region, kind: FacilityKind, limit: number, cell?: number) {
  const pending = pendingFacilityCells(w)
  let best = -1,
    potential = 0,
    bestScore = -1
  for (const id of cell === undefined ? r.cells : [cell]) {
    const site = w.facilities?.sites[id] ?? {},
      level = site[kind] ?? 0,
      suitability = facilitySitePotential(w, id, kind)
    if (
      !suitability ||
      pending.has(id) ||
      level >= limit ||
      Object.values(site).reduce((sum, value) => sum + value, 0) >= MAX_FACILITY_LEVELS
    )
      continue
    const score = suitability / (1 + level)
    if (score > bestScore) {
      best = id
      bestScore = score
      potential = suitability
    }
  }
  return { cell: best, potential }
}

function quoteFacility(
  w: World,
  r: Region,
  kind: FacilityKind,
  cell?: number,
  commitment = Infinity,
): FacilityQuote {
  const definition = FACILITY_DEFINITIONS[kind],
    n = w.nations[r.nation],
    limit = n ? facilityLevelLimit(n, kind) : 0,
    installed = Math.round(regionalFacilityLevels(w, r)[kind] * r.cells.length)
  const result: FacilityQuote = {
    kind,
    district: r.id,
    province: provinceId(r),
    level: 0,
    limit,
    installed,
    cost: 0,
    workerMonths: 0,
    duration: FACILITY_POLICY.duration,
    score: 0,
    reason: '',
    obstacle: '',
  }
  const block = (obstacle: string) => ({ ...result, obstacle })
  if (!n || n.extinct !== undefined || w.regions[provinceId(r)].control || !population(r))
    return block('Requires an inhabited, unoccupied home district.')
  if (!w.economy?.producers[r.id] || !w.economy.households[r.id])
    return block('Local economic accounts initialize on the first monthly step.')
  if (!limit)
    return block(`Requires ${definition.research} research level ${FACILITY_RECIPES[kind].technology}.`)
  if (cell !== undefined && !r.cells.includes(cell))
    return block('The construction site is outside this district.')
  const { cell: best, potential } = selectSite(w, r, kind, limit, cell)
  if (best < 0)
    return block(
      definition.sector === 'food'
        ? 'No cultivable site with free capacity is available at current technology.'
        : definition.sector !== 'market' && RAW_GOODS.has(definition.sector)
          ? `No remaining ${definition.sector} deposit with free capacity is available at current technology.`
          : 'Available sites are occupied by construction or at their land or technology limit.',
    )
  const level = w.facilities?.sites[best]?.[kind] ?? 0,
    scale = 1 + FACILITY_POLICY.costGrowth * level,
    recipe = FACILITY_RECIPES[kind],
    construction = publicConstructionQuote(
      w,
      r,
      {
        timber: recipe.timber * scale,
        stone: recipe.stone * scale,
        iron: recipe.iron * scale,
        tools: recipe.tools * scale,
      },
      recipe.laborMonths * scale,
    )
  const opportunity = facilityEconomicCase(w, r, kind, potential)
  Object.assign(result, {
    cell: best,
    level,
    cost: construction.cost,
    workerMonths: recipe.laborMonths * scale,
    construction,
    score: construction.cost > 0 ? opportunity.benefit / construction.cost : 0,
    reason: opportunity.reason,
  })
  if (construction.laborCost <= 0)
    return block('Construction requires a positive wage for available workers.')
  if (construction.available + 1e-9 < construction.labor)
    return block('Not enough available construction workers.')
  if (Object.entries(construction.recipe).some(([g, amount]) => r.stocks[g as Good] + 1e-9 < amount))
    return block('Requires local timber, stone, iron and tools for the full recipe.')
  if (construction.cost > commitment + 1e-9)
    return block('This project exceeds the remaining capital appropriation.')
  if (n.treasury + 1e-9 < construction.laborCost)
    return block('Construction wages must be paid from treasury cash.')
  if (n.treasury + 1e-9 < construction.cost) {
    const financing = quoteMaterialFinancing(w, r, construction.recipe, construction.laborCost, 1, n.treasury)
    if (financing.amount < 1 - 1e-9)
      return block('Treasury funds and eligible supplier credit cannot fund a full tier.')
  }
  return result
}

/** Read-only, currently executable quote shared by the player and agent menus. */
export function facilityQuote(w: World, r: Region, kind: FacilityKind, cell?: number) {
  return withWorldConfiguration(w, () => quoteFacility(w, r, kind, cell))
}

/** Ranked domestic alternatives; each must still be revalidated before payment. */
export function facilityOpportunities(w: World, n: Nation, units = economicRegions(w), budget = n.treasury) {
  return withWorldConfiguration(w, () =>
    units
      .filter((r) => r.nation === n.id)
      .flatMap((r) =>
        FACILITY_KINDS.filter((kind) => n.foodCoverage >= 0.97 || kind === 'farm-estate')
          .map((kind) => quoteFacility(w, r, kind, undefined, budget))
          .filter((q) => !q.obstacle && q.score > 0),
      )
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.district - b.district ||
          FACILITY_KINDS.indexOf(a.kind) - FACILITY_KINDS.indexOf(b.kind),
      ),
  )
}

/** Only completed, supplied construction creates usable premises. Public
 * facilities are shared district capital; enterprise equity remains separate. */
export function fundFacility(w: World, r: Region, kind: FacilityKind, budget: number, cell?: number) {
  return withWorldConfiguration(w, () => {
    const q = quoteFacility(w, r, kind, cell)
    if (q.obstacle || q.cell === undefined || !q.construction) return 0
    const { cost } = fundPublicConstruction(
      w,
      r,
      q.construction,
      1,
      budget,
      `${FACILITY_DEFINITIONS[kind].name} construction`,
      1 - 1e-9,
    )
    if (!cost) return 0
    const state = (w.facilities ??= { sites: {}, projects: [] })
    state.projects.push({
      nation: r.nation,
      cell: q.cell,
      kind,
      level: q.level + 1,
      funded: w.month,
      completes: w.month + q.duration,
      cost,
    })
    recordWorldEvent(w, {
      id: w.nextEvent++,
      month: w.month,
      type: 'economy',
      nation: r.nation,
      region: provinceId(r),
      title: `${w.nations[r.nation].shortName} builds ${FACILITY_DEFINITIONS[kind].name.toLowerCase()} in ${r.name}`,
      detail: `Tier ${q.level + 1} costs ${cost.toFixed(3)}k crowns in real materials and wages and completes in ${q.duration} months. ${q.reason} Production still requires paid workers, resources, inputs and customers.`,
    })
    return cost
  })
}

/** One site per district in a review; finite commitments and current construction
 * workers limit the batch independently of the number of available territories. */
export function fundFacilityProgram(w: World, n: Nation, units: Region[], budget: number) {
  let spent = 0
  const used = new Set<number>()
  for (const q of facilityOpportunities(w, n, units, budget)) {
    if (used.has(q.district) || q.cost > budget - spent + 1e-9) continue
    const cost = fundFacility(w, economicRegion(w, q.district), q.kind, budget - spent, q.cell)
    if (!cost) continue
    used.add(q.district)
    spent += cost
  }
  return spent
}

/** A named district order cannot spill into another market or foreign province. */
export function buildFacility(
  w: World,
  province: number,
  kind: FacilityKind,
  district?: number,
  cell?: number,
) {
  const units = economicRegions(w).filter(
    (r) => provinceId(r) === province && (district === undefined || r.id === district),
  )
  if (!units.length) return 'Choose a district inside the selected province.'
  const quotes = units
    .map((r) => facilityQuote(w, r, kind, cell))
    .sort(
      (a, b) => Number(!!a.obstacle) - Number(!!b.obstacle) || b.score - a.score || a.district - b.district,
    )
  const q = quotes[0]
  if (q.obstacle) return q.obstacle
  const r = economicRegion(w, q.district),
    cost = fundFacility(w, r, kind, w.nations[r.nation].treasury, q.cell)
  return cost > 0
    ? `${FACILITY_DEFINITIONS[kind].name} tier ${q.level + 1} funded in ${r.name} for ${cost.toFixed(3)}k crowns; ready in ${q.duration} months.`
    : 'Funding, materials or construction workers are no longer available.'
}
