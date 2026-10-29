/** Personnel movements transfer dated people between civilian and military holders.
 * Rebuild only affected home censuses after retirement or demobilization. */
import { cohortDeaths, extractAges } from './age-cohorts'
import { apportion } from './allocation'
import { allForces } from './forces'
import type { Fleet } from './military-types'
import { armyStore, fleetStore, marketStore, recordGift } from './national-accounts'
import {
  addCommunity,
  AGES,
  coalesceCommunities,
  communitySize,
  ensurePopulation,
  rollupPopulation,
} from './population'
import { cloneCommunity } from './population-clone'
import type { PopulationCommunity } from './population-types'
import { clamp, type Army, type Region, type World } from './types'
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
/** Extract eligible adults without synthesizing cohorts or exceeding available people. */
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
/** Remove civilian adult casualties and reconcile their local census. */
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
/** Apportion casualties over the formation’s actual dated cohorts. */
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
/** Return surviving military people and inventories to a civilian home. */
export function returnArmyPeople(world: World, army: Army, region: Region) {
  ensurePopulation(world)
  for (const source of army.communities!) {
    const group = cloneCommunity(source)
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
/** Demobilize a bounded number of soldiers back into local communities. */
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
/** Age military cohorts and return retirees to their capital’s civilian census. */
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
