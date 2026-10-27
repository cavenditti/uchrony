import { recordWorldEvent } from './event-memory'
import { governance } from './governance'
import { economicRegions } from './local-units'
import { random } from './random'
import { allForces } from './forces'
import { clamp, population, type Region, type World } from './types'
import { effectMultiplier } from './effects'
import {
  communitySize,
  communityIndex,
  discrimination,
  ensurePopulation,
  identityDistribution,
  registerIdentity,
  rollupPopulation,
  splitCommunity,
} from './population'
import type { HistoricalEffect } from './history-types'
import type { IdentityAxis, IdentityDefinition } from './population-types'

const AXES: IdentityAxis[] = ['culture', 'language', 'belief', 'movement']
function choose(state: { rng: number }, weights: Map<number, number>) {
  let left = random(state) * [...weights.values()].reduce((sum, value) => sum + value, 0)
  for (const [id, weight] of weights) {
    left -= weight
    if (left <= 0) return id
  }
  return weights.keys().next().value as number
}
function note(world: World, region: Region, title: string, detail: string) {
  recordWorldEvent(world, {
    id: world.nextEvent++,
    month: world.month,
    type: 'population',
    title,
    detail,
    ...(region.nation >= 0 ? { nation: region.nation } : {}),
    region: region.id,
  })

}

export function beginPopulationMonth(world: World) {
  ensurePopulation(world)
  for (const region of economicRegions(world)) {
    const metrics = region.populationDynamics!
    for (const field of [
      'immigrants',
      'emigrants',
      'refugees',
      'culturalChanges',
      'languageChanges',
      'beliefChanges',
      'politicalChanges',
    ] as const)
      metrics[field] = 0
  }
}
/** Publications and belief events seed adopters; they never relabel a whole nation. */
export function introduceCulturalLegacy(
  world: World,
  nation: number,
  regionId: number,
  kind: 'literature' | 'belief' | 'institution',
  name: string,
  effects: HistoricalEffect[] = [],
) {
  ensurePopulation(world)
  if (kind === 'institution') return
  const region =
      world.regions[regionId]?.nation === nation
        ? world.regions[regionId]
        : world.regions[world.nations[nation].capital],
    axis = kind === 'belief' ? 'belief' : 'movement',
    label = kind === 'belief' ? name : `Readers of ${name}`,
    reform = effects.some(
      (effect) =>
        (effect.stat === 'pluralism' && effect.amount > 0) ||
        (effect.stat === 'education' && effect.amount > 0),
    ),
    commercial = effects.some(
      (effect) =>
        (effect.stat === 'tradeCapacity' && effect.amount > 0) ||
        (effect.stat === 'tradeCost' && effect.amount < 0),
    ),
    orientation: IdentityDefinition['orientation'] = commercial ? 'commerce' : reform ? 'reform' : 'communal',
    prior = identityDistribution(region.communities!, axis)[0]?.id,
    existing = world.demography!.identities.find(
      (identity) =>
        identity.kind === axis &&
        identity.name.toLocaleLowerCase() === label.slice(0, 180).toLocaleLowerCase(),
    ),
    id =
      existing?.id ??
      registerIdentity(world, axis, label, region.id, prior === undefined ? [] : [prior], orientation)
  world.demography!.identities[id].momentum = 1
  let remaining = Math.max(1, Math.min(500, Math.floor(population(region) * 0.004)))
  for (const group of [...region.communities!].sort(
    (a, b) => b.literacy + b.urban - (a.literacy + a.urban),
  )) {
    if (remaining < 1) break
    if (group[axis] === id) continue
    const moved = splitCommunity(
      region,
      group,
      { [axis]: id },
      Math.min(0.02, remaining / Math.max(1, communitySize(group))),
    )
    remaining -= moved
    if (axis === 'belief') region.populationDynamics!.beliefChanges += moved
    else region.populationDynamics!.politicalChanges += moved
  }
  rollupPopulation(region)
}

export function evolveIdentities(world: World) {
  ensurePopulation(world)
  const state = world.demography!
  if (state.lastEvolution === world.month) return
  state.lastEvolution = world.month
  const totals = world.regions.map(population),
    distributions = world.regions.map(
      (region) =>
        Object.fromEntries(
          AXES.map((axis) => [axis, identityDistribution(region.communities!, axis)]),
        ) as Record<IdentityAxis, { id: number; count: number }[]>,
    ),
    contacts = world.regions.map(
      (region) =>
        new Map<number, number>([
          [region.id, 1],
          ...region.neighbors.map((id) => [id, 0.04 + region.infrastructure * 0.03] as [number, number]),
        ]),
    )
  for (const route of world.routes) {
    const strength = Math.min(
      0.5,
      route.volume / Math.max(100, Math.min(totals[route.from], totals[route.to]) * 0.02),
    )
    contacts[route.from].set(route.to, (contacts[route.from].get(route.to) ?? 0) + strength)
    contacts[route.to].set(route.from, (contacts[route.to].get(route.from) ?? 0) + strength)
  }
  for (const identity of state.identities) identity.momentum *= 0.996
  for (const region of world.regions) {
    if (!population(region)) continue
    const index = communityIndex(region.communities!),
      nation = governance(world, region.nation),
      official = nation.identity!,
      metrics = region.populationDynamics!,
      exposure = Object.fromEntries(AXES.map((axis) => [axis, new Map<number, number>()])) as Record<
        IdentityAxis,
        Map<number, number>
      >
    for (const [other, contact] of contacts[region.id])
      for (const axis of AXES)
        for (const entry of distributions[other][axis])
          exposure[axis].set(
            entry.id,
            (exposure[axis].get(entry.id) ?? 0) + (entry.count / Math.max(1, totals[other])) * contact,
          )
    for (const axis of ['belief', 'movement'] as const)
      for (const [id, value] of exposure[axis]) {
        const definition = state.identities[id]
        exposure[axis].set(
          id,
          Math.pow(value, 0.8) + (definition.origin === region.id ? 0.13 : 0.04) * definition.momentum,
        )
      }
    if (nation.policies.beliefPolicy !== 'protected')
      exposure.belief.set(
        official.belief,
        (exposure.belief.get(official.belief) ?? 0) +
          (nation.policies.beliefPolicy === 'restricted' ? 0.45 : 0.15),
      )
    const contact = [...contacts[region.id]].reduce(
        (sum, [id, weight]) => sum + (id === region.id ? 0 : weight),
        0,
      ),
      cultures = distributions[region.id].culture,
      diversity =
        1 - cultures.reduce((sum, entry) => sum + (entry.count / Math.max(1, totals[region.id])) ** 2, 0)
    metrics.diversity = diversity
    metrics.mixing = clamp(
      metrics.mixing +
        (diversity * Math.min(1, region.urban + 0.3) * (0.5 + region.happiness * 0.5) - metrics.mixing) *
          0.004,
    )
    metrics.isolation = clamp(metrics.isolation + ((contact < 0.2 ? 1 : 0) - metrics.isolation) * 0.003)
    // Shared local identities form after sustained contact, not at border changes.
    if (
      world.month - metrics.lastCulture >= 240 &&
      metrics.mixing > 0.18 &&
      cultures.length > 1 &&
      cultures[1].count / totals[region.id] > 0.12 &&
      region.urban > 0.4 &&
      region.unrest < 45
    ) {
      const parents = cultures.slice(0, 2).map((entry) => entry.id),
        existing = state.identities.find(
          (identity) =>
            identity.kind === 'culture' &&
            identity.origin === region.id &&
            identity.parents.join(',') === parents.join(','),
        ),
        id =
          existing?.id ??
          registerIdentity(world, 'culture', `${region.name} common identity`, region.id, parents)
      state.identities[id].language = distributions[region.id].language[0].id
      metrics.lastCulture = world.month
      for (const group of [...region.communities!])
        if (parents.includes(group.culture))
          metrics.culturalChanges += splitCommunity(
            region,
            group,
            { culture: id },
            0.008,
            [2, 0.5, 0.1],
            index,
          )
      note(
        world,
        region,
        `A shared identity takes root in ${region.name}`,
        'Sustained contact has given some households a shared local identity. Older affiliations continue alongside it.',
      )
    }
    if (
      world.month - metrics.lastLanguage >= 600 &&
      metrics.isolation > 0.7 &&
      nation.policies.languagePolicy === 'local' &&
      region.literacy < 0.65
    ) {
      const parent = distributions[region.id].language[0].id,
        existing = state.identities.find(
          (identity) =>
            identity.kind === 'language' &&
            identity.origin === region.id &&
            identity.parents.includes(parent),
        ),
        id =
          existing?.id ?? registerIdentity(world, 'language', `${region.name} dialect`, region.id, [parent])
      metrics.lastLanguage = world.month
      for (const group of [...region.communities!])
        if (group.language === parent)
          metrics.languageChanges += splitCommunity(
            region,
            group,
            { language: id },
            0.01,
            [2, 0.4, 0.1],
            index,
          )
      note(
        world,
        region,
        `${region.name} develops a distinct dialect`,
        'Long local continuity and limited outside contact distinguish a local form of speech. Its speakers remain connected to a wider language family.',
      )
    }
    for (const group of [...region.communities!]) {
      const exclusion = discrimination(world, region, group),
        school = effectMultiplier(world, 'education', nation.id, region.id),
        related =
          group.language === official.language ||
          state.identities[group.language].parents.includes(official.language) ||
          state.identities[official.language].parents.includes(group.language),
        learning =
          (0.001 + region.literacy * 0.003 + region.urban * 0.002) *
          school *
          (related ? 1 : 0.55) *
          (1 - exclusion * 0.3)
      group.fluency =
        group.language === official.language ? 1 : clamp(group.fluency + (1 - group.fluency) * learning)
      const culture = choose(state, exposure.culture),
        language =
          nation.policies.languagePolicy === 'common' ? official.language : choose(state, exposure.language),
        belief = choose(state, exposure.belief),
        movement = choose(state, exposure.movement)
      if (culture !== group.culture) {
        const rate =
          0.00022 *
          (0.3 + group.urban) *
          (1 - group.rootedness * 0.75) *
          (nation.policies.citizenship === 'pluralist' ? 0.35 : 1)
        metrics.culturalChanges += splitCommunity(region, group, { culture }, rate, [2, 0.5, 0.1], index)
      }
      const relatedNative =
        state.identities[language].parents.includes(group.language) ||
        state.identities[group.language].parents.includes(language)
      if (
        language !== group.language &&
        (language === official.language ? group.fluency > 0.5 : relatedNative)
      ) {
        const rate =
          0.0006 *
          (language === official.language ? group.fluency : 0.7) *
          (nation.policies.languagePolicy === 'common' ? 1.8 : 0.35)
        metrics.languageChanges += splitCommunity(region, group, { language }, rate, [2.5, 0.35, 0.05], index)
      }
      if (belief !== group.belief) {
        const pressure = belief === official.belief && nation.policies.beliefPolicy === 'restricted' ? 1.8 : 1
        metrics.beliefChanges += splitCommunity(
          region,
          group,
          { belief },
          0.0007 * (0.5 + group.literacy + group.urban) * pressure * (1 - group.rootedness * 0.5),
          [1.5, 1, 0.3],
          index,
        )
      }
      if (movement !== group.movement) {
        const orientation = state.identities[movement].orientation,
          affinity =
            orientation === 'reform'
              ? group.literacy + exclusion
              : orientation === 'local'
                ? group.grievance + group.rootedness * 0.4
                : orientation === 'institutional'
                  ? group.loyalty
                  : orientation === 'commerce'
                    ? group.urban + group.wealth
                    : 0.5
        metrics.politicalChanges += splitCommunity(
          region,
          group,
          { movement },
          0.0014 * (0.3 + affinity),
          [0.8, 1.2, 0.4],
          index,
        )
      }
      if (group.allegiance !== region.nation && group.loyalty > 0.65)
        metrics.politicalChanges += splitCommunity(
          region,
          group,
          { allegiance: region.nation },
          0.0015 * group.loyalty,
          [2, 0.8, 0.15],
          index,
        )
      else if (group.allegiance !== -1 && group.grievance > 0.5 && group.loyalty < 0.4)
        metrics.politicalChanges += splitCommunity(
          region,
          group,
          { allegiance: -1 },
          0.0015 * group.grievance,
          [0.7, 1.2, 0.5],
          index,
        )
    }
    rollupPopulation(region)
    metrics.cohesion =
      region.communities!.reduce((sum, group) => sum + communitySize(group) * (1 - group.grievance), 0) /
      Math.max(1, population(region))
    metrics.discrimination =
      region.communities!.reduce(
        (sum, group) => sum + communitySize(group) * discrimination(world, region, group),
        0,
      ) / Math.max(1, population(region))
  }
}

export function populationIdentitySummary(world: World, nation: number, regionId?: number) {
  const regions = world.regions.filter((region) =>
      regionId === undefined ? region.nation === nation : region.id === regionId,
    ),
    groups = [
      ...regions.flatMap((region) => region.communities ?? []),
      ...(regionId === undefined
        ? allForces(world)
            .filter((army) => army.nation === nation)
            .flatMap((army) => army.communities ?? [])
        : []),
    ],
    total = groups.reduce((sum, group) => sum + communitySize(group), 0),
    distribution = (axis: IdentityAxis) =>
      identityDistribution(groups, axis)
        .slice(0, 8)
        .map((entry) => ({
          id: entry.id,
          name: world.demography?.identities[entry.id]?.name ?? 'Unrecorded identity',
          people: entry.count,
          share: entry.count / Math.max(1, total),
        }))
  return {
    people: total,
    cultures: distribution('culture'),
    languages: distribution('language'),
    beliefs: distribution('belief'),
    movements: distribution('movement'),
    loyalty:
      groups.reduce((sum, group) => sum + communitySize(group) * group.loyalty, 0) / Math.max(1, total),
    displaced: Math.round(groups.reduce((sum, group) => sum + communitySize(group) * group.displacement, 0)),
    fluent:
      groups.reduce(
        (sum, group) =>
          sum +
          communitySize(group) *
            (group.knownLanguage === world.nations[nation].identity?.language
              ? group.fluency
              : group.language === world.nations[nation].identity?.language
                ? 1
                : 0),
        0,
      ) / Math.max(1, total),
    discrimination:
      regions.reduce(
        (sum, region) => sum + (region.populationDynamics?.discrimination ?? 0) * population(region),
        0,
      ) / Math.max(1, total),
    transitions: regions.reduce(
      (sum, region) =>
        sum +
        (region.populationDynamics?.beliefChanges ?? 0) +
        (region.populationDynamics?.culturalChanges ?? 0) +
        (region.populationDynamics?.languageChanges ?? 0) +
        (region.populationDynamics?.politicalChanges ?? 0),
      0,
    ),
  }
}
