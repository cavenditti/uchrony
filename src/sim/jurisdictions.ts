import { neighbors } from './hex'
import { cellPosition } from './physical-space'
import { ensureAdaptiveWorld } from './adaptive-world'
import { householdAccount, governmentAccount, transfer } from './ledger'
import { recordWages } from './national-accounts'
import { STRATA } from './economic-types'
import type { World } from './types'
import type { Jurisdiction } from './adaptive-types'

export const activeJurisdictions = (w: World, level?: Jurisdiction['level']) =>
  Object.values(w.adaptive?.jurisdictions ?? {}).filter(
    (j) => j.retired === undefined && (!level || j.level === level),
  )
export function jurisdictionAt(w: World, cell: number, level: Jurisdiction['level'] = 'municipality') {
  return activeJurisdictions(w, level).find((j) => j.cells.includes(cell))
}
export function jurisdictionOwners(w: World, level: Jurisdiction['level']) {
  const owners = new Map<number, string>()
  for (const jurisdiction of activeJurisdictions(w, level))
    for (const cell of jurisdiction.cells) owners.set(cell, jurisdiction.id)
  return owners
}
function connected(w: World, cells: number[]) {
  if (!cells.length) return false
  const remaining = new Set(cells),
    queue = [cells[0]]
  remaining.delete(cells[0])
  for (let i = 0; i < queue.length; i++)
    for (const next of neighbors(queue[i], w.width, w.height)) if (remaining.delete(next)) queue.push(next)
  if (!remaining.size) return true
  // Existing islands may remain together only when a real sea corridor joins components.
  for (const route of w.routes)
    if (route.legs?.some((l) => l.mode === 'sea')) {
      const path = route.legs.flatMap((l) => l.cells)
      if (path.some((c) => queue.includes(c))) for (const c of path) if (remaining.delete(c)) queue.push(c)
    }
  for (let i = 0; i < queue.length; i++)
    for (const next of neighbors(queue[i], w.width, w.height)) if (remaining.delete(next)) queue.push(next)
  return remaining.size === 0
}
export interface ReformProposal {
  level: Jurisdiction['level']
  from: string[]
  replacements: { name: string; cells: number[]; seat: number }[]
  reason: string
}
/** Validate everything before writing any geometry. Legal accounts, sites and historic region handles survive. */
export function applyAdministrativeReform(w: World, proposal: ReformProposal, cost = 0) {
  const a = ensureAdaptiveWorld(w)
  const source = proposal.from.map((id) => a.jurisdictions[id])
  if (
    !source.length ||
    new Set(proposal.from).size !== source.length ||
    source.some((j) => !j || j.retired !== undefined || j.level !== proposal.level)
  )
    throw new Error('Invalid administrative predecessors')
  const nation = source[0].nation
  if (source.some((j) => j.nation !== nation))
    throw new Error('Administrative reform cannot change sovereignty')
  const original = new Set(source.flatMap((j) => j.cells)),
    seen = new Set<number>()
  for (const replacement of proposal.replacements) {
    if (
      !replacement.name.trim() ||
      !replacement.cells.includes(replacement.seat) ||
      !connected(w, replacement.cells)
    )
      throw new Error('Administrative seat must serve connected territory')
    for (const cell of replacement.cells) {
      if (!original.has(cell) || seen.has(cell) || w.regions[w.cells[cell].region].nation !== nation)
        throw new Error('Reform must cover the same sovereign territory exactly once')
      seen.add(cell)
    }
  }
  if (seen.size !== original.size) throw new Error('Reform would abandon territory')
  const created = proposal.replacements.map((replacement, i): Jurisdiction => {
    const id = `${proposal.level}:reform:${a.nextJurisdiction + i}`
    return {
      ...replacement,
      id,
      level: proposal.level,
      nation,
      founded: w.month,
      revised: w.month,
      successors: [],
      predecessors: [...proposal.from],
      account: source[0].account,
    }
  })
  // All state mutations after validation are synchronous and cannot yield to an observer.
  for (const old of source) {
    old.retired = w.month
    old.successors = created.map((j) => j.id)
  }
  for (const next of created) a.jurisdictions[next.id] = next
  a.nextJurisdiction += created.length
  a.boundaries.push({
    month: w.month,
    level: proposal.level,
    from: [...proposal.from],
    to: created.map((j) => j.id),
    assignments: created.flatMap((j) => j.cells.map((c): [number, string] => [c, j.id])),
    reason: proposal.reason,
    cost,
  })
  a.revision++
  return created
}
function residents(w: World, cell: number) {
  const site = w.adaptive!.sites[`home:${cell}`]
  return site ? (w.localEconomy!.units[site.pool].residents[cell] ?? 0) : 0
}
/** Network-constrained service access. Closed/impassable links are absent. Values are minutes. */
export function serviceTravel(w: World, seat: number, allowed: Set<number>) {
  const distance = new Map<number, number>([[seat, 0]]),
    queue = [seat]
  // Deterministic relaxation over local cells; geographic distance is converted to walking/road time.
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i],
      from = cellPosition(w, c)
    for (const next of neighbors(c, w.width, w.height)) {
      if (!allowed.has(next)) continue
      const to = cellPosition(w, next),
        terrain = w.cells[next].terrain
      const infrastructure = w.regions[w.cells[next].region].infrastructure
      const speed =
        4 * (terrain === 'mountains' ? 0.45 : terrain === 'hills' ? 0.7 : 1) * (1 + infrastructure * 0.4)
      const minutes = distance.get(c)! + (Math.hypot(to.x - from.x, to.y - from.y) / 1000 / speed) * 60
      if (minutes + 1e-8 < (distance.get(next) ?? Infinity)) {
        distance.set(next, minutes)
        queue.push(next)
      }
    }
  }
  return distance
}
function monthlyCost(
  w: World,
  jurisdictions: Pick<Jurisdiction, 'seat' | 'cells' | 'level'>[],
  nation: number,
) {
  const cells = new Set(jurisdictions.flatMap((j) => j.cells))
  const wage = w.economy!.producers[w.nations[nation].capital]?.wage ?? 0.01
  let cost = 0
  for (const j of jurisdictions) {
    const travel = serviceTravel(w, j.seat, cells)
    // Four return visits per year, valued at a quarter of the hourly wage; offices require paid clerks.
    cost += j.cells.reduce(
      (sum, c) =>
        sum + ((((((residents(w, c) * (travel.get(c) ?? 1440)) / 60) * 2 * 4) / 12) * wage) / 160) * 0.25,
      0,
    )
    const served = j.cells.reduce((sum, c) => sum + residents(w, c), 0)
    cost += wage * ((j.level === 'province' ? 20 : 4) + served / 10000 + (served / 80000) ** 1.3)
  }
  return cost
}
function seatFor(w: World, cells: number[]) {
  return [...cells].sort((x, y) => residents(w, y) - residents(w, x) || x - y)[0]
}
/** Annual, feasible local search. Savings must repay reorganization work; no province-count target. */
export function reviewAdministration(w: World) {
  const a = w.adaptive
  if (!a || w.month - a.reviewMonth < 12) return
  a.reviewMonth = w.month
  for (const level of ['municipality', 'province'] as const) {
    const active = activeJurisdictions(w, level),
      owners = jurisdictionOwners(w, level)
    for (const nation of w.nations) {
      if (nation.stability < 25) continue
      const candidates: { proposal: ReformProposal; saving: number; work: number }[] = []
      for (const j of active.filter((x) => x.nation === nation.id)) {
        const base = monthlyCost(w, [j], nation.id),
          wage = w.economy!.producers[w.nations[nation.id].capital]?.wage ?? 0.01
        const work = 2 + j.cells.reduce((s, c) => s + residents(w, c), 0) / 20000
        const adjacent = new Set(
          j.cells.flatMap((c) => neighbors(c, w.width, w.height)).map((c) => owners.get(c)),
        )
        for (const id of [...adjacent].filter((id): id is string => !!id && id > j.id)) {
          const other = a.jurisdictions[id]
          if (other.nation !== nation.id || other.retired !== undefined) continue
          const cells = [...j.cells, ...other.cells]
          const merged = {
            name: residents(w, j.seat) >= residents(w, other.seat) ? j.name : other.name,
            cells,
            seat: seatFor(w, cells),
            level,
          }
          const saving = base + monthlyCost(w, [other], nation.id) - monthlyCost(w, [merged], nation.id)
          if (saving * 36 > work * wage && connected(w, cells))
            candidates.push({
              proposal: {
                level,
                from: [j.id, other.id],
                replacements: [merged],
                reason: 'Shared administration reduces service and office costs.',
              },
              saving,
              work,
            })
          // A boundary can move without merging the jurisdictions.
          for (const cell of j.cells.filter(
            (c) => c !== j.seat && neighbors(c, w.width, w.height).some((n) => owners.get(n) === other.id),
          )) {
            const first = { ...j, cells: j.cells.filter((c) => c !== cell) },
              second = { ...other, cells: [...other.cells, cell] }
            if (!connected(w, first.cells) || !connected(w, second.cells)) continue
            const reduction =
              base + monthlyCost(w, [other], nation.id) - monthlyCost(w, [first, second], nation.id)
            const effort = 0.5 + residents(w, cell) / 20000
            if (reduction * 36 > effort * wage)
              candidates.push({
                proposal: {
                  level,
                  from: [j.id, other.id],
                  replacements: [first, second],
                  reason: 'Service catchment moved toward the more accessible seat.',
                },
                saving: reduction,
                work: effort,
              })
          }
        }
        if (j.cells.length > 2) {
          const travel = serviceTravel(w, j.seat, new Set(j.cells))
          const second = [...j.cells].sort(
            (x, y) =>
              (travel.get(y) ?? 0) * Math.sqrt(residents(w, y)) -
              (travel.get(x) ?? 0) * Math.sqrt(residents(w, x)),
          )[0]
          if (second !== j.seat) {
            const otherTravel = serviceTravel(w, second, new Set(j.cells))
            const part = j.cells.filter((c) => (otherTravel.get(c) ?? Infinity) < (travel.get(c) ?? Infinity))
            const rest = j.cells.filter((c) => !part.includes(c))
            if (connected(w, part) && connected(w, rest)) {
              const split = [
                { name: j.name, seat: j.seat, cells: rest, level },
                {
                  name: `${w.regions[w.cells[second].region].name} district`,
                  seat: second,
                  cells: part,
                  level,
                },
              ]
              const saving = base - monthlyCost(w, split, nation.id)
              if (saving * 36 > work * wage)
                candidates.push({
                  proposal: {
                    level,
                    from: [j.id],
                    replacements: split,
                    reason: 'A second service seat repays its administrative cost.',
                  },
                  saving,
                  work,
                })
            }
          }
        }
      }
      const best = candidates.sort(
        (x, y) => y.saving - x.saving || x.proposal.from[0].localeCompare(y.proposal.from[0]),
      )[0]
      if (!best) continue
      const pool = w.localEconomy!.units[w.nations[nation.id].capital],
        hh = w.economy!.households[pool.id],
        wage = w.economy!.producers[pool.id].wage
      const available = STRATA.reduce(
        (s, stratum) => s + Math.max(0, hh[stratum].laborForce - hh[stratum].employed),
        0,
      )
      const cost = best.work * wage
      if (available < best.work || nation.treasury < cost || wage <= 0) continue
      // Planning validated connectivity; apply the same full validation before paying workers.
      applyAdministrativeReform(w, best.proposal, cost)
      for (const stratum of STRATA) {
        const h = hh[stratum],
          jobs = (best.work * Math.max(0, h.laborForce - h.employed)) / available
        const paid = transfer(
          w,
          governmentAccount(nation.id),
          householdAccount(pool.id, stratum),
          jobs * wage,
          'administrative reorganization wages',
        )
        h.employed += paid / wage
        h.income += paid
        nation.spending += paid
        recordWages(w, pool.id, governmentAccount(nation.id), paid, true)
      }
    }
  }
}

/** A sovereignty change is recorded by the existing political system, never caused by a local reform. */
export function reconcileJurisdictionSovereignty(w: World) {
  const a = w.adaptive
  if (!a) return
  for (const old of activeJurisdictions(w)) {
    const groups = new Map<number, number[]>()
    for (const cell of old.cells) {
      const nation = w.regions[w.cells[cell].region].nation,
        cells = groups.get(nation) ?? []
      cells.push(cell)
      groups.set(nation, cells)
    }
    if (groups.size === 1 && groups.has(old.nation)) continue
    const created: Jurisdiction[] = []
    for (const [nation, cells] of groups) {
      const remaining = new Set(cells)
      while (remaining.size) {
        const start = remaining.values().next().value!,
          component = [start]
        remaining.delete(start)
        for (let i = 0; i < component.length; i++)
          for (const next of neighbors(component[i], w.width, w.height))
            if (remaining.delete(next)) component.push(next)
        const id = `${old.level}:reform:${a.nextJurisdiction++}`
        created.push({
          ...old,
          id,
          nation,
          cells: component,
          seat: component.includes(old.seat) ? old.seat : seatFor(w, component),
          founded: w.month,
          revised: w.month,
          retired: undefined,
          predecessors: [old.id],
          successors: [],
          account: `government:${nation}`,
        })
      }
    }
    old.retired = w.month
    old.successors = created.map((j) => j.id)
    for (const j of created) a.jurisdictions[j.id] = j
    a.boundaries.push({
      month: w.month,
      level: old.level,
      from: [old.id],
      to: old.successors,
      assignments: created.flatMap((j) => j.cells.map((c): [number, string] => [c, j.id])),
      reason:
        'Jurisdiction reconciled to a separately recorded change of sovereignty; predecessor claims remain identifiable.',
      cost: 0,
    })
    a.revision++
  }
}
