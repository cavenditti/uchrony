import { placeLabels } from './almanac'
import { economicLandscape } from './economic-landscape'
import { mapHomesSnapshot, mapMeshSnapshot } from './map-snapshot'
import { urbanBlocks } from './urban-blocks'
import { clamp, GOODS, type Inventory, type Army, type World } from './types'
import { unitLoyalty } from './forces'
import type { IdentityAxis, PopulationCommunity } from './population-types'
import { STRATA, type EconomicStratum } from './economic-types'
import { communitySize } from './population'
import { localFirmRegion } from './local-units'
import { spatialState } from './spatial'

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
export function viewSnapshot(world: World, detailNation?: number | null): Omit<World, 'cells'> {
  const includes = (nation: number) => detailNation === undefined || detailNation === nation
  const places = new Set(
    (world.localEconomy ? Object.values(world.localEconomy.units) : world.regions)
      .filter((unit) => includes(unit.nation))
      .map((unit) => unit.id),
  )
  const firms = world.economy?.firms?.filter((firm) => places.has(localFirmRegion(firm)))
  const borrowers = new Set([
    ...[...places].flatMap((id) => [`producer:${id}`, ...STRATA.map((s) => `household:${id}:${s}`)]),
    ...(firms ?? []).map((firm) => `firm:${firm.id}`),
  ])
  const bankLoans: Record<number, number> = {}
  for (const loan of world.economy?.credit.loans ?? [])
    if (loan.bank !== undefined) bankLoans[loan.bank] = (bankLoans[loan.bank] ?? 0) + loan.principal
  const { cells: _cells, ...rest } = world
  const strata = new Map<number, Partial<Record<EconomicStratum, number>>>()
  if (world.localEconomy)
    for (const r of world.regions)
      for (const g of includes(r.nation) ? (r.communities ?? []) : []) {
        const id = g.locality ?? r.id,
          counts = strata.get(id) ?? {},
          stratum = g.stratum ?? 'laborer'
        counts[stratum] = (counts[stratum] ?? 0) + communitySize(g)
        strata.set(id, counts)
      }
  const shipmentTotals: Record<number, { arriving: number; leaving: number }> = {}
  for (const shipment of world.localEconomy?.shipments ?? []) {
    const from = (shipmentTotals[shipment.from] ??= { arriving: 0, leaving: 0 })
    const to = (shipmentTotals[shipment.to] ??= { arriving: 0, leaving: 0 })
    from.leaving += shipment.quantity
    to.arriving += shipment.quantity
  }
  // Work ledgers and production forecasts are not display data. One shared empty
  // inventory also remains shared across structuredClone/postMessage. None of
  // these projected work buffers may be used to save or advance a world.
  const empty = Object.fromEntries(GOODS.map((good) => [good, 0])) as Inventory
  const e = world.economy
  const project = <T extends PopulationHolder>(entity: T): T => {
    const { communities: _communities, ...data } = entity
    return { ...data, census: censusOf(entity, world.month) } as T
  }
  return {
    ...rest,
    viewOnly: true,
    almanac: undefined,
    viewPlaces: placeLabels(world),
    viewLandscape: economicLandscape(world),
    ...(world.adaptive
      ? {
          viewHomes: mapHomesSnapshot(world),
          viewMesh: mapMeshSnapshot(world),
          viewUrbanBlocks: urbanBlocks(world),
        }
      : {}),
    ...(detailNation !== undefined ? { viewNation: detailNation, viewBankLoans: bankLoans } : {}),
    spatial: spatialState(world),
    ...(e
      ? {
          economy: {
            ...e,
            ...(detailNation !== undefined
              ? {
                  households: Object.fromEntries(
                    Object.entries(e.households).filter(([id]) => places.has(+id)),
                  ),
                  credit: {
                    ...e.credit,
                    loans: e.credit.loans.filter((loan) => borrowers.has(loan.borrower)),
                  },
                  ...(e.banking
                    ? {
                        banking: {
                          ...e.banking,
                          accounts: {},
                          banks: e.banking.banks.map((bank) => ({ ...bank, owners: {} })),
                        },
                      }
                    : {}),
                }
              : {}),
            ledger: { ...e.ledger, opening: {}, net: {}, entries: [] },
            inventoryPrices: undefined,
            ...(e.accounts ? { accounts: { ...e.accounts, businesses: {}, stores: {} } } : {}),
            producers: Object.fromEntries(
              Object.entries(e.producers)
                .filter(([id]) => places.has(+id))
                .map(([id, p]) => [
                  id,
                  {
                    ...p,
                    projects: [],
                    forecast: empty,
                    planned: empty,
                    sold: empty,
                    inputTargets: empty,
                    openingStocks: empty,
                    losses: empty,
                    intermediate: empty,
                  },
                ]),
            ),
            firms: firms?.map((f) => ({
              ...f,
              projects: [],
              prices: empty,
              production: empty,
              planned: empty,
              forecast: empty,
              sold: empty,
              laborMix: undefined,
              labor: undefined,
            })),
          },
        }
      : {}),
    ...(world.adaptive
      ? {
          adaptive: {
            ...world.adaptive,
            sites: {},
            commuting: [],
            commutingRows: [],
            commuteRoutes: {},
            construction: [],
            boundaries: [],
            transit: [],
            tree: { leaves: [], changed: {}, month: world.adaptive.tree.month },
            jurisdictions: Object.fromEntries(
              Object.entries(world.adaptive.jurisdictions).filter(([, j]) => j.retired === undefined),
            ),
          },
        }
      : {}),
    ...(world.localEconomy
      ? {
          localEconomy: {
            ...world.localEconomy,
            shipments: [],
            shipmentTotals,
            units: Object.fromEntries(
              Object.entries(world.localEconomy.units).map(([id, u]) => {
                const { communities: _communities, census: _census, ...data } = u
                return [
                  id,
                  {
                    ...data,
                    strataCounts: strata.get(+id) ?? {},
                    ...(includes(u.nation)
                      ? {}
                      : {
                          stocks: empty,
                          production: empty,
                          plannedProduction: empty,
                          consumption: empty,
                          prices: empty,
                          populationDynamics: undefined,
                        }),
                  },
                ]
              }),
            ),
          },
        }
      : {}),
    regions: world.regions.map(project),
    armies: world.armies.map(project),
    ...(world.warfare ? { warfare: { ...world.warfare, fleets: world.warfare.fleets.map(project) } } : {}),
  }
}
