/** Destination orders own their rendezvous until arrival/cancellation. The
 * monthly navy and combat phases still execute every physical step and loss. */
import { shortestPaths } from './economy'
import { availableTransport, mayEnterProvince, movementGraph, seaPassage } from './maritime-routing'
import { canEmbarkArmy, embarkArmy, ensureWarfare, orderFleet, portAt, transportSeats } from './navy'
import type { Army, World } from './types'

/** Plan a land march or retain a sea journey even while capacity is unavailable. */
export function orderArmyJourney(w: World, army: Army, destination: number) {
  ensureWarfare(w)
  if (!w.regions[destination] || !mayEnterProvince(w, army.nation, destination))
    return 'The destination requires military access or a declared war.'
  if (army.operations!.embarkedOn !== null)
    return 'This army is already at sea. Land it before changing its destination.'
  const graph = movementGraph(w, army.nation)
  const land = shortestPaths(graph, army.region)
  if (Number.isFinite(land.distance[destination])) {
    delete army.operations!.journey
    army.target = destination === army.region ? null : destination
    army.operations!.stance = 'march'
    army.operations!.progress = 0
    return `${army.name} ordered to ${w.regions[destination].name}. Movement begins next month.`
  }
  const passage = seaPassage(w, army.nation, army.region, destination, graph)
  if (!passage) return 'No accessible land-and-sea route reaches this province.'
  const fleet = availableTransport(w, army.nation, passage.departure, army.soldiers, army.id)
  army.operations!.journey = {
    destination,
    departure: passage.departure,
    arrival: passage.arrival,
    fleet: fleet?.id ?? null,
    started: w.month,
    stage: fleet ? 'assembling' : 'waiting',
    obstacle: fleet ? '' : 'Waiting for an available, supplied fleet with enough berths.',
  }
  army.operations!.stance = 'march'
  army.operations!.progress = 0
  army.target = passage.departure === army.region ? null : passage.departure
  return `Sea journey to ${w.regions[destination].name} planned via ${w.regions[passage.departure].name}. ${fleet ? 'Troops and ships will assemble automatically.' : army.operations!.journey.obstacle}`
}

/** Holding an order releases an empty transport; passengers already at sea must
 * physically return or land, so cancellation never teleports a formation. */
export function cancelArmyJourney(army: Army) {
  const journey = army.operations?.journey
  if (!journey) return
  delete army.operations!.journey
  if (army.operations!.embarkedOn === null) army.target = null
}

/** Run before sailing. A world with no journeys does no routing work. */
export function advanceArmyJourneys(w: World) {
  for (const army of w.armies) {
    const o = army.operations,
      j = o?.journey
    if (!o || !j) continue
    const wait = (reason: string) => {
      j.stage = 'waiting'
      j.obstacle = reason
    }
    if (!mayEnterProvince(w, army.nation, j.destination)) {
      wait('Destination access was revoked or the war ended.')
      if (o.embarkedOn === null) army.target = null
      continue
    }
    if (o.embarkedOn !== null) {
      const f = w.warfare!.fleets.find((f) => f.id === o.embarkedOn)!
      j.stage = f.course.length ? 'sailing' : 'landing'
      j.obstacle = f.mission === 'return' ? 'The fleet is returning for supplies or repairs.' : ''
      continue
    }
    if (army.region === j.destination) {
      delete o.journey
      army.target = null
      continue
    }
    if (j.stage === 'inland') {
      army.target = j.destination
      continue
    }
    if (o.stance !== 'march' || o.disorder) {
      wait('The army must be fit and ordered to advance.')
      continue
    }
    let fleet = w.warfare?.fleets.find((f) => f.id === j.fleet && f.nation === army.nation)
    if (!fleet || transportSeats(fleet) < army.soldiers || fleet.embarked.length) {
      j.fleet = null
      fleet = availableTransport(w, army.nation, j.departure, army.soldiers, army.id)
      j.fleet = fleet?.id ?? null
    }
    if (!fleet) {
      wait('Waiting for an available, supplied fleet with enough berths.')
      continue
    }
    if (!portAt(w, j.departure) || !portAt(w, j.arrival)) {
      wait('A surveyed embarkation or landing port is unavailable.')
      continue
    }
    const path = shortestPaths(movementGraph(w, army.nation), army.region)
    if (!Number.isFinite(path.distance[j.departure])) {
      wait('The army can no longer reach its departure port.')
      continue
    }
    army.target = army.region === j.departure ? null : j.departure
    j.stage = 'assembling'
    j.obstacle = ''
    try {
      if (fleet.cell !== portAt(w, j.departure)!.water) {
        if (fleet.target !== j.departure || !fleet.course.length)
          orderFleet(w, fleet.id, j.departure, 'return')
        continue
      }
      if (army.region !== j.departure) continue
      j.stage = 'boarding'
      if (army.supply < 0.65 || fleet.supply < 0.65 || army.operations!.food < army.soldiers * 0.034) {
        wait('Waiting for troop and fleet provisions at the departure port.')
        continue
      }
      if (!canEmbarkArmy(w, army, fleet)) {
        wait('Embarkation access or transport capacity is unavailable.')
        continue
      }
      // Validate the voyage before changing the manifest, leaving no half-boarded order.
      orderFleet(w, fleet.id, j.arrival, 'transport')
      embarkArmy(w, army.id, fleet.id)
      j.stage = 'sailing'
    } catch (error) {
      wait(error instanceof Error ? error.message : 'The sea passage is blocked.')
    }
  }
}
