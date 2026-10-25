import { householdNeed, BASE_PRICE } from './economy'
import { GOODS } from './types'
import { realService } from './public-services'
import { relocateHouseholdClaims } from './district-finance'
import { economicRegions, economicRegion } from './local-units'
import { marketStore, armyStore, fleetStore, recordGift } from './national-accounts'
import {
  ensureAges,
  mergeAges,
  extractAges,
  cohortDeaths,
  cohortBirths,
  expectedInteger,
} from './age-cohorts'
import { STRATA, type EconomicStratum } from './economic-types'
import { stratumPeople, householdAccount, transfer } from './ledger'
import { MODEL_PARAMETERS } from './model-parameters'
import { apportion } from './allocation'
export { apportion } from './allocation'
import { hashSeed, random } from './random'
import { allForces } from './forces'
import type { Fleet } from './military-types'
import { effectMultiplier, effectValue } from './effects'
import { clamp, population, relation, type Army, type Region, type World } from './types'
import type {
  AgeCohort,
  Cohorts,
  IdentityAxis,
  IdentityDefinition,
  PopulationCommunity,
  PopulationDynamics,
} from './population-types'

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
export const communityKey = (group: PopulationCommunity) =>
  `${group.culture}:${group.language}:${group.belief}:${group.movement}:${group.allegiance}:${group.stratum ?? 'laborer'}${group.locality === undefined ? '' : ':local:' + group.locality}`
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
  for (const age of AGES)
    region.population[age] = region.communities.reduce((sum, group) => sum + group.population[age], 0)
  const total = population(region)
  if (total)
    for (const field of ['health', 'literacy', 'urban'] as const)
      region[field] =
        region.communities.reduce((sum, group) => sum + group[field] * communitySize(group), 0) / total
  if (total)
    region.happiness =
      region.communities.reduce((sum, group) => sum + group.contentment * communitySize(group), 0) / total
}
export function communityIndex(groups: PopulationCommunity[]) {
  const index = new Map<string, PopulationCommunity>()
  for (const group of groups) if (!index.has(communityKey(group))) index.set(communityKey(group), group)
  return index
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
    const added = structuredClone(incoming)
    groups.push(added)
    index?.set(key, added)
    return
  }
  const size = communitySize(existing)
  for (const field of SOCIAL)
    existing[field] = (existing[field] * size + incoming[field] * count) / (size + count)
  if (existing.ageCohorts || incoming.ageCohorts) mergeAges(existing, incoming)
  else for (const age of AGES) existing.population[age] += incoming.population[age]
}
/** Equal identities may converge after allegiance changes; combine their actual people and weighted conditions. */
export function coalesceCommunities(groups: PopulationCommunity[]) {
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
    for (const field of SOCIAL)
      existing[field] = (existing[field] * size + group[field] * count) / (size + count)
    if (existing.ageCohorts || group.ageCohorts) mergeAges(existing, group)
    else for (const age of AGES) existing.population[age] += group.population[age]
  }
  return [...indexed.values()]
}
function copyPopulation(group: PopulationCommunity, counts: Cohorts): PopulationCommunity {
  if (group.ageCohorts) return extractAges(structuredClone(group), counts)
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
    const rng = world.demography,
      count = Math.min(world.regions.length, Math.max(4, Math.round(Math.sqrt(world.regions.length)))),
      seeds = [world.regions[Math.floor(random(rng) * world.regions.length)]]
    while (seeds.length < count) {
      let candidate = world.regions[0],
        best = -1
      for (const region of world.regions) {
        const at = world.cells[region.center],
          distance = Math.min(
            ...seeds.map((seed) => {
              const cell = world.cells[seed.center]
              return Math.hypot(cell.x - at.x, cell.y - at.y)
            }),
          )
        if (distance > best) {
          best = distance
          candidate = region
        }
      }
      seeds.push(candidate)
    }
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
        nearest = seeds
          .map((seed, index) => ({
            index,
            distance: Math.hypot(world.cells[seed.center].x - at.x, world.cells[seed.center].y - at.y),
          }))
          .sort((a, b) => a.distance - b.distance || a.index - b.index),
        first = nearest[0].index,
        second = nearest[1].index,
        faith = Math.min(3, Math.floor((at.x / span) * 4)),
        shares = [0.72, 0.18, 0.1],
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
        const language = world.nations[region.nation].identity!.language
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
  const nation = world.nations[region.nation],
    identity = nation.identity!,
    policies = nation.policies
  return (
    clamp(
      (policies.citizenship === 'heritage' && group.culture !== identity.culture ? 0.35 : 0) +
        (policies.beliefPolicy === 'restricted' && group.belief !== identity.belief
          ? 0.4
          : policies.beliefPolicy === 'favored' && group.belief !== identity.belief
            ? 0.12
            : 0) +
        (policies.languagePolicy === 'common' &&
        (group.language === identity.language
          ? 1
          : group.knownLanguage === identity.language
            ? group.fluency
            : 0) < 0.5
          ? 0.12
          : 0),
      0,
      1,
    ) *
    (1 - protection * 0.45)
  )
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
export function updateCommunityDemography(world: World, region: Region) {
  const nation = world.nations[region.nation],
    mortality = effectMultiplier(world, 'mortality', nation.id, region.id),
    fertility = effectMultiplier(world, 'birthRate', nation.id, region.id),
    shortage = 1 - region.foodCoverage,
    education = effectMultiplier(world, 'education', nation.id, region.id)
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
    const language = nation.identity!.language
    if (group.knownLanguage !== language) {
      group.knownLanguage = language
      group.fluency = group.language === language ? 1 : 0.1
    }
    const exclusion = discrimination(world, region, group),
      access = 1 - exclusion * 0.45
    group.health = clamp(group.health + (region.health * access + group.wealth * 0.03 - group.health) * 0.05)
    group.literacy = clamp(
      group.literacy +
        Math.max(0, region.literacy - group.literacy) * 0.04 * access +
        ((education * realService(world, region, 'education')) / Math.max(1, population(region) / 10000)) *
          0.0001 *
          (1 - group.literacy) *
          access,
      0,
      0.995,
    )
    const household = world.economy?.households[region.id]?.[group.stratum ?? 'laborer']
    if (household) {
      const people = openingStrata[group.stratum ?? 'laborer']
      group.wealth = clamp(
        Math.log1p(((household.cash / Math.max(1, people)) * 1000) / Math.max(1e-9, priceIndex)) /
          Math.log(21),
      )
    }
    group.urban = clamp(
      group.urban + (clamp(region.industry * 0.5, 0.03, 0.92) - group.urban) * 0.001,
      0.01,
      0.98,
    )
    const movement = world.demography!.identities[group.movement],
      dissatisfaction =
        movement.orientation === 'reform' && nation.policies.citizenship === 'heritage'
          ? 0.06
          : movement.orientation === 'local' && nation.policies.languagePolicy === 'common'
            ? 0.05
            : 0
    group.contentment = clamp(
      group.contentment +
        (region.happiness -
          exclusion * 0.22 -
          dissatisfaction +
          (group.wealth - 0.5) * 0.08 -
          group.contentment) *
          0.06,
    )
    group.grievance = clamp(
      group.grievance +
        (exclusion * 0.55 + (1 - group.contentment) * 0.28 + region.devastation * 0.3 - group.grievance) *
          0.025,
    )
    group.loyalty = clamp(
      group.loyalty +
        (0.35 +
          group.contentment * 0.4 +
          nation.legitimacy / 400 -
          exclusion * 0.45 -
          group.grievance * 0.25 -
          group.loyalty) *
          0.008,
    )
    group.displacement = Math.max(0, group.displacement - 0.004)
    group.rootedness = clamp(group.rootedness + 0.002 * (1 - region.devastation))
    const deprivation = 1 - (household?.foodCoverage ?? 1 - shortage)
    const deaths = cohortDeaths(group, world.month, world.demography!, deprivation, mortality)
    const births = cohortBirths(group, world.month, world.demography!, deprivation, fertility)
    region.births += births
    region.deaths += deaths
  }
  world.totals.births += region.births
  world.totals.deaths += region.deaths
  rollupPopulation(region)
}

/** Province-level military transfers must update both views of the same census immediately. */
function settleCivilianCensus(world: World, region: Region) {
  rollupPopulation(region)
  if (!world.localEconomy || world.regions[region.id] !== region) return
  const units = world.localEconomy.units
  const local = new Map<number, PopulationCommunity[]>()
  for (const group of region.communities!) {
    const id =
      group.locality !== undefined &&
      units[group.locality]?.retired === undefined &&
      units[group.locality]?.province === region.id
        ? group.locality
        : region.id
    group.locality = id
    const groups = local.get(id) ?? []
    groups.push(group)
    local.set(id, groups)
  }
  for (const id of world.localEconomy.active) {
    const unit = units[id]
    if (unit.province !== region.id) continue
    unit.communities = local.get(id) ?? []
    rollupPopulation(unit)
  }
}

export function takeCivilianAdults(
  world: World,
  region: Region,
  amount: number,
  eligible: (group: PopulationCommunity) => boolean = () => true,
) {
  ensurePopulation(world)
  const groups = region.communities!,
    counts = apportion(
      amount,
      groups.map((group) => (eligible(group) ? group.population.adults * (0.5 + group.loyalty) : 0)),
      groups.map((group) => (eligible(group) ? group.population.adults : 0)),
    ),
    taken: PopulationCommunity[] = []
  groups.forEach((group, index) => {
    if (counts[index]) {
      taken.push(extractAges(group, { children: 0, adults: counts[index], elders: 0 }))
    }
  })
  settleCivilianCensus(world, region)
  return taken
}
export function removeCivilianAdults(world: World, region: Region, amount: number) {
  ensurePopulation(world)
  const counts = apportion(
    amount,
    region.communities!.map((group) => group.population.adults),
    region.communities!.map((group) => group.population.adults),
  )
  region.communities!.forEach((group, index) => {
    extractAges(group, { children: 0, adults: counts[index], elders: 0 })
    // The caller records provincial/world casualties; keep the resident district
    // counter too so a later provincial rollup cannot erase reported combat deaths.
    if (world.localEconomy && world.regions[region.id] === region)
      world.localEconomy.units[group.locality ?? region.id].deaths += counts[index]
  })
  settleCivilianCensus(world, region)
}
export function removeSoldiers(world: World, army: Army, amount: number) {
  ensurePopulation(world)
  const groups = army.communities!,
    counts = apportion(amount, groups.map(communitySize), groups.map(communitySize))
  groups.forEach((group, index) => {
    const removed = apportion(
      counts[index],
      AGES.map((age) => group.population[age]),
      AGES.map((age) => group.population[age]),
    )
    extractAges(group, { children: removed[0], adults: removed[1], elders: removed[2] })
  })
  army.communities = groups.filter((group) => communitySize(group) > 0)
  army.soldiers -= counts.reduce((sum, count) => sum + count, 0)
}
export function returnArmyPeople(world: World, army: Army, region: Region) {
  ensurePopulation(world)
  for (const source of army.communities!) {
    const group = structuredClone(source)
    if (world.localEconomy) group.locality = region.id
    group.host = region.nation
    if (group.allegiance !== region.nation) group.loyalty *= 0.75
    addCommunity(region.communities!, group)
  }
  army.communities = []
  army.soldiers = 0
  if ('warships' in army) {
    const fleet = army as Fleet
    recordGift(world, fleetStore(fleet.id), marketStore(region.id), 'food', fleet.food)
    recordGift(world, fleetStore(fleet.id), marketStore(region.id), 'arms', fleet.arms)
    region.stocks.food += fleet.food
    region.stocks.arms += fleet.arms
    fleet.food = 0
    fleet.arms = 0
  }
  if (army.operations) {
    recordGift(world, armyStore(army.id), marketStore(region.id), 'food', army.operations.food)
    recordGift(world, armyStore(army.id), marketStore(region.id), 'arms', army.operations.arms)
    region.stocks.food += army.operations.food
    region.stocks.arms += army.operations.arms
    army.operations.food = 0
    army.operations.arms = 0
  }
  settleCivilianCensus(world, region)
}
export function releaseSoldiers(world: World, army: Army, region: Region, amount: number) {
  ensurePopulation(world)
  const groups = army.communities ?? [],
    counts = apportion(amount, groups.map(communitySize), groups.map(communitySize))
  groups.forEach((g, i) => {
    const moved = apportion(
      counts[i],
      AGES.map((age) => g.population[age]),
      AGES.map((age) => g.population[age]),
    )
    const person = extractAges(g, { children: moved[0], adults: moved[1], elders: moved[2] })
    if (world.localEconomy) person.locality = region.id
    person.host = region.nation
    person.rootedness *= 0.5
    addCommunity(region.communities!, person)
  })
  army.soldiers -= counts.reduce((sum, count) => sum + count, 0)
  army.communities = groups.filter((g) => communitySize(g))
  settleCivilianCensus(world, region)
}
export function ageMilitaryPopulation(world: World) {
  const homes = new Set<Region>()
  for (const army of allForces(world)) {
    army.communities = coalesceCommunities(army.communities!)
    const home = world.regions[world.nations[army.nation].capital]
    for (const group of army.communities!) {
      const nation = world.nations[army.nation],
        language = nation.identity!.language
      if (group.host !== army.nation) {
        group.host = army.nation
        group.loyalty *= 0.75
      }
      if (group.knownLanguage !== language) {
        group.knownLanguage = language
        group.fluency = group.language === language ? 1 : 0.1
      }
      group.fluency = clamp(
        group.fluency + (1 - group.fluency) * (0.002 + nation.technologies.logistics * 0.0005),
      )
      group.health = clamp(
        group.health +
          (0.45 + army.supply * 0.25 + nation.technologies.medicine * 0.03 - group.health) * 0.03,
      )
      group.loyalty = clamp(
        group.loyalty + (0.3 + army.supply * 0.25 + nation.legitimacy / 400 - group.loyalty) * 0.008,
      )
      const deaths = cohortDeaths(group, world.month, world.demography!, Math.max(0, 1 - army.supply) * 0.3)
      const retired = group.population.elders
      army.soldiers -= deaths + retired
      army.casualties += deaths
      world.nations[army.nation].casualties += deaths
      world.totals.deaths += deaths
      if (retired) {
        const incoming = extractAges(group, { children: 0, adults: 0, elders: retired })
        if (world.localEconomy) incoming.locality = home.id
        addCommunity(home.communities!, incoming)
      }
    }
    army.communities = army.communities!.filter((group) => communitySize(group) > 0)
    homes.add(home)
  }
  // Retirement transfers alter communities immediately; aggregate each home once after all arrivals.
  for (const home of homes) settleCivilianCensus(world, home)
}

export function migrateCommunities(world: World) {
  // Plans are simultaneous: destination communities stay unchanged until every household has chosen.
  // Marginals give the same affinity as scanning every destination group for every comparison.
  const destinations = Object.fromEntries(
    economicRegions(world).map((region) => {
      const language = new Map<number, number>(),
        belief = new Map<number, number>(),
        culture = new Map<number, number>()
      for (const group of region.communities!) {
        const size = communitySize(group)
        for (const [axis, counts] of [
          ['language', language],
          ['belief', belief],
          ['culture', culture],
        ] as const)
          counts.set(group[axis], (counts.get(group[axis]) ?? 0) + size)
      }
      return [
        region.id,
        {
          strata: Object.fromEntries(STRATA.map((s) => [s, stratumPeople(world, region.id, s)])) as Record<
            EconomicStratum,
            number
          >,
          language,
          belief,
          culture,
          people: Math.max(1, population(region)),
          protection:
            (world.historical?.societies.find((society) => society.nation === region.nation)?.pluralism ??
              50) / 100,
          attraction: effectValue(world, 'migrationAttraction', region.nation, region.id) * 0.2,
          prestige:
            (world.historical?.societies.find((society) => society.nation === region.nation)?.prestige ?? 0) /
            3000,
        },
      ] as const
    }),
  )
  const sea = new Map<number, Map<number, number>>()
  for (const route of world.localEconomy
    ? world.localEconomy.shipments
        .filter((s) => s.legs.some((l) => l.mode === 'sea'))
        .map((s) => ({ from: s.from, to: s.to, volume: s.quantity, sea: true }))
    : world.routes)
    if (route.sea) {
      for (const [from, to] of [
        [route.from, route.to],
        [route.to, route.from],
      ]) {
        if (!sea.has(from)) sea.set(from, new Map())
        sea.get(from)!.set(to, (sea.get(from)!.get(to) ?? 0) + Math.floor(route.volume * 0.15))
      }
    }
  const plans: {
    from: Region
    to: Region
    source: PopulationCommunity
    counts: Cohorts
    refugee: boolean
    incoming?: PopulationCommunity
    assets: number
  }[] = []
  const candidatesByRegion = Object.fromEntries(
    economicRegions(world).map(
      (region) =>
        [
          region.id,
          [...new Set([...region.neighbors, ...(sea.get(region.id)?.keys() ?? [])])]
            .map((id) => economicRegion(world, id))
            .filter((to) => to && to.id !== region.id),
        ] as const,
    ),
  )
  for (const region of economicRegions(world))
    for (const group of region.communities!) {
      const size = communitySize(group)
      if (!size) continue
      const pressure = clamp(
          region.devastation * 0.75 +
            Math.max(0, 0.8 - region.foodCoverage) * 0.8 +
            discrimination(world, region, group, destinations[region.id].protection) * 0.35,
        ),
        refugee = pressure > 0.17,
        appeal = (to: Region) => {
          const destination = destinations[to.id],
            compatible =
              ((destination.language.get(group.language) ?? 0) * 0.6 +
                (destination.belief.get(group.belief) ?? 0) * 0.2 +
                (destination.culture.get(group.culture) ?? 0) * 0.2) /
              destination.people
          return (
            to.happiness * 0.35 +
            to.health * 0.2 +
            to.foodCoverage * 0.2 +
            to.infrastructure * 0.1 +
            economicAppeal(world, to, group.stratum ?? 'laborer') +
            compatible * 0.12 -
            (world.localEconomy
              ? 0.04 * Math.log1p(population(to) / Math.max(1, to.cells.length * 12000)) +
                (Math.hypot(
                  world.cells[to.center].q - world.cells[region.center].q,
                  world.cells[to.center].r - world.cells[region.center].r,
                ) *
                  0.002) /
                  (1 + to.infrastructure)
              : 0) +
            destination.attraction +
            destination.prestige -
            to.devastation * 0.6 -
            discrimination(world, to, group, destination.protection) * 0.3
          )
        }
      let to: Region | undefined,
        bestAppeal = -Infinity
      for (const candidate of candidatesByRegion[region.id]) {
        if (!(
          candidate.nation === region.nation ||
          refugee ||
          (world.nations[region.nation].policies.migration !== 'closed' &&
            world.nations[candidate.nation].policies.migration !== 'closed' &&
            relation(world, region.nation, candidate.nation)?.treaty !== 'war')
        ))
          continue
        const value = appeal(candidate)
        if (value > bestAppeal || (value === bestAppeal && candidate.id < to!.id)) {
          to = candidate
          bestAppeal = value
        }
      }
      if (!to) continue
      const border =
          to.nation === region.nation
            ? 1
            : world.nations[to.nation].policies.migration === 'closed'
              ? refugee
                ? 0.025
                : 0
              : world.nations[to.nation].policies.migration === 'controlled'
                ? 0.3
                : 0.7,
        rate = clamp((bestAppeal - appeal(region) - 0.025) * 0.012 + pressure * 0.01, 0, 0.018) * border,
        wanted = Math.floor(size * rate * (1 - group.rootedness * 0.4)),
        maritime = !region.neighbors.includes(to.id),
        capacity = maritime ? (sea.get(region.id)?.get(to.id) ?? 0) : Infinity,
        amount = Math.min(wanted, capacity),
        allocation = apportion(
          amount,
          [group.population.children * 0.9, group.population.adults * 1.2, group.population.elders * 0.4],
          AGES.map((age) => group.population[age]),
        )
      if (amount < 1) continue
      plans.push({
        from: region,
        to,
        source: group,
        counts: { children: allocation[0], adults: allocation[1], elders: allocation[2] },
        refugee,
        assets:
          ((world.economy?.households[region.id][group.stratum ?? 'laborer'].cash ?? 0) * amount) /
          Math.max(1, destinations[region.id].strata[group.stratum ?? 'laborer']),
      })
      if (maritime) sea.get(region.id)!.set(to.id, capacity - amount)
    }
  relocateHouseholdClaims(
    world,
    plans.map((p) => ({
      from: householdAccount(p.from.id, p.source.stratum ?? 'laborer'),
      to: householdAccount(p.to.id, p.source.stratum ?? 'laborer'),
      fraction:
        (p.counts.children + p.counts.adults + p.counts.elders) /
        Math.max(1, destinations[p.from.id].strata[p.source.stratum ?? 'laborer']),
    })),
  )
  // Subtract every departure before arrivals: no newly arrived person moves twice this month.
  for (const plan of plans) plan.incoming = extractAges(plan.source, plan.counts)
  const arrivalIndexes = Object.fromEntries(
    economicRegions(world).map((r) => [r.id, communityIndex(r.communities!)]),
  )
  for (const plan of plans) {
    const incoming = plan.incoming!,
      amount = communitySize(incoming),
      language = world.nations[plan.to.nation].identity!.language
    if (world.localEconomy) incoming.locality = plan.to.id
    incoming.host = plan.to.nation
    incoming.rootedness *= 0.65
    if (plan.refugee) incoming.displacement = 1
    if (incoming.allegiance !== plan.to.nation && plan.from.nation !== plan.to.nation)
      incoming.loyalty *= 0.75
    if (incoming.knownLanguage !== language) {
      incoming.knownLanguage = language
      incoming.fluency = incoming.language === language ? 1 : 0.05
    }
    if (world.economy)
      transfer(
        world,
        householdAccount(plan.from.id, incoming.stratum ?? 'laborer'),
        householdAccount(plan.to.id, incoming.stratum ?? 'laborer'),
        plan.assets,
        'migrant household assets',
      )
    addCommunity(plan.to.communities!, incoming, arrivalIndexes[plan.to.id])
    plan.from.migration -= amount
    plan.to.migration += amount
    world.totals.migration += amount
    plan.from.populationDynamics!.emigrants += amount
    plan.to.populationDynamics!.immigrants += amount
    if (plan.refugee) plan.to.populationDynamics!.refugees += amount
  }
  for (const region of economicRegions(world)) rollupPopulation(region)
}

export function splitCommunity(
  region: Region,
  source: PopulationCommunity,
  changes: Partial<
    Pick<PopulationCommunity, 'culture' | 'language' | 'belief' | 'movement' | 'allegiance' | 'stratum'>
  >,
  rate: number,
  ageFactors = [1, 1, 1],
  index?: Map<string, PopulationCommunity>,
) {
  const counts = { children: 0, adults: 0, elders: 0 }
  AGES.forEach((age, index) => {
    counts[age] = Math.min(
      source.population[age],
      Math.floor(source.population[age] * clamp(rate * ageFactors[index], 0, 0.15)),
    )
  })
  const moved = counts.children + counts.adults + counts.elders
  if (moved) addCommunity(region.communities!, { ...extractAges(source, counts), ...changes }, index)
  return moved
}

function economicAppeal(world: World, region: Region, stratum: EconomicStratum) {
  const e = world.economy
  if (!e) return 0
  const h = e.households[region.id][stratum],
    f = e.producers[region.id]
  const employment = h.laborForce ? Math.min(1, h.employed / h.laborForce) : 0
  const realWage = f.wage / Math.max(0.01, region.prices.food / 14)
  return employment * 0.12 + Math.min(0.08, realWage * 20)
}

/** Slow family-group occupational mobility, independently of cultural identity. */
export function advanceEconomicStrata(world: World) {
  const e = world.economy
  if (!e) return
  for (const r of economicRegions(world)) {
    const index = communityIndex(r.communities!)
    const opening = Object.fromEntries(
      STRATA.map((s) => [s, { people: stratumPeople(world, r.id, s), cash: e.households[r.id][s].cash }]),
    ) as Record<EconomicStratum, { people: number; cash: number }>
    for (const g of [...r.communities!]) {
      const from = g.stratum ?? 'laborer',
        h = e.households[r.id][from],
        size = communitySize(g)
      const cashPerPerson = opening[from].cash / Math.max(1, opening[from].people)
      let to: EconomicStratum = from,
        opportunity = 0
      if (h.foodCoverage < 0.6 && from !== 'laborer' && from !== 'smallholder') {
        to = 'laborer'
        opportunity = 1 - h.foodCoverage
      } else if (from === 'smallholder' && r.urban > 0.15) {
        to = 'laborer'
        opportunity = r.urban
      } else if (from === 'laborer' && g.literacy > 0.2) {
        to = 'artisan'
        opportunity = g.literacy * r.industry
      } else if (from === 'artisan' && g.literacy > 0.55) {
        to = 'professional'
        opportunity = g.literacy
      } else if (from === 'professional' && cashPerPerson > 0.02) {
        to = 'owner'
        opportunity = Math.min(1, cashPerPerson / 0.1)
      }
      if (to === from || !size) continue
      const amount = Math.min(
        size,
        expectedInteger(world, size * MODEL_PARAMETERS.mobilityMonthly * clamp(opportunity)),
      )
      if (!amount) continue
      const parts = apportion(
        amount,
        AGES.map((age) => g.population[age]),
        AGES.map((age) => g.population[age]),
      )
      const moved = extractAges(g, { children: parts[0], adults: parts[1], elders: parts[2] })
      moved.stratum = to
      addCommunity(r.communities!, moved, index)
      transfer(
        world,
        householdAccount(r.id, from),
        householdAccount(r.id, to),
        cashPerPerson * amount,
        'occupational mobility assets',
      )
    }
    rollupPopulation(r)
  }
}
