import { COMMODITIES, EXTENDED_GOODS, type ExtendedGood } from './commodity-catalog'
import {
  regionalMineralPotential,
  fishingPotential,
  extractExtendedResource,
  type ExtendedMineral,
} from './resource-extraction'
/** Competitive firms hire from local labor pools and produce against real inputs.
 * Payroll, inventories, capital projects and sales remain reconciled with the ledger. */
import {
  FACILITY_POLICY,
  publicWorkshopJobs,
  regionalFacilityLevels,
  weightFacilityLabor,
} from './productive-facilities'
import { GOOD_FACILITY } from './facility-types'
import { regionalLandProductivity } from './productive-land'
import {
  EXTRACTIVE_OUTPUTS,
  WORKSHOP_GOODS,
  productionRecipe,
  selectProductionTechniques,
} from './production-chains'
import { participatingLabor } from './age-cohorts'
import { loansForBorrower, payBank, writeDownLoan } from './banking'
import { localClimate } from './climate'
import { recordLocalJob } from './commuting'
import { parameterGroup } from './configuration-context'
import { decisionPolicy } from './decision-policy'
import { activeDevelopment } from './development'
import { extractDistrictResource } from './districts'
import { STRATA, type CompetitiveFirm, type EconomicStratum } from './economic-types'
import { BASE_PRICE, householdNeed, marketNeed, reserveTarget } from './economy'
import { effectMultiplier } from './effects'
import { expansionParameters } from './expansion-parameters'
import { governance } from './governance'
import { bargainWage, matchJobs, reservationWage, retainedJobs } from './labor-market'
import {
  balance,
  borrow,
  ensureEconomy,
  firmAccount,
  householdAccount,
  producerAccount,
  transfer,
} from './ledger'
import { economicRegion, economicRegions, localFirmRegion, provinceId } from './local-units'
import { collectedTaxRate } from './macroeconomy'
import { MODEL_PARAMETERS as P } from './model-parameters'
import { realFinancingRate } from './monetary-policy'
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
import { hashSeed } from './random'
import { refreshRetailQuote, retailMarkup } from './retail-pricing'
import { simulationSettings } from './settings'
import { crossedPeriodMonth, periodInterest, periodRate, simulationMonths } from './simulation-period'
import { reserveTaxRelief, targetInventoryMonths } from './strategic-reserves'
import { issueSupplierCredit, quoteMaterialFinancing } from './supplier-credit'
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

import { recordGift } from './national-accounts'
import { FIRM_SLOTS_PER_REGION as SLOTS } from './simulation-invariants'
export { retailDecay, retailMarkup } from './retail-pricing'
export const WAGE_SKILL: Record<EconomicStratum, number> = parameterGroup('wageSkills')
function workingCapitalLimit(w: World, f: CompetitiveFirm) {
  const sales = GOODS.reduce((sum, g) => sum + (f.forecast[g] * f.prices[g]) / 1000, 0)
  const rate = (w.economy!.banking?.centralBank.rate ?? P.policyRateMonthly) + P.bankLoanSpread
  return (sales * 0.3) / (periodRate(P.creditRepaymentMonthly) + periodInterest(rate))
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
  for (const g of GOODS) f.forecast[g] = marketNeed(r, g) / 3
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
  const initialized = new Set<number>()
  for (const r of economicRegions(w)) {
    if (initialized.has(r.id)) continue
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
    initialized.add(r.id)
  }
  return e.firms!
}
export function beginFirmMonth(w: World) {
  ensureFirms(w)
  for (const f of w.economy!.firms!) {
    if (!f.active) continue
    for (const g of GOODS)
      f.forecast[g] =
        (1 - periodRate(P.forecastAdjustment)) * f.forecast[g] + periodRate(P.forecastAdjustment) * f.sold[g]
    f.capital *= 1 - periodRate(P.depreciationMonthly)
    for (const p of f.projects) if ((p.remaining -= simulationMonths()) <= 0) f.capital += p.capital
    f.projects = f.projects.filter((p) => p.remaining > 0)
    f.payroll = f.sales = f.purchases = f.interest = f.taxes = 0
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
  selectProductionTechniques(r, governance(w, r.nation).technologies.industry)
  const e = ensureEconomy(w),
    firms = regionalFirms(w, r.id).filter((f) => f.active),
    hh = e.households[r.id]
  for (const s of STRATA) hh[s].laborForce = 0
  for (const c of r.communities ?? []) hh[c.stratum ?? 'laborer'].laborForce += participatingLabor(c)
  const labor = STRATA.reduce((sum, s) => sum + hh[s].laborForce, 0)
  // Missing industrial goods are not an outside income for a subsistence
  // household. Their scarcity prices must not make paid farming unattractive.
  const basket = GOODS.reduce(
    (sum, g) => sum + householdNeed(r, g) * r.prices[g] * (g === 'food' ? 1 : (r.materialCoverage ?? 1)),
    0,
  )
  const p = e.producers[r.id]
  const averageSkill =
    labor > 0 ? STRATA.reduce((sum, s) => sum + hh[s].laborForce * WAGE_SKILL[s], 0) / labor : 1
  // Actual consumption changes marginal utility. An unaffordable basket must
  // not be treated as guaranteed outside income that makes work unattractive.
  const consumption = 0.7 * (r.foodCoverage ?? 1) + 0.3 * (r.materialCoverage ?? 1)
  const reservation =
    labor > 0
      ? reservationWage(
          basket / (1000 * labor * averageSkill),
          consumption,
          decisionPolicy().workDisutility,
          P.consumptionRiskAversion,
        )
      : 0
  const expectedInflation = e.banking?.policy?.expectedInflation ?? 0.02
  const plans = new Map<number, { opening: number; retained: number; wanted: number }>()
  const n = governance(w, r.nation)
  const serviceShare =
    (n.policies.education + n.policies.military + n.policies.research + 30) /
    Math.max(1, n.policies.education + n.policies.military + n.policies.research + n.policies.welfare + 30)
  const averageWage = firms.length ? firms.reduce((sum, f) => sum + f.wage, 0) / firms.length : p.wage
  // Anticipated public hiring has a funded wage budget and competes for people.
  // Unused reservations remain unemployment; they never count as a paid service.
  const development = activeDevelopment(w, n)
  const publicFunds = development
    ? Math.min(
        ((development.appropriation * population(r)) / Math.max(1, n.population)) * serviceShare,
        labor * averageWage * 0.15,
      )
    : Math.min(
        (n.treasury * population(r)) / Math.max(1, n.population),
        labor * averageWage * collectedTaxRate(w, r) * serviceShare,
      )
  const privateLabor = Math.max(0, labor - publicFunds / Math.max(1e-9, averageWage)),
    sharedPremises = publicWorkshopJobs(w, r, firms.length)
  for (const f of firms) {
    const share = 1 / Math.max(1, firms.length)
    const benchmarkJobs = privateLabor * share
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
        p.forecast[g] * share,
        (reserveTarget(r, g) / (g === 'food' ? 2.4 : 3)) * share,
      )
      const plan = Math.max(0, demand + 0.25 * (demand * targetInventoryMonths(w, r, g) - f.stocks[g]))
      f.planned[g] = plan
      // Idle raw-material-dependent jobs cannot produce anything this month.
      // Keep the unconstrained order for procurement, but share available inputs
      // across firms before assigning scarce workers to workshops.
      let executable = plan
      for (const [input, rate] of Object.entries(productionRecipe(r, g)))
        executable = Math.min(executable, r.stocks[input as Good] / rate / Math.max(1, firms.length))
      required[g] = q[g] > 1e-9 ? baseline[g] * clamp(executable / q[g], 0, 4) : 0
    }
    // Premises constrain workshop jobs. Farming and extraction use the real
    // land/resource capacities below, so a depreciating workshop cannot evict
    // farmers or prevent a new rural enterprise from employing anyone.
    const indoor = WORKSHOP_GOODS.reduce((sum, good) => sum + required[good], 0)
    const premises = (w.adaptive?.sites[`firm:${f.id}`]?.capacity ?? Infinity) + sharedPremises
    const indoorScale = Math.min(1, premises / Math.max(1e-9, benchmarkJobs * indoor))
    for (const good of WORKSHOP_GOODS) required[good] *= indoorScale
    const needed = GOODS.reduce((sum, g) => sum + required[g], 0)
    const utilization = clamp(needed, 0.05, 0.98)
    f.laborMix = inventory()
    for (const g of GOODS) f.laborMix[g] = needed > 0 ? required[g] / needed : baseline[g]
    f.desiredEmployment = benchmarkJobs * utilization * (1 - r.devastation * 0.5)
    // Screen the production plan that can actually be executed. A workshop
    // switching to farming must not be rejected using its obsolete industrial
    // mix, especially when missing inputs have already redirected its workers.
    f.employment = benchmarkJobs
    const plannedCapacity = firmCapacity(w, r, f, firms.length).q
    f.employment = oldEmployment
    const valueAdded = GOODS.reduce((sum, g) => {
      const inputs = Object.entries(productionRecipe(r, g)).reduce(
        (cost, [input, rate]) => cost + r.prices[input as Good] * rate,
        0,
      )
      return sum + (plannedCapacity[g] * Math.max(0, f.prices[g] - inputs)) / 1000
    }, 0)
    const productivity = benchmarkJobs > 0 ? valueAdded / (benchmarkJobs * averageSkill) : 0
    const employedShare = p.previousLabor
      ? Math.min(1, (p.previousJobs ?? 0) / p.previousLabor)
      : 1 - P.referenceUnemployment
    const bargainingPower = P.workerBargainingPower * employedShare
    f.wage = bargainWage(
      f.wage,
      reservation,
      productivity,
      bargainingPower,
      periodRate(P.wageRenegotiationMonthly),
      expectedInflation / 12,
    )
    if (productivity < reservation) f.desiredEmployment = 0
    const opening = f.employment
    const bill = f.desiredEmployment * f.wage * averageSkill
    // At most 30% of expected receipts can service working-capital debt.
    if (f.cash < bill) borrow(w, firmAccount(f.id), bill - f.cash, workingCapitalLimit(w, f))
    const wanted = f.wage > 0 ? Math.min(f.desiredEmployment, f.cash / (f.wage * averageSkill)) : 0
    const retained = retainedJobs(opening, wanted, periodRate(P.jobSeparationMonthly))
    plans.set(f.id, { opening, retained, wanted: f.wage >= reservation ? wanted : retained })
  }
  // Existing contracts have priority over new vacancies. Migration, retirement
  // and changing boundaries can reduce the resident pool; scale claims together.
  const claimed = [...plans.values()].reduce((sum, p) => sum + p.retained, 0)
  const retentionScale = claimed > 0 ? Math.min(1, privateLabor / claimed) : 1
  for (const plan of plans.values()) plan.retained *= retentionScale
  const retained = [...plans.values()].reduce((sum, p) => sum + p.retained, 0)
  const vacancies = [...plans.values()].reduce((sum, p) => sum + Math.max(0, p.wanted - p.retained), 0)
  const matches = matchJobs(
    Math.max(0, privateLabor - retained),
    vacancies,
    periodRate(P.matchingEfficiency),
    P.matchingElasticity,
  )
  let jobs = 0,
    payroll = 0
  for (const f of firms) {
    const plan = plans.get(f.id)!
    const vacant = Math.max(0, plan.wanted - plan.retained)
    const hires = vacancies > 0 ? (matches * vacant) / vacancies : 0
    const count = plan.retained + hires
    f.employment = 0
    for (const s of STRATA) {
      const h = hh[s]
      const allocation = labor > 0 ? (count * h.laborForce) / labor : 0
      const paid = transfer(
        w,
        firmAccount(f.id),
        householdAccount(r.id, s),
        allocation * f.wage * WAGE_SKILL[s],
        'enterprise wages',
      )
      const actual = f.wage > 0 ? paid / (f.wage * WAGE_SKILL[s]) : 0
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
      if (r.nation >= 0) w.nations[r.nation].income += tax
      recordLocalJob(w, r.id, f.id, s, actual, paid)
      f.employment += actual
      f.payroll += paid
      recordWages(w, r.id, firmAccount(f.id), paid)
    }
    // Payroll settlement is the authority for actual jobs, including rounding.
    const actualRetained = Math.min(plan.retained, f.employment)
    f.labor = {
      opening: plan.opening,
      retained: actualRetained,
      hires: Math.max(0, f.employment - actualRetained),
      separations: plan.opening - actualRetained,
      vacancies: vacant,
      unfilled: Math.max(0, vacant - (f.employment - actualRetained)),
    }
    jobs += f.employment
    payroll += f.payroll
  }
  p.payroll = payroll
  p.desiredEmployment = firms.reduce((sum, f) => sum + f.desiredEmployment, 0)
  p.wage = jobs > 0 ? firms.reduce((sum, f) => sum + f.wage * f.employment, 0) / jobs : p.wage
  r.employed = jobs
  return jobs
}
function baseLaborMix(w: World, r: Region, f?: CompetitiveFirm): Inventory {
  const n = governance(w, r.nation)
  const farm = clamp(
    0.58 -
      r.urban * 0.18 +
      (n.policies.priority === 'agriculture' ? 0.15 : n.policies.priority === 'industry' ? -0.1 : 0),
    0.3,
    0.78,
  )
  // Nonfarm reference shares sum to 0.52; rescale them to the remaining
  // labor after the endogenous farming share, preserving their relative mix.
  const mix: Inventory = {
    ...inventory(),
    food: farm * 0.92,
    wool: farm * 0.08,
    timber: ((1 - farm) * 0.1) / 0.52,
    stone: ((1 - farm) * 0.065) / 0.52,
    ironOre: ((1 - farm) * 0.06) / 0.52,
    iron: ((1 - farm) * 0.025) / 0.52,
    coal: ((1 - farm) * 0.05) / 0.52,
    charcoal: ((1 - farm) * 0.05) / 0.52,
    tools: ((1 - farm) * 0.06) / 0.52,
    textiles: ((1 - farm) * 0.085) / 0.52,
    arms: ((1 - farm) * 0.025) / 0.52,
  }
  // Extra sectors compete for the same finite labor pool, rather than adding
  // another full workforce for every catalogue entry.
  let extra = 0
  for (const good of EXTENDED_GOODS) {
    mix[good] = COMMODITIES[good].laborShare
    extra += mix[good]
  }
  for (const good of GOODS) mix[good] /= 1 + extra
  for (const good of EXTENDED_GOODS) {
    const sector = COMMODITIES[good].sector
    if (sector === 'mineral') mix[good] *= regionalMineralPotential(w, r, good as ExtendedMineral)
    if (sector === 'fishery') mix[good] *= fishingPotential(w, r)
  }
  if (r.province !== undefined) {
    mix.food *= Math.max(0.03, r.fertility) * (f?.specialization === 'agricultural' ? 3 : 1)
    mix.wool *= Math.max(0.03, r.fertility) * (f?.specialization === 'agricultural' ? 3 : 1)
    for (const g of ['timber', 'stone', 'ironOre', 'coal'] as const)
      mix[g] *= r.deposits[EXTRACTIVE_OUTPUTS[g]!] * (f?.specialization === 'mining' ? 3 : 1)
    for (const g of WORKSHOP_GOODS)
      mix[g] *= (0.15 + r.urban * 2) * (f?.specialization === 'industrial' ? 3 : 1)
  }
  if (f?.activity) {
    mix[f.activity] *= 4
  }
  // Geography removes unavailable occupations; redistribute their labor once,
  // including regional firms without a district specialization.
  const total = GOODS.reduce((sum, g) => sum + mix[g], 0)
  for (const g of GOODS) mix[g] /= Math.max(1e-12, total)
  return weightFacilityLabor(w, r, mix)
}
export function firmCapacity(
  w: World,
  r: Region,
  f: CompetitiveFirm,
  active: number,
  mix = f.laborMix ?? baseLaborMix(w, r, f),
) {
  const n = governance(w, r.nation),
    t = n.technologies,
    abundance = simulationSettings(w).abundance,
    facilities = regionalFacilityLevels(w, r)
  const eff =
    (1 + r.literacy * 0.35 + t.industry * 0.13) *
    (1 - r.devastation * 0.55) *
    (0.75 + 0.25 * (r.materialCoverage ?? 1)) *
    f.productivity *
    regionalLandProductivity(w, r)
  // Each base cell supports 1,800 reference labor units, fertility-adjusted and
  // divided among active firms so entry cannot multiply the same land endowment.
  const land = Math.max(1, r.cells.length * 1800 * (0.35 + r.fertility * 0.65)) / Math.max(1, active)
  const climate = localClimate(w, w.cells[f.cell ?? r.center]),
    season = climate.season
  // Capital was seeded against a reference population; normalize that baseline
  // when districts split so refinement cannot grant an equipment productivity bonus.
  const capital =
    (w.economy!.producers[r.id].capital + f.capital * active) *
    (r.capitalReference === undefined ? 1 : r.capitalReference / Math.max(500, population(r)))
  // Productive equipment also serves farms. Diminishing returns preserve the
  // need for land and labor; an empty balance sheet receives no equipment bonus.
  const equipment = decisionPolicy().agriculture ? 1 + 0.5 * Math.log1p(capital) : 1
  const agricultural = mix.food + mix.wool + mix.grain + mix.flax + mix.cotton + mix.hemp
  const farmLabor =
    (land * (1 - Math.exp((-f.employment * agricultural) / land))) / Math.max(1e-12, agricultural)
  const q = inventory()
  q.food =
    farmLabor *
    mix.food *
    (0.105 + r.fertility * 0.125) *
    abundance *
    equipment *
    (1 + t.agriculture * 0.19) *
    season *
    w.climate *
    eff *
    effectMultiplier(w, 'harvest', n.id, r.id) *
    (1 + FACILITY_POLICY.productivity * Math.log1p(facilities['farm-estate']))
  for (const [g, rate] of [
    ['timber', 0.13],
    ['stone', 0.12],
    ['ironOre', 0.12],
    ['coal', 0.1],
  ] as const)
    q[g] =
      f.employment *
      mix[g] *
      rate *
      r.deposits[EXTRACTIVE_OUTPUTS[g]!] *
      eff *
      abundance *
      effectMultiplier(w, 'extraction', n.id, r.id) *
      (1 + FACILITY_POLICY.productivity * Math.log1p(facilities[GOOD_FACILITY[g]]))
  // Grazing and crop production share the paid agricultural labor pool. Wool
  // remains land-limited and seasonal; extra firms cannot multiply the pasture.
  q.wool =
    farmLabor *
    mix.wool *
    0.045 *
    abundance *
    equipment *
    (1 + t.agriculture * 0.19) *
    season *
    w.climate *
    eff *
    (1 + FACILITY_POLICY.productivity * Math.log1p(facilities['sheep-farm']))
  const agglomeration =
    r.province === undefined
      ? 1
      : Math.min(1.4, 1 + 0.04 * Math.log1p(population(r) / Math.max(1, r.cells.length) / 1000))
  const manufacturing = effectMultiplier(w, 'manufacturing', n.id, r.id)
  // Low-tech kilns and bloomery furnaces can bootstrap from labor and inputs;
  // equipment improves throughput but cannot replace ore or wood in the recipe.
  const furnace = f.employment * eff * agglomeration * manufacturing * (1 + 0.2 * Math.log1p(capital))
  q.iron = furnace * mix.iron * 0.1 * (1 + FACILITY_POLICY.productivity * Math.log1p(facilities.smelter))
  q.charcoal =
    furnace *
    mix.charcoal *
    0.06 *
    (1 + FACILITY_POLICY.productivity * Math.log1p(facilities['charcoal-kiln']))
  const factory = f.employment * capital * eff * agglomeration * manufacturing
  // Public workshops contain paid productive equipment, so a district with no
  // inherited private equipment can develop industry. Employment and input
  // procurement below still bound actual production; firm entry cannot multiply it.
  const publicEquipment = f.employment * FACILITY_POLICY.equipment * eff * agglomeration * manufacturing
  q.tools = (factory + publicEquipment * facilities['tool-industry']) * mix.tools * (0.007 / 0.19 / 0.35)
  q.textiles =
    (factory + publicEquipment * facilities['textile-industry']) * mix.textiles * (0.013 / 0.19 / 0.5)
  q.arms =
    (factory + publicEquipment * facilities['arms-industry']) *
    mix.arms *
    (0.0025 / 0.19 / 0.15) *
    (n.policies.priority === 'military' ? 2 : 1)
  const technology = n.technologies.industry
  for (const good of EXTENDED_GOODS) {
    const spec = COMMODITIES[good]
    if ((spec.sector === 'crop' ? t.agriculture : technology) < spec.technology) continue
    const facility = facilities[GOOD_FACILITY[good]]
    const improvement = 1 + FACILITY_POLICY.productivity * Math.log1p(facility)
    if (spec.sector === 'crop') {
      const suitability =
        good === 'cotton'
          ? clamp((climate.temperature - 8) / 16)
          : good === 'flax'
            ? clamp(1 - Math.abs(climate.temperature - 15) / 25)
            : 1
      q[good] =
        farmLabor *
        mix[good] *
        spec.rate *
        suitability *
        abundance *
        equipment *
        (1 + t.agriculture * 0.19) *
        season *
        w.climate *
        eff *
        improvement
    } else if (spec.sector === 'mineral') {
      q[good] =
        f.employment *
        mix[good] *
        spec.rate *
        regionalMineralPotential(w, r, good as ExtendedMineral) *
        abundance *
        eff *
        improvement
    } else if (spec.sector === 'fishery') {
      q[good] = f.employment * mix[good] * spec.rate * fishingPotential(w, r) * eff * equipment * improvement
    } else q[good] = furnace * mix[good] * spec.rate * improvement
  }
  if (simulationMonths() !== 1) for (const g of GOODS) q[g] *= simulationMonths()
  return { q }
}
/** Producers quote replacement-cost prices with bounded markups, not unbounded inventory inflation. */
export function produceFirms(w: World, r: Region, hired = false) {
  const e = ensureEconomy(w),
    firms = regionalFirms(w, r.id).filter((f) => f.active),
    merchant = e.producers[r.id]
  // Hiring reads the last visible industrial orders. Clearing them first would
  // erase the only demand signal for ore and wool, which households never buy.
  if (!hired) hireFirms(w, r)
  r.production = inventory()
  r.plannedProduction = inventory()
  for (const f of firms) {
    const { q } = firmCapacity(w, r, f, firms.length)
    const laborShares = f.laborMix ?? baseLaborMix(w, r, f)
    for (const g of GOODS) {
      f.planned[g] = Math.max(f.planned[g], q[g])
      r.plannedProduction[g] += f.planned[g]
      if (q[g] <= 1e-9) continue
      const recipe = productionRecipe(r, g)
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
          borrow(w, firmAccount(f.id), desiredCash - f.cash, workingCapitalLimit(w, f))
        }
        made = Math.min(made, f.cash / perUnit)
      }
      made = Math.max(0, made)
      const resource = EXTRACTIVE_OUTPUTS[g]
      if (resource) made = extractDistrictResource(w, r, resource, made)
      const extended = COMMODITIES[g as ExtendedGood]
      if (extended?.sector === 'mineral' || extended?.sector === 'fishery')
        made = extractExtendedResource(w, r, g as ExtendedMineral | 'fish', made)
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
    merchant.inputTargets[g] = Math.max(0, reserveTarget(r, g) - marketNeed(r, g) * (g === 'food' ? 2.4 : 3))
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
    // Requote carried stock even without a new purchase: old saves may retain
    // a marginal-lot quote far below the warehouse's actual acquisition cost.
    refreshRetailQuote(w, r, g, bought > 0 ? value / bought : undefined)
  }
}
export function invest(
  w: World,
  r: Region,
  f: CompetitiveFirm,
  sponsor?: { budget: number; activity: 'food' | 'tools' | 'textiles' },
) {
  const hh = w.economy!.households[r.id].artisan,
    merchant = w.economy!.producers[r.id]
  const wage = f.wage * WAGE_SKILL.artisan,
    labor = 1000 / simulationMonths(),
    recipe = { timber: 300, stone: 400, tools: 40 }
  const materials = Object.entries(recipe).reduce((s, [g, q]) => s + (q * r.prices[g as Good]) / 1000, 0)
  const unitCost = materials + labor * wage
  const loanRate = (w.economy!.banking?.centralBank.rate ?? P.policyRateMonthly) + P.bankLoanSpread
  const userCost = periodInterest(
    realFinancingRate(loanRate, w.economy!.banking?.policy?.expectedInflation ?? 0.02) +
      P.depreciationMonthly,
  )
  // Renewal runs before retail. Count only forecast sales still unsatisfied and
  // backed by current inventory; wholesale sales have already entered f.sold.
  // Treating the unfinished period's cash receipts as final profits otherwise
  // excludes firms that sell directly to households from capital renewal.
  const remainingSales = decisionPolicy().renewal
    ? GOODS.reduce(
        (sum, g) =>
          sum + (Math.min(f.stocks[g], Math.max(0, f.forecast[g] - f.sold[g])) * f.prices[g]) / 1000,
        0,
      )
    : 0
  const operatingYield =
    (f.sales + remainingSales - f.payroll - f.purchases) / Math.max(unitCost, f.capital * unitCost)
  const target = sponsor
    ? 0.18
    : operatingYield > userCost
      ? Math.max(0, f.employment / Math.max(1, f.desiredEmployment) - 0.75) *
          periodRate(decisionPolicy().investmentAdjustment) +
        f.capital * periodRate(P.depreciationMonthly)
      : 0
  const financed = sponsor
    ? quoteMaterialFinancing(
        w,
        r,
        recipe,
        labor * wage,
        Math.min(target, Math.max(0, hh.laborForce - hh.employed) / labor),
        sponsor.budget,
      )
    : undefined
  const amount =
    financed?.amount ??
    Math.max(
      0,
      Math.min(
        target,
        (sponsor
          ? Math.min(sponsor.budget, w.nations[r.nation].treasury)
          : f.cash * decisionPolicy().investmentShare) / Math.max(1e-9, unitCost),
        Math.max(0, hh.laborForce - hh.employed) / labor,
        r.stocks.timber / 300,
        r.stocks.stone / 400,
        r.stocks.tools / 40,
      ),
    )
  if (amount <= 1e-7 || f.projects.length >= 120) return 0
  const cost = amount * unitCost
  if (sponsor) {
    const payer = `government:${r.nation}`
    const owners = f.owners ?? { [householdAccount(r.id, 'owner')]: 1 }
    const shares = Object.values(owners).reduce((sum, share) => sum + share, 0)
    // Subscribe new equity at current book value, without taking private shares.
    const value = Math.max(
      unitCost * 0.05,
      f.cash +
        f.capital * unitCost +
        f.projects.reduce((sum, p) => sum + p.cost, 0) +
        GOODS.reduce((sum, g) => sum + (f.stocks[g] * f.prices[g]) / 1000, 0) -
        loansForBorrower(w, firmAccount(f.id)).reduce((sum, l) => sum + l.principal, 0),
    )
    const cashCost = financed?.cash ?? cost
    const paid = transfer(w, payer, firmAccount(f.id), cashCost, 'public enterprise equity')
    if (paid < cashCost - 1e-9) throw new Error('Public investment funding changed during settlement')
    owners[payer] = (owners[payer] ?? 0) + (cost / value) * Math.max(1e-9, shares)
    f.owners = owners
    f.activity = sponsor.activity
    w.nations[r.nation].spending += cost
    w.nations[r.nation].capitalSpending = (w.nations[r.nation].capitalSpending ?? 0) + cost
  }
  for (const [input, quantity] of Object.entries(recipe)) {
    const g = input as Good,
      // Division followed by multiplication can exceed the limiting stock by one ULP.
      // Bound the actual withdrawal too, so empty stores cannot become negative dust.
      used = Math.min(r.stocks[g], amount * quantity)
    const deferred = (Math.min(used, financed?.deferred[g] ?? 0) * r.prices[g]) / 1000
    issueSupplierCredit(w, r, deferred)
    const paid = transfer(
      w,
      firmAccount(f.id),
      producerAccount(r.id),
      (used * r.prices[g]) / 1000 - deferred,
      'capital materials',
    )
    recordGoodsSale(w, marketStore(r.id), g, used, paid + deferred, {
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
  if (r.nation >= 0) w.nations[r.nation].income += tax
  recordWages(w, r.id, firmAccount(f.id), paid)
  recordOwnCapital(w, r.id, firmAccount(f.id), cost)
  f.projects.push({ remaining: P.constructionMonths, capital: amount, cost })
  merchant.investment += cost
  return cost
}
/** Fund capital before public hiring and residential construction consume all
 * remaining workers and materials. Every project still pays wages and inputs. */
export function investProductiveCapital(w: World) {
  if (!decisionPolicy().renewal) return
  for (const r of economicRegions(w)) for (const f of regionalFirms(w, r.id)) if (f.active) invest(w, r, f)
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
        Math.max(0, f.profit) * collectedTaxRate(w, r) * (1 - reserveTaxRelief(w, r, f)),
        'enterprise profit tax',
      )
      if (r.nation >= 0) w.nations[r.nation].income += f.taxes
      const owners = f.owners ?? { [householdAccount(r.id, 'owner')]: 1 },
        shares = Object.values(owners).reduce((a, b) => a + b, 0)
      // Retain a six-month operating buffer and funded construction plans.
      // Idle cash above that buffer returns to owners; otherwise a tiny rural
      // economy can drain all household purchasing power into dormant firms.
      const operatingBuffer =
        ((f.payroll + f.purchases + f.interest) * 6) / simulationMonths() +
        f.projects.reduce((sum, project) => sum + project.cost, 0)
      const distribution =
        Math.max(0, f.profit - f.taxes) * 0.45 + Math.max(0, f.cash - operatingBuffer) * periodRate(0.04)
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
        if (owner.startsWith('government:')) {
          w.nations[+unit].income += dividend
          w.nations[+unit].enterpriseIncome = (w.nations[+unit].enterpriseIncome ?? 0) + dividend
        }
      }
      f.distress =
        (f.desiredEmployment > 1 && f.employment < f.desiredEmployment * 0.05) ||
        (f.cash < Math.max(0.01, f.payroll) && f.profit < 0)
          ? f.distress + simulationMonths()
          : Math.max(0, f.distress - simulationMonths())
      f.markup = clamp(f.markup + (inventoryValue > expectedSales * 2 ? -0.002 : 0.001), 0.04, 0.3)
      if (!decisionPolicy().renewal) invest(w, r, f)
      // Unsold inventories spoil physically and reduce operating surplus; financial defaults do not erase goods.
      for (const g of GOODS) {
        const loss = f.stocks[g] * periodRate(g === 'food' ? 0.035 : 0.001)
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
      (crossedPeriodMonth(w.month, r.id % 12, 12) || (w.localEconomy && !firms.some((f) => f.active))) &&
      population(r) > expansionParameters().enterprisePopulation
    ) {
      const active = firms.filter((f) => f.active)
      let slot = firms.find((f) => !f.active)
      const target = w.localEconomy
        ? Math.min(24, Math.max(2, Math.ceil(Math.sqrt(population(r) / 15000))))
        : 3
      const owner = householdAccount(r.id, 'owner'),
        // Tiny camps need a small farm or workshop. Full towns retain the
        // ordinary operating-capital floor; cheap entry everywhere would
        // drain their civic savings into undercapitalized competitors.
        seed = Math.max(
          expansionParameters().enterpriseEquity,
          Math.min(1, (population(r) / 500) ** 2),
          population(r) * 0.00015,
        )
      if (!slot && w.localEconomy && active.length < target && balance(w, owner) >= seed * 2) {
        slot = newFirm(w, r, e.firms!.length)
        e.firms!.push(slot)
      }
      if (slot && active.length < target && balance(w, owner) >= seed * 2) {
        slot.active = true
        slot.owners = { [owner]: 1 }
        delete slot.activity
        slot.generation++
        // Delete absent optional state: an own undefined property disappears in
        // JSON and would change insertion order on the next paid labor record.
        delete slot.labor
        slot.distress = 0
        slot.profit = 0
        slot.wage = merchant.wage
        slot.markup = 0.1
        slot.productivity = 0.95 + (hashSeed(`${w.seed}:${slot.id}:${slot.generation}`) % 200) / 1000
        for (const g of GOODS) {
          slot.prices[g] = Math.max(0.01, r.prices[g] / (1 + retailMarkup(w, r, g)))
          slot.forecast[g] = marketNeed(r, g) / 3
        }
        transfer(w, owner, firmAccount(slot.id), seed, 'entrepreneur equity subscription')
        e.firmEntries = (e.firmEntries ?? 0) + 1
      }
    }
    r.industry = merchant.capital + firms.reduce((s, f) => s + f.capital, 0)
  }
}
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
