import type { World } from './types'
import type { PhysicalSite } from './adaptive-types'
import { polygonArea } from './physical-space'
import { URBAN_USES, type FloorUses, type UrbanBuilding, type UrbanUse } from './urban-types'

export const floorUses = (use: UrbanUse = 'housing', area = 0): FloorUses =>
  Object.fromEntries(URBAN_USES.map((u) => [u, u === use ? area : 0])) as FloorUses

export function openingFabric(_w: World, site: PhysicalSite): UrbanBuilding {
  const use =
    site.kind === 'residential' ? 'housing' : site.kind === 'establishment' ? 'production' : site.kind
  const footprint = site.building ? polygonArea(site.building) : 0
  const area = Math.max(footprint, site.capacity * (use === 'housing' ? 28 : 18))
  return {
    floorArea: area,
    uses: floorUses(use, area),
    condition: 1,
    built: site.founded,
    altered: site.founded,
    survey: site.building ? 'recorded' : 'aggregate',
    predecessors: [],
    successors: [],
    occupants: site.kind === 'establishment' ? [site.entity] : [],
  }
}

/** Only the simulation invokes migration. Display queries never invent fabric. */
export function ensureUrbanFabric(w: World) {
  const a = w.adaptive
  if (!a || !w.localEconomy || w.viewOnly) return
  a.urban ??= {
    version: 1,
    enabled: true,
    initialized: w.month,
    lastMonth: w.month,
    nextProject: 0,
    nextLane: 0,
    streetRevision: 0,
    projects: [],
    history: [],
    pressure: {},
  }
  for (const site of Object.values(a.sites)) {
    if (site.retired !== undefined) continue
    site.fabric ??= openingFabric(w, site)
    // Ordinary paid housing additions retain their original construction path.
    const required = site.kind === 'residential' ? site.capacity * 28 : 0
    if (required > site.fabric.uses.housing) {
      site.fabric.floorArea += required - site.fabric.uses.housing
      site.fabric.uses.housing = required
    }
  }
  for (const lane of a.lanes ?? []) lane.id ??= `street:${a.urban.nextLane++}`
}

export function dominantUrbanUse(site: PhysicalSite): UrbanUse {
  return URBAN_USES.reduce(
    (best, use) => ((site.fabric?.uses[use] ?? 0) > (site.fabric?.uses[best] ?? 0) ? use : best),
    'housing',
  )
}

/** Validate extension data before any saved geometry is used for planning. */
export function validateUrbanFabric(w: World) {
  const a = w.adaptive,
    u = a?.urban
  if (!a || !u) return
  const fail = (why: string): never => {
    throw new Error(`Invalid urban evolution: ${why}`)
  }
  const number = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min
  const date = (v: unknown): v is number => number(v) && Number.isSafeInteger(v) && v <= w.month
  const point = (p: { x: number; y: number }) =>
    p && number(p.x) && number(p.y) && p.x <= w.width * 1024 && p.y <= w.height * 1024
  const check = (f: UrbanBuilding) => {
    if (
      !f ||
      !number(f.floorArea) ||
      !f.uses ||
      URBAN_USES.some((k) => !number(f.uses[k])) ||
      Math.abs(URBAN_USES.reduce((n, k) => n + f.uses[k], 0) - f.floorArea) > 1e-5 ||
      !number(f.condition) ||
      f.condition > 1 ||
      !date(f.built) ||
      !date(f.altered) ||
      f.altered < f.built ||
      !['recorded', 'aggregate'].includes(f.survey) ||
      [f.predecessors, f.successors, f.occupants].some(
        (l) => !Array.isArray(l) || l.some((s) => typeof s !== 'string'),
      )
    )
      fail('building areas, condition or history')
  }
  if (
    u.version !== 1 ||
    typeof u.enabled !== 'boolean' ||
    !date(u.initialized) ||
    !date(u.lastMonth) ||
    !Number.isSafeInteger(u.nextProject) ||
    u.nextProject < 0 ||
    !Number.isSafeInteger(u.nextLane) ||
    u.nextLane < 0 ||
    !Number.isSafeInteger(u.streetRevision) ||
    u.streetRevision < 0 ||
    !Array.isArray(u.projects) ||
    !Array.isArray(u.history) ||
    !u.pressure ||
    typeof u.pressure !== 'object'
  )
    fail('version, clock or collections')
  for (const site of Object.values(a.sites)) if (site.fabric) check(site.fabric)
  const ids = new Set<number>(),
    occupied = new Set<string>()
  for (const p of u.projects) {
    if (
      !p ||
      !Number.isSafeInteger(p.id) ||
      p.id < 0 ||
      p.id >= u.nextProject ||
      ids.has(p.id) ||
      !['repair', 'extend', 'convert', 'replace', 'consolidate', 'connect', 'widen', 'realign'].includes(
        p.kind,
      ) ||
      !['proposed', 'funded', 'clearing', 'construction', 'occupied', 'cancelled'].includes(p.status) ||
      !date(p.proposed) ||
      (p.started !== undefined && (!date(p.started) || p.started < p.proposed)) ||
      (p.completed !== undefined && (!date(p.completed) || p.completed < (p.started ?? p.proposed))) ||
      !a ||
      !w.localEconomy?.units[p.pool] ||
      !w.localEconomy.units[p.host] ||
      typeof p.sponsor !== 'string' ||
      typeof p.reason !== 'string' ||
      !number(p.cost) ||
      !number(p.benefit) ||
      !number(p.duration, 1) ||
      !p.inputs ||
      Object.values(p.inputs).some((v) => !number(v)) ||
      !Array.isArray(p.sites) ||
      p.sites.some((id) => !a.sites[id]) ||
      !Array.isArray(p.before) ||
      !Array.isArray(p.after) ||
      !Array.isArray(p.displaced)
    )
      fail('project')
    ids.add(p.id)
    if (!['proposed', 'cancelled'].includes(p.status) && p.started === undefined)
      fail('unfunded active project')
    if (p.status === 'occupied' && p.completed === undefined) fail('undated completion')
    if (!['occupied', 'cancelled', 'proposed'].includes(p.status))
      for (const id of p.sites) {
        if (occupied.has(id)) fail('overlapping construction')
        occupied.add(id)
      }
    for (const s of [...p.before, ...p.after]) {
      if (
        !s ||
        !a.sites[s.site] ||
        !point(s.point) ||
        !w.cells[s.cell] ||
        !number(s.capacity) ||
        !s.parcel ||
        !point(s.parcel) ||
        !number(s.parcel.size, 1) ||
        !Array.isArray(s.building) ||
        s.building.length !== 4 ||
        s.building.some((p) => !point(p))
      )
        fail('project geometry')
      check(s.fabric)
    }
    for (const d of p.displaced)
      if (!a.sites[d.from] || !a.sites[d.to] || !number(d.people) || !Number.isSafeInteger(d.people))
        fail('relocation')
    if (
      p.lane &&
      (!number(p.lane.width, 1) ||
        p.lane.width > 20 ||
        !Array.isArray(p.lane.points) ||
        p.lane.points.length < 2 ||
        p.lane.points.some((v) => !point(v)))
    )
      fail('street project')
  }
  for (const [id, p] of Object.entries(u.pressure))
    if (
      !a.sites[id] ||
      !p ||
      !URBAN_USES.includes(p.use) ||
      !date(p.since) ||
      !date(p.reviewed) ||
      p.since > p.reviewed ||
      !number(p.score, -Infinity)
    )
      fail('pressure')
  const lanes = new Set<string>()
  for (const l of a.lanes ?? [])
    if (l.id) {
      if (lanes.has(l.id)) fail('duplicate street identity')
      lanes.add(l.id)
    }
}
