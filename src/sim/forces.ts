import { clamp, type Army, type World } from './types'
export const allForces = (world: World): Army[] => [...world.armies, ...(world.warfare?.fleets ?? [])]
export const militaryPeople = (world: World, nation: number) =>
  allForces(world)
    .filter((f) => f.nation === nation)
    .reduce((sum, f) => sum + f.soldiers, 0)
export function unitLoyalty(world: World, force: Army) {
  const total = Math.max(1, force.soldiers),
    language = world.nations[force.nation].identity?.language
  let loyalty = 0,
    fluency = 0
  for (const g of force.communities ?? []) {
    const size = g.population.children + g.population.adults + g.population.elders
    loyalty += size * g.loyalty
    fluency += size * (g.language === language ? 1 : g.knownLanguage === language ? g.fluency : 0)
  }
  return {
    loyalty: clamp(loyalty / total),
    cohesion: clamp(0.55 + (loyalty / total) * 0.3 + (fluency / total) * 0.15),
  }
}
