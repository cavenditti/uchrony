import type { BirthCohort, PopulationCommunity } from './population-types'

/** Dated cohorts are numeric tuples; clone the extensible social record normally
 * and copy its large tuple array directly, preserving optional-field presence. */
export function cloneCommunity(group: PopulationCommunity): PopulationCommunity {
  const copy = structuredClone({ ...group, ageCohorts: undefined }) as PopulationCommunity
  if (!Object.hasOwn(group, 'ageCohorts')) delete copy.ageCohorts
  if (group.ageCohorts) copy.ageCohorts = group.ageCohorts.map((c): BirthCohort => [c[0], c[1], c[2]])
  return copy
}

/** Isolate settlement trials without sending millions of numeric tuples through structuredClone. */
export function clonePopulationHolders<T extends { communities?: PopulationCommunity[] }>(holders: T[]): T[] {
  const result: T[] = structuredClone(holders.map((holder) => ({ ...holder, communities: undefined })))
  holders.forEach((holder, i) => {
    if (!Object.hasOwn(holder, 'communities')) delete result[i].communities
    if (!holder.communities) return
    const groups: PopulationCommunity[] = structuredClone(
      holder.communities.map((group) => ({ ...group, ageCohorts: undefined })),
    )
    holder.communities.forEach((group, j) => {
      if (!Object.hasOwn(group, 'ageCohorts')) delete groups[j].ageCohorts
      if (group.ageCohorts)
        groups[j].ageCohorts = group.ageCohorts.map((cohort): BirthCohort => [
          cohort[0],
          cohort[1],
          cohort[2],
        ])
    })
    result[i].communities = groups
  })
  return result
}
