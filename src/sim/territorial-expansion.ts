import { communitySize } from './population'
import { clamp, population, type Nation, type Region, type World } from './types'

export function culturalAffinity(nation: Nation, region: Region) {
  const people = population(region)
  if (!people || !nation.identity) return 0
  return (
    (region.communities ?? []).reduce(
      (sum, group) =>
        sum +
        communitySize(group) *
          ((group.culture === nation.identity!.culture ? 0.6 : 0) +
            (group.language === nation.identity!.language ? 0.4 : 0)),
      0,
    ) / people
  )
}

/** Productive land and related communities give expansion a concrete payoff.
 * This is a preference, never an exemption from founding's material costs. */
export function frontierValue(world: World, nation: Nation, region: Region) {
  const foodNeed = 1 + clamp(1.2 - nation.foodCoverage) * 2
  const resources = region.deposits.iron * 0.8 + region.deposits.coal * 0.5 + region.deposits.timber * 0.3
  const economic =
    region.fertility * foodNeed + resources + clamp(region.gdp / Math.max(1, population(region)) / 0.01) * 0.3
  const cultural = culturalAffinity(nation, region)
  const at = world.cells[region.center],
    home = world.cells[world.regions[nation.capital].center]
  const distance = Math.hypot(at.x - home.x, at.y - home.y)
  return { economic, cultural, score: economic + cultural * 1.2 + 0.3 / (1 + distance / 20) }
}

/** Political integration changes jurisdiction, not ancestry, goods, or homes. */
export function claimIndependentProvince(world: World, region: Region, nation: number, voluntary: boolean) {
  if (region.nation !== -1) throw new Error('Only independent land can join a state.')
  region.nation = nation
  for (const group of region.communities ?? []) {
    group.host = nation
    if (voluntary && group.allegiance === -1) {
      group.allegiance = nation
      group.loyalty = Math.max(0.6, group.loyalty)
    }
  }
  if (world.localEconomy)
    for (const id of world.localEconomy.active) {
      const unit = world.localEconomy.units[id]
      if (unit.province === region.id) {
        unit.nation = nation
        for (const group of unit.communities ?? []) group.host = nation
      }
    }
  if (world.adaptive) {
    for (const level of ['province', 'municipality'] as const) {
      const id = `${level}:${region.id}`
      world.adaptive.jurisdictions[id] = {
        id,
        level,
        name: region.name,
        nation,
        seat: region.center,
        cells: [...region.cells],
        founded: world.month,
        revised: world.month,
        predecessors: [],
        successors: [],
        account: `government:${nation}`,
      }
    }
    world.adaptive.revision++
  }
}
