import { clamp, type Army, type World } from './types'
import { unitLoyalty } from './forces'
import type { IdentityAxis, PopulationCommunity } from './population-types'
import type { EconomicStratum } from './economic-types'
import { communitySize } from './population'

const axes: IdentityAxis[] = ['culture', 'language', 'belief', 'movement']
export interface PopulationCensus {
  groups: number
  total: number
  identities: Record<IdentityAxis, Record<number, number>>
  strata: Partial<Record<EconomicStratum, number>>
  weighted: Record<'loyalty' | 'displacement' | 'grievance', number>
  fluent: Record<number, number>
  ageSex: { age: string; female: number; male: number }[]
  hasAges: boolean
  largest: PopulationCommunity[]
}
type PopulationHolder = { communities?: PopulationCommunity[]; census?: PopulationCensus }
function emptyCensus(): PopulationCensus {
  return {
    groups: 0,
    total: 0,
    identities: { culture: {}, language: {}, belief: {}, movement: {} },
    strata: {},
    weighted: { loyalty: 0, displacement: 0, grievance: 0 },
    fluent: {},
    ageSex: Array.from({ length: 22 }, (_, i) => ({ age: `${i * 5}–${i * 5 + 4}`, female: 0, male: 0 })),
    hasAges: false,
    largest: [],
  }
}
/** Exact display aggregates. The simulation keeps every dated cohort and joint identity. */
export function censusOf(holder: PopulationHolder, month: number): PopulationCensus {
  if (holder.census) return holder.census
  const census = emptyCensus(),
    groups = holder.communities ?? []
  census.groups = groups.length
  for (const g of groups) {
    const size = communitySize(g)
    census.total += size
    for (const axis of axes) census.identities[axis][g[axis]] = (census.identities[axis][g[axis]] ?? 0) + size
    const stratum = g.stratum ?? 'laborer'
    census.strata[stratum] = (census.strata[stratum] ?? 0) + size
    for (const key of ['loyalty', 'displacement', 'grievance'] as const) census.weighted[key] += size * g[key]
    census.fluent[g.language] = (census.fluent[g.language] ?? 0) + size
    if (g.knownLanguage !== g.language)
      census.fluent[g.knownLanguage] = (census.fluent[g.knownLanguage] ?? 0) + size * g.fluency
    census.hasAges ||= !!g.ageCohorts
    for (const [born, female, male] of g.ageCohorts ?? []) {
      const bin = census.ageSex[Math.min(21, Math.max(0, Math.floor((month - born) / 60)))]
      bin.female += female
      bin.male += male
    }
  }
  census.largest = [...groups]
    .sort((a, b) => communitySize(b) - communitySize(a))
    .slice(0, 12)
    .map(({ ageCohorts: _ages, ...g }) => g)
  return census
}
export function mergeCensuses(censuses: PopulationCensus[]): PopulationCensus {
  const sum = emptyCensus()
  const add = (target: Record<string, number>, source: Record<string, number>) => {
    for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value
  }
  for (const c of censuses) {
    sum.groups += c.groups
    sum.total += c.total
    for (const axis of axes) add(sum.identities[axis], c.identities[axis])
    add(sum.strata, c.strata)
    add(sum.weighted, c.weighted)
    add(sum.fluent, c.fluent)
    sum.hasAges ||= c.hasAges
    c.ageSex.forEach((bin, i) => {
      sum.ageSex[i].female += bin.female
      sum.ageSex[i].male += bin.male
    })
    sum.largest.push(...c.largest)
  }
  // A global top twelve must be in an entity's local top twelve; stable sort preserves ties.
  sum.largest.sort((a, b) => communitySize(b) - communitySize(a))
  sum.largest.length = Math.min(12, sum.largest.length)
  return sum
}
export const censusDistribution = (census: PopulationCensus, axis: IdentityAxis) =>
  Object.entries(census.identities[axis])
    .map(([id, count]) => ({ id: Number(id), count }))
    .sort((a, b) => b.count - a.count || a.id - b.id)

/** Naval dossiers use the same weighted loyalty/fluency as the canonical force. */
export function censusUnitLoyalty(world: World, force: Army) {
  if (!world.viewOnly || !force.census) return unitLoyalty(world, force)
  const total = Math.max(1, force.soldiers),
    language = world.nations[force.nation].identity?.language
  const loyalty = force.census.weighted.loyalty / total
  const fluency = (language === undefined ? 0 : (force.census.fluent[language] ?? 0)) / total
  return { loyalty: clamp(loyalty), cohesion: clamp(0.55 + loyalty * 0.3 + fluency * 0.15) }
}

/** UI-only data must never be used as a save or as simulation input. */
export function viewSnapshot(world: World): Omit<World, 'cells'> {
  const { cells: _cells, ...rest } = world
  const residents = new Map<number, PopulationCommunity[]>()
  if (world.localEconomy)
    for (const r of world.regions)
      for (const g of r.communities ?? []) {
        const id = g.locality ?? r.id,
          groups = residents.get(id) ?? []
        groups.push(g)
        residents.set(id, groups)
      }
  const project = <T extends PopulationHolder>(entity: T): T => {
    const { communities: _communities, ...data } = entity
    return { ...data, census: censusOf(entity, world.month) } as T
  }
  return {
    ...rest,
    viewOnly: true,
    ...(world.localEconomy
      ? {
          localEconomy: {
            ...world.localEconomy,
            units: Object.fromEntries(
              Object.entries(world.localEconomy.units).map(([id, u]) => [
                id,
                project({ ...u, communities: residents.get(+id) ?? [] }),
              ]),
            ),
          },
        }
      : {}),
    regions: world.regions.map(project),
    armies: world.armies.map(project),
    ...(world.warfare ? { warfare: { ...world.warfare, fleets: world.warfare.fleets.map(project) } } : {}),
  }
}
