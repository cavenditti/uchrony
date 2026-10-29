/** Districts own local goods and resident cohorts; provinces expose political rollups.
 * Boundary remapping conserves dated cohorts, stores, deposits, debt and equity. */
import { rebuildAdaptiveMesh } from './adaptive-world'
import { refreshAges } from './age-cohorts'
import { apportion } from './allocation'
import { divideStock } from './district-allocation'
import { clearProducerAssets, distributeProducerAssets, transferAccountPartitions } from './district-assets'
import { consolidateClaims } from './district-finance'
import type { DistrictEconomy, DistrictUnit } from './district-types'
import { STRATA, type EconomicStratum, type ProducerAccount } from './economic-types'
import { neighbors } from './grid'
import { landscapeAt } from './landscape'
import {
  accountAddress,
  auditLedger,
  balance,
  ensureEconomy,
  householdAccount,
  producerAccount,
} from './ledger'
import { MODEL_PARAMETERS } from './model-parameters'
import { inventoryQuote, marketStore, reconcileGDP, recordGift } from './national-accounts'
import { coalesceCommunities, communitySize, emptyDynamics, rollupPopulation } from './population'
import type { BirthCohort, PopulationCommunity } from './population-types'
import { buildSpatial, type SpatialDistrict } from './spatial'
import { habitableLand } from './terrain-access'
import { clamp, GOODS, inventory, population, type Inventory, type Region, type World } from './types'

const minerals = ['timber', 'stone', 'iron', 'coal'] as const
const integerSum = (values: Record<number, number>) => Object.values(values).reduce((a, b) => a + b, 0)
export { divideStock } from './district-allocation'
/** Allocate each dated sex cohort, with exact recipient totals and no synthetic birthdays. */
export function partitionPeople(groups: PopulationCommunity[], ids: number[], targets: number[]) {
  const remaining = [...targets],
    result = ids.map(() => [] as PopulationCommunity[])
  // Preserve the source stratum proportions, then place joint identity groups in
  // compact portions. Spreading every tiny group into every district needlessly
  // multiplies dated cohort records and assumes perfect residential mixing.
  for (const stratum of STRATA) {
    const members = groups.filter((g) => (g.stratum ?? 'laborer') === stratum)
    const quotas = apportion(
      members.reduce((sum, g) => sum + communitySize(g), 0),
      remaining,
      remaining,
    )
    quotas.forEach((q, i) => (remaining[i] -= q))
    for (const group of members) {
      let count = communitySize(group)
      const portions = ids.map(() => 0)
      for (const i of ids.map((_, i) => i).sort((a, b) => quotas[b] - quotas[a] || a - b)) {
        const amount = Math.min(count, quotas[i])
        portions[i] = amount
        quotas[i] -= amount
        count -= amount
        if (!count) break
      }
      if (count) throw new Error('District community allocation exceeded census capacity')
      // A joint community occupies only its allocated districts. Do not build
      // and sort a mostly empty vector for every sex and dated birth cohort.
      const occupied = portions.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0)
      const capacities = occupied.map((i) => portions[i])
      const bins: BirthCohort[][] = occupied.map(() => [])
      for (const [born, female, male] of group.ageCohorts ?? []) {
        const bySex = [female, male].map((count) => {
          const parts = apportion(count, capacities, capacities)
          parts.forEach((part, i) => (capacities[i] -= part))
          return parts
        })
        occupied.forEach((_, i) => {
          if (bySex[0][i] + bySex[1][i]) bins[i].push([born, bySex[0][i], bySex[1][i]])
        })
      }
      occupied.forEach((destination, i) => {
        if (!bins[i].length) return
        const id = ids[destination]
        const copy = { ...group, locality: id, population: { ...group.population }, ageCohorts: bins[i] }
        refreshAges(copy)
        result[destination].push(copy)
      })
    }
  }
  if (remaining.some((x) => x !== 0)) throw new Error('District cohort partition did not conserve people')
  return result.map(coalesceCommunities)
}

function geometry(w: World, parent: Region, d: SpatialDistrict, id: number): DistrictUnit {
  const center =
    d.cells.includes(parent.center) && habitableLand(w.cells[parent.center])
      ? parent.center
      : (d.cells.find((id) => habitableLand(w.cells[id])) ?? d.cells[0])
  const r: DistrictUnit = {
    ...parent,
    id,
    province: parent.province ?? parent.id,
    name: d.cells.includes(parent.center) ? parent.name : `${parent.name} countryside`,
    center,
    cells: [...d.cells],
    neighbors: [],
    node: d.node,
    span: d.span,
    coastal: d.cells.some((cell) =>
      neighbors(cell, w.width, w.height).some((n) => w.cells[n].terrain === 'water'),
    ),
    terrain: w.cells[center].terrain,
    population: { children: 0, adults: 0, elders: 0 },
    populationDynamics: emptyDynamics(),
    stocks: inventory(),
    production: inventory(),
    plannedProduction: inventory(),
    consumption: inventory(),
    prices: { ...parent.prices },
    deposits: { timber: 0, stone: 0, iron: 0, coal: 0 },
    capitalReference: parent.capitalReference ?? population(parent),
    activity: 'mixed',
    founded: w.month,
    predecessors: [],
    residents: {},
    migration: 0,
    births: 0,
    deaths: 0,
    employed: 0,
    gdp: 0,
    materialCoverage: parent.materialCoverage ?? 1,
  }
  delete r.delegation
  delete r.occupation
  delete r.control
  delete r.census
  // Cohorts have one serialized home: the province census with a district tag.
  Object.defineProperty(r, 'communities', {
    value: [],
    writable: true,
    configurable: true,
    enumerable: false,
  })
  refreshEndowment(w, r)
  return r
}

export function refreshEndowment(w: World, r: DistrictUnit, refreshFertility = true) {
  const area = Math.max(1, r.cells.length)
  if (refreshFertility)
    r.fertility = r.cells.reduce((s, id) => s + landscapeAt(w.cells[id]).habitat, 0) / area
  for (const good of minerals)
    r.deposits[good] =
      r.cells.reduce((s, id) => {
        const initial = landscapeAt(w.cells[id]).resources[good]
        const stock = w.localEconomy?.reserves[id]?.[good]
        const opening = initial * (good === 'timber' ? 5000 : 150000)
        return s + initial * (stock === undefined || !opening ? 1 : clamp(stock / opening))
      }, 0) / area
}

/** Opening partitions inherit the original bank and keep its surviving loan identity. */
function partitionAccount(w: World, from: string, recipients: string[], weights: number[]) {
  transferAccountPartitions(w, [{ from, recipients, weights, cash: balance(w, from) }], true)
}

function zeroAccounts(w: World, id: number, template: number) {
  const e = w.economy!
  if (e.producers[id]) return
  // These accounts inherit a schema, not assets. Build the empty fields directly
  // instead of deeply cloning inventories and projects only to discard them.
  const producer: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(e.producers[template])) {
    producer[key] =
      typeof value === 'number'
        ? key === 'wage' || key === 'previousPriceIndex'
          ? value
          : 0
        : Array.isArray(value)
          ? []
          : value && typeof value === 'object'
            ? inventory()
            : value
  }
  e.producers[id] = producer as unknown as (typeof e.producers)[number]
  const households = {} as (typeof e.households)[number]
  for (const [stratum, source] of Object.entries(e.households[template])) {
    const h: Record<string, unknown> = {}
    for (const key of Object.keys(source)) h[key] = key.endsWith('Coverage') ? 1 : 0
    h.consumption = inventory()
    households[stratum as keyof typeof households] =
      h as unknown as (typeof households)[keyof typeof households]
  }
  e.households[id] = households
}

function shareProducer(w: World, source: number, targets: DistrictUnit[], weights: number[]) {
  const e = w.economy!,
    original = structuredClone(e.producers[source])
  clearProducerAssets(e.producers[source])
  distributeProducerAssets(
    original,
    targets.map((r) => e.producers[r.id]),
    weights,
  )
  partitionAccount(
    w,
    producerAccount(source),
    targets.map((r) => producerAccount(r.id)),
    weights,
  )
}

export function ensureDistrictEconomy(w: World) {
  if (w.localEconomy) {
    linkDistrictPeople(w)
    aggregateDistricts(w)
    return w.localEconomy
  }
  if (w.viewOnly) throw new Error('A display snapshot cannot initialize local economies')
  const e = ensureEconomy(w),
    spatial = w.spatial ?? buildSpatial(w)
  const system: DistrictEconomy = (w.localEconomy = {
    version: 1 as const,
    initialized: w.month,
    nextId: w.regions.length,
    active: [] as number[],
    units: {} as Record<number, DistrictUnit>,
    built: {},
    reserves: {},
    cities: [],
    nextCity: 0,
    shipments: [],
    revision: 0,
    lastRemesh: w.month,
    reorganizations: 0,
  })
  for (const c of w.cells)
    if (c.terrain !== 'water') {
      const natural = landscapeAt(c).resources
      system.reserves[c.id] = Object.fromEntries(
        minerals.map((g) => [g, natural[g] * (g === 'timber' ? 5000 : 150000)]),
      ) as typeof natural
      system.built[c.id] = 0
    }
  const districtsByProvince = new Map<number, SpatialDistrict[]>()
  for (const district of spatial.districts) {
    const list = districtsByProvince.get(district.region) ?? []
    list.push(district)
    districtsByProvince.set(district.region, list)
  }
  const settlementByCell = new Map<number, number>()
  spatial.settlements.forEach((s, i) => {
    if (!settlementByCell.has(s.cell)) settlementByCell.set(s.cell, i)
  })
  for (const r of w.regions) {
    const parts = districtsByProvince.get(r.id) ?? []
    const targets = parts.map((d) => {
      const id = d.cells.includes(r.center) ? r.id : system.nextId++
      const unit = geometry(w, r, d, id)
      system.units[id] = unit
      if (e.accounts) e.accounts.territories[id] = e.accounts.territories[r.id] ?? r.nation
      system.active.push(id)
      zeroAccounts(w, id, r.id)
      return unit
    })
    const groups = partitionPeople(
      r.communities!,
      targets.map((x) => x.id),
      parts.map((d) => d.population),
    )
    targets.forEach((unit, i) => {
      unit.communities = groups[i]
      rollupPopulation(unit)
      const urban = parts[i].urbanPopulation
      const first = unit.cells.reduce(
        (index, cell) => Math.min(index, settlementByCell.get(cell) ?? Infinity),
        Infinity,
      )
      const site = spatial.settlements[first]
      const rural = apportion(
        population(unit) - urban,
        unit.cells.map((c) => landscapeAt(w.cells[c]).habitat ** 2),
        unit.cells.map((c) => (habitableLand(w.cells[c]) ? Infinity : 0)),
      )
      unit.cells.forEach(
        (c, j) => (unit.residents[c] = rural[j] + (c === (site?.cell ?? unit.center) ? urban : 0)),
      )
      unit.urban = population(unit) ? urban / population(unit) : 0
      for (const g of unit.communities!) g.urban = unit.urban
      for (const c of unit.cells)
        system.built[c] = clamp((c === site?.cell ? urban : 0) / MODEL_PARAMETERS.fullBuiltPopulationPerCell)
    })
    const weights = parts.map((d) => d.population + d.cells.length * 10)
    for (const good of GOODS) {
      const amounts = divideStock(r.stocks[good], weights)
      targets.forEach((unit, i) => (unit.stocks[good] = amounts[i]))
    }
    // Opening stores are relocated at carrying value, not bought or newly produced.
    if (e.accounts)
      for (const target of targets)
        if (target.id !== r.id)
          for (const good of GOODS)
            recordGift(w, marketStore(r.id), marketStore(target.id), good, target.stocks[good])
    if (e.inventoryPrices?.[marketStore(r.id)])
      for (const target of targets)
        e.inventoryPrices[marketStore(target.id)] = { ...e.inventoryPrices[marketStore(r.id)] }
    shareProducer(w, r.id, targets, weights)
    for (const s of STRATA) {
      const counts = groups.map((gs) =>
        gs.filter((g) => g.stratum === s).reduce((sum, g) => sum + communitySize(g), 0),
      )
      partitionAccount(
        w,
        householdAccount(r.id, s),
        targets.map((t) => householdAccount(t.id, s)),
        counts.some(Boolean) ? counts : weights,
      )
    }
    r.communities = targets.flatMap((u) => u.communities!)
  }
  for (const f of e.firms ?? []) {
    f.cell ??= w.regions[f.region].center
    f.locality = system.active.find((id) => system.units[id].cells.includes(f.cell!))!
    f.owners ??= { [householdAccount(f.locality, 'owner')]: 1 }
  }
  system.active.sort((a, b) => a - b)
  updateDistrictNeighbors(w)
  aggregateDistricts(w)
  consolidateClaims(w)
  auditLedger(w)
  return system
}

/** Reattach nonserialized local views after loading, and collect political changes. */
export function linkDistrictPeople(w: World) {
  const system = w.localEconomy
  if (!system) return
  for (const id of system.active) {
    const unit = system.units[id],
      province = w.regions[unit.province],
      previous = system.provinceSignals?.[province.id]
    if (previous)
      for (const field of ['infrastructure', 'fertility', 'devastation', 'unrest'] as const) {
        const delta = province[field] - previous[field]
        if (delta)
          unit[field] = clamp(
            unit[field] + delta,
            0,
            field === 'unrest' ? 100 : field === 'devastation' ? 1 : field === 'fertility' ? 1.2 : 1.5,
          )
      }
  }
  if (system.provinceSignals)
    for (const p of w.regions)
      system.provinceSignals[p.id] = {
        infrastructure: p.infrastructure,
        fertility: p.fertility,
        devastation: p.devastation,
        unrest: p.unrest,
      }
  for (const id of system.active) {
    const r = system.units[id]
    if (
      !Object.getOwnPropertyDescriptor(r, 'communities') ||
      Object.getOwnPropertyDescriptor(r, 'communities')!.enumerable
    )
      Object.defineProperty(r, 'communities', {
        value: [],
        writable: true,
        configurable: true,
        enumerable: false,
      })
    else r.communities = []
    r.nation = w.regions[r.province].nation
  }
  for (const province of w.regions)
    for (const group of province.communities ?? []) {
      const id =
        group.locality !== undefined &&
        system.units[group.locality]?.retired === undefined &&
        system.units[group.locality]?.province === province.id
          ? group.locality
          : province.id
      group.locality = id
      system.units[id].communities!.push(group)
    }
  for (const id of system.active) {
    const r = system.units[id]
    rollupPopulation(r)
    updateResidentCounts(r)
  }
}
export function updateResidentCounts(r: DistrictUnit) {
  const total = population(r),
    prior = integerSum(r.residents)
  if (prior === total) return
  const amounts = apportion(
    total,
    r.cells.map((c) => (r.residents[c] ?? 0) + (prior === 0 ? 1 : 0)),
  )
  r.cells.forEach((c, i) => (r.residents[c] = amounts[i]))
}
export function aggregateDistricts(w: World) {
  const system = w.localEconomy
  if (!system) return
  const byProvince = w.regions.map(() => [] as DistrictUnit[])
  for (const id of system.active) {
    const unit = system.units[id]
    unit.nation = w.regions[unit.province].nation
    rollupPopulation(unit)
    updateResidentCounts(unit)
    byProvince[unit.province].push(unit)
  }
  for (const r of w.regions) {
    const units = byProvince[r.id],
      principal = system.units[r.id]
    r.communities = units.flatMap((unit) => unit.communities!)
    rollupPopulation(r)
    const total = Math.max(1, population(r))
    for (const field of [
      'foodCoverage',
      'materialCoverage',
      'infrastructure',
      'unrest',
      'devastation',
    ] as const)
      r[field] = units.reduce((sum, unit) => sum + (unit[field] ?? 1) * population(unit), 0) / total
    for (const field of ['births', 'deaths', 'migration', 'employed', 'gdp', 'industry'] as const)
      r[field] = units.reduce((sum, unit) => sum + unit[field], 0)
    r.production = inventory()
    for (const unit of units) for (const g of GOODS) r.production[g] += unit.production[g]
    // Military and provincial procurement use the physical administrative depot.
    // Other districts can supply it only by actual freight, never by an aggregate stock withdrawal.
    r.stocks = principal.stocks
    r.prices = principal.prices
    r.consumption = principal.consumption
    r.fertility =
      units.reduce((sum, u) => sum + u.fertility * u.cells.length, 0) / Math.max(1, r.cells.length)
    system.provinceSignals ??= {}
    system.provinceSignals[r.id] = {
      infrastructure: r.infrastructure,
      fertility: r.fertility,
      devastation: r.devastation,
      unrest: r.unrest,
    }
  }
}
export function updateDistrictNeighbors(w: World) {
  const system = w.localEconomy!
  const cellUnit = new Int32Array(w.cells.length).fill(-1)
  for (const id of system.active) for (const c of system.units[id].cells) cellUnit[c] = id
  for (const id of system.active) {
    const adjacent = new Set<number>()
    for (const c of system.units[id].cells)
      for (const next of neighbors(c, w.width, w.height))
        if (cellUnit[next] >= 0 && cellUnit[next] !== id) adjacent.add(cellUnit[next])
    system.units[id].neighbors = [...adjacent].sort((a, b) => a - b)
  }
  return cellUnit
}

/** Extraction reduces geographically fixed natural reserves; refinement cannot replenish a mine. */
export function extractDistrictResource(
  w: World,
  r: Region,
  good: keyof DistrictUnit['deposits'],
  wanted: number,
) {
  if (!w.localEconomy || r.province === undefined) return wanted
  const remaining = r.cells.map((c) => w.localEconomy!.reserves[c][good]),
    sum = remaining.reduce((a, b) => a + b, 0)
  const quantity = Math.max(0, Math.min(wanted, sum)),
    shares = divideStock(quantity, remaining)
  r.cells.forEach((c, i) => (w.localEconomy!.reserves[c][good] = Math.max(0, remaining[i] - shares[i])))
  return quantity
}

/** Conservative finite-volume remapping at a closed month boundary. No firm is divided. */
export function remeshDistricts(w: World, partition: SpatialDistrict[]) {
  if (w.adaptive) {
    // Compatibility entry point: numerical refinement cannot novate household debt or create merchants.
    rebuildAdaptiveMesh(w, partition.length <= w.regions.length ? 'coarse' : 'adaptive')
    return
  }
  const system = ensureDistrictEconomy(w),
    e = w.economy!
  const old = system.active.map((id) => system.units[id])
  const oldCells = new Map(old.map((r) => [r.id, new Set(r.cells)]))
  if (
    partition.length === old.length &&
    partition.every((d) =>
      old.some(
        (r) =>
          r.node === d.node &&
          r.cells.length === d.cells.length &&
          d.cells.every((c) => oldCells.get(r.id)!.has(c)),
      ),
    )
  )
    return
  const used = new Set<number>()
  const targets = partition.map((d) => {
    const p = w.regions[d.region]
    const prior = d.cells.includes(p.center)
      ? system.units[p.id]
      : old.find((r) => r.province === p.id && !used.has(r.id) && r.id !== p.id && d.cells.includes(r.center))
    const id = prior && !used.has(prior.id) ? prior.id : system.nextId++
    used.add(id)
    const unit = geometry(w, prior ?? p, d, id)
    unit.predecessors = old
      .filter((r) => r.province === p.id && d.cells.some((c) => oldCells.get(r.id)!.has(c)))
      .map((r) => r.id)
    if (prior) {
      unit.founded = prior.founded
      unit.name = prior.name
    }
    zeroAccounts(w, id, p.id)
    return unit
  })
  // Snapshot before retained ids are assigned their new geometry.
  const stockCopies = new Map(old.map((r) => [r.id, { ...r.stocks }]))
  const carrying = new Map(
    old.map((r) => [
      r.id,
      {
        ...(e.accounts?.stores[marketStore(r.id)]?.price ??
          e.inventoryPrices?.[marketStore(r.id)] ??
          Object.fromEntries(GOODS.map((g) => [g, r.prices[g] / 1000]))),
      } as Inventory,
    ]),
  )
  const values = new Map(targets.map((r) => [r.id, inventory()])),
    quotes = new Map(targets.map((r) => [r.id, inventory()]))
  const producerCopies = new Map(old.map((r) => [r.id, structuredClone(e.producers[r.id])]))
  const groups = new Map(old.map((r) => [r.id, r.communities!]))
  const contributions = new Map<number, Map<number, Record<EconomicStratum, number>>>()
  // New stores start empty; retained stores are emptied into temporary source records below.
  for (const target of targets) {
    system.units[target.id] = target
    if (e.accounts)
      e.accounts.territories[target.id] ??= e.accounts.territories[target.province] ?? target.nation
  }
  for (const source of old) {
    const recipients = targets.filter(
      (r) => r.province === source.province && r.cells.some((c) => oldCells.get(source.id)!.has(c)),
    )
    const counts = recipients.map((r) => r.cells.reduce((sum, c) => sum + (source.residents[c] ?? 0), 0))
    const partitions = partitionPeople(
      groups.get(source.id)!,
      recipients.map((r) => r.id),
      counts,
    )
    contributions.set(
      source.id,
      new Map(
        recipients.map((r, i) => [
          r.id,
          Object.fromEntries(
            STRATA.map((s) => [
              s,
              partitions[i].filter((g) => g.stratum === s).reduce((sum, g) => sum + communitySize(g), 0),
            ]),
          ) as Record<EconomicStratum, number>,
        ]),
      ),
    )
    const weights = counts.some(Boolean)
      ? counts
      : recipients.map((r) => r.cells.filter((c) => oldCells.get(source.id)!.has(c)).length)
    recipients.forEach((r, i) => {
      r.communities!.push(...partitions[i])
      for (const c of r.cells) if (oldCells.get(source.id)!.has(c)) r.residents[c] = source.residents[c] ?? 0
    })
    for (const g of GOODS) {
      const parts = divideStock(stockCopies.get(source.id)![g], weights)
      recipients.forEach((r, i) => {
        r.stocks[g] += parts[i]
        values.get(r.id)![g] += parts[i] * carrying.get(source.id)![g]
        quotes.get(r.id)![g] += parts[i] * source.prices[g]
        // A retained source may already have received another district's goods.
        // Transfer the original parcel's value from the snapshot, not its new average.
        if (r.id !== source.id)
          recordGift(
            w,
            marketStore(source.id),
            marketStore(r.id),
            g,
            parts[i],
            parts[i] * carrying.get(source.id)![g],
          )
      })
    }
    // Asset accounts are handled from snapshots in a second pass to avoid merge-order dependence.
  }
  for (const target of targets) {
    for (const good of GOODS)
      if (target.stocks[good] > 0) {
        const price = values.get(target.id)![good] / target.stocks[good]
        inventoryQuote(w, marketStore(target.id), good, price)
        e.inventoryPrices ??= {}
        e.inventoryPrices[marketStore(target.id)] ??= Object.fromEntries(
          GOODS.map((g) => [g, target.prices[g] / 1000]),
        ) as Inventory
        e.inventoryPrices[marketStore(target.id)][good] = price
        target.prices[good] = quotes.get(target.id)![good] / target.stocks[good]
      }
    for (const field of ['infrastructure', 'fertility', 'devastation', 'unrest'] as const) {
      target[field] =
        old
          .filter((r) => r.province === target.province)
          .reduce(
            (sum, r) => sum + r[field] * target.cells.filter((c) => oldCells.get(r.id)!.has(c)).length,
            0,
          ) / target.cells.length
    }
  }
  redistributeAccounts(w, old, targets, oldCells, producerCopies, groups, contributions)
  for (const source of old)
    if (!used.has(source.id)) {
      source.cells = []
      source.residents = {}
      source.communities = []
      source.stocks = inventory()
      source.population = { children: 0, adults: 0, elders: 0 }
      source.retired = w.month
      system.units[source.id] = source
    }
  system.active = targets.map((r) => r.id).sort((a, b) => a - b)
  for (const f of e.firms ?? []) {
    f.cell ??= w.regions[f.region].center
    f.locality = targets.find((r) => r.cells.includes(f.cell!))!.id
  }
  system.revision++
  system.reorganizations++
  system.lastRemesh = w.month
  updateDistrictNeighbors(w)
  aggregateDistricts(w)
  consolidateClaims(w)
  auditLedger(w)
  if (e.accounts) reconcileGDP(w)
}

function redistributeAccounts(
  w: World,
  old: DistrictUnit[],
  targets: DistrictUnit[],
  oldCells: Map<number, Set<number>>,
  producerCopies: Map<number, ProducerAccount>,
  groups: Map<number, PopulationCommunity[]>,
  contributions: Map<number, Map<number, Record<EconomicStratum, number>>>,
) {
  const e = w.economy!
  // A remesh can split and merge simultaneously. Every original balance, claim and share
  // is captured before any transfer, preventing receipts being redistributed a second time.
  const plans: { from: string; recipients: string[]; weights: number[]; cash: number }[] = []
  for (const source of old) {
    const recipients = targets.filter(
      (r) => r.province === source.province && r.cells.some((c) => oldCells.get(source.id)!.has(c)),
    )
    const weights = recipients.map((r) => r.cells.reduce((sum, c) => sum + (source.residents[c] ?? 0), 0))
    const fallback = recipients.map((r) => r.cells.filter((c) => oldCells.get(source.id)!.has(c)).length)
    const allocation = weights.some(Boolean) ? weights : fallback
    plans.push({
      from: producerAccount(source.id),
      recipients: recipients.map((r) => producerAccount(r.id)),
      weights: allocation,
      cash: producerCopies.get(source.id)!.cash,
    })
    for (const s of STRATA) {
      // Same fractional cohort population relocation; stratum/age totals are never rounded away.
      const byStratum = recipients.map((r) => contributions.get(source.id)!.get(r.id)![s])
      const sourcePeople = groups
        .get(source.id)!
        .filter((g) => g.stratum === s)
        .reduce((sum, g) => sum + communitySize(g), 0)
      plans.push({
        from: householdAccount(source.id, s),
        recipients: recipients.map((r) => householdAccount(r.id, s)),
        weights: sourcePeople && byStratum.some(Boolean) ? byStratum : allocation,
        cash: e.households[source.id][s].cash,
      })
    }
  }
  // Snapshot all producers before clearing any destination, including split/merge overlaps.
  for (const id of new Set([...old.map((r) => r.id), ...targets.map((r) => r.id)]))
    clearProducerAssets(e.producers[id])
  const byAccount = new Map(plans.map((plan) => [plan.from, plan]))
  for (const source of old) {
    const plan = byAccount.get(producerAccount(source.id))!
    distributeProducerAssets(
      producerCopies.get(source.id)!,
      plan.recipients.map((to) => e.producers[accountAddress(w, to).id]),
      plan.weights,
    )
  }
  transferAccountPartitions(w, plans)
}

/** Called only as the next monthly books open. A retired unit can be archived
 * only after every asset and claim has left it; no nonzero balance is discarded. */
export function archiveRetiredDistricts(w: World) {
  const s = w.localEconomy,
    e = w.economy
  if (!s || !e) return
  const claimed = new Set(e.credit.loans.map((l) => l.borrower))
  for (const owners of [
    ...e.banking!.banks.map((b) => b.owners),
    ...Object.values(e.supplierCredit ?? {}),
    ...(e.firms ?? []).flatMap((f) => (f.owners ? [f.owners] : [])),
  ])
    for (const [key, value] of Object.entries(owners)) if (value) claimed.add(key)
  for (const [key, u] of Object.entries(s.units)) {
    if (u.retired === undefined) continue
    const accounts = [producerAccount(u.id), ...STRATA.map((stratum) => householdAccount(u.id, stratum))]
    const p = e.producers[u.id]
    if (
      p.cash !== 0 ||
      p.capital !== 0 ||
      p.projects.length ||
      STRATA.some((stratum) => e.households[u.id][stratum].cash !== 0) ||
      accounts.some((a) => claimed.has(a))
    )
      continue
    s.archive ??= {}
    s.archive[u.id] = {
      province: u.province,
      name: u.name,
      founded: u.founded,
      retired: u.retired,
      predecessors: u.predecessors,
    }
    for (const account of accounts) delete e.banking!.accounts[account]
    delete e.producers[u.id]
    delete e.households[u.id]
    delete s.units[+key]
  }
}
