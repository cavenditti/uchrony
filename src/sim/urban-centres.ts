import { parameterGroup } from './configuration-context'
import type { World } from './types'
import { population } from './types'
import type { City } from './district-types'
import type { PhysicalSite } from './adaptive-types'
import { STRATA } from './economic-types'
import { residentialFootprint, footprintConnection, localWalkingConnection } from './residential-geometry'
import { SpatialBuckets } from './spatial-buckets'
import { MinHeap } from './heap'
import { settlementKind } from './settlement-model'

/** Synthetic calibration from monthly 50-year paired-centre scenarios (see
 * docs/URBAN_CENTRES.md). Repeated refreshes cannot accelerate elapsed time. */
export const URBAN_INTEGRATION = parameterGroup('urbanIntegration')

export function setCentreSites(city: City, sites: PhysicalSite[]) {
  city.sites = sites.map((s) => s.id).sort()
  city.cells = [...new Set(sites.map((s) => s.cell))].sort((a, b) => a - b)
  city.population = sites.reduce((sum, s) => sum + (s.residents ?? 0), 0)
  city.kind = settlementKind(city.population)
  if (sites.length && !city.sites.includes(city.nucleusSite!))
    city.nucleusSite = [...sites].sort(
      (a, b) => (b.residents ?? 0) - (a.residents ?? 0) || a.id.localeCompare(b.id),
    )[0].id
  const nucleus = sites.find((s) => s.id === city.nucleusSite)
  if (nucleus) city.nucleus = nucleus.cell
}

function event(w: World, city: City, kind: NonNullable<City['history']>[number]['kind'], other: number) {
  ;(city.history ??= []).push({ month: w.month, kind, with: other })
}

export function separateCentre(w: World, city: City) {
  if (city.metropolis) event(w, city, 'separated', city.metropolis.centre)
  delete city.metropolis
}

/** Occupied connectivity determines catchments. The numerical tree and city
 * rank never move a home; multi-source shortest paths preserve distinct nuclei. */
export function partitionCentres(w: World, sites: PhysicalSite[], centres: City[]) {
  const groups = new Map(centres.map((c) => [c.id, [] as PhysicalSite[]]))
  const contacts = new Map<string, { a: Set<number>; b: Set<number>; points: PhysicalSite[] }>()
  if (centres.length === 1) {
    groups.set(centres[0].id, sites)
    return { groups, contacts }
  }
  const shapes = sites.map((s) => residentialFootprint(w, s))
  const maximum = sites.reduce((n, s) => Math.max(n, s.parcel!.size), 0)
  const buckets = new SpatialBuckets<number>(Math.max(64, maximum + 150))
  sites.forEach((s, i) => buckets.insert(i, s.x, s.y, s.x, s.y))
  const edges: { to: number; distance: number }[][] = sites.map(() => [])
  sites.forEach((from, i) => {
    const radius = (from.parcel!.size + maximum) / Math.SQRT2 + (from.building ? 24 : 150)
    for (const j of buckets.query(from.x - radius, from.y - radius, from.x + radius, from.y + radius)) {
      if (j <= i) continue
      const to = sites[j]
      if (Math.hypot(to.x - from.x, to.y - from.y) > radius) continue
      const connection = footprintConnection(shapes[i], shapes[j])
      if (
        connection.distance > (from.building && to.building ? 24 : 150) + 1e-7 ||
        !localWalkingConnection(w, connection.from, connection.to, w.localEconomy!.units[from.pool].nation, [
          from.cell,
          to.cell,
        ])
      )
        continue
      const distance = Math.max(1, Math.hypot(from.x - to.x, from.y - to.y))
      edges[i].push({ to: j, distance })
      edges[j].push({ to: i, distance })
    }
  })
  const owner = new Int32Array(sites.length).fill(-1)
  const costs = new Float64Array(sites.length).fill(Infinity)
  const byId = new Map(sites.map((s, i) => [s.id, i]))
  const queue = new MinHeap()
  const ordered = [...centres].sort((a, b) => a.id - b.id)
  const identities = new Map(w.localEconomy!.cities.map((c) => [c.id, c]))
  // Current nuclei take precedence over historical anchors at the same site.
  for (const historical of [false, true])
    for (const city of ordered) {
      const anchors = historical
        ? w.localEconomy!.cities.filter((c) => {
            let successor = c.absorbedBy
            while (successor !== undefined && successor !== city.id)
              successor = identities.get(successor)?.absorbedBy
            return successor === city.id
          })
        : [city]
      for (const anchor of anchors) {
        const i = byId.get(anchor.nucleusSite ?? `home:${anchor.nucleus}`)
        if (i === undefined || costs[i] === 0) continue
        owner[i] = city.id
        costs[i] = 0
        queue.push(i, 0)
      }
    }
  while (queue.size) {
    const { id, cost } = queue.pop()
    if (cost !== costs[id]) continue
    for (const edge of edges[id]) {
      const next = cost + edge.distance
      if (next < costs[edge.to] || (next === costs[edge.to] && owner[id] < owner[edge.to])) {
        costs[edge.to] = next
        owner[edge.to] = owner[id]
        queue.push(edge.to, next)
      }
    }
  }
  sites.forEach((site, i) => {
    if (owner[i] < 0) throw new Error('Urban component has no reachable centre')
    groups.get(owner[i])!.push(site)
    for (const edge of edges[i]) {
      if (edge.to <= i || owner[i] === owner[edge.to]) continue
      const a = Math.min(owner[i], owner[edge.to]),
        b = Math.max(owner[i], owner[edge.to])
      const key = `${a}:${b}`,
        contact = contacts.get(key) ?? { a: new Set<number>(), b: new Set<number>(), points: [] }
      contact.a.add(owner[i] === a ? i : edge.to)
      contact.b.add(owner[i] === b ? i : edge.to)
      contact.points.push(site)
      contacts.set(key, contact)
    }
  })
  return { groups, contacts }
}

export function centreStanding(w: World, city: City, sites: PhysicalSite[]) {
  let wealth = 0
  for (const site of sites) {
    const unit = w.localEconomy!.units[site.pool],
      hh = w.economy?.households[site.pool]
    // Pool deposits are attributed proportionally, not claimed to be a building census.
    const deposits = hh ? STRATA.reduce((sum, stratum) => sum + hh[stratum].cash, 0) : 0
    wealth += (site.investedValue ?? 0) + (deposits * (site.residents ?? 0)) / Math.max(1, population(unit))
  }
  const capital = w.nations.some(
    (n) =>
      n.capital === w.cells[city.nucleus].region &&
      sites.some((s) => s.id === `home:${w.regions[n.capital].center}`),
  )
  return {
    wealthPerResident: wealth / Math.max(1, city.population),
    prestige:
      Math.sqrt(city.population / 500) +
      Math.log1p(Math.max(0, w.month - city.founded) / 120) +
      (capital ? 2 : 0),
  }
}

/** A shared urban area can remain polycentric indefinitely. Incorporation and
 * full identity succession require both material wealth and prestige dominance,
 * sustained through broad occupied contact. Legal jurisdictions are untouched. */
export function integrateCentres(w: World, centres: City[], partition: ReturnType<typeof partitionCentres>) {
  for (const city of centres) {
    setCentreSites(city, partition.groups.get(city.id)!)
    city.standing = centreStanding(w, city, partition.groups.get(city.id)!)
  }
  if (centres.length === 1) {
    separateCentre(w, centres[0])
    return
  }
  const rank = (c: City) => c.standing!.prestige * (1 + Math.log1p(c.standing!.wealthPerResident))
  const ranked = [...centres].sort((a, b) => rank(b) - rank(a) || a.founded - b.founded || a.id - b.id)
  const incumbent = centres.find(
    (c) => !c.metropolis && centres.some((other) => other.metropolis?.centre === c.id),
  )
  const leader = incumbent && rank(ranked[0]) < rank(incumbent) * 1.2 ? incumbent : ranked[0]
  separateCentre(w, leader)
  for (const city of centres) {
    if (city === leader) continue
    if (city.metropolis?.centre !== leader.id) {
      separateCentre(w, city)
      city.metropolis = { centre: leader.id, since: w.month }
      event(w, city, 'linked', leader.id)
    }
    const relation = city.metropolis!
    const contact = partition.contacts.get(`${Math.min(city.id, leader.id)}:${Math.max(city.id, leader.id)}`)
    const points = contact?.points ?? []
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const p of points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const width = points.length ? Math.hypot(maxX - minX, maxY - minY) : 0
    const broad = !!contact && contact.a.size >= 3 && contact.b.size >= 3 && width >= 64
    const prestige = leader.standing!.prestige / Math.max(0.01, city.standing!.prestige)
    const richness = (1 + leader.standing!.wealthPerResident) / (1 + city.standing!.wealthPerResident)
    const dominant =
      broad && prestige >= URBAN_INTEGRATION.prestigeRatio && richness >= URBAN_INTEGRATION.wealthRatio
    const overwhelming =
      dominant &&
      prestige >= URBAN_INTEGRATION.mergerPrestigeRatio &&
      richness >= URBAN_INTEGRATION.mergerWealthRatio
    if (dominant) relation.dominantSince ??= w.month
    else delete relation.dominantSince
    if (overwhelming) relation.overwhelmingSince ??= w.month
    else delete relation.overwhelmingSince
    if (
      relation.incorporated === undefined &&
      relation.dominantSince !== undefined &&
      w.month - relation.dominantSince >= URBAN_INTEGRATION.incorporationMonths
    ) {
      relation.incorporated = w.month
      event(w, city, 'incorporated', leader.id)
    }
    if (
      relation.incorporated !== undefined &&
      relation.overwhelmingSince !== undefined &&
      w.month - Math.max(relation.overwhelmingSince, relation.incorporated) >= URBAN_INTEGRATION.mergerMonths
    ) {
      city.absorbedBy = leader.id
      event(w, city, 'merged', leader.id)
      leader.parents = [...new Set([...leader.parents, city.id])]
      leader.aliases = [...new Set([...leader.aliases, city.name, ...city.aliases])]
      partition.groups.get(leader.id)!.push(...partition.groups.get(city.id)!)
      setCentreSites(leader, partition.groups.get(leader.id)!)
      city.cells = []
      city.sites = []
      city.population = 0
      delete city.metropolis
    }
  }
}
