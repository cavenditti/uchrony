import { resolveIdentityPolicy } from './identity-policy'
import { identityStateAppeal } from './identity-politics'
/** Migration plans are simultaneous: destinations are observed before any arrival.
 * Cohorts and their financial claims move together; occupational changes preserve totals. */
import { expectedInteger, extractAges } from './age-cohorts'
import { apportion } from './allocation'
import { relocateHouseholdClaims } from './district-finance'
import { STRATA, type EconomicStratum } from './economic-types'
import { effectValue } from './effects'
import { governance } from './governance'
import { landComponents } from './land-connectivity'
import { householdAccount, stratumPeople, transfer } from './ledger'
import { economicRegion, economicRegions } from './local-units'
import { MODEL_PARAMETERS } from './model-parameters'
import {
  addCommunity,
  AGES,
  communityIndex,
  communitySize,
  discrimination,
  rollupPopulation,
} from './population'
import type { Cohorts, PopulationCommunity } from './population-types'
import { random } from './random'
import { relocateResidentialResidents } from './residential-sites'
import { settlementMigrationOptions } from './settlement-access'
import { simulationMonths } from './simulation-period'
import { habitableLand } from './terrain-access'
import { clamp, population, relation, type Region, type World } from './types'
/** Plan all moves against opening destinations, then transfer cohorts and their claims. */
export function migrateCommunities(world: World, months = 1, coarse = false) {
  const housing = settlementMigrationOptions(world, coarse)
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
          identityPolicy: resolveIdentityPolicy(governance(world, region.nation).policies),
          strata: Object.fromEntries(STRATA.map((s) => [s, stratumPeople(world, region.id, s)])) as Record<
            EconomicStratum,
            number
          >,
          language,
          belief,
          culture,
          people: Math.max(1, population(region)),
          appeal: Object.fromEntries(
            STRATA.map((s) => [
              s,
              region.happiness * 0.35 +
                region.health * 0.2 +
                region.foodCoverage * 0.2 +
                region.infrastructure * 0.1 +
                economicAppeal(world, region, s),
            ]),
          ) as Record<EconomicStratum, number>,
          crowding: 0.04 * Math.log1p(population(region) / Math.max(1, region.cells.length * 12000)),
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
  const land = landComponents(world)
  const candidatesByRegion = Object.fromEntries(
    economicRegions(world).map(
      (region) =>
        [
          region.id,
          [
            ...new Set([
              ...region.neighbors.filter((id) => {
                const other = economicRegion(world, id)
                return other && land[region.center] >= 0 && land[region.center] === land[other.center]
              }),
              ...(housing.candidates.get(region.id) ?? []),
              ...(sea.get(region.id)?.keys() ?? []),
            ]),
          ]
            .map((id) => economicRegion(world, id))
            .filter(
              (to) => to && to.id !== region.id && to.cells.some((id) => habitableLand(world.cells[id])),
            ),
        ] as const,
    ),
  )
  for (const region of economicRegions(world)) {
    const travelCosts = new Map<number, number>()
    if (world.localEconomy)
      for (const to of [region, ...candidatesByRegion[region.id]])
        travelCosts.set(
          to.id,
          destinations[to.id].crowding +
            (Math.hypot(
              world.cells[to.center].q - world.cells[region.center].q,
              world.cells[to.center].r - world.cells[region.center].r,
            ) *
              0.002) /
              (1 + to.infrastructure),
        )
    for (const group of region.communities!) {
      const size = communitySize(group)
      if (!size) continue
      const pressure = clamp(
          region.devastation * 0.75 +
            Math.max(0, 0.8 - region.foodCoverage) * 0.8 +
            discrimination(world, region, group, destinations[region.id].protection) * 0.35,
        ),
        // Forced displacement uses a calibrated threshold on unit pressure;
        // its destination constraints differ from ordinary economic migration.
        refugee = pressure > 0.17,
        appeal = (to: Region) => {
          const destination = destinations[to.id],
            compatible =
              ((destination.language.get(group.language) ?? 0) * 0.6 +
                (destination.belief.get(group.belief) ?? 0) * 0.2 +
                (destination.culture.get(group.culture) ?? 0) * 0.2) /
              destination.people
          return (
            destination.appeal[group.stratum ?? 'laborer'] +
            compatible * 0.12 +
            identityStateAppeal(
              group,
              governance(world, to.nation),
              destination.identityPolicy,
              destination.protection,
            ) *
              0.15 -
            (travelCosts.get(to.id) ?? 0) +
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
          (governance(world, region.nation).policies.migration !== 'closed' &&
            governance(world, candidate.nation).policies.migration !== 'closed' &&
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
            : governance(world, to.nation).policies.migration === 'closed'
              ? refugee
                ? 0.025
                : 0
              : governance(world, to.nation).policies.migration === 'controlled'
                ? 0.3
                : 0.7,
        rate = clamp((bestAppeal - appeal(region) - 0.025) * 0.012 + pressure * 0.01, 0, 0.018) * border,
        wanted = Math.floor(
          size * (months === 1 ? rate : 1 - (1 - rate) ** months) * (1 - group.rootedness * 0.4),
        ),
        maritime =
          (!region.neighbors.includes(to.id) ||
            land[region.center] < 0 ||
            land[region.center] !== land[to.center]) &&
          !(housing.candidates.get(region.id) ?? []).includes(to.id),
        capacity = maritime ? (sea.get(region.id)?.get(to.id) ?? 0) * months : Infinity,
        amount = Math.min(
          wanted,
          capacity,
          world.adaptive && !refugee ? (housing.vacancies.get(to.id) ?? 0) : Infinity,
        )
      if (amount < 1) continue
      const allocation = apportion(
        amount,
        [group.population.children * 0.9, group.population.adults * 1.2, group.population.elders * 0.4],
        AGES.map((age) => group.population[age]),
      )
      if (world.adaptive && !refugee) housing.vacancies.set(to.id, housing.vacancies.get(to.id)! - amount)
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
      language = world.nations[plan.to.nation]?.identity?.language ?? plan.source.language
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
  relocateResidentialResidents(
    world,
    plans.map((p) => ({ from: p.from.id, to: p.to.id, people: communitySize(p.incoming!) })),
  )
}
/** Move a bounded share of dated cohorts into a new joint-identity group. */
export function splitCommunity(
  region: Region,
  source: PopulationCommunity,
  changes: Partial<
    Pick<PopulationCommunity, 'culture' | 'language' | 'belief' | 'movement' | 'allegiance' | 'stratum'>
  >,
  rate: number,
  ageFactors = [1, 1, 1],
  index?: Map<string, PopulationCommunity>,
  rounding?: { rng: number },
) {
  const counts = { children: 0, adults: 0, elders: 0 }
  AGES.forEach((age, index) => {
    const expected = source.population[age] * clamp(rate * ageFactors[index], 0, 0.15)
    counts[age] = Math.min(
      source.population[age],
      Math.floor(expected) + (rounding && random(rounding) < expected % 1 ? 1 : 0),
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
  const realWage = f.wage / simulationMonths() / Math.max(0.01, region.prices.food / 14)
  return employment * 0.12 + Math.min(0.08, realWage * 20)
}
/** Change occupations only after preserving cohort totals and transferring household cash. */
export function advanceEconomicStrata(world: World, months = 1) {
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
      const rate = MODEL_PARAMETERS.mobilityMonthly * clamp(opportunity)
      const amount = Math.min(
        size,
        expectedInteger(
          world,
          months === 1
            ? size * MODEL_PARAMETERS.mobilityMonthly * clamp(opportunity)
            : size * (1 - (1 - rate) ** months),
        ),
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
