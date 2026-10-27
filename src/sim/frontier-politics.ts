import { localImpression } from './influence'
import { makeNation } from './generate'
import { advanceAlmanac } from './almanac'
import { ensureSovereignty } from './sovereignty'
import { ensurePopulation } from './population'
import { ensureCharacters } from './character'
import { ensureHistory } from './history'
import { ensureIntelligence } from './intelligence'
import { ensureWarfare } from './navy'
import { ensureStatecraft } from './statecraft'
import { landComponents } from './land-connectivity'
import { economicRegions } from './local-units'
import { STRATA } from './economic-types'
import { householdAccount, governmentAccount, transfer } from './ledger'
import { claimIndependentProvince, culturalAffinity } from './territorial-expansion'
import { recordWorldEvent } from './event-memory'
import { simulationMonths } from './simulation-period'
import { MAX_STATE_IDENTITIES, clamp, population, type Nation, type Region, type World } from './types'
import type { City } from './district-types'

/** Synthetic model thresholds, in elapsed months and existing household money. */
export const FRONTIER_POLITICS = {
  accessionMonths: 120,
  mandateMonths: 36,
  influence: 0.55,
  prosperityMonths: 60,
  cityPopulation: 500,
  wealthPerPerson: 0.012,
  contribution: 0.1,
} as const

export interface FrontierProgress {
  region: number
  since: number
  updated: number
  nation: number
  influence: number
  mandate: number
  prosperity: number
  city: number | null
}

const atWar = (w: World, id: number) =>
  w.relations.some((r) => r.treaty === 'war' && (r.a === id || r.b === id))
const solventGovernment = (w: World, n: Nation) =>
  n.stability >= 45 && n.legitimacy >= 45 && n.foodCoverage >= 0.7 && n.treasury >= 0 && !atWar(w, n.id)

function householdFunds(w: World, units: Region[]) {
  return units.reduce(
    (sum, unit) =>
      sum + STRATA.reduce((cash, stratum) => cash + (w.economy?.households[unit.id]?.[stratum].cash ?? 0), 0),
    0,
  )
}

/** A sovereign city begins with its province, the simulation's territorial unit.
 * Its treasury is a contribution from local households, never an opening grant. */
function establishCityState(w: World, region: Region, city: City, units: Region[], capital: number) {
  const nation = makeNation(w.nations.length, region.id)
  nation.name = `Free City of ${city.name}`.slice(0, 180)
  nation.shortName = city.name.slice(0, 80)
  nation.government = 'Republic'
  nation.personality = 'mercantile'
  nation.researchFocus = 'logistics'
  nation.treasury = 0
  nation.debt = 0
  nation.population = population(region)
  nation.gdp = region.gdp
  nation.foodCoverage = region.foodCoverage
  nation.stability = 65
  nation.legitimacy = 75
  nation.policies.citizenship = 'civic'
  nation.policies.languagePolicy = 'multilingual'
  nation.policies.beliefPolicy = 'protected'
  w.nations.push(nation)
  for (const other of w.nations.slice(0, -1))
    w.relations.push({
      a: other.id,
      b: nation.id,
      opinion: 0,
      treaty: 'neutral',
      since: w.month,
      warExhaustion: 0,
      grievance: 0,
    })
  // Register the account before transferring deposits; banking and ledger rules apply.
  const fraction = capital / householdFunds(w, units)
  for (const unit of units)
    for (const stratum of STRATA) {
      const cash = w.economy!.households[unit.id][stratum].cash
      transfer(
        w,
        householdAccount(unit.id, stratum),
        governmentAccount(nation.id),
        cash * fraction,
        'independent city charter contribution',
      )
    }
  claimIndependentProvince(w, region, nation.id, true)
  ensurePopulation(w)
  ensureCharacters(w)
  ensureHistory(w)
  ensureWarfare(w)
  ensureIntelligence(w)
  if (w.statecraft) ensureStatecraft(w)
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: w.month,
    type: 'world',
    nation: nation.id,
    region: region.id,
    title: `${city.name} establishes an independent state`,
    detail:
      'Years of urban prosperity allow the local council to establish a sovereign government. Residents fund its treasury from their own savings; the city and its surrounding province now participate in ordinary diplomacy, trade and territorial politics.',
  })
}

/** Accumulated local ties compete with independent urban state formation.
 * Opening ownership is used for the whole pass, so a chain cannot annex itself
 * in one month. Empty wilderness has no residents able to consent to accession. */
export function advanceFrontierPolitics(w: World) {
  const independent = w.regions.filter((r) => r.nation === -1)
  if (!independent.length) {
    if (w.sovereignty?.frontiers) w.sovereignty.frontiers = []
    return
  }
  ensurePopulation(w)
  const state = ensureSovereignty(w)
  const prior = new Map((state.frontiers ?? []).map((r) => [r.region, r]))
  const units = w.regions.map(() => [] as Region[])
  let totalMoney = 0,
    totalPeople = 0
  for (const unit of economicRegions(w)) {
    units[unit.province ?? unit.id].push(unit)
    // Frontier prosperity is relative to other independent communities;
    // a state's opening treasury is not private wealth available to a free city.
    if (unit.nation === -1) {
      totalPeople += population(unit)
      totalMoney += householdFunds(w, [unit])
    }
  }
  const cities = new Map<number, City>()
  for (const city of w.localEconomy?.cities ?? []) {
    const province = w.cells[city.nucleus].region
    if (city.absorbedBy !== undefined || w.regions[province].nation !== -1) continue
    if (city.population > (cities.get(province)?.population ?? 0)) cities.set(province, city)
  }
  const trade = new Map<string, number>()
  for (const route of w.routes) {
    for (const [from, to] of [
      [route.from, route.to],
      [route.to, route.from],
    ]) {
      const nation = w.regions[to].nation
      if (w.regions[from].nation !== -1 || nation < 0) continue
      const key = `${from}:${nation}`
      trade.set(key, (trade.get(key) ?? 0) + route.volume / simulationMonths())
    }
  }
  for (const contact of w.influence?.trade ?? []) {
    const nation = w.regions[contact.to].nation
    if (w.regions[contact.from].nation !== -1 || nation < 0) continue
    const key = `${contact.from}:${nation}`
    trade.set(key, (trade.get(key) ?? 0) + contact.strength * population(w.regions[contact.from]) * 0.026)
  }
  const components = landComponents(w)
  const pending: { region: Region; nation: number; city?: City; capital?: number }[] = []
  state.frontiers = []
  for (const r of independent) {
    const progress: FrontierProgress = prior.get(r.id) ?? {
      region: r.id,
      since: Math.max(0, w.month - simulationMonths()),
      updated: Math.max(0, w.month - simulationMonths()),
      nation: -1,
      influence: 0,
      mandate: 0,
      prosperity: 0,
      city: null,
    }
    state.frontiers.push(progress)
    const elapsed = Math.max(0, Math.min(simulationMonths(), w.month - progress.updated))
    if (!elapsed) continue
    progress.updated = w.month
    const people = population(r)
    const candidates = new Map<number, number>()
    for (const id of r.neighbors) {
      const neighbor = w.regions[id],
        n = w.nations[neighbor.nation]
      if (
        !n ||
        !solventGovernment(w, n) ||
        !population(neighbor) ||
        components[r.center] < 0 ||
        components[r.center] !== components[neighbor.center]
      )
        continue
      const affinity = culturalAffinity(n, r)
      const relativeOutput = clamp(
        (neighbor.gdp / Math.max(1, population(neighbor)) - r.gdp / Math.max(1, people)) / 0.02,
        -1,
        1,
      )
      const commerce = clamp((trade.get(`${r.id}:${n.id}`) ?? 0) / Math.max(1, people * 0.026))
      const security = (n.stability + n.legitimacy) / 200
      const access = clamp((r.infrastructure + neighbor.infrastructure) / 2)
      const exclusion = n.policies.citizenship === 'heritage' ? (1 - affinity) * 0.25 : 0
      const appeal = clamp(
        0.4 +
          affinity * 0.3 +
          security * 0.24 +
          relativeOutput * 0.12 +
          commerce * 0.14 +
          access * 0.1 -
          (n.policies.tax / 100) * 0.12 -
          exclusion -
          (localImpression(w, r.id, n.id)?.opposition ?? 0) * 0.45,
      )
      candidates.set(n.id, Math.max(candidates.get(n.id) ?? 0, appeal))
    }
    const ranked = [...candidates].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    const best = ranked[0]
    const candidate = best?.[0] ?? -1
    if (progress.nation !== candidate) {
      progress.nation = candidate
      progress.since = w.month - elapsed
      progress.influence = 0
      progress.mandate = 0
    }
    // Rival states with comparable appeal prevent automatic winner-takes-all accession.
    const target = best ? clamp(best[1] - (ranked[1]?.[1] ?? 0) * 0.45) : 0
    progress.influence += (target - progress.influence) * (1 - 0.985 ** elapsed)
    progress.mandate =
      people > 0 && progress.influence >= FRONTIER_POLITICS.influence
        ? progress.mandate + elapsed
        : Math.max(0, progress.mandate - elapsed * 2)

    const city = cities.get(r.id)
    const cash = householdFunds(w, units[r.id])
    const peerWealth = Math.max(0, totalMoney - cash) / Math.max(1, totalPeople - people)
    const capital = Math.max(1, (city?.population ?? 0) * 0.001)
    const wealthy =
      city &&
      city.population >= FRONTIER_POLITICS.cityPopulation &&
      city.population >= people * 0.5 &&
      cash / Math.max(1, people) >= Math.max(FRONTIER_POLITICS.wealthPerPerson, peerWealth * 2) &&
      cash * FRONTIER_POLITICS.contribution >= capital
    if (progress.city !== (city?.id ?? null)) {
      progress.city = city?.id ?? null
      progress.prosperity = 0
    }
    // Wealth records the long build-up. A single poor harvest does not erase
    // years of civic organization; food and order are checked when chartering.
    progress.prosperity = wealthy ? progress.prosperity + elapsed : Math.max(0, progress.prosperity - elapsed)
    if (
      wealthy &&
      r.foodCoverage >= 0.85 &&
      r.unrest < 40 &&
      progress.prosperity >= FRONTIER_POLITICS.prosperityMonths &&
      w.nations.length + pending.filter((p) => !!p.city).length < MAX_STATE_IDENTITIES
    ) {
      pending.push({ region: r, nation: -1, city, capital })
    } else if (
      candidate >= 0 &&
      people > 0 &&
      progress.mandate >= FRONTIER_POLITICS.mandateMonths &&
      w.month - progress.since >= FRONTIER_POLITICS.accessionMonths
    ) {
      pending.push({ region: r, nation: candidate })
    }
  }
  for (const transition of pending) {
    const { region, nation, city, capital } = transition
    if (city) establishCityState(w, region, city, units[region.id], capital!)
    else {
      claimIndependentProvince(w, region, nation, true)
      recordWorldEvent(w, {
        id: w.nextEvent++,
        month: w.month,
        type: 'world',
        nation,
        region: region.id,
        title: `${region.name} joins ${w.nations[nation].shortName}`,
        detail:
          'Sustained ties to a neighboring state and years of local support lead independent communities to accept its government. Residents retain their cultures, languages, homes and property.',
      })
    }
  }
  state.frontiers = state.frontiers.filter((p) => w.regions[p.region].nation === -1)
  if (pending.length) advanceAlmanac(w, true)
}
