import { habitableLand } from './terrain-access'
import { isVisibleSettlement, settlementKind } from './settlement-model'
import { settledResidentsByCell } from './settlement-morphology'
import { METERS_PER_MAP_UNIT } from './physical-space'
import { localFirmRegion } from './local-units'
import { apportion } from './allocation'
import { landscapeAt, settlementWeight } from './landscape'
import { neighbors } from './grid'
import { clamp, population, type World } from './types'

export interface Settlement {
  id: string
  region: number
  cell: number
  name: string
  kind: 'village' | 'town' | 'city'
  population: number
  capital: boolean
  cells?: number[]
  aliases?: string[]
  position?: { x: number; y: number }
  siteIds?: string[]
  nucleusSite?: string
  metropolis?: { name: string; incorporated: boolean }
}
export interface SpatialDistrict {
  id: string
  region: number
  /** Quadtree address; polygons are clipped to land and province boundaries. */
  node: string
  span: number
  cells: number[]
  population: number
  urbanPopulation: number
  industrialEmployment: number
  capital: number
}
export interface SpatialState {
  version: 1
  month: number
  splits: string[]
  settlements: Settlement[]
  districts: SpatialDistrict[]
}

export function settlementPosition(w: World, settlement: Settlement) {
  const scale = w.adaptive?.metersPerMapUnit ?? METERS_PER_MAP_UNIT
  return settlement.position
    ? { x: settlement.position.x / scale, y: settlement.position.y / scale }
    : w.cells[settlement.cell]
}

const fallback = new WeakMap<World, SpatialState>()
export const spatialState = (w: World) => {
  // Old adaptive saves published municipal catchments as towns. Reconstruct a
  // read-only settlement view until their next tick refreshes the saved projection.
  if (w.spatial && !(w.adaptive && w.spatial.settlements.some((s) => s.id.startsWith('municipality:'))))
    return w.spatial
  let state = fallback.get(w)
  if (!state || state.month !== w.month) {
    state = buildSpatial(w)
    fallback.set(w, state)
  }
  return state
}
export function refreshSpatial(w: World) {
  w.spatial = buildSpatial(w)
  if (w.localEconomy) {
    const proposal = w.spatial,
      settled = settledResidentsByCell(w)
    const jobs = new Map<number, number>(),
      capital = new Map<number, number>()
    for (const f of w.economy?.firms ?? []) {
      const id = localFirmRegion(f)
      capital.set(id, (capital.get(id) ?? 0) + f.capital)
      if (f.active)
        jobs.set(
          id,
          (jobs.get(id) ?? 0) +
            f.employment *
              (f.laborMix
                ? f.laborMix.tools + f.laborMix.textiles + f.laborMix.arms + f.laborMix.iron + f.laborMix.coal
                : 0),
        )
    }
    const splits = new Set<string>()
    proposal.districts = w.localEconomy.active.map((id) => {
      const u = w.localEconomy!.units[id]
      for (let n = 1; n < u.node.length; n++) splits.add(u.node.slice(0, n))
      return {
        id: `district:${id}`,
        region: u.province,
        node: u.node,
        span: u.span,
        cells: [...u.cells],
        population: population(u),
        urbanPopulation: u.cells.reduce((sum, c) => sum + (settled.get(c) ?? 0), 0),
        industrialEmployment: jobs.get(id) ?? 0,
        capital: (w.economy?.producers[id]?.capital ?? 0) + (capital.get(id) ?? 0),
      }
    })
    proposal.splits = [...splits].sort()
  }
  return w.spatial
}

/** One quantitative scale shared by the map fill and its legend. */
export function districtDensityScale(w: World) {
  const maximum = Math.max(1, ...spatialState(w).districts.map((d) => d.population / d.cells.length))
  const denominator = Math.log1p(maximum)
  return {
    maximum,
    midpoint: Math.expm1(denominator / 2),
    intensity: (density: number) => Math.log1p(Math.max(0, density)) / denominator,
  }
}

/** Read-only adaptive partition proposal. Local economic state is conservatively remapped
 * by remeshDistricts; legacy worlds retain the provincial projection until conversion. */
export function buildSpatial(w: World): SpatialState {
  const counts = new Float64Array(w.cells.length),
    urban = new Float64Array(w.cells.length),
    jobs = new Float64Array(w.cells.length),
    capital = new Float64Array(w.cells.length)
  const settlements: Settlement[] = []
  const previous = w.spatial?.settlements ?? []
  const previousByRegion = new Map<number, Settlement[]>()
  for (const s of previous) {
    const list = previousByRegion.get(s.region) ?? []
    list.push(s)
    previousByRegion.set(s.region, list)
  }
  const industrialJobs = new Float64Array(w.regions.length)
  for (const f of w.economy?.firms ?? [])
    if (f.active) {
      const mix = f.laborMix
      industrialJobs[f.region] +=
        f.employment * (mix ? mix.tools + mix.textiles + mix.arms + mix.iron + mix.coal : 0)
    }
  if (w.localEconomy) {
    const local = w.localEconomy
    const settled = settledResidentsByCell(w)
    for (const id of local.active) {
      const r = local.units[id],
        total = Math.max(1, population(r))
      for (const c of r.cells) {
        counts[c] = r.residents[c] ?? 0
        urban[c] = settled.get(c) ?? 0
        capital[c] = (w.economy?.producers[id]?.capital ?? 0) * (counts[c] / total)
      }
      if (!population(r))
        for (const c of r.cells) capital[c] = (w.economy?.producers[id]?.capital ?? 0) / r.cells.length
    }
    for (const f of w.economy?.firms ?? []) {
      const r = local.units[localFirmRegion(f)],
        cell = f.cell ?? r.center
      capital[cell] += f.capital
      if (f.active)
        jobs[cell] +=
          f.employment *
          (f.laborMix
            ? f.laborMix.tools + f.laborMix.textiles + f.laborMix.arms + f.laborMix.iron + f.laborMix.coal
            : 0)
    }
    for (const city of local.cities)
      if (city.absorbedBy === undefined && city.cells.length && isVisibleSettlement(city.population)) {
        const region = w.cells[city.nucleus].region
        settlements.push({
          id: `city:${city.id}`,
          region,
          cell: city.nucleus,
          name: city.name,
          kind: settlementKind(city.population),
          population: city.population,
          capital: w.nations.some(
            (n) =>
              n.capital === region &&
              (city.sites
                ? city.sites.includes(`home:${w.regions[region].center}`)
                : city.cells.includes(w.regions[region].center)),
          ),
          cells: [...city.cells],
          aliases: [...city.aliases],
          ...(city.metropolis
            ? {
                metropolis: {
                  name: local.cities.find((c) => c.id === city.metropolis!.centre)!.name,
                  incorporated: city.metropolis.incorporated !== undefined,
                },
              }
            : {}),
          ...(city.sites ? { siteIds: [...city.sites], nucleusSite: city.nucleusSite } : {}),
          ...(city.nucleusSite && w.adaptive?.sites[city.nucleusSite]
            ? {
                position: {
                  x: w.adaptive.sites[city.nucleusSite].x,
                  y: w.adaptive.sites[city.nucleusSite].y,
                },
              }
            : {}),
        })
      }
    // Unincorporated concentrations still drive refinement; settlement names are not fabricated to fill every tile.
  } else {
    for (const r of w.regions) {
      const total = population(r),
        urbanTotal = Math.round(total * clamp(r.urban))
      const old = previousByRegion.get(r.id) ?? []
      const isCapital = w.nations[r.nation]?.capital === r.id
      // A broad rural catchment needs more concentrated residents to form a town.
      // Separate entry/exit thresholds preserve existing centers through small shocks.
      const threshold = (old.length ? 600 : 1200) * Math.max(1, Math.sqrt(r.cells.length) / 2)
      const desired = urbanTotal >= threshold ? Math.min(8, 1 + Math.floor(urbanTotal / 40000)) : 0
      const candidates = r.cells
        .filter((id) => habitableLand(w.cells[id]))
        .sort((a, b) => settlementWeight(w.cells[b]) - settlementWeight(w.cells[a]) || a - b)
      const sites = old
        .filter((s) => habitableLand(w.cells[s.cell]))
        .slice(0, desired)
        .map((s) => s.cell)
      // Capitals retain their seat; frontier markets retain their explicitly seeded urban nucleus.
      if (
        ((isCapital && total > 0) ||
          (w.settlementStart === 'frontier' && r.urban >= 0.9 && isVisibleSettlement(urbanTotal))) &&
        !sites.length &&
        habitableLand(w.cells[r.center])
      )
        sites.push(r.center)
      for (const cell of candidates) {
        if (sites.length >= desired) break
        const c = w.cells[cell]
        if (sites.every((id) => Math.hypot(c.q - w.cells[id].q, c.r - w.cells[id].r) >= 3)) sites.push(cell)
      }
      const concentrated = sites.length && isVisibleSettlement(urbanTotal) ? urbanTotal : 0
      const sizes = apportion(
        concentrated,
        sites.map((_, i) => (i + 1) ** -1.15),
      )
      sites.forEach((cell, i) => {
        const size = sizes[i]
        urban[cell] += size
        counts[cell] += size
        if (!isVisibleSettlement(size)) return
        settlements.push({
          id: `settlement:${r.id}:${cell}`,
          region: r.id,
          cell,
          name: old.find((s) => s.cell === cell)?.name ?? (i === 0 ? r.name : `${r.name} ${i + 1}`),
          kind: settlementKind(size),
          population: size,
          capital: isCapital && i === 0,
        })
      })
      const rural = apportion(
        total - concentrated,
        r.cells.map((id) => {
          const h = landscapeAt(w.cells[id]).habitat
          return habitableLand(w.cells[id]) ? Math.max(0.0001, h ** 2) : 0
        }),
        r.cells.map((id) => (habitableLand(w.cells[id]) ? Infinity : 0)),
      )
      const activity = w.economy?.firms ? industrialJobs[r.id] : total * r.urban * r.industry * 0.25
      const workWeights = r.cells.map(
        (id) =>
          urban[id] +
          (landscapeAt(w.cells[id]).resources.iron + landscapeAt(w.cells[id]).resources.coal) * 40,
      )
      const workTotal = workWeights.reduce((sum, x) => sum + x, 0)
      r.cells.forEach((id, i) => {
        counts[id] += rural[i]
        const share = workTotal > 0 ? workWeights[i] / workTotal : 1 / r.cells.length
        jobs[id] = activity * share
        capital[id] = r.industry * share
      })
    }
  }
  const splits: string[] = [],
    districts: SpatialDistrict[] = []
  const priorSplits = new Set(w.spatial?.splits ?? [])
  const rootSpan = 2 ** Math.ceil(Math.log2(Math.max(w.width, w.height)))
  const visit = (ids: number[], x: number, y: number, span: number, node: string) => {
    if (!ids.length) return
    const pressure = ids.reduce((sum, id) => sum + urban[id] / 8000 + jobs[id] / 2500, 0)
    if (span > 1 && pressure > (priorSplits.has(node) ? 0.55 : 1)) {
      splits.push(node)
      const half = span / 2,
        children: number[][] = [[], [], [], []]
      for (const id of ids) {
        const c = w.cells[id]
        children[(c.q >= x + half ? 1 : 0) + (c.r >= y + half ? 2 : 0)].push(id)
      }
      children.forEach((child, i) =>
        visit(child, x + (i % 2) * half, y + Math.floor(i / 2) * half, half, node + i),
      )
      return
    }
    // Clip leaves to connected land within each province: no sea-spanning tiles.
    const remaining = new Set(ids)
    for (const id of ids) {
      if (!remaining.delete(id)) continue
      const region = w.cells[id].region,
        group = [id]
      for (let i = 0; i < group.length; i++)
        for (const next of neighbors(group[i], w.width, w.height)) {
          if (w.cells[next].region === region && remaining.delete(next)) group.push(next)
        }
      districts.push({
        id: `${node}:${region}:${id}`,
        node,
        region,
        span,
        cells: group,
        population: group.reduce((s, cell) => s + counts[cell], 0),
        urbanPopulation: group.reduce((s, cell) => s + urban[cell], 0),
        industrialEmployment: group.reduce((s, cell) => s + jobs[cell], 0),
        capital: group.reduce((s, cell) => s + capital[cell], 0),
      })
    }
  }
  visit(
    w.cells.filter((c) => c.terrain !== 'water').map((c) => c.id),
    0,
    0,
    rootSpan,
    'r',
  )
  return { version: 1, month: w.month, settlements, districts, splits }
}
