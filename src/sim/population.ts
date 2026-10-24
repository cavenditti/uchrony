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
  AGES.reduce((sum, age) => sum + group.population[age], 0)
export const communityKey = (group: PopulationCommunity) =>
  `${group.culture}:${group.language}:${group.belief}:${group.movement}:${group.allegiance}`
/** Unbiased rounding keeps small minorities aging and dying, using the saved census RNG. */
const expectedPeople = (world: World, value: number) => {
  const whole = Math.floor(Math.max(0, value))
  return whole + (random(world.demography!) < value - whole ? 1 : 0)
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
/** Integer apportionment with explicit capacities; no people disappear in rounding. */
export function apportion(total: number, weights: number[], limits = weights.map(() => Infinity)) {
  const result = weights.map(() => 0)
  let left = Math.min(
    Math.max(0, Math.floor(total)),
    limits.reduce((sum, limit) => sum + limit, 0),
  )
  while (left > 0) {
    const active = weights
        .map((weight, index) => ({ index, weight: Math.max(0, weight) }))
        .filter(({ index }) => result[index] < limits[index]),
      sum = active.reduce((value, item) => value + item.weight, 0)
    if (!active.length) break
    const shares = active.map(({ index, weight }) => ({
      index,
      exact: left * (sum ? weight / sum : 1 / active.length),
    }))
    let granted = 0
    for (const share of shares) {
      const amount = Math.min(limits[share.index] - result[share.index], Math.floor(share.exact))
      result[share.index] += amount
      granted += amount
    }
    left -= granted
    if (left <= 0) break
    shares.sort(
      (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.index - b.index,
    )
    let remainder = 0
    for (const { index } of shares)
      if (left && result[index] < limits[index]) {
        result[index]++
        left--
        remainder++
      }
    if (!remainder && !granted) break
  }
  return result
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
  const groups = region.communities!
  region.communities = groups.filter((group) => communitySize(group) > 0)
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
export function addCommunity(groups: PopulationCommunity[], incoming: PopulationCommunity) {
  const count = communitySize(incoming)
  if (!count) return
  const existing = groups.find((group) => communityKey(group) === communityKey(incoming))
  if (!existing) {
    groups.push(structuredClone(incoming))
    return
  }
  const size = communitySize(existing)
  for (const field of SOCIAL)
    existing[field] = (existing[field] * size + incoming[field] * count) / (size + count)
  for (const age of AGES) existing.population[age] += incoming.population[age]
}
function copyPopulation(group: PopulationCommunity, counts: Cohorts): PopulationCommunity {
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
export function ensurePopulation(world: World) {
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
    const span = Math.max(...world.cells.map((cell) => cell.x), 1)
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
}
export function discrimination(world: World, region: Region, group: PopulationCommunity) {
  const nation = world.nations[region.nation],
    identity = nation.identity!,
    policies = nation.policies,
    protection =
      (world.historical?.societies.find((society) => society.nation === nation.id)?.pluralism ?? 50) / 100
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
        ((education * nation.budget.education) / Math.max(1, nation.population / 10000)) *
          0.0001 *
          (1 - group.literacy) *
          access,
      0,
      0.995,
    )
    group.wealth = clamp(
      group.wealth +
        (0.2 +
          region.industry * 0.2 +
          region.foodCoverage * 0.2 -
          nation.policies.tax * 0.003 -
          region.devastation * 0.25 -
          exclusion * 0.15 -
          group.wealth) *
          0.015,
    )
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
    const births = expectedPeople(
        world,
        group.population.adults *
          0.0032 *
          (1 - group.literacy * 0.3) *
          (1 - shortage * 0.7) *
          (1 - group.urban * 0.12) *
          clamp(0.9 + group.wealth * 0.2, 0.8, 1.15) *
          fertility,
      ),
      deaths = {
        children: Math.min(
          group.population.children,
          expectedPeople(
            world,
            group.population.children *
              (0.0005 * (1.35 - group.health * 0.65) + shortage * 0.012) *
              mortality,
          ),
        ),
        adults: Math.min(
          group.population.adults,
          expectedPeople(
            world,
            group.population.adults * (0.0005 * (1.35 - group.health * 0.65) + shortage * 0.007) * mortality,
          ),
        ),
        elders: Math.min(
          group.population.elders,
          expectedPeople(
            world,
            group.population.elders * (0.007 * (1.35 - group.health * 0.65) + shortage * 0.018) * mortality,
          ),
        ),
      },
      mature = expectedPeople(world, (group.population.children - deaths.children) / (18 * 12)),
      retire = expectedPeople(world, (group.population.adults - deaths.adults) / (47 * 12))
    group.population.children += births - deaths.children - mature
    group.population.adults += mature - deaths.adults - retire
    group.population.elders += retire - deaths.elders
    region.births += births
    region.deaths += deaths.children + deaths.adults + deaths.elders
  }
  world.totals.births += region.births
  world.totals.deaths += region.deaths
  rollupPopulation(region)
}

export function takeCivilianAdults(world: World, region: Region, amount: number) {
  ensurePopulation(world)
  const groups = region.communities!,
    counts = apportion(
      amount,
      groups.map((group) => group.population.adults * (0.5 + group.loyalty)),
      groups.map((group) => group.population.adults),
    ),
    taken: PopulationCommunity[] = []
  groups.forEach((group, index) => {
    if (counts[index]) {
      group.population.adults -= counts[index]
      taken.push(copyPopulation(group, { children: 0, adults: counts[index], elders: 0 }))
    }
  })
  rollupPopulation(region)
  return taken
}
export function removeCivilianAdults(world: World, region: Region, amount: number) {
  ensurePopulation(world)
  const counts = apportion(
    amount,
    region.communities!.map((group) => group.population.adults),
    region.communities!.map((group) => group.population.adults),
  )
  region.communities!.forEach((group, index) => (group.population.adults -= counts[index]))
  rollupPopulation(region)
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
    AGES.forEach((age, i) => (group.population[age] -= removed[i]))
  })
  army.communities = groups.filter((group) => communitySize(group) > 0)
  army.soldiers -= counts.reduce((sum, count) => sum + count, 0)
}
export function returnArmyPeople(world: World, army: Army, region: Region) {
  ensurePopulation(world)
  for (const source of army.communities!) {
    const group = structuredClone(source)
    group.host = region.nation
    if (group.allegiance !== region.nation) group.loyalty *= 0.75
    addCommunity(region.communities!, group)
  }
  army.communities = []
  army.soldiers = 0
  if ('warships' in army) {
    const fleet = army as Fleet
    region.stocks.food += fleet.food
    region.stocks.arms += fleet.arms
    fleet.food = 0
    fleet.arms = 0
  }
  if (army.operations) {
    region.stocks.food += army.operations.food
    region.stocks.arms += army.operations.arms
    army.operations.food = 0
    army.operations.arms = 0
  }
  rollupPopulation(region)
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
    const person = copyPopulation(g, { children: moved[0], adults: moved[1], elders: moved[2] })
    person.host = region.nation
    person.rootedness *= 0.5
    AGES.forEach((age) => (g.population[age] -= person.population[age]))
    addCommunity(region.communities!, person)
  })
  army.soldiers -= counts.reduce((sum, count) => sum + count, 0)
  army.communities = groups.filter((g) => communitySize(g))
  rollupPopulation(region)
}
export function ageMilitaryPopulation(world: World) {
  for (const army of allForces(world)) {
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
      const deaths = Math.min(
          group.population.adults,
          expectedPeople(world, group.population.adults * 0.0004 * (1.3 - group.health * 0.6)),
        ),
        retired = expectedPeople(world, (group.population.adults - deaths) / (47 * 12))
      group.population.adults -= deaths + retired
      army.soldiers -= deaths + retired
      army.casualties += deaths
      world.nations[army.nation].casualties += deaths
      world.totals.deaths += deaths
      if (retired)
        addCommunity(home.communities!, copyPopulation(group, { children: 0, adults: 0, elders: retired }))
    }
    army.communities = army.communities!.filter((group) => communitySize(group) > 0)
    rollupPopulation(home)
  }
}

export function migrateCommunities(world: World) {
  // Plans are simultaneous: destination communities stay unchanged until every household has chosen.
  // Marginals give the same affinity as scanning every destination group for every comparison.
  const destinations = world.regions.map((region) => {
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
    return {
      language,
      belief,
      culture,
      people: Math.max(1, population(region)),
      attraction: effectValue(world, 'migrationAttraction', region.nation, region.id) * 0.2,
      prestige:
        (world.historical?.societies.find((society) => society.nation === region.nation)?.prestige ?? 0) /
        3000,
    }
  })
  const sea = new Map<number, Map<number, number>>()
  for (const route of world.routes)
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
  }[] = []
  for (const region of world.regions)
    for (const group of region.communities!) {
      const size = communitySize(group)
      if (!size) continue
      const pressure = clamp(
          region.devastation * 0.75 +
            Math.max(0, 0.8 - region.foodCoverage) * 0.8 +
            discrimination(world, region, group) * 0.35,
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
            compatible * 0.12 +
            destination.attraction +
            destination.prestige -
            to.devastation * 0.6 -
            discrimination(world, to, group) * 0.3
          )
        },
        candidates = [...new Set([...region.neighbors, ...(sea.get(region.id)?.keys() ?? [])])]
          .map((id) => world.regions[id])
          .filter(
            (to) =>
              to.id !== region.id &&
              (to.nation === region.nation ||
                refugee ||
                (world.nations[region.nation].policies.migration !== 'closed' &&
                  world.nations[to.nation].policies.migration !== 'closed' &&
                  relation(world, region.nation, to.nation)?.treaty !== 'war')),
          )
          .sort((a, b) => appeal(b) - appeal(a) || a.id - b.id),
        to = candidates[0]
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
        rate = clamp((appeal(to) - appeal(region) - 0.025) * 0.012 + pressure * 0.01, 0, 0.018) * border,
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
      })
      if (maritime) sea.get(region.id)!.set(to.id, capacity - amount)
    }
  // Subtract every departure before arrivals: no newly arrived person moves twice this month.
  for (const plan of plans) for (const age of AGES) plan.source.population[age] -= plan.counts[age]
  for (const plan of plans) {
    const incoming = copyPopulation(plan.source, plan.counts),
      amount = communitySize(incoming),
      language = world.nations[plan.to.nation].identity!.language
    incoming.host = plan.to.nation
    incoming.rootedness *= 0.65
    if (plan.refugee) incoming.displacement = 1
    if (incoming.allegiance !== plan.to.nation && plan.from.nation !== plan.to.nation)
      incoming.loyalty *= 0.75
    if (incoming.knownLanguage !== language) {
      incoming.knownLanguage = language
      incoming.fluency = incoming.language === language ? 1 : 0.05
    }
    addCommunity(plan.to.communities!, incoming)
    plan.from.migration -= amount
    plan.to.migration += amount
    world.totals.migration += amount
    plan.from.populationDynamics!.emigrants += amount
    plan.to.populationDynamics!.immigrants += amount
    if (plan.refugee) plan.to.populationDynamics!.refugees += amount
  }
  for (const region of world.regions) rollupPopulation(region)
}

export function splitCommunity(
  region: Region,
  source: PopulationCommunity,
  changes: Partial<Pick<PopulationCommunity, 'culture' | 'language' | 'belief' | 'movement' | 'allegiance'>>,
  rate: number,
  ageFactors = [1, 1, 1],
) {
  const counts = { children: 0, adults: 0, elders: 0 }
  AGES.forEach((age, index) => {
    counts[age] = Math.min(
      source.population[age],
      Math.floor(source.population[age] * clamp(rate * ageFactors[index], 0, 0.15)),
    )
    source.population[age] -= counts[age]
  })
  const moved = counts.children + counts.adults + counts.elders
  if (moved) addCommunity(region.communities!, { ...source, ...changes, population: counts })
  return moved
}
