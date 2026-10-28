import type { World } from './types'
import type { PhysicalSite, PointMeters } from './adaptive-types'
import type { UrbanProject, UrbanProjectKind, UrbanShape } from './urban-types'
import { urbanShape, projectUrbanResidents } from './urban-construction'
import { urbanLand, urbanLandSegment } from './urban-land'
import { footprintConnection } from './residential-geometry'
import { polygonArea } from './physical-space'
import { laneTouchesRiver } from './river-lanes'
import { STRATA } from './economic-types'
import { producerAccount, householdAccount, balance, transfer } from './ledger'
import { marketStore, recordUse, recordWages, recordOwnCapital } from './national-accounts'
import { simulationMonths } from './simulation-period'

export const activeUrbanProject = (p: UrbanProject) =>
  !['occupied', 'cancelled', 'proposed'].includes(p.status)

/** Check the actual footprint against other buildings, streets and water. A
 * numerical parcel boundary is not an obstacle; occupied land always is. */
export function urbanShapeClear(w: World, shape: UrbanShape, replaced: ReadonlySet<string>) {
  const nation = w.localEconomy!.units[w.adaptive!.sites[shape.site].pool].nation
  if (
    polygonArea(shape.building) < 4 ||
    [shape.point, ...shape.building].some((p) => urbanLand(w, p, nation) < 0)
  )
    return false
  if (laneTouchesRiver(w, [...shape.building, shape.building[0]], 6)) return false
  for (const s of Object.values(w.adaptive!.sites))
    if (
      !replaced.has(s.id) &&
      s.retired === undefined &&
      s.building &&
      !s.premises &&
      footprintConnection(shape.building, s.building).distance < 2
    )
      return false
  for (const lane of w.adaptive!.lanes ?? [])
    for (let i = 1; i < lane.points.length; i++)
      if (
        footprintConnection(shape.building, [lane.points[i - 1], lane.points[i]]).distance <
        lane.width / 2 + 1
      )
        return false
  return true
}

export function proposeUrbanProject(
  w: World,
  kind: UrbanProjectKind,
  sites: PhysicalSite[],
  after: UrbanShape[],
  reason: string,
  benefit: number,
  lane?: UrbanProject['lane'],
  sponsorPool?: number,
): UrbanProject {
  const pool = sponsorPool ?? sites[0]?.pool ?? w.adaptive!.lanes!.find((l) => l.id === lane?.id)!.pool
  const before = sites.map(urbanShape)
  const area = after.reduce((n, s) => n + s.fabric.floorArea, 0)
  const oldArea = before.reduce((n, s) => n + s.fabric.floorArea, 0)
  const amount =
    kind === 'repair'
      ? area * 0.12
      : kind === 'extend'
        ? Math.max(0, area - oldArea)
        : kind === 'convert'
          ? area * 0.3
          : area
  const length =
    lane?.points
      .slice(1)
      .reduce((n, p, i) => n + Math.hypot(p.x - lane.points[i].x, p.y - lane.points[i].y), 0) ?? 0
  const works = length * (lane?.width ?? 0)
  return {
    id: w.adaptive!.urban!.nextProject,
    kind,
    status: 'proposed',
    proposed: w.month,
    sponsor: producerAccount(pool),
    pool,
    host: pool,
    sites: sites.map((s) => s.id),
    reason,
    benefit,
    cost: 0,
    inputs: {
      timber: amount * 0.008 + works * 0.002,
      stone: amount * 0.006 + works * 0.025,
      labor: amount * 0.012 + works * 0.012,
    },
    duration: kind === 'repair' ? 2 : kind === 'convert' ? 3 : kind === 'extend' ? 4 : lane ? 4 : 6,
    before,
    after: structuredClone(after),
    displaced: [],
    ...(lane ? { lane: structuredClone(lane) } : {}),
  }
}

function rehousing(w: World, project: UrbanProject) {
  const a = w.adaptive!,
    reserved = new Map<string, number>(),
    moves: UrbanProject['displaced'] = []
  const excluded = new Set([
    ...project.sites,
    ...a.urban!.projects.filter(activeUrbanProject).flatMap((p) => p.sites),
  ])
  const destructive = ['replace', 'consolidate'].includes(project.kind)
  for (const old of project.before) {
    const source = a.sites[old.site],
      future = project.after.find((s) => s.site === old.site)
    let remaining = Math.ceil(
      Math.max(0, (source.residents ?? 0) - (destructive ? 0 : (future?.capacity ?? 0))),
    )
    const targets = Object.values(a.sites)
      .filter(
        (s) =>
          s.kind === 'residential' &&
          s.retired === undefined &&
          s.pool === source.pool &&
          !excluded.has(s.id),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - source.x, a.y - source.y) - Math.hypot(b.x - source.x, b.y - source.y) ||
          a.id.localeCompare(b.id),
      )
    for (const target of targets) {
      if (!remaining) break
      const people = Math.min(
        remaining,
        Math.floor(target.capacity - (target.residents ?? 0) - (reserved.get(target.id) ?? 0)),
      )
      if (people <= 0) continue
      moves.push({ from: source.id, to: target.id, people })
      reserved.set(target.id, (reserved.get(target.id) ?? 0) + people)
      remaining -= people
    }
    if (remaining) return undefined
  }
  return moves
}

/** Atomic preflight precedes every payment and relocation. Materials come from
 * the sponsoring producer's existing stocks; labour is paid through the ledger.
 * Failed opportunities leave no ghosts, reservations or empty building sites. */
export function fundUrbanProject(w: World, project: UrbanProject, budgetShare = 0.15) {
  const a = w.adaptive,
    u = a?.urban,
    local = w.localEconomy,
    e = w.economy
  if (
    !a ||
    !u?.enabled ||
    !local ||
    !e ||
    w.viewOnly ||
    project.status !== 'proposed' ||
    project.id !== u.nextProject
  )
    return false
  const r = local.units[project.pool],
    p = e.producers[project.pool],
    hh = e.households[project.pool]
  if (!r || !p || !hh || project.sponsor !== producerAccount(project.pool) || p.wage <= 0) return false
  if (
    u.projects.some(
      (p) =>
        activeUrbanProject(p) &&
        (p.sites.some((id) => project.sites.includes(id)) ||
          (project.lane?.id && p.lane?.id === project.lane.id)),
    )
  )
    return false
  if (project.before.some((s) => JSON.stringify(urbanShape(a.sites[s.site])) !== JSON.stringify(s)))
    return false
  if (project.after.some((s) => !urbanShapeClear(w, s, new Set(project.sites)))) return false
  if (project.lane) {
    const lane = project.lane
    if (
      lane.width < 1 ||
      lane.width > 8 ||
      lane.points.length < 2 ||
      laneTouchesRiver(w, lane.points, lane.width)
    )
      return false
    if (
      lane.id &&
      !a.lanes?.some(
        (l) =>
          l.id === lane.id &&
          l.pool === project.pool &&
          JSON.stringify(l.points) === JSON.stringify(lane.before),
      )
    )
      return false
    for (let i = 1; i < lane.points.length; i++) {
      const segment = [lane.points[i - 1], lane.points[i]]
      if (!urbanLandSegment(w, segment[0], segment[1], r.nation)) return false
      if (
        Object.values(a.sites).some(
          (s) =>
            s.retired === undefined &&
            s.building &&
            !s.premises &&
            footprintConnection(segment, s.building).distance < lane.width / 2 + 1,
        )
      )
        return false
    }
  }
  const moves = rehousing(w, project)
  if (!moves) return false
  const available = STRATA.reduce((n, s) => n + Math.max(0, hh[s].laborForce - hh[s].employed), 0)
  const { timber, stone, labor } = project.inputs,
    months = simulationMonths()
  const wages = (labor * p.wage) / months
  if (
    ![timber, stone, labor, wages].every((v) => Number.isFinite(v) && v >= 0) ||
    timber > r.stocks.timber * budgetShare ||
    stone > r.stocks.stone * budgetShare ||
    labor > available * months * budgetShare ||
    wages > balance(w, project.sponsor) * budgetShare
  )
    return false
  let paid = 0
  for (const stratum of STRATA) {
    const h = hh[stratum],
      share = Math.max(0, h.laborForce - h.employed) / Math.max(1e-9, available)
    const payment = transfer(
      w,
      project.sponsor,
      householdAccount(project.pool, stratum),
      wages * share,
      'urban construction wages',
    )
    h.income += payment
    h.employed += payment / p.wage
    paid += payment
    recordWages(w, project.pool, project.sponsor, payment)
  }
  const materials =
    recordUse(w, marketStore(project.pool), 'timber', timber) +
    recordUse(w, marketStore(project.pool), 'stone', stone)
  r.stocks.timber -= timber
  r.stocks.stone -= stone
  r.consumption.timber += timber
  r.consumption.stone += stone
  recordOwnCapital(w, project.pool, project.sponsor, paid + materials)
  project.cost = paid + materials
  project.displaced = moves
  for (const d of moves) {
    a.sites[d.from].residents = (a.sites[d.from].residents ?? 0) - d.people
    a.sites[d.to].residents = (a.sites[d.to].residents ?? 0) + d.people
  }
  for (const old of project.before) {
    const s = a.sites[old.site]
    if (['replace', 'consolidate'].includes(project.kind)) s.capacity = 0
    else s.capacity = Math.min(s.capacity, project.after.find((a) => a.site === s.id)?.capacity ?? 0)
  }
  project.status = 'funded'
  project.started = w.month
  u.nextProject++
  u.projects.push(project)
  projectUrbanResidents(w, new Set(project.before.map((s) => a.sites[s.site].pool)))
  a.revision++
  return true
}

export function nearestFrontage(w: World, point: PointMeters) {
  let best: { angle: number; distance: number } | undefined
  for (const l of w.adaptive?.lanes ?? [])
    for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1],
        b = l.points[i]
      const distance = footprintConnection([point], [a, b]).distance
      if (!best || distance < best.distance) best = { distance, angle: Math.atan2(b.y - a.y, b.x - a.x) }
    }
  return best
}
