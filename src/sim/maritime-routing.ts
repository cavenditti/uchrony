/** Shared physical passage quotes. Land paths obey directional access; water
 * paths use surveyed geography. Quotes reserve neither ships nor public money. */
import { activeExpedition } from './overseas-types'
import { diplomaticAccess } from './agreements'
import { shortestPaths, transportGraph, type Graph } from './economy'
import { stepDistance } from './grid'
import { knownMap } from './intelligence'
import { controller } from './military-control'
import { friendlyPort, portAt, transportSeats, waterPath } from './navy'
import { portBlockadeView } from './naval-control'
import { transportNetwork } from './transport'
import { relation, type World } from './types'
import type { Fleet } from './military-types'

export interface SeaPassage {
  departure: number
  arrival: number
  distance: number
  months: number
  landCost: number
}

/** The same legal land graph serves explicit orders and automatic rendezvous. */
export function movementGraph(w: World, nation: number): Graph {
  const chart = w.nations[nation].ai ? new Set(knownMap(w, nation).map((r) => r.id)) : null
  return transportGraph(w, nation).map((edges, from) =>
    chart && !chart.has(from) ? [] : edges.filter((e) => !e.sea && (!chart || chart.has(e.to))),
  )
}

export function mayEnterProvince(w: World, nation: number, region: number) {
  const owner = controller(w, region)
  return (
    owner === nation ||
    relation(w, nation, owner)?.treaty === 'war' ||
    diplomaticAccess(w, nation, owner, 'transit', region)
  )
}

/** Map spans, including diagonal distance, are the navy's movement unit. */
export function seaDistance(w: World, path: readonly number[]) {
  let distance = 0
  for (let i = 1; i < path.length; i++) distance += stepDistance(w.cells[path[i - 1]], w.cells[path[i]])
  return distance
}

export function sailingMonths(w: World, nation: number, distance: number) {
  return Math.max(1, Math.ceil(distance / Math.max(1, 12 + w.nations[nation].technologies.logistics * 3)))
}

/** Reverse the directed graph once: a landing must reach the destination, not
 * merely be reachable FROM it through a one-way military-access corridor. */
export function seaPassage(
  w: World,
  nation: number,
  from: number,
  to: number,
  graph = movementGraph(w, nation),
): SeaPassage | undefined {
  if (!mayEnterProvince(w, nation, to)) return
  const outward = shortestPaths(graph, from)
  const reversed: Graph = graph.map(() => [])
  for (const [start, edges] of graph.entries())
    for (const edge of edges) reversed[edge.to].push({ ...edge, to: start })
  const inward = shortestPaths(reversed, to)
  const chart = w.nations[nation].ai ? new Set(knownMap(w, nation).map((r) => r.id)) : null
  const blockade = portBlockadeView(w)
  const harbors = transportNetwork(w).harbors.filter((h) => !chart || chart.has(h.region))
  const departures = harbors.filter(
    (h) => Number.isFinite(outward.distance[h.region]) && friendlyPort(w, nation, h.region),
  )
  const arrivals = harbors.filter(
    (h) =>
      Number.isFinite(inward.distance[h.region]) &&
      mayEnterProvince(w, nation, h.region) &&
      blockade(nation, h.region) > 0,
  )
  let best: SeaPassage | undefined
  let score = Infinity
  for (const departure of departures)
    for (const arrival of arrivals) {
      if (departure.region === arrival.region) continue
      const landCost = outward.distance[departure.region] + inward.distance[arrival.region]
      // Straight-line distance is a lower bound on any navigable water path.
      // Reject inferior port pairs before allocating an ocean path search.
      if (landCost + stepDistance(w.cells[departure.water], w.cells[arrival.water]) >= score) continue
      const path = waterPath(w, departure.water, arrival.water)
      if (!path.length) continue
      const distance = seaDistance(w, path)
      const candidate = landCost + distance
      if (candidate >= score) continue
      score = candidate
      best = {
        departure: departure.region,
        arrival: arrival.region,
        distance,
        months: sailingMonths(w, nation, distance),
        landCost,
      }
    }
  return best
}

/** A ship already committed to passengers or an explicit operation cannot be
 * silently reassigned. Reservations live on their owning journeys/projects. */
export function fleetReserved(w: World, fleet: number, exceptArmy?: number) {
  return (
    w.armies.some((a) => a.id !== exceptArmy && a.operations?.journey?.fleet === fleet) ||
    (w.overseas?.expeditions.some((e) => activeExpedition(e) && e.fleet === fleet) ?? false)
  )
}

export function availableTransport(
  w: World,
  nation: number,
  departure: number,
  people: number,
  exceptArmy?: number,
  excluded?: ReadonlySet<number>,
): Fleet | undefined {
  const harbor = portAt(w, departure)
  if (!harbor) return
  let chosen: Fleet | undefined
  let distance = Infinity
  for (const f of w.warfare?.fleets ?? []) {
    if (
      f.nation !== nation ||
      excluded?.has(f.id) ||
      f.embarked.length ||
      fleetReserved(w, f.id, exceptArmy) ||
      !['escort', 'return'].includes(f.mission) ||
      f.course.length ||
      transportSeats(f) < people ||
      f.hull < 0.5 ||
      f.supply < 0.5 ||
      f.morale < 0.2
    )
      continue
    const path = waterPath(w, f.cell, harbor.water)
    if (!path.length) continue
    const length = seaDistance(w, path)
    if (length < distance) {
      distance = length
      chosen = f
    }
  }
  return chosen
}
