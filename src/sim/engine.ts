/** Monthly orchestration: local books and cohorts settle before provincial political
 * decisions; synchronization at those boundaries carries changes in both directions. */
import { ensureAdaptiveWorld, rebuildAdaptiveMesh, refreshAdaptiveTotals, syncSites } from './adaptive-world'
import { agreementTerms } from './agreements'
import { advanceAgriculturalInvestment, completeFarmProjects } from './agriculture'
import { advanceAlmanac } from './almanac'
import { reportedExpansionInterests } from './ambitions'
import { withLoanOriginationBatch } from './banking'
import { ensureBuildingLots } from './building-lots'
import { advanceCharacters, characterPolicyTargets, characterResearch } from './character'
import { advanceSettlements, evolveCities, refreshCityLabels } from './cities'
import { competitivePressure } from './competitive-pressure'
import { withWorldConfiguration } from './configuration'
import { decisionPolicy } from './decision-policy'
import { advanceDevelopment, recordDevelopment } from './development'
import { advanceDiplomaticOffices } from './diplomatic-friction'
import { aggregateDistricts, ensureDistrictEconomy, linkDistrictPeople, refreshEndowment } from './districts'
import { advanceDomesticPolicy } from './domestic-policy'
import { consume, produce, trade } from './economy'
import { effectMultiplier, effectValue } from './effects'
import { expansionParameters } from './expansion-parameters'
import { retireEmptyStates } from './extinction'
import { ensureFirms, investProductiveCapital } from './firms'
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
import { advanceInstitutions, allocateProvincialTaxes, foreignPolicyMandate } from './institutions'
import { advanceIntelligence, perceivedPower } from './intelligence'
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
import { recruit } from './recruitment'
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
    n.stability = clamp(
      n.stability + (happy * 80 + n.legitimacy * 0.2 - n.stability) * 0.05 - (n.debt > n.gdp * 24 ? 0.3 : 0),
      5,
      99,
    )
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
        n.researchFocus = characterResearch(n)
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
    if (w.statecraft || w.month % 3 !== 0) continue
    const commerce = (a.character!.effective.commercialism + b.character!.effective.commercialism) / 2
    const patience = (a.character!.effective.patience + b.character!.effective.patience) / 2
    if (a.ai && b.ai && rel.opinion > 35 && rel.treaty === 'neutral' && random(w) < 0.05 + commerce * 0.2) {
      rel.treaty = 'trade'
      rel.since = w.month
      event(
        w,
        'diplomacy',
        `${a.shortName}–${b.shortName} trade accord`,
        'The two states remove tariff friction from cross-border shipments.',
        a.id,
      )
    }
    if (a.ai && b.ai && rel.opinion > 68 && rel.treaty === 'trade' && random(w) < 0.025 + patience * 0.08) {
      rel.treaty = 'alliance'
      rel.since = w.month
      event(
        w,
        'diplomacy',
        `${a.shortName} and ${b.shortName} form an alliance`,
        'Mutual military access is granted. Relations and commerce reinforce the pact.',
        a.id,
      )
    }
    const aggressor = [a, b]
      .filter((n) => n.ai && n.character!.effective.assertiveness > 0.62)
      .sort((a, b) => b.character!.effective.assertiveness - a.character!.effective.assertiveness)[0]
    const militaryDrive = expansionParameters().militaryDrive
    const rival = aggressor?.id === a.id ? b : a
    const pressure = aggressor && militaryDrive > 0 ? competitivePressure(w, aggressor) : undefined
    const interests =
      aggressor && militaryDrive > 0 ? reportedExpansionInterests(w, aggressor, rival.id) : undefined
    const initiative = militaryDrive * ((pressure?.peer ?? 0) + (interests?.economic ?? 0))
    const capable =
      !aggressor ||
      !militaryDrive ||
      (aggressor.foodCoverage >= 0.8 &&
        perceivedPower(w, aggressor.id, aggressor.id) >=
          Math.max(100, perceivedPower(w, aggressor.id, rival.id) * 0.8))
    if (
      aggressor?.ai &&
      capable &&
      foreignPolicyMandate(w, aggressor.id, [aggressor.id]) &&
      rel.treaty === 'neutral' &&
      territory.bordering(a.id, b.id) &&
      random(w) <
        ((rel.opinion < 0 ? 0.09 : 0.02) + initiative * 0.08) *
          aggressor.character!.effective.assertiveness &&
      aggressor.stability > 50
    ) {
      rel.treaty = 'war'
      rel.aggressor = aggressor.id
      rel.since = w.month
      rel.opinion = -75
      rel.warExhaustion = 0
      event(
        w,
        'war',
        `${a.shortName} and ${b.shortName} go to war`,
        'Borders close to commerce. Armies mobilize, drawing food, equipment, and recruits from the civilian economy.',
        aggressor.id,
      )
    }
  }
  for (const n of w.nations)
    if (!decisionPolicy().agriculture && !w.statecraft && n.ai && territory.alive(n.id)) {
      if (w.month % 6 === 0) {
        const targets = characterPolicyTargets(n)
        for (const key of [
          'tax',
          'welfare',
          'education',
          'military',
          'research',
          'tariff',
          'conscription',
        ] as const)
          n.policies[key] += clamp(
            targets[key] - n.policies[key],
            key === 'conscription' ? -0.2 : -2,
            key === 'conscription' ? 0.2 : 2,
          )
        n.policies.priority =
          n.foodCoverage < 0.97
            ? 'agriculture'
            : w.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war')
              ? 'military'
              : n.character!.effective.commercialism > 0.6
                ? 'industry'
                : 'balanced'
        if (n.treasury < 1000) n.policies.tax = clamp(n.policies.tax + 1, 10, 38)
        if (n.stability < 45) n.policies.welfare = clamp(n.policies.welfare + 3, 0, 80)
        const fighting = w.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war')
        if (fighting && w.armies.filter((a) => a.nation === n.id).length < 4 && n.treasury > 1200)
          recruit(w, n, w.regions[n.capital])
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
  w.month += simulationMonths()
  advanceMilitaryInfluence(w)
  w.totals.births = 0
  w.totals.deaths = 0
  w.totals.migration = 0
  ensureWarfare(w)
  beginPopulationMonth(w)
  beginEconomyMonth(w)
  completeFarmProjects(w)
  retireEmptyStates(w)
  arriveFreight(w)
  aggregateDistricts(w)
  worldEvents(w)
  advanceHistory(w)
  advancePressures(w)
  advanceCharacters(w)
  if (w.statecraft) advanceStatecraft(w)
  if (decisionPolicy().agriculture) advanceDomesticPolicy(w)
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
  summarize(w)
  // Saves may occur between coarse substeps; their physical settlement census must be current.
  refreshSpatial(w)
  advanceAlmanac(w)
  return w
}
