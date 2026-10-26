import { rebuildAdaptiveMesh } from './adaptive-world'
import { consolidateClaims } from './district-finance'
import { MODEL_PARAMETERS } from './model-parameters'
import { GOODS, inventory, population, clamp, type Region, type World, type Inventory } from './types'
import type { DistrictEconomy, DistrictUnit } from './district-types'
import type { PopulationCommunity, BirthCohort } from './population-types'
import { STRATA, type EconomicStratum, type ProducerAccount } from './economic-types'
import { apportion } from './allocation'
import { landscapeAt } from './landscape'
import { neighbors } from './hex'
import { buildSpatial, type SpatialDistrict } from './spatial'
import { communitySize, coalesceCommunities, emptyDynamics, rollupPopulation } from './population'
import { refreshAges } from './age-cohorts'
import { ensureEconomy, householdAccount, producerAccount, transfer, auditLedger } from './ledger'
import { recordGift, marketStore, reconcileGDP, inventoryQuote } from './national-accounts'

const minerals = ['timber', 'stone', 'iron', 'coal'] as const
const integerSum = (values: Record<number, number>) => Object.values(values).reduce((a, b) => a + b, 0)
const fractions = (weights: number[]) => {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0)
  return weights.map((x) => (sum ? Math.max(0, x) / sum : 1 / weights.length))
}
/** The final recipient receives the residual, so no stock disappears through rounding. */
export function divideStock(amount: number, weights: number[]) {
  const shares = fractions(weights)
  let left = amount
  return shares.map((share, i) => {
    const part = i === shares.length - 1 ? left : Math.min(left, amount * share)
    left -= part
    return part
  })
}

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
      const bins: BirthCohort[][] = ids.map(() => [])
      for (const [born, female, male] of group.ageCohorts ?? []) {
        const bySex = [female, male].map((count) => {
          const parts = apportion(count, portions, portions)
          parts.forEach((part, i) => (portions[i] -= part))
          return parts
        })
        ids.forEach((_, i) => {
          if (bySex[0][i] + bySex[1][i]) bins[i].push([born, bySex[0][i], bySex[1][i]])
        })
      }
      ids.forEach((id, i) => {
        if (!bins[i].length) return
        const copy = { ...group, locality: id, population: { ...group.population }, ageCohorts: bins[i] }
        refreshAges(copy)
        result[i].push(copy)
      })
    }
  }
  if (remaining.some((x) => x !== 0)) throw new Error('District cohort partition did not conserve people')
  return result.map(coalesceCommunities)
}

function geometry(w: World, parent: Region, d: SpatialDistrict, id: number): DistrictUnit {
  const center = d.cells.includes(parent.center) ? parent.center : d.cells[0]
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

/** Existing legal claims keep lender, interest rate, origination date and arrears.
 * Household/merchant aggregates are novated in the same fractions as their owners. */
function partitionAccount(w: World, from: string, recipients: string[], weights: number[]) {
  const e = w.economy!,
    sourceBank = e.banking!.accounts[from]
  for (const to of recipients) if (to !== from) e.banking!.accounts[to] ??= sourceBank
  const cash = from.startsWith('household:')
    ? e.households[Number(from.split(':')[1])][from.split(':')[2] as EconomicStratum].cash
    : e.producers[Number(from.split(':')[1])].cash
  const amounts = divideStock(cash, weights)
  recipients.forEach((to, i) => {
    if (to !== from) transfer(w, from, to, amounts[i], 'district boundary asset transfer')
  })
  for (const loan of [...e.credit.loans].filter((l) => l.borrower === from)) {
    const claims = divideStock(loan.principal, weights),
      original = { ...loan }
    loan.principal = 0
    recipients.forEach((borrower, i) => {
      if (!claims[i]) return
      if (borrower === from) {
        loan.principal = claims[i]
        loan.contract ??= loan.id
      } else
        e.credit.loans.push({
          ...original,
          contract: original.contract ?? original.id,
          id: e.credit.nextId++,
          borrower,
          principal: claims[i],
        })
    })
  }
  for (const owners of [
    ...e.banking!.banks.map((b) => b.owners),
    ...(e.firms ?? []).map((f) => f.owners).filter((x): x is Record<string, number> => !!x),
  ]) {
    const shares = owners[from]
    if (shares === undefined) continue
    delete owners[from]
    const parts = divideStock(shares, weights)
    recipients.forEach((to, i) => {
      if (parts[i]) owners[to] = (owners[to] ?? 0) + parts[i]
    })
  }
}

function zeroAccounts(w: World, id: number, template: number) {
  const e = w.economy!
  if (e.producers[id]) return
  e.producers[id] = structuredClone(e.producers[template])
  for (const [key, value] of Object.entries(e.producers[id])) {
    if (typeof value === 'number' && !['wage', 'previousPriceIndex'].includes(key))
      (e.producers[id] as unknown as Record<string, unknown>)[key] = 0
    else if (Array.isArray(value)) (e.producers[id] as unknown as Record<string, unknown>)[key] = []
    else if (value && typeof value === 'object')
      (e.producers[id] as unknown as Record<string, unknown>)[key] = inventory()
  }
  e.households[id] = structuredClone(e.households[template])
  for (const h of Object.values(e.households[id])) {
    for (const key of Object.keys(h))
      if (key !== 'consumption')
        (h as unknown as Record<string, unknown>)[key] = key.endsWith('Coverage') ? 1 : 0
    h.consumption = inventory()
  }
}

function shareProducer(w: World, source: number, targets: DistrictUnit[], weights: number[]) {
  const e = w.economy!,
    original = structuredClone(e.producers[source])
  for (const [key, value] of Object.entries(original)) {
    if (key === 'cash' || key === 'projects' || key === 'wage' || key === 'previousPriceIndex') continue
    if (typeof value === 'number') {
      const values = divideStock(value, weights)
      targets.forEach((r, i) => {
        const p = e.producers[r.id] as unknown as Record<string, number>
        p[key] = (r.id === source ? 0 : p[key]) + values[i]
      })
    } else if (value && !Array.isArray(value))
      for (const g of GOODS) {
        const values = divideStock((value as Inventory)[g], weights)
        targets.forEach((r, i) => {
          const field = (e.producers[r.id] as unknown as Record<string, Inventory>)[key]
          field[g] = (r.id === source ? 0 : field[g]) + values[i]
        })
      }
  }
  e.producers[source].projects = []
  for (const project of original.projects) {
    const capital = divideStock(project.capital, weights),
      cost = divideStock(project.cost, weights)
    targets.forEach((r, i) => {
      if (capital[i] || cost[i])
        e.producers[r.id].projects.push({ ...project, capital: capital[i], cost: cost[i] })
    })
  }
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
  for (const r of w.regions) {
    const parts = spatial.districts.filter((d) => d.region === r.id)
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
      const site = spatial.settlements.find((s) => unit.cells.includes(s.cell))
      const rural = apportion(
        population(unit) - urban,
        unit.cells.map((c) => landscapeAt(w.cells[c]).habitat ** 2),
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
        if (r.id !== source.id) recordGift(w, marketStore(source.id), marketStore(r.id), g, parts[i])
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
        e.inventoryPrices[marketStore(target.id)] ??= { ...target.prices }
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
  const loanOpening = structuredClone(e.credit.loans)
  const owners = [
    ...e.banking!.banks.map((b) => b.owners),
    ...(e.firms ?? []).flatMap((f) => (f.owners ? [f.owners] : [])),
  ]
  const ownerOpening = owners.map((o) => ({ ...o }))
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
  // Noncash productive assets and all monthly counters are extensive and additive.
  for (const id of new Set([...old.map((r) => r.id), ...targets.map((r) => r.id)])) {
    const p = e.producers[id]
    for (const [key, value] of Object.entries(p)) {
      if (typeof value === 'number' && !['cash', 'wage', 'previousPriceIndex'].includes(key))
        (p as unknown as Record<string, number>)[key] = 0
      else if (Array.isArray(value)) (p as unknown as Record<string, unknown>)[key] = []
      else if (value && typeof value === 'object')
        (p as unknown as Record<string, unknown>)[key] = inventory()
    }
  }
  for (const source of old) {
    const p = producerCopies.get(source.id)!,
      plan = plans.find((p) => p.from === producerAccount(source.id))!
    for (const [key, value] of Object.entries(p)) {
      if (['cash', 'wage', 'previousPriceIndex', 'projects'].includes(key)) continue
      if (typeof value === 'number')
        divideStock(value, plan.weights).forEach((v, i) => {
          ;(e.producers[Number(plan.recipients[i].split(':')[1])] as unknown as Record<string, number>)[
            key
          ] += v
        })
      else if (value && !Array.isArray(value))
        for (const g of GOODS)
          divideStock((value as Inventory)[g], plan.weights).forEach((v, i) => {
            ;(e.producers[Number(plan.recipients[i].split(':')[1])] as unknown as Record<string, Inventory>)[
              key
            ][g] += v
          })
    }
    for (const project of p.projects) {
      const caps = divideStock(project.capital, plan.weights),
        costs = divideStock(project.cost, plan.weights)
      plan.recipients.forEach((to, i) => {
        if (caps[i] || costs[i])
          e.producers[Number(to.split(':')[1])].projects.push({
            ...project,
            capital: caps[i],
            cost: costs[i],
          })
      })
    }
  }
  // Transfer only captured opening amounts. Incoming receipts are never divided again,
  // including when a unit both receives a merger and contributes to a split.
  for (const plan of plans) {
    const amounts = divideStock(plan.cash, plan.weights)
    plan.recipients.forEach((to, i) => {
      if (to !== plan.from) transfer(w, plan.from, to, amounts[i], 'district boundary asset transfer')
    })
  }
  const byAccount = new Map(plans.map((p) => [p.from, p]))
  e.credit.loans = []
  for (const loan of loanOpening) {
    const plan = byAccount.get(loan.borrower)
    if (!plan) {
      e.credit.loans.push(loan)
      continue
    }
    const parts = divideStock(loan.principal, plan.weights)
    let used = false
    plan.recipients.forEach((borrower, i) => {
      if (parts[i]) {
        e.credit.loans.push({
          ...loan,
          contract: loan.contract ?? loan.id,
          borrower,
          principal: parts[i],
          id: used ? e.credit.nextId++ : loan.id,
        })
        used = true
      }
    })
  }
  owners.forEach((o, i) => {
    for (const key of Object.keys(o)) delete o[key]
    for (const [from, shares] of Object.entries(ownerOpening[i])) {
      const plan = byAccount.get(from)
      if (!plan) {
        o[from] = (o[from] ?? 0) + shares
        continue
      }
      divideStock(shares, plan.weights).forEach((v, j) => {
        if (v) o[plan.recipients[j]] = (o[plan.recipients[j]] ?? 0) + v
      })
    }
  })
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
