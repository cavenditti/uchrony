/**
 * Places: the administrative identity of settled land.
 *
 * Land itself carries no town/countryside distinction; it carries the
 * settlement fields (`settlement-field.ts`). A *place* is the only distinction,
 * and it is administrative: a named identity holding one prominent mode of the
 * agglomeration field and administering every home in that mode's basin, town
 * and hinterland alike. Places are born, grow, become quarters of a neighbour,
 * regain independence and retire solely through the field's topology
 * (`settlement-topology.ts`):
 *
 * - **Territory.** Every home within reach of a place belongs to the place
 *   whose mode its node ascends to. Insignificant ripples resolve to their
 *   significant ancestor; small unnamed basins join the place they adjoin, so a
 *   hamlet that grew against a town is administered by it.
 * - **Birth.** A significant mode (prominence ≥ `quarterBirth`, or an area
 *   summit) without an owner is named once the residents of developed fabric in
 *   its basin (and in unnamed basins adjoining it) reach the village threshold.
 *   Its population is then everyone it administers, dispersed occupants included.
 *   Because modes live at market scale, evenly spread growth forms one plateau
 *   with one summit instead of a lattice of identical villages.
 * - **Identity.** A place keeps the mode its nucleus (the occupied home nearest
 *   its peak) ascends to, so peaks may drift with growth while names persist.
 *   An existing place keeps its own peak down to `quarterRetirement`
 *   (hysteresis); below it, or when two places' nuclei reach one peak, the
 *   junior identity merges into the senior and survives as an alias.
 * - **Quarters.** In a shared urban area the summit's place is principal and
 *   other prominent places are independent. One whose prominence falls below
 *   `incorporation` is *linked* to the nearest independent place above it and,
 *   if that persists for `transitionMonths`, becomes its quarter; a quarter is
 *   released again only once its prominence reaches `release` for as long.
 *
 * Nothing here moves residents, buildings, accounts or legal jurisdictions:
 * places are read from the physical census and recorded for history, naming
 * and observation. Repeated refreshes within one month cannot advance a dwell.
 */
import type { World } from './types'
import type { City } from './district-types'
import { hashSeed } from './random'
import { SETTLEMENT, settlementKind } from './settlement-model'
import {
  PLACE_TOPOLOGY,
  prominence,
  settlementStructure,
  type FieldMode,
  type SettlementStructure,
  type SettlementTopology,
} from './settlement-topology'

type PlaceEvent = NonNullable<City['history']>[number]['kind']
const record = (w: World, city: City, kind: PlaceEvent, other: number) =>
  (city.history ??= []).push({ month: w.month, kind, with: other })

/** How the merge tree resolves into administration. Pure: modes in, indices out. */
export interface PlaceTree {
  /** Nearest significant ancestor of every mode (itself when significant). */
  readonly rep: Int32Array
  /** Significant modes that hold, or are about to found, a named place. */
  readonly isPlace: Uint8Array
  /** Place mode administering each significant mode (−1: open country). */
  readonly placeOf: Int32Array
  /** Principal place mode of each urban area (−1: no named place). */
  readonly principal: Int32Array
}

/** Significance with hysteresis: a held peak persists down to the retirement
 * prominence, a new one needs the birth prominence; area summits always count.
 * Parents have smaller indices than children, so one forward pass resolves
 * every insignificant ripple to its nearest significant ancestor. */
export function significantAncestors(modes: readonly FieldMode[], claimed: Uint8Array) {
  const P = PLACE_TOPOLOGY,
    rep = new Int32Array(modes.length)
  for (let m = 0; m < modes.length; m++) {
    const mode = modes[m]
    rep[m] =
      mode.parent < 0 || prominence(mode) >= (claimed[m] ? P.quarterRetirement : P.quarterBirth)
        ? m
        : rep[mode.parent]
  }
  return rep
}

/** Which significant modes are places and who administers the rest.
 * Developed residents accumulate children before parents (descending index is
 * ascending peak): a basin too small to name passes them to the basin it joins,
 * so hamlets that grew against one another can found a place together. */
export function placeTree(
  topology: SettlementTopology,
  rep: Int32Array,
  developed: Float64Array,
  owned: (mode: number) => boolean,
): PlaceTree {
  const { modes, summits } = topology
  const total = new Float64Array(modes.length),
    isPlace = new Uint8Array(modes.length)
  for (let m = 0; m < modes.length; m++) total[rep[m]] += developed[m]
  for (let m = modes.length - 1; m >= 0; m--) {
    if (rep[m] !== m) continue
    if (owned(m) || total[m] >= SETTLEMENT.villagePopulation) isPlace[m] = 1
    else if (modes[m].parent >= 0) total[rep[modes[m].parent]] += total[m]
  }
  const principal = new Int32Array(summits.length).fill(-1)
  for (let m = 0; m < modes.length; m++)
    if (isPlace[m] && principal[modes[m].area] < 0) principal[modes[m].area] = m
  // Ancestors resolve first. An unnamed basin with no named ancestor (a small
  // summit beside a larger named slope) is administered by the area's principal.
  const placeOf = new Int32Array(modes.length).fill(-1)
  for (let m = 0; m < modes.length; m++) {
    if (rep[m] !== m) continue
    placeOf[m] = isPlace[m] ? m : modes[m].parent >= 0 ? placeOf[rep[modes[m].parent]] : -1
    if (placeOf[m] < 0) placeOf[m] = principal[modes[m].area]
  }
  return { rep, isPlace, placeOf, principal }
}

/** End any link or quarter relation, recording the separation once. */
function separate(w: World, city: City) {
  if (city.metropolis) record(w, city, 'separated', city.metropolis.centre)
  delete city.metropolis
}

/** The junior identity becomes a dated alias of the place that now holds its peak. */
function absorb(w: World, city: City, keeper: City) {
  separate(w, city)
  city.absorbedBy = keeper.id
  record(w, city, 'merged', keeper.id)
  keeper.parents = [...new Set([...keeper.parents, city.id])]
  keeper.aliases = [...new Set([...keeper.aliases, city.name, ...city.aliases])]
  clearTerritory(city)
}

function clearTerritory(city: City) {
  city.cells = []
  if (city.sites) city.sites = []
  city.population = 0
  delete city.field
}

function placeName(w: World, cell: number, used: Set<string>) {
  const suffix = ['Ford', 'Cross', 'Vale', 'Heath', 'Bank', 'Mere', 'Ridge', 'Field'][
    hashSeed(`${w.seed}:place:${cell}`) % 8
  ]
  let name = `${w.regions[w.cells[cell].region].name} ${suffix}`
  if (used.has(name)) name += ` ${w.localEconomy!.nextCity + 1}`
  used.add(name)
  return name
}

/** Status machine of a non-principal place against the place administering it:
 * independent ⇄ linked (incorporation pending) → quarter → released. Returns
 * whether the place is a quarter after this refresh. */
function updateRelation(w: World, city: City, centre: City, p: number, newborn: boolean) {
  const P = PLACE_TOPOLOGY
  let relation = city.metropolis
  if (relation?.incorporated === undefined) {
    if (p >= P.incorporation) {
      separate(w, city)
      return false
    }
    if (!relation) {
      relation = city.metropolis = { centre: centre.id, since: w.month }
      record(w, city, 'linked', centre.id)
    }
    // A newly named basin that is already a flank of its neighbour is born a quarter.
    if (newborn || w.month - (relation.pending ??= w.month) >= P.transitionMonths) {
      delete relation.pending
      relation.incorporated = w.month
      record(w, city, 'incorporated', centre.id)
    }
  } else if (p < P.release) delete relation.pending
  else if (w.month - (relation.pending ??= w.month) >= P.transitionMonths) {
    record(w, city, 'released', centre.id)
    delete city.metropolis
    return false
  }
  if (relation.centre !== centre.id) {
    relation.centre = centre.id
    record(w, city, 'linked', centre.id)
  }
  return relation.incorporated !== undefined
}

/** Reconcile place identities with the current settlement fields. */
export function refreshPlaces(w: World, structure: SettlementStructure = settlementStructure(w)) {
  const local = w.localEconomy
  if (!local) return
  const { sources, sourceMode, sourceReach, topology, agglomeration: field } = structure
  const { modes } = topology
  // Legacy cell economies have no site registry; their places record cells only.
  const physical = w.adaptive?.residentialVersion === 1
  const sourceIndex = new Map(sources.map((s, i) => [s.id, i]))

  // 1. Claims: each living identity's raw mode is the one its nucleus ascends to,
  //    else the one holding most of its previous occupants. The larger, then
  //    older, identity claims first.
  const living = local.cities
    .filter((c) => c.absorbedBy === undefined && c.abandoned === undefined)
    .sort((a, b) => b.population - a.population || a.founded - b.founded || a.id - b.id)
  const rawOf = new Map<City, number>()
  for (const city of living) {
    const nucleus = sourceIndex.get(city.nucleusSite ?? `home:${city.nucleus}`)
    let mode = nucleus === undefined ? -1 : sourceMode[nucleus]
    if (mode < 0) {
      const votes = new Map<number, number>()
      for (const id of city.sites ?? city.cells.map((c) => `home:${c}`)) {
        const i = sourceIndex.get(id)
        if (i !== undefined && sourceMode[i] >= 0)
          votes.set(sourceMode[i], (votes.get(sourceMode[i]) ?? 0) + sources[i].people)
      }
      mode = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? -1
    }
    rawOf.set(city, mode)
  }

  // 2. Owners: the most senior claimant keeps a significant peak; later
  //    claimants of the same peak merge into it.
  const claimed = new Uint8Array(modes.length)
  for (const mode of rawOf.values()) if (mode >= 0) claimed[mode] = 1
  const rep = significantAncestors(modes, claimed)
  const owner = new Map<number, City>()
  for (const city of living) {
    const raw = rawOf.get(city)!
    if (raw < 0) continue
    const keeper = owner.get(rep[raw])
    if (keeper) absorb(w, city, keeper)
    else owner.set(rep[raw], city)
  }

  // 3. Administration. Naming thresholds count residents in developed fabric:
  //    a coarse rural record with a few new houses must not found a town of all
  //    its dispersed occupants.
  const developed = new Float64Array(modes.length)
  sources.forEach((s, i) => {
    if (sourceMode[i] >= 0) developed[sourceMode[i]] += s.developed
  })
  const { isPlace, placeOf, principal } = placeTree(topology, rep, developed, (m) => owner.has(m))
  const members = new Map<number, number[]>()
  sources.forEach((_, i) => {
    const place = sourceMode[i] < 0 ? -1 : placeOf[rep[sourceMode[i]]]
    if (place < 0) return
    const list = members.get(place)
    if (list) list.push(i)
    else members.set(place, [i])
  })

  // 4. Seats and labels. The nucleus is the occupied home nearest the peak; the
  //    label sits at the centre of mass of the place's core, the developed
  //    fabric within half the peak's reach, so a large hinterland cannot drag it
  //    away from the centre that names the place. Both are physical positions,
  //    never a field node or terrain-sample centre.
  const nucleusOf = (m: number) => {
    const span = field.scale.span,
      x = ((modes[m].node % field.columns) + 0.5) * span,
      y = (Math.floor(modes[m].node / field.columns) + 0.5) * span
    let best = -1,
      bestScore = Infinity
    for (const i of members.get(m)!) {
      const s = sources[i]
      // Unoccupied homes rank after every occupied one.
      const score = Math.hypot(s.x - x, s.y - y) + (s.people > 0 ? 0 : 1e9)
      const b = sources[best]
      if (
        score < bestScore ||
        (score === bestScore && (s.people > b.people || (s.people === b.people && s.id < b.id)))
      ) {
        best = i
        bestScore = score
      }
    }
    return sources[best]
  }
  const coreCentre = (m: number, list: number[]) => {
    const core = (modes[m].peak * field.reachArea) / 2
    for (const restrict of [true, false]) {
      let x = 0,
        y = 0,
        mass = 0
      for (const i of list) {
        if (restrict && sourceReach[i] < core) continue
        const weight = sources[i].developed || sources[i].people * 1e-9
        x += sources[i].x * weight
        y += sources[i].y * weight
        mass += weight
      }
      if (mass > 0) return { x: x / mass, y: y / mass }
    }
    return nucleusOf(m)
  }

  // 5. Births, in descending peak order so names are assigned deterministically.
  const used = new Set(local.cities.map((c) => c.name)),
    born = new Set<City>()
  for (let m = 0; m < modes.length; m++) {
    if (!isPlace[m] || owner.has(m)) continue
    const nucleus = nucleusOf(m)
    const city: City = {
      id: local.nextCity++,
      name: placeName(w, nucleus.cell, used),
      aliases: [],
      founded: w.month,
      nucleus: nucleus.cell,
      cells: [],
      population: 0,
      kind: 'village',
      parents: [],
      lastNameChange: w.month,
    }
    local.cities.push(city)
    owner.set(m, city)
    born.add(city)
  }

  // 6. Records and status, ancestors before descendants so a centre's own
  //    status is settled before its quarters choose it.
  const quarter = new Uint8Array(modes.length)
  for (let m = 0; m < modes.length; m++) {
    const city = owner.get(m)
    if (!city || !isPlace[m]) continue
    const list = members.get(m)!
    city.population = list.reduce((sum, i) => sum + sources[i].people, 0)
    if (!city.population) {
      // An identity is abandoned when its last residents leave, never at a label threshold.
      separate(w, city)
      clearTerritory(city)
      city.abandoned = w.month
      continue
    }
    const nucleus = nucleusOf(m)
    city.cells = [...new Set(list.map((i) => sources[i].cell))].sort((a, b) => a - b)
    if (physical) {
      city.sites = list.map((i) => sources[i].id).sort()
      city.nucleusSite = nucleus.id
    }
    city.nucleus = nucleus.cell
    // Village, town and city describe the developed core; the census also
    // counts the farms it administers, which make no place more urban.
    const fabric = list.reduce((sum, i) => sum + sources[i].developed, 0)
    city.kind = settlementKind(fabric)
    city.field = {
      reach: modes[m].peak * field.reachArea,
      prominence: prominence(modes[m]),
      developed: Math.round(fabric),
      ...coreCentre(m, list),
    }
    if (principal[modes[m].area] === m) {
      separate(w, city)
      continue
    }
    // The centre is the nearest ancestor place that is not itself a quarter.
    let centre = principal[modes[m].area]
    for (let a = modes[m].parent; a >= 0; a = modes[a].parent) {
      const p = placeOf[rep[a]]
      if (p >= 0 && p !== m && !quarter[p] && owner.get(p)!.abandoned === undefined) {
        centre = p
        break
      }
    }
    if (owner.get(centre)!.abandoned !== undefined) separate(w, city)
    else
      quarter[m] = Number(updateRelation(w, city, owner.get(centre)!, city.field.prominence, born.has(city)))
  }

  // 7. Identities without a peak keep their remaining occupied homes until the
  //    last resident leaves.
  const held = new Set<number>()
  for (const list of members.values()) for (const i of list) held.add(i)
  for (const city of living) {
    if (city.absorbedBy !== undefined || rawOf.get(city)! >= 0) continue
    separate(w, city)
    delete city.field
    const remaining = (city.sites ?? city.cells.map((c) => `home:${c}`))
      .map((id) => sourceIndex.get(id))
      .filter((i): i is number => i !== undefined && sources[i].people > 0 && !held.has(i))
    city.population = remaining.reduce((sum, i) => sum + sources[i].people, 0)
    city.cells = [...new Set(remaining.map((i) => sources[i].cell))].sort((a, b) => a - b)
    if (physical) {
      city.sites = remaining.map((i) => sources[i].id).sort()
      if (city.sites.length && !city.sites.includes(city.nucleusSite!)) city.nucleusSite = city.sites[0]
      if (city.nucleusSite && w.adaptive!.sites[city.nucleusSite])
        city.nucleus = w.adaptive!.sites[city.nucleusSite].cell
    }
    city.kind = settlementKind(remaining.reduce((sum, i) => sum + sources[i].developed, 0))
    if (!city.population) city.abandoned = w.month
  }

  nameDistricts(w)
}

/** Resident markets take the name of the largest place holding their centre. */
function nameDistricts(w: World) {
  const local = w.localEconomy!
  const placeAt = new Map<number, City>()
  for (const city of local.cities)
    if (city.absorbedBy === undefined && city.abandoned === undefined)
      for (const c of city.cells) {
        const previous = placeAt.get(c)
        if (
          !previous ||
          city.population > previous.population ||
          (city.population === previous.population && city.id < previous.id)
        )
          placeAt.set(c, city)
      }
  const suffixes = {
    mining: 'mining district',
    industrial: 'industrial district',
    agricultural: 'farmland',
    wilderness: 'uplands',
    urban: 'district',
    mixed: 'district',
  } as const
  for (const id of local.active) {
    const u = local.units[id]
    u.name = placeAt.get(u.center)?.name ?? `${w.regions[u.province].name} ${suffixes[u.activity]}`
  }
}
