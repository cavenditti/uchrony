import { advanceIdentityImplementation } from './identity-implementation'
import { resolveIdentityPolicy } from './identity-policy'
import {
  COMMUNITY_POLITICAL_FIELDS,
  initializeCommunityPolitics,
  evaluateIdentityPolicy,
  evolveCommunityPolitics,
} from './identity-politics'
/** Joint identity communities own dated cohorts; province/district views share those holders.
 * Seeding and demography live here; mobility and personnel transfers have separate boundaries. */
import { cohortBirths, cohortDeaths, ensureAges, extractAges, mergeAges } from './age-cohorts'
import { apportion } from './allocation'
import { STRATA, type EconomicStratum } from './economic-types'
import { BASE_PRICE, householdNeed } from './economy'
import { effectMultiplier } from './effects'
import { allForces } from './forces'
import { governance } from './governance'
import { identityHomelands } from './identity-geography'
import { stratumPeople } from './ledger'
import { cloneCommunity } from './population-clone'
import type {
  AgeCohort,
  Cohorts,
  IdentityAxis,
  IdentityDefinition,
  PopulationCommunity,
  PopulationDynamics,
} from './population-types'
import { realService } from './public-services'
import { hashSeed } from './random'
import { periodFlow, periodRate } from './simulation-period'
import { clamp, GOODS, population, type Region, type World } from './types'
export { apportion } from './allocation'
export { advanceEconomicStrata, migrateCommunities, splitCommunity } from './population-mobility'
export {
  ageMilitaryPopulation,
  releaseSoldiers,
  removeCivilianAdults,
  removeSoldiers,
  returnArmyPeople,
  takeCivilianAdults,
} from './population-personnel'

export const AGES: AgeCohort[] = ['children', 'adults', 'elders']
const SOCIAL = [
  'health',
  'literacy',
  'wealth',
  'urban',
  'contentment',
  'loyalty',
  'grievance',
  'rootedness',
  'displacement',
  'fluency',
] as const
export const communitySize = (group: PopulationCommunity) =>
  group.population.children + group.population.adults + group.population.elders
/** One census pass supplies all household strata without repeating cohort scans. */
export function peopleByStratum(groups: readonly PopulationCommunity[]) {
  const counts = Object.fromEntries(STRATA.map((stratum) => [stratum, 0])) as Record<EconomicStratum, number>
  for (const group of groups) counts[group.stratum ?? 'laborer'] += communitySize(group)
  return counts
}
type CommunityIdentity = Pick<
  PopulationCommunity,
  'culture' | 'language' | 'belief' | 'movement' | 'allegiance' | 'stratum' | 'locality'
>
const communityKeys = new WeakMap<PopulationCommunity, CommunityIdentity & { key: string }>()
export function communityKey(group: PopulationCommunity) {
  const previous = communityKeys.get(group)
  if (
    previous &&
    previous.culture === group.culture &&
    previous.language === group.language &&
    previous.belief === group.belief &&
    previous.movement === group.movement &&
    previous.allegiance === group.allegiance &&
    previous.stratum === group.stratum &&
    previous.locality === group.locality
  )
    return previous.key
  const key = `${group.culture}:${group.language}:${group.belief}:${group.movement}:${group.allegiance}:${group.stratum ?? 'laborer'}${group.locality === undefined ? '' : ':local:' + group.locality}`
  communityKeys.set(group, {
    culture: group.culture,
    language: group.language,
    belief: group.belief,
    movement: group.movement,
    allegiance: group.allegiance,
    stratum: group.stratum,
    locality: group.locality,
    key,
  })
  return key
}
export function emptyDynamics(): PopulationDynamics {
  return {
    immigrants: 0,
    emigrants: 0,
    refugees: 0,
    culturalChanges: 0,
    languageChanges: 0,
    beliefChanges: 0,
    politicalChanges: 0,
    diversity: 0,
    cohesion: 1,
    discrimination: 0,
    mixing: 0,
    isolation: 0,
    lastCulture: 0,
    lastLanguage: 0,
  }
}
export function registerIdentity(
  world: World,
  kind: IdentityAxis,
  name: string,
  origin: number,
  parents: number[] = [],
  orientation: IdentityDefinition['orientation'] = 'neutral',
) {
  const state = world.demography!,
    id = state.identities.length
  state.identities.push({
    id,
    kind,
    name: name.slice(0, 180),
    parents: [...new Set(parents)],
    origin,
    formed: world.month,
    language: -1,
    orientation,
    momentum: world.month ? 1 : 0,
  })
  return id
}
export function identityDistribution(groups: PopulationCommunity[], axis: IdentityAxis) {
  const counts = new Map<number, number>()
  for (const group of groups) {
    const size = communitySize(group)
    counts.set(group[axis], (counts.get(group[axis]) ?? 0) + size)
  }
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id - b.id)
}
export function rollupPopulation(region: Region) {
  region.communities = coalesceCommunities(region.communities!)
  let children = 0,
    adults = 0,
    elders = 0,
    health = 0,
    literacy = 0,
    urban = 0,
    contentment = 0
  for (const group of region.communities) {
    children += group.population.children
    adults += group.population.adults
    elders += group.population.elders
    const count = communitySize(group)
    health += group.health * count
    literacy += group.literacy * count
    urban += group.urban * count
    contentment += group.contentment * count
  }
  region.population.children = children
  region.population.adults = adults
  region.population.elders = elders
  const total = population(region)
  if (total) {
    region.health = health / total
    region.literacy = literacy / total
    region.urban = urban / total
    region.happiness = contentment / total
  }
}
export function communityIndex(groups: PopulationCommunity[]) {
  const index = new Map<string, PopulationCommunity>()
  for (const group of groups) if (!index.has(communityKey(group))) index.set(communityKey(group), group)
  return index
}
/** Political fields do not fragment census keys; equal communities merge their
 * population-weighted attitudes. Legacy absence remains valid until initialized. */
function mergePoliticalConditions(
  existing: PopulationCommunity,
  incoming: PopulationCommunity,
  size: number,
  count: number,
) {
  for (const key of COMMUNITY_POLITICAL_FIELDS) {
    if (existing[key] === undefined && incoming[key] === undefined) continue
    const fallback = key === 'languageTransmission' ? 1 : 0.5
    existing[key] =
      ((existing[key] ?? fallback) * size + (incoming[key] ?? fallback) * count) / (size + count)
  }
}
export function addCommunity(
  groups: PopulationCommunity[],
  incoming: PopulationCommunity,
  index?: Map<string, PopulationCommunity>,
) {
  const count = communitySize(incoming)
  if (!count) return
  const key = communityKey(incoming)
  const existing = index ? index.get(key) : groups.find((group) => communityKey(group) === key)
  if (!existing) {
    const added = cloneCommunity(incoming)
    groups.push(added)
    index?.set(key, added)
    return
  }
  const size = communitySize(existing)
  mergePoliticalConditions(existing, incoming, size, count)
  for (const field of SOCIAL)
    existing[field] = (existing[field] * size + incoming[field] * count) / (size + count)
  if (existing.ageCohorts || incoming.ageCohorts) mergeAges(existing, incoming)
  else for (const age of AGES) existing.population[age] += incoming.population[age]
}
/** Equal identities may converge after allegiance changes; combine their actual people and weighted conditions. */
export function coalesceCommunities(groups: PopulationCommunity[]) {
  if (groups.length < 2) return groups.filter((group) => communitySize(group) > 0)
  const indexed = new Map<string, PopulationCommunity>()
  for (const group of groups) {
    const count = communitySize(group)
    if (!count) continue
    const key = communityKey(group),
      existing = indexed.get(key)
    if (!existing) {
      indexed.set(key, group)
      continue
    }
    const size = communitySize(existing)
    mergePoliticalConditions(existing, group, size, count)
    for (const field of SOCIAL)
      existing[field] = (existing[field] * size + group[field] * count) / (size + count)
    if (existing.ageCohorts || group.ageCohorts) mergeAges(existing, group)
    else for (const age of AGES) existing.population[age] += group.population[age]
  }
  return [...indexed.values()]
}
function copyPopulation(group: PopulationCommunity, counts: Cohorts): PopulationCommunity {
  if (group.ageCohorts) return extractAges(cloneCommunity(group), counts)
  return { ...group, population: { ...counts } }
}
function seedGroup(
  region: Region,
  identity: { culture: number; language: number; belief: number; movement: number },
  counts: Cohorts,
): PopulationCommunity {
  return {
    ...identity,
    population: counts,
    allegiance: region.nation,
    host: region.nation,
    health: region.health,
    literacy: region.literacy,
    wealth: clamp(0.25 + region.industry * 0.2),
    urban: region.urban,
    contentment: region.happiness,
    loyalty: 0.65,
    grievance: 0.05,
    rootedness: 0.85,
    displacement: 0,
    knownLanguage: identity.language,
    fluency: 1,
  }
}
const preparedCensus = new WeakMap<World, number>()
export function ensurePopulation(world: World) {
  if (
    world.demography &&
    preparedCensus.get(world) === world.month &&
    world.nations.every((n) => !!n.identity) &&
    allForces(world).every((f) => !!f.communities)
  )
    return
  const initializing = !world.demography
  if (!world.demography) {
    world.demography = {
      version: 1,
      rng: hashSeed(`${world.seed}:population-identities`),
      identities: [],
      lastEvolution: world.month,
    }
    const { seeds, owner } = identityHomelands(world, world.demography)
    const languages = seeds.map((seed, index) =>
        registerIdentity(world, 'language', `${seed.name} speech`, seed.id, index < 3 ? [] : [index % 3]),
      ),
      cultures = seeds.map((seed, index) => {
        const id = registerIdentity(world, 'culture', `${seed.name} communities`, seed.id)
        world.demography!.identities[id].language = languages[index]
        return id
      }),
      beliefs = ['Hearth observances', 'River fellowship', 'Way of the open skies', 'Civic humanism'].map(
        (name, index) => registerIdentity(world, 'belief', name, seeds[index].id),
      ),
      movements = [
        ['Civic reform', 'reform'],
        ['Local assemblies', 'local'],
        ['Institutional continuity', 'institutional'],
        ['Mutual-aid associations', 'communal'],
        ['Merchant councils', 'commerce'],
      ].map(([name, orientation], index) =>
        registerIdentity(
          world,
          'movement',
          name,
          seeds[index % seeds.length].id,
          [],
          orientation as IdentityDefinition['orientation'],
        ),
      )
    const span = world.cells.reduce((max, cell) => Math.max(max, cell.x), 1)
    for (const region of world.regions) {
      const at = world.cells[region.center],
        first = owner[region.id],
        border = region.neighbors.filter((id) => owner[id] !== first).sort((a, b) => a - b),
        second = border.length ? owner[border[0]] : first,
        // Small border communities, not a large foreign minority in every province.
        minority = border.length ? 0.02 + (hashSeed(`${world.seed}:border:${region.id}`) % 201) / 10000 : 0,
        faith = Math.min(3, Math.floor((at.x / span) * 4)),
        shares = [0.9 - minority, minority, 0.1],
        counts = AGES.map((age) => apportion(region.population[age], shares)),
        primary = region.urban > 0.5 ? 0 : region.industry > 0.6 ? 4 : (region.id % 3) + 1
      region.communities = [
        seedGroup(
          region,
          {
            culture: cultures[first],
            language: languages[first],
            belief: beliefs[faith],
            movement: movements[primary],
          },
          { children: counts[0][0], adults: counts[1][0], elders: counts[2][0] },
        ),
        seedGroup(
          region,
          {
            culture: cultures[second],
            language: languages[second],
            belief: beliefs[faith],
            movement: movements[(primary + 1) % movements.length],
          },
          { children: counts[0][1], adults: counts[1][1], elders: counts[2][1] },
        ),
        seedGroup(
          region,
          {
            culture: cultures[first],
            language: languages[first],
            belief: beliefs[(faith + 1) % beliefs.length],
            movement: movements[3],
          },
          { children: counts[0][2], adults: counts[1][2], elders: counts[2][2] },
        ),
      ]
      region.populationDynamics = emptyDynamics()
    }
  }
  for (const nation of world.nations) {
    nation.policies.citizenship ??= 'civic'
    nation.policies.languagePolicy ??= 'multilingual'
    nation.policies.beliefPolicy ??= 'protected'
    Object.assign(nation.policies, resolveIdentityPolicy(nation.policies))
    if (!nation.identity) {
      const groups = world.regions
          .filter((region) => region.nation === nation.id)
          .flatMap((region) => region.communities ?? []),
        fallback = world.regions[nation.capital].communities!
      nation.identity = {
        culture:
          identityDistribution(groups.length ? groups : fallback, 'culture')[0]?.id ??
          world.demography!.identities.find((identity) => identity.kind === 'culture')!.id,
        language:
          identityDistribution(groups.length ? groups : fallback, 'language')[0]?.id ??
          world.demography!.identities.find((identity) => identity.kind === 'language')!.id,
        belief:
          identityDistribution(groups.length ? groups : fallback, 'belief')[0]?.id ??
          world.demography!.identities.find((identity) => identity.kind === 'belief')!.id,
      }
    }
  }
  if (initializing) {
    for (const region of world.regions)
      for (const group of region.communities!) {
        const language = world.nations[region.nation]?.identity?.language ?? group.language
        if (group.knownLanguage !== language) {
          group.knownLanguage = language
          group.fluency = group.language === language ? 1 : 0.15 + group.urban * 0.2
        }
      }
  }
  for (const army of allForces(world))
    if (!army.communities) {
      const home = world.regions[army.region],
        groups = home.communities!,
        counts = apportion(
          army.soldiers,
          groups.map((group) => group.population.adults),
        )
      army.communities = groups
        .map((group, index) => copyPopulation(group, { children: 0, adults: counts[index], elders: 0 }))
        .filter((group) => communitySize(group) > 0)
    }
  const initialize = (groups: PopulationCommunity[], urban: number) => {
    const result: PopulationCommunity[] = []
    for (const group of groups) {
      initializeCommunityPolitics(group, world.demography!.identities[group.movement].orientation)
      ensureAges(group, world.month)
      if (group.stratum) {
        result.push(group)
        continue
      }
      const weights = [0.5 - urban * 0.4, 0.28, 0.1 + urban * 0.1, 0.06 + urban * 0.25, 0.06 + urban * 0.05]
      const parts = AGES.map((age) => apportion(group.population[age], weights))
      for (let i = 0; i < STRATA.length; i++) {
        const part = extractAges(group, { children: parts[0][i], adults: parts[1][i], elders: parts[2][i] })
        if (communitySize(part)) result.push({ ...part, stratum: STRATA[i] })
      }
    }
    return result
  }
  for (const r of world.regions) {
    r.communities = initialize(r.communities!, r.urban)
    rollupPopulation(r)
  }
  for (const force of allForces(world))
    force.communities = initialize(force.communities!, world.regions[force.region].urban)
  preparedCensus.set(world, world.month)
}
export function discrimination(
  world: World,
  region: Region,
  group: PopulationCommunity,
  protection = (world.historical?.societies.find((society) => society.nation === region.nation)?.pluralism ??
    50) / 100,
) {
  const home = group.locality === undefined ? undefined : world.localEconomy?.units[group.locality]
  const holder = region.province === undefined && home?.province === region.id ? home : region
  return evaluateIdentityPolicy(
    group,
    governance(world, region.nation),
    holder.populationDynamics?.appliedIdentityPolicy,
    protection,
  ).exclusion
}
export function populationTension(world: World, region: Region) {
  if (!region.communities) return 0
  const total = population(region)
  return (
    region.communities.reduce(
      (sum, group) =>
        sum +
        communitySize(group) *
          (group.grievance * 20 + (1 - group.loyalty) * 6 + discrimination(world, region, group) * 5),
      0,
    ) / Math.max(1, total)
  )
}
export function updateCommunityDemography(world: World, region: Region, urbanOpportunity?: number) {
  const nation = governance(world, region.nation),
    mortality = effectMultiplier(world, 'mortality', nation.id, region.id),
    fertility = effectMultiplier(world, 'birthRate', nation.id, region.id),
    shortage = 1 - region.foodCoverage,
    education = effectMultiplier(world, 'education', nation.id, region.id)
  advanceIdentityImplementation(world, region)
  const metrics = region.populationDynamics!
  const protection =
    (world.historical?.societies.find((s) => s.nation === region.nation)?.pluralism ?? 50) / 100
  region.births = 0
  region.deaths = 0
  const basket = GOODS.reduce((sum, g) => sum + householdNeed(region, g) * region.prices[g], 0)
  const baseBasket = GOODS.reduce((sum, g) => sum + householdNeed(region, g) * BASE_PRICE[g], 0)
  const priceIndex = baseBasket > 0 ? basket / baseBasket : 1
  const openingStrata = Object.fromEntries(
    STRATA.map((s) => [s, stratumPeople(world, region.id, s)]),
  ) as Record<EconomicStratum, number>
  for (const group of region.communities!) {
    if (group.host !== region.nation) {
      group.loyalty *= group.allegiance === region.nation ? 1 : 0.65
      group.grievance = clamp(group.grievance + 0.12)
      group.host = region.nation
    }
    // Secondary language learning belongs to identity evolution. Do not erase
    // a trading language at every demographic update.
    const evaluation = evaluateIdentityPolicy(group, nation, metrics.appliedIdentityPolicy, protection),
      exclusion = evaluation.exclusion,
      access = 1 - exclusion * 0.45
    group.health = clamp(
      group.health + (region.health * access + group.wealth * 0.03 - group.health) * periodRate(0.05),
    )
    group.literacy = clamp(
      group.literacy +
        Math.max(0, region.literacy - group.literacy) * periodRate(0.04) * access +
        ((education * realService(world, region, 'education')) / Math.max(1, population(region) / 10000)) *
          periodRate(0.0001) *
          (1 - group.literacy) *
          access,
      0,
      0.995,
    )
    const household = world.economy?.households[region.id]?.[group.stratum ?? 'laborer']
    if (household) {
      const people = openingStrata[group.stratum ?? 'laborer']
      // Cash is stored in thousands of crowns. Deflate per-person balances, then
      // log-scale 20 real crowns to one so extreme fortunes cannot dominate welfare.
      group.wealth = clamp(
        Math.log1p(((household.cash / Math.max(1, people)) * 1000) / Math.max(1e-9, priceIndex)) /
          Math.log(21),
      )
    }
    group.urban = world.adaptive
      ? region.urban
      : clamp(group.urban + (clamp(region.industry * 0.5, 0.03, 0.92) - group.urban) * 0.001, 0.01, 0.98)
    const movement = world.demography!.identities[group.movement]
    evolveCommunityPolitics(group, movement.orientation, exclusion, periodRate(0.001))
    group.governmentSupport = clamp(
      group.governmentSupport! +
        (clamp(region.happiness + evaluation.consent) - group.governmentSupport!) * periodRate(0.04),
    )
    group.contentment = clamp(
      group.contentment +
        (region.happiness -
          exclusion * 0.22 +
          evaluation.consent * 0.15 +
          (group.wealth - 0.5) * 0.08 -
          group.contentment) *
          periodRate(0.06),
    )
    group.grievance = clamp(
      group.grievance +
        (exclusion * 0.55 + (1 - group.contentment) * 0.28 + region.devastation * 0.3 - group.grievance) *
          periodRate(0.025),
    )
    group.loyalty = clamp(
      group.loyalty +
        (0.35 +
          group.contentment * 0.3 +
          group.governmentSupport! * 0.1 +
          evaluation.consent * 0.2 +
          nation.legitimacy / 400 -
          exclusion * 0.45 -
          group.grievance * 0.25 -
          group.loyalty) *
          periodRate(0.008),
    )
    group.displacement = Math.max(0, group.displacement - periodFlow(0.004))
    group.rootedness = clamp(group.rootedness + periodFlow(0.002) * (1 - region.devastation))
    const deprivation = 1 - (household?.foodCoverage ?? 1 - shortage)
    const deaths = cohortDeaths(group, world.month, world.demography!, deprivation, mortality)
    const births = cohortBirths(
      group,
      world.month,
      world.demography!,
      deprivation,
      fertility,
      urbanOpportunity,
    )
    region.births += births
    region.deaths += deaths
  }
  world.totals.births += region.births
  world.totals.deaths += region.deaths
  rollupPopulation(region)
}
