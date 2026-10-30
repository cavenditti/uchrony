import { COMMUNITY_POLITICAL_FIELDS } from './identity-politics'
import { overseasOptions } from './overseas'
import { placeLabels } from './almanac'
import { withWorldConfiguration } from './configuration'
import { economicLandscape } from './economic-landscape'
import { STRATA, type EconomicStratum } from './economic-types'
import { unitLoyalty } from './forces'
import { firmAccount, householdAccount, producerAccount } from './ledger'
import { localFirmRegion } from './local-units'
import { mapHomesSnapshot, mapMeshSnapshot } from './map-snapshot'
import { communitySize } from './population'
import type { IdentityAxis, PopulationCommunity } from './population-types'
import { spatialState } from './spatial'
import { clamp, GOODS, type Army, type Inventory, type World } from './types'
import { urbanBlocks } from './urban-blocks'

const axes: IdentityAxis[] = ['culture', 'language', 'belief', 'movement']
export interface PopulationCensus {
  groups: number
  total: number
  identities: Record<IdentityAxis, Record<number, number>>
  strata: Partial<Record<EconomicStratum, number>>
  weighted: Record<'loyalty' | 'displacement' | 'grievance', number> &
    Partial<Record<(typeof COMMUNITY_POLITICAL_FIELDS)[number], number>>
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
    for (const key of COMMUNITY_POLITICAL_FIELDS)
      census.weighted[key] =
        (census.weighted[key] ?? 0) + size * (g[key] ?? (key === 'languageTransmission' ? 1 : 0.5))
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
  return withWorldConfiguration(world, () => configuredSnapshot(world, detailNation))
}
function configuredSnapshot(world: World, detailNation?: number | null): Omit<World, 'cells'> {
  const includes = (nation: number) => detailNation === undefined || detailNation === nation
  const places = new Set(
    (world.localEconomy ? Object.values(world.localEconomy.units) : world.regions)
      .filter((unit) => includes(unit.nation))
      .map((unit) => unit.id),
  )
  const firms = world.economy?.firms?.filter((firm) => places.has(localFirmRegion(firm)))
  const borrowers = new Set([
    ...[...places].flatMap((id) => [producerAccount(id), ...STRATA.map((s) => householdAccount(id, s))]),
    ...(firms ?? []).map((firm) => firmAccount(firm.id)),
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
    from.leaving += shipment.quantity / (world.economy?.periodMonths ?? 1)
    to.arriving += shipment.quantity / (world.economy?.periodMonths ?? 1)
  }
  // Work ledgers and production forecasts are not display data. One shared empty
  // inventory also remains shared across structuredClone/postMessage. None of
  // these projected work buffers may be used to save or advance a world.
  const e = world.economy,
    months = e?.periodMonths ?? 1
  const rates = snapshotRates(months),
    { monthly, regionRates } = rates
  const project = <T extends PopulationHolder>(entity: T): T => {
    const { communities: _communities, ...data } = entity
    return { ...data, census: censusOf(entity, world.month) } as T
  }
  return {
    ...rest,
    viewOnly: true,
    viewOverseas:
      detailNation !== null && detailNation !== undefined
        ? { nation: detailNation, options: overseasOptions(world, detailNation) }
        : undefined,
    archive: undefined,
    institutions: world.institutions
      ? {
          ...world.institutions,
          organizations: world.institutions.organizations.map(({ events: _events, calls, ...o }) => ({
            ...o,
            ...(calls ? { calls: calls.filter((c) => c.closed === undefined) } : {}),
          })),
        }
      : undefined,
    ...(months !== 1
      ? {
          totals: monthly(world.totals, ['births', 'deaths', 'migration']),
          routes: world.routes.map((r) => monthly(r, ['volume', 'capacity'])),
        }
      : {}),
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
          economy: projectEconomySnapshot(e, { detailNation, places, borrowers, firms }, rates),
        }
      : {}),
    ...(world.adaptive
      ? {
          adaptive: projectAdaptiveSnapshot(world.adaptive),
        }
      : {}),
    ...(world.localEconomy
      ? {
          localEconomy: projectLocalEconomySnapshot(
            world.localEconomy,
            includes,
            strata,
            shipmentTotals,
            rates,
          ),
        }
      : {}),
    regions: world.regions.map((r) => project(regionRates(r))),
    armies: world.armies.map(project),
    ...(world.overseas
      ? { overseas: { ...world.overseas, expeditions: world.overseas.expeditions.map(project) } }
      : {}),
    ...(world.warfare ? { warfare: { ...world.warfare, fleets: world.warfare.fleets.map(project) } } : {}),
  }
}

/** Rate projection keeps six-month ledgers intact and scales only flow quantities. */
function snapshotRates(months: number) {
  const empty = Object.fromEntries(GOODS.map((good) => [good, 0])) as Inventory
  const monthly = <T extends object>(data: T, keys: readonly string[]): T => {
    if (months === 1) return data
    const result = { ...data } as Record<string, unknown>
    for (const key of keys)
      if (typeof result[key] === 'number') result[key] = (result[key] as number) / months
    return result as T
  }
  const inventoryRate = (data: Inventory) => monthly(data, GOODS)
  const flowKeys = [
    'income',
    'taxes',
    'transfers',
    'expenditure',
    'payroll',
    'sales',
    'purchases',
    'interest',
    'freight',
    'investment',
    'profit',
    'grossOutput',
    'valueAdded',
    'realOutput',
    'publicServices',
  ]
  const regionRates = <T extends World['regions'][number]>(r: T): T =>
    months === 1
      ? r
      : {
          ...monthly(r, ['gdp', 'births', 'deaths', 'migration']),
          production: inventoryRate(r.production),
          plannedProduction: r.plannedProduction && inventoryRate(r.plannedProduction),
          consumption: inventoryRate(r.consumption),
          ...(r.populationDynamics
            ? {
                populationDynamics: monthly(r.populationDynamics, [
                  'immigrants',
                  'emigrants',
                  'refugees',
                  'culturalChanges',
                  'languageChanges',
                  'beliefChanges',
                  'politicalChanges',
                ]),
              }
            : {}),
        }

  return { empty, monthly, inventoryRate, flowKeys, regionRates }
}
/** Filter private account detail once and express flows as monthly rates. */
function projectEconomySnapshot(
  e: NonNullable<World['economy']>,
  selection: {
    detailNation?: number | null
    places: ReadonlySet<number>
    borrowers: ReadonlySet<string>
    firms: NonNullable<World['economy']>['firms']
  },
  rates: ReturnType<typeof snapshotRates>,
) {
  const { detailNation, places, borrowers, firms } = selection
  const { monthly, inventoryRate, flowKeys, empty } = rates
  return {
    ...e,
    ...(detailNation !== undefined
      ? {
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
    households: Object.fromEntries(
      Object.entries(e.households)
        .filter(([id]) => places.has(+id))
        .map(([id, pools]) => [
          id,
          Object.fromEntries(
            Object.entries(pools).map(([stratum, h]) => [
              stratum,
              { ...monthly(h, flowKeys), consumption: inventoryRate(h.consumption) },
            ]),
          ) as typeof pools,
        ]),
    ),
    ledger: { ...e.ledger, opening: {}, net: {}, entries: [] },
    inventoryPrices: undefined,
    ...(e.accounts
      ? {
          accounts: {
            ...e.accounts,
            businesses: {},
            stores: {},
            world: monthly(e.accounts.world, Object.keys(e.accounts.world)),
            nations: Object.fromEntries(
              Object.entries(e.accounts.nations).map(([id, account]) => [
                id,
                monthly(account, Object.keys(account)),
              ]),
            ),
            regionalValueAdded: monthly(
              e.accounts.regionalValueAdded,
              Object.keys(e.accounts.regionalValueAdded),
            ),
          },
        }
      : {}),
    producers: Object.fromEntries(
      Object.entries(e.producers)
        .filter(([id]) => places.has(+id))
        .map(([id, p]) => [
          id,
          {
            ...monthly(p, flowKeys),
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
      ...monthly(f, flowKeys),
      projects: [],
      prices: empty,
      production: empty,
      planned: empty,
      forecast: empty,
      sold: empty,
      laborMix: undefined,
      labor: undefined,
    })),
  }
}
/** Mesh work buffers are simulation state, not display payload. */
function projectAdaptiveSnapshot(adaptive: NonNullable<World['adaptive']>) {
  return {
    ...adaptive,
    urban: undefined,
    sites: {},
    commuting: [],
    commutingRows: [],
    commuteRoutes: {},
    construction: [],
    boundaries: [],
    transit: [],
    tree: { leaves: [], changed: {}, month: adaptive.tree.month },
    jurisdictions: Object.fromEntries(
      Object.entries(adaptive.jurisdictions).filter(([, j]) => j.retired === undefined),
    ),
  }
}
/** Local snapshots retain censuses while hiding foreign market work buffers. */
function projectLocalEconomySnapshot(
  localEconomy: NonNullable<World['localEconomy']>,
  includes: (nation: number) => boolean,
  strata: Map<number, Partial<Record<EconomicStratum, number>>>,
  shipmentTotals: Record<number, { arriving: number; leaving: number }>,
  rates: ReturnType<typeof snapshotRates>,
) {
  const { regionRates, empty } = rates
  return {
    ...localEconomy,
    shipments: [],
    shipmentTotals,
    units: Object.fromEntries(
      Object.entries(localEconomy.units).map(([id, u]) => {
        const { communities: _communities, census: _census, ...data } = u
        return [
          id,
          {
            ...regionRates(data),
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
  }
}
