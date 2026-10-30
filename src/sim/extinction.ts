import { expeditionPeople } from './overseas-types'
import { population, type World } from './types'
import { economicRegions } from './local-units'
import { allForces, militaryPeople } from './forces'
import { returnArmyPeople } from './population'
import { governmentAccount, transfer } from './ledger'
import { recordWorldEvent } from './event-memory'

/** Retain historical IDs and financial claims, but end government, diplomacy
 * and territorial control when no civilians or military residents remain. */
export function retireEmptyStates(w: World) {
  const people = new Map<number, number>()
  for (const unit of economicRegions(w))
    people.set(unit.nation, (people.get(unit.nation) ?? 0) + population(unit))
  const ended = new Set(
    w.nations
      .filter(
        (n) =>
          n.extinct === undefined &&
          (people.get(n.id) ?? 0) + militaryPeople(w, n.id) + expeditionPeople(w, n.id) === 0,
      )
      .map((n) => n.id),
  )
  if (!ended.size) return false
  for (const n of w.nations) {
    if (!ended.has(n.id)) continue
    n.extinct = w.month
    n.ai = false
    n.population = n.manpower = 0
    for (const key of Object.keys(n.budget) as (keyof typeof n.budget)[]) n.budget[key] = 0
    for (const force of allForces(w).filter((f) => f.nation === n.id))
      returnArmyPeople(w, force, w.regions[force.region])
    recordWorldEvent(w, {
      id: w.nextEvent++,
      month: w.month,
      type: 'world',
      nation: n.id,
      title: `${n.shortName} ceases to exist`,
      detail:
        'No civilian or military residents remain. Its government and territorial claims end; its history, buildings and outstanding financial claims remain recorded.',
    })
  }
  for (const region of w.regions)
    if (ended.has(region.nation)) {
      region.nation = -1
      for (const group of region.communities ?? []) group.host = -1
    }
  for (const unit of economicRegions(w))
    if (ended.has(unit.nation)) {
      unit.nation = -1
      for (const group of unit.communities ?? []) group.host = -1
    }
  for (const jurisdiction of Object.values(w.adaptive?.jurisdictions ?? {}))
    if (jurisdiction.retired === undefined && ended.has(jurisdiction.nation)) jurisdiction.retired = w.month
  if (w.adaptive) w.adaptive.revision++
  for (const rel of w.relations)
    if (ended.has(rel.a) || ended.has(rel.b)) {
      rel.treaty = 'neutral'
      rel.since = w.month
      rel.warExhaustion = 0
    }
  w.armies = w.armies.filter((a) => !ended.has(a.nation))
  if (w.warfare) {
    w.warfare.fleets = w.warfare.fleets.filter((f) => !ended.has(f.nation))
    for (const fleet of w.warfare.fleets)
      fleet.embarked = fleet.embarked.filter((id) => w.armies.some((a) => a.id === id))
    w.warfare.revision++
  }
  for (const offer of w.statecraft?.offers ?? [])
    if (['proposed', 'ratified'].includes(offer.status) && offer.parties.some((id) => ended.has(id))) {
      offer.status = 'expired'
      w.statecraft!.revision++
    }
  for (const organization of w.institutions?.organizations ?? []) {
    if (organization.status !== 'active' || !organization.members.some((id) => ended.has(id))) continue
    const previous = organization.members
    organization.members = previous.filter((id) => !ended.has(id))
    if (organization.members.length < 2) {
      const beneficiary = organization.members[0] ?? previous[0]
      transfer(
        w,
        `institution:${organization.id}`,
        governmentAccount(beneficiary),
        organization.treasury,
        'institution dissolution',
      )
      organization.status = 'dissolved'
    }
  }
  return true
}
