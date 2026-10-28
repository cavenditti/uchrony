import { ageTotals } from './age-cohorts'
import { STRATA } from './economic-types'
import type { World } from './types'
import type { IdentityAxis, PopulationCommunity } from './population-types'
import { AGES, communityKey } from './population'
import { allForces } from './forces'

export function validatePopulation(world: World, allowDuplicateCommunities = false) {
  const state = world.demography,
    fail = (message: string): never => {
      throw new Error(`Invalid population save: ${message}`)
    },
    number = (value: unknown, min = 0, max = 1e14) =>
      typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    integer = (value: unknown, min = 0, max = 1e14) => number(value, min, max) && Number.isInteger(value),
    object = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value),
    nation = (id: number) => integer(id, 0, world.nations.length - 1)
  if (!state) {
    if (
      world.regions.some((region) => region.communities !== undefined) ||
      allForces(world).some((army) => army.communities !== undefined) ||
      world.nations.some((nation) => nation.identity !== undefined)
    )
      fail('communities need their identity registry')
    return
  }
  if (
    !object(state) ||
    state.version !== 1 ||
    !integer(state.rng, 0, 0xffffffff) ||
    !integer(state.lastEvolution, 0, world.month) ||
    !Array.isArray(state.identities) ||
    state.identities.length < 4 ||
    state.identities.length > 20000
  )
    fail('invalid identity registry')
  const identity = (id: number, kind: IdentityAxis) =>
    integer(id, 0, state.identities.length - 1) && state.identities[id].kind === kind
  for (const [index, definition] of state.identities.entries()) {
    if (
      !object(definition) ||
      definition.id !== index ||
      !['culture', 'language', 'belief', 'movement'].includes(definition.kind) ||
      typeof definition.name !== 'string' ||
      definition.name.length < 1 ||
      definition.name.length > 180 ||
      !Array.isArray(definition.parents) ||
      definition.parents.length > 4 ||
      definition.parents.some(
        (id) => !integer(id, 0, index - 1) || state.identities[id].kind !== definition.kind,
      ) ||
      !world.regions[definition.origin] ||
      !integer(definition.origin) ||
      !integer(definition.formed, 0, world.month) ||
      !['neutral', 'reform', 'local', 'institutional', 'commerce', 'communal'].includes(
        definition.orientation,
      ) ||
      !number(definition.momentum, 0, 1) ||
      !(definition.language === -1 || identity(definition.language, 'language'))
    )
      fail('invalid identity or ancestry')
  }
  let groups = 0
  const validateGroups = (communities: PopulationCommunity[] | undefined) => {
    if (!Array.isArray(communities) || communities.length > (world.localEconomy ? 65536 : 4096))
      fail('invalid communities')
    groups += communities!.length
    const keys = new Set<string>(),
      totals = { children: 0, adults: 0, elders: 0 }
    for (const group of communities!) {
      if (
        !object(group) ||
        !identity(group.culture, 'culture') ||
        !identity(group.language, 'language') ||
        !identity(group.belief, 'belief') ||
        !identity(group.movement, 'movement') ||
        !(group.allegiance === -1 || nation(group.allegiance)) ||
        !(group.host === -1 || nation(group.host)) ||
        !identity(group.knownLanguage, 'language') ||
        !object(group.population) ||
        AGES.some((age) => !integer(group.population[age])) ||
        [
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
        ].some((field) => !number(group[field as keyof PopulationCommunity], 0, 1))
      )
        fail('invalid community profile')
      if (group.stratum !== undefined && !STRATA.includes(group.stratum)) fail('unknown economic stratum')
      if (group.ageCohorts !== undefined) {
        if (
          !Array.isArray(group.ageCohorts) ||
          group.ageCohorts.length > 2641 ||
          !Number.isInteger(group.ageMonth) ||
          group.ageMonth! < 0 ||
          group.ageMonth! > world.month
        )
          fail('invalid dated cohorts')
        const births = new Set<number>()
        for (const bin of group.ageCohorts!) {
          if (
            !Array.isArray(bin) ||
            bin.length !== 3 ||
            !Number.isInteger(bin[0]) ||
            bin[0] > world.month ||
            bin[0] < -100000 ||
            births.has(bin[0]) ||
            !integer(bin[1]) ||
            !integer(bin[2]) ||
            bin[1] + bin[2] === 0
          )
            fail('invalid birth cohort')
          births.add(bin[0])
        }
        const ageCounts = ageTotals(group.ageCohorts!, group.ageMonth!)
        if (AGES.some((age) => ageCounts[age] !== group.population[age]))
          fail('dated cohorts disagree with census')
      } else if (group.ageMonth !== undefined) fail('cohort date without cohorts')
      const key = communityKey(group)
      if (keys.has(key) && !allowDuplicateCommunities) fail('duplicate census community')
      keys.add(key)
      for (const age of AGES) totals[age] += group.population[age]
    }
    return totals
  }
  for (const region of world.regions) {
    const totals = validateGroups(region.communities)
    if (AGES.some((age) => totals[age] !== region.population[age]))
      fail('community ages disagree with the province census')
    const metrics = region.populationDynamics
    if (!object(metrics)) fail('missing demographic flows')
    for (const field of [
      'immigrants',
      'emigrants',
      'refugees',
      'culturalChanges',
      'languageChanges',
      'beliefChanges',
      'politicalChanges',
    ] as const)
      if (!integer(metrics![field])) fail('invalid identity flow')
    for (const field of ['diversity', 'cohesion', 'discrimination', 'mixing', 'isolation'] as const)
      if (!number(metrics![field], 0, 1)) fail('invalid demographic index')
    for (const field of ['lastCulture', 'lastLanguage'] as const)
      if (!integer(metrics![field], 0, world.month)) fail('invalid identity formation date')
  }
  for (const army of allForces(world)) {
    const totals = validateGroups(army.communities)
    if (totals.children + totals.adults + totals.elders !== army.soldiers)
      fail('military communities disagree with troop numbers')
  }
  // The former fixed ceiling rejected a valid 1,400-province world after six
  // simulated years. Keep a bounded import budget, scaled to map size; the
  // per-holder limits and every individual census invariant still apply.
  // Mature dense worlds can contain more valid identity/occupation combinations
  // than a sparse map of the same area. Use the checked census, not cached totals;
  // the absolute import ceiling and every per-holder/cohort bound remain in force.
  const residents = world.regions.reduce(
    (sum, r) => sum + r.population.children + r.population.adults + r.population.elders,
    0,
  )
  const communityBudget = Math.min(
    1_000_000,
    Math.max(150_000, world.regions.length * 512, Math.floor(residents / 64)),
  )
  if (groups > communityBudget) fail('census exceeds the supported resolution')
  for (const state of world.nations) {
    if (
      !object(state.identity) ||
      !identity(state.identity!.culture, 'culture') ||
      !identity(state.identity!.language, 'language') ||
      !identity(state.identity!.belief, 'belief')
    )
      fail('invalid recognized national identities')
  }
}
