import { advanceDynasties } from './dynasties'
import { advanceDependencies } from './state-dependencies'
import { recordWorldArchive } from './world-archive'
import { reconcileInstitutions } from './institution-lifecycle'
/** Monthly orchestration: local books and cohorts settle before provincial political
 * decisions; synchronization at those boundaries carries changes in both directions. */
import { ensureAdaptiveWorld, rebuildAdaptiveMesh, refreshAdaptiveTotals, syncSites } from './adaptive-world'
import { agreementTerms } from './agreements'
import { advanceAgriculturalInvestment, completeFarmProjects } from './agriculture'
import { advanceAlmanac } from './almanac'
import { withLoanOriginationBatch } from './banking'
import { ensureBuildingLots } from './building-lots'
import { advanceCharacters } from './character'
import { advanceSettlements, evolveCities, refreshCityLabels } from './cities'
import { withWorldConfiguration } from './configuration'
import { decisionPolicy } from './decision-policy'
import { advanceCabinet } from './cabinet-ai'
import { cabinetResearchFocus } from './cabinet-policy'
import { cabinetOrderReserved } from './cabinet-state'
import { advanceDevelopment, recordDevelopment } from './development'
import { advanceDiplomaticOffices } from './diplomatic-friction'
import { aggregateDistricts, ensureDistrictEconomy, linkDistrictPeople, refreshEndowment } from './districts'
import { advanceDomesticPolicy } from './domestic-policy'
import { consume, produce, trade } from './economy'
import { effectMultiplier, effectValue } from './effects'
import { retireEmptyStates } from './extinction'
import { ensureFirms, investProductiveCapital } from './firms'
import { nextFiscalStability } from './fiscal-stability'
import { militaryPeople } from './forces'
import { advanceFounding } from './founding'
import { arriveFreight } from './freight-transit'
import { advanceFrontierPolitics } from './frontier-politics'
import { advanceGeopolitics } from './geopolitics'
import { governance } from './governance'
import { advanceHarbors } from './harbors'
import { advanceHistory } from './history'
import { beginPopulationMonth, evolveIdentities } from './identities'
import { advanceMilitaryInfluence, advanceTradeInfluence } from './influence'
import { advanceInstitutions, allocateProvincialTaxes } from './institutions'
import { advanceIntelligence } from './intelligence'
import { reconcileJurisdictionSovereignty, reviewAdministration } from './jurisdictions'
import { advanceLandUse } from './land-use'
import { withBatchedLedgerEntries } from './ledger'
import { economicRegions, provinceId } from './local-units'
import { beginEconomyMonth, finishEconomyMonth, fundGovernment } from './macroeconomy'
import { advanceArmies } from './military'
import { reinforceArmies } from './military-personnel'
import { MODEL_PARAMETERS } from './model-parameters'
import { advanceNavy, ensureWarfare } from './navy'
import {
  advanceEconomicStrata,
  ageMilitaryPopulation,
  ensurePopulation,
  migrateCommunities,
  populationTension,
  updateCommunityDemography,
} from './population'
import { advancePressures } from './pressures'
import { advanceProductiveInvestment } from './productive-investment'
import { nationalRealService, realService } from './public-services'
import { random } from './random'
import { TECH_NAMES, researchCost } from './research'
import { ensureResidentialSites, syncResidentialPopulation } from './residential-sites'
import { reconcileRiverLanes } from './river-lanes'
import { settlementAccess } from './settlement-access'
import { event } from './simulation-events'
import {
  crossedPeriodMonth,
  periodFlow,
  periodRate,
  simulationMonths,
  withSimulationPeriod,
} from './simulation-period'
import { advanceSovereignty } from './sovereignty'
import { refreshSpatial } from './spatial'
import { advanceStatecraft } from './statecraft'
import { reconcileMountainTerrain } from './terrain-migration'
import { absorbUnclaimedEnclaves } from './territorial-expansion'
import { territorialIndex } from './territory-index'
import { type World, FIELDS, clamp, population } from './types'
import { urbanOpportunityByDistrict } from './urban-demography'
import { summarize } from './world-summary'
export { bordering, nationRegions } from './territory-index'

export { applyCommand } from './commands'

export { summarize } from './world-summary'

export { TECH_NAMES, researchCost } from './research'

export { event } from './simulation-events'

function fiscalPolicy(w: World) {
  const territory = territorialIndex(w)
  for (const n of w.nations) n.income -= allocateProvincialTaxes(w, n.id, n.income)
  fundGovernment(w)
  for (const n of w.nations) {
    const regions = territory.regions(n.id)
    n.population = regions.reduce((s, r) => s + population(r), 0) + militaryPeople(w, n.id)
    n.gdp = regions.reduce((s, r) => s + r.gdp, 0) / simulationMonths()
    if (!regions.length) {
      n.income = 0
      n.spending = 0
      continue
    }
    // Income was collected from wages and transactions, never minted from output.
    const civilians = regions.reduce((s, r) => s + population(r), 0)
    n.foodCoverage = regions.reduce((s, r) => s + r.foodCoverage * population(r), 0) / Math.max(1, civilians)
    n.manpower = regions.reduce((s, r) => s + r.population.adults * 0.08, 0)
    const happy = regions.reduce((s, r) => s + r.happiness * population(r), 0) / Math.max(1, civilians)
    n.stability = nextFiscalStability(n, happy)
  }
}

function demographics(w: World, coarse = false, mobilityMonths = 1) {
  ensurePopulation(w)
  const urbanOpportunity = urbanOpportunityByDistrict(w)
  for (const r of economicRegions(w)) {
    const n = governance(w, r.nation),
      pop = population(r)
    // Services are real output per 10,000 residents; response rates integrate monthly.
    const services =
      (realService(w, r, 'administration') / Math.max(1, pop / 10000)) *
      effectMultiplier(w, 'healthcare', n.id, r.id)
    const school =
      (realService(w, r, 'education') / Math.max(1, pop / 10000)) *
      effectMultiplier(w, 'education', n.id, r.id)
    const healthTarget = clamp(
      0.44 +
        services * 0.014 +
        n.technologies.medicine * 0.05 +
        r.foodCoverage * 0.2 -
        r.devastation * 0.35 -
        (1 - (r.materialCoverage ?? 1)) * 0.06,
    )
    r.health = clamp(r.health + (healthTarget - r.health) * periodRate(0.035))
    r.literacy = clamp(
      r.literacy +
        school * periodRate(0.0003) * (1 - r.literacy) +
        periodFlow(n.technologies.governance * 0.00003),
      0,
      0.99,
    )
    // Transfers are monthly crowns per resident, deflated by the 14-crown food
    // reference price. The 0.24 cap bounds their contribution to a unit happiness score.
    const happinessTarget = clamp(
      0.6 +
        Math.min(
          0.24,
          ((Object.values(w.economy!.households[r.id]).reduce((sum, h) => sum + h.transfers, 0) /
            Math.max(1, pop) /
            simulationMonths()) *
            100 *
            14) /
            Math.max(0.01, r.prices.food),
        ) -
        Math.max(0, n.policies.tax - 20) * 0.006 +
        r.health * 0.2 -
        (1 - r.foodCoverage) * 0.55 -
        r.devastation * 0.4 -
        (1 - (r.materialCoverage ?? 1)) * 0.14 -
        n.policies.conscription * 0.012,
    )
    r.happiness = clamp(r.happiness + (happinessTarget - r.happiness) * periodRate(0.09))
    r.unrest = clamp(
      r.unrest +
        ((1 - r.happiness) * 65 +
          populationTension(w, r) -
          effectValue(w, 'cohesion', n.id, r.id) * 15 +
          r.devastation * 35 -
          r.unrest) *
          periodRate(0.06),
      0,
      100,
    )
    updateCommunityDemography(w, r, urbanOpportunity?.get(r.id))
    const investment = realService(w, r, 'infrastructure') / Math.max(1, pop / 10000)
    r.infrastructure = clamp(
      r.infrastructure +
        periodFlow(investment * MODEL_PARAMETERS.infrastructureServiceProductivity) -
        r.infrastructure * periodRate(MODEL_PARAMETERS.infrastructureWearMonthly) -
        periodFlow(r.devastation * 0.0007),
      w.settlementStart === 'frontier' ? 0 : 0.08,
      1.5,
    )
    if (!w.adaptive) r.urban = clamp(r.urban + (r.industry * 0.5 - r.urban) * periodRate(0.001), 0.03, 0.92)
    r.devastation = clamp(r.devastation - periodFlow(0.008))
    if (r.foodCoverage < 0.75 && crossedPeriodMonth(w.month, r.id % 6, 6) && pop > 1000)
      event(
        w,
        'population',
        `Food shortage in ${r.name}`,
        `Households receive ${Math.round(r.foodCoverage * 100)}% of their food requirement. Mortality and migration are rising.`,
        r.nation,
        provinceId(r),
      )
  }
  aggregateDistricts(w)
  ageMilitaryPopulation(w)
  linkDistrictPeople(w)
  if (!coarse || simulationMonths() > 1) {
    migrateCommunities(w, coarse ? simulationMonths() : mobilityMonths, coarse)
    advanceEconomicStrata(w, coarse ? simulationMonths() : mobilityMonths)
  }
  aggregateDistricts(w)
  // Identity evolution rewrites provincial communities. Coarse one-month steps
  // skip it, so the immediately preceding aggregation already settled both views.
  if (!coarse || simulationMonths() > 1) {
    evolveIdentities(w)
    linkDistrictPeople(w)
    aggregateDistricts(w)
  }
}

function science(w: World) {
  const territory = territorialIndex(w)
  for (const n of w.nations) {
    const regions = territory.regions(n.id)
    if (!regions.length) continue
    const literacy = regions.reduce((s, r) => s + r.literacy, 0) / regions.length
    const focus = n.researchFocus,
      level = n.technologies[focus]
    if (level >= 6) {
      if (n.ai) n.researchFocus = FIELDS.find((f) => n.technologies[f] < 6) ?? focus
      continue
    }
    n.researchProgress[focus] +=
      periodFlow(
        nationalRealService(w, n.id, 'research') * (decisionPolicy().development ? 0.01 / 0.0015 : 1 / 7),
      ) *
      (0.35 + literacy) *
      (1 + n.technologies.governance * 0.07) *
      effectMultiplier(w, 'research', n.id)
    if (n.researchProgress[focus] >= researchCost(level)) {
      n.researchProgress[focus] -= researchCost(level)
      n.technologies[focus]++
      event(
        w,
        'research',
        `${n.shortName} discovers ${TECH_NAMES[focus][level]}`,
        `${focus[0].toUpperCase() + focus.slice(1)} advances to level ${level + 1}. The discovery now affects production, institutions, or survival.`,
        n.id,
      )
      if (n.ai) {
        if (!cabinetOrderReserved(w, n, 'research') || n.technologies[focus] >= 6)
          n.researchFocus = cabinetResearchFocus(w, n, regions)
      }
    }
  }
}

function diplomacy(w: World) {
  const territory = territorialIndex(w)
  const exchanges = new Set<string>()
  for (const route of w.routes)
    if (route.international) {
      const a = w.regions[route.from].nation,
        b = w.regions[route.to].nation
      exchanges.add(a < b ? `${a}:${b}` : `${b}:${a}`)
    }
  for (const rel of w.relations) {
    if (!territory.alive(rel.a) || !territory.alive(rel.b)) continue
    const a = w.nations[rel.a],
      b = w.nations[rel.b]
    const exchange =
      exchanges.has(a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`) ||
      exchanges.has(`${a.id}:${a.id}`) ||
      exchanges.has(`${b.id}:${b.id}`)
    rel.opinion = clamp(rel.opinion + (exchange ? 0.15 : -0.015) - rel.grievance * 0.001, -100, 100)
    rel.grievance = Math.max(0, rel.grievance - 0.08)
    if (rel.treaty === 'war') {
      rel.warExhaustion += periodFlow(0.7 + (2 - a.foodCoverage - b.foodCoverage) * 1.5)
      continue
    }
    if (rel.treaty === 'truce') {
      if (
        w.month - rel.since >= 60 &&
        !agreementTerms(w, 'peace').some(
          ({ term }) => [term.from, term.to].includes(a.id) && [term.from, term.to].includes(b.id),
        )
      )
        rel.treaty = 'neutral'
      continue
    }
  }
}

function worldEvents(w: World) {
  if (w.month % 12 === 0) {
    w.climate = 0.82 + random(w) * 0.34
    if (w.climate < 0.9)
      event(
        w,
        'economy',
        'A dry year begins',
        'Rainfall is below average. Harvests fall across the world; reserves and trade will determine which regions cope.',
      )
    else if (w.climate > 1.1)
      event(
        w,
        'economy',
        'Favorable growing conditions',
        'A wetter growing season improves harvests and replenishes food reserves.',
      )
  }
}

/** Establish physical land and the adaptive map before the first displayed month.
 * The same initialization is used by playback; observing a new world does not tick it. */
export function prepareSpatialWorld(w: World) {
  return withWorldConfiguration(w, () => prepareSpatialWorldConfigured(w))
}

function prepareSpatialWorldConfigured(w: World) {
  return withBatchedLedgerEntries(w, () => initializeSpatialWorld(w))
}

function initializeSpatialWorld(w: World) {
  ensurePopulation(w)
  const converting = !w.localEconomy
  const initializing = !w.adaptive || w.adaptive.residentialVersion !== 1
  ensureDistrictEconomy(w)
  if (converting) evolveCities(w, true)
  ensureAdaptiveWorld(w)
  ensureResidentialSites(w)
  const terrainChanged = reconcileMountainTerrain(w)
  const buildingsChanged = ensureBuildingLots(w)
  reconcileRiverLanes(w)
  syncResidentialPopulation(w)
  if (initializing || buildingsChanged || terrainChanged) {
    rebuildAdaptiveMesh(w)
    refreshCityLabels(w)
    refreshSpatial(w)
  }
}

/** One aggregate clearing and demographic integration, followed by physical reconciliation. */
export function advanceCoarsePeriod(w: World, months = 6): World {
  return withWorldConfiguration(w, () => advanceCoarsePeriodConfigured(w, months))
}

function advanceCoarsePeriodConfigured(w: World, months = 6): World {
  // Opening assets, inventories and cohorts are always initialized in monthly units.
  prepareSpatialWorld(w)
  ensureFirms(w)
  ensureWarfare(w)
  return withSimulationPeriod(months, () =>
    withBatchedLedgerEntries(w, () => advanceMonth(w, 'coarse', true)),
  )
}

export type TickDetail = 'monthly' | 'coarse' | 'reconcile'

export function tick(w: World, detail: TickDetail = 'monthly'): World {
  return withWorldConfiguration(w, () => tickConfigured(w, detail))
}

function tickConfigured(w: World, detail: TickDetail = 'monthly'): World {
  const resumeMonthly = detail === 'monthly' && !!w.fastForward?.phase
  const result = withBatchedLedgerEntries(w, () => advanceMonth(w, resumeMonthly ? 'reconcile' : detail))
  if (resumeMonthly) w.fastForward!.phase = 0
  return result
}

function advanceMonth(w: World, detail: TickDetail, prepared = false): World {
  const coarse = detail === 'coarse'
  if (!prepared) prepareSpatialWorld(w)
  if (!w.archive) recordWorldArchive(w)
  w.month += simulationMonths()
  advanceMilitaryInfluence(w)
  w.totals.births = 0
  w.totals.deaths = 0
  w.totals.migration = 0
  ensureWarfare(w)
  if (w.warfare!.raids) w.warfare!.raids = []
  beginPopulationMonth(w)
  beginEconomyMonth(w)
  completeFarmProjects(w)
  retireEmptyStates(w)
  arriveFreight(w)
  aggregateDistricts(w)
  worldEvents(w)
  advanceHistory(w)
  advancePressures(w)
  advanceDynasties(w)
  advanceCharacters(w)
  if (w.statecraft) advanceStatecraft(w)
  advanceCabinet(w)
  advanceDomesticPolicy(w)
  advanceDevelopment(w)
  linkDistrictPeople(w)
  for (const id of w.localEconomy!.active) refreshEndowment(w, w.localEconomy!.units[id], false)
  if (coarse) withLoanOriginationBatch(w, () => produce(w, true))
  else produce(w, false)
  aggregateDistricts(w)
  advanceNavy(w)
  if (coarse) withLoanOriginationBatch(w, () => trade(w))
  else trade(w)
  advanceHarbors(w)
  advanceTradeInfluence(w)
  if (decisionPolicy().agriculture) advanceAgriculturalInvestment(w)
  advanceProductiveInvestment(w)
  investProductiveCapital(w)
  fiscalPolicy(w)
  if (decisionPolicy().realCosts) {
    advanceArmies(w)
    reinforceArmies(w)
    advanceFounding(w)
  }
  consume(w)
  aggregateDistricts(w)
  advanceDiplomaticOffices(w)
  advanceInstitutions(w)
  advanceIntelligence(w)
  advanceGeopolitics(w)
  linkDistrictPeople(w)
  demographics(w, coarse, detail === 'reconcile' ? (w.fastForward?.phase ?? 0) + 1 : 1)
  retireEmptyStates(w)
  science(w)
  diplomacy(w)
  if (!decisionPolicy().realCosts) {
    advanceArmies(w)
    reinforceArmies(w)
  }
  advanceSovereignty(w)
  advanceDependencies(w)
  // Enclosed land has no accession waiting period or independent charter race.
  absorbUnclaimedEnclaves(w)
  advanceFrontierPolitics(w)
  linkDistrictPeople(w)
  reconcileJurisdictionSovereignty(w)
  reviewAdministration(w)
  syncResidentialPopulation(w)
  syncSites(w)
  refreshAdaptiveTotals(w)
  const access = settlementAccess(w, coarse)
  // Max retains aggregate housing demand even during its periodic plot review.
  advanceLandUse(w, access, coarse, detail !== 'monthly')
  if (!decisionPolicy().realCosts) advanceFounding(w)
  if (absorbUnclaimedEnclaves(w)) reconcileJurisdictionSovereignty(w)
  refreshAdaptiveTotals(w)
  finishEconomyMonth(w)
  recordDevelopment(w)
  if (w.adaptive?.transit)
    w.adaptive.transit = w.adaptive.transit.filter((s) => Object.values(s.goods).some((q) => q > 0))
  advanceSettlements(
    w,
    false,
    access,
    coarse ? 0 : detail === 'reconcile' ? (w.fastForward?.phase ?? 0) + 1 : 1,
  )
  refreshCityLabels(w)
  aggregateDistricts(w)
  syncSites(w)
  if (!coarse && (w.month % 6 === 0 || detail === 'reconcile')) rebuildAdaptiveMesh(w)
  else refreshAdaptiveTotals(w)
  reconcileInstitutions(w)
  summarize(w)
  // Saves may occur between coarse substeps; their physical settlement census must be current.
  refreshSpatial(w)
  advanceAlmanac(w)
  recordWorldArchive(w)
  return w
}
