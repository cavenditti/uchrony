import { refreshSpatial } from './spatial'
import type { World } from './types'
import { population } from './types'
import { localFirmRegion } from './local-units'
import { ensureDistrictEconomy } from './districts'
import { CELL_METERS } from './grid'
import {
  METERS_PER_MAP_UNIT,
  cellPosition,
  cellPolygon,
  rootBounds,
  nodeBounds,
  quadrant,
  polygonArea,
  splitFragments,
  meshInterfaces,
} from './physical-space'
import type {
  AdaptiveNode,
  AdaptiveMesh,
  PhysicalSite,
  SpatialBounds,
  SpatialFragment,
} from './adaptive-types'

const meshCache = new WeakMap<World, { revision: number; mesh: AdaptiveMesh }>()
/** Persistent pools are closure records, not mesh cells. Their account IDs never follow a mesh boundary. */
export function ensureAdaptiveWorld(w: World) {
  if (w.adaptive) return w.adaptive
  if (w.viewOnly) throw new Error('Display snapshots cannot migrate an adaptive world')
  const local = ensureDistrictEconomy(w)
  w.adaptive = {
    version: 1,
    initialized: w.month,
    revision: 0,
    metersPerMapUnit: METERS_PER_MAP_UNIT,
    minimumSpan: 128,
    mode: 'adaptive',
    tree: { leaves: [], changed: {}, month: -1, domain: 'world' },
    sites: {},
    jurisdictions: {},
    nextJurisdiction: 0,
    boundaries: [],
    names: [],
    commuting: [],
    reviewMonth: w.month,
    migration: {
      source: 'legacy',
      month: w.month,
      assumptions: [
        'Terrain samples occupy aligned 1,024 m squares; numerical refinement preserves this geography.',
        'Opening residential capacity equals 115% of residents plus existing built-land capacity.',
        'Legacy markets and household pools retain their exact identities and heterogeneous closure state.',
        'Opening site capacity is a balance-sheet initialization, not output or GDP.',
      ],
    },
  }
  w.modelProvenance ??= {
    accepted: 0,
    lastMonth: w.month,
    roles: {},
    source: 'legacy-unknown',
  }
  for (const id of local.active) {
    const pool = local.units[id]
    for (const cell of pool.cells) {
      const capacity = Math.max(
        Math.ceil((pool.residents[cell] ?? 0) * 1.15),
        (local.built[cell] ?? 0) * 12000,
      )
      addSite(w, {
        id: `home:${cell}`,
        cell,
        pool: id,
        kind: 'residential',
        entity: `residents:${id}`,
        capacity,
      })
    }
    addSite(w, {
      id: `market:${id}`,
      cell: pool.center,
      pool: id,
      kind: 'market',
      entity: `producer:${id}`,
      capacity: 0,
    })
  }
  for (const region of w.regions) {
    const province = `province:${region.id}`,
      municipality = `municipality:${region.id}`
    for (const [id, level] of [
      [province, 'province'],
      [municipality, 'municipality'],
    ] as const)
      w.adaptive.jurisdictions[id] = {
        id,
        level,
        name: region.name,
        nation: region.nation,
        seat: region.center,
        cells: [...region.cells],
        founded: w.month,
        revised: w.month,
        successors: [],
        predecessors: [],
        account: `government:${region.nation}`,
      }
    w.adaptive.names.push({
      id: `place:${region.center}`,
      name: region.name,
      cell: region.center,
      since: w.month,
      aliases: [],
    })
  }
  syncSites(w)
  rebuildAdaptiveMesh(w)
  refreshSpatial(w)
  return w.adaptive
}
function addSite(
  w: World,
  input: Pick<PhysicalSite, 'id' | 'cell' | 'pool' | 'kind' | 'entity' | 'capacity'>,
) {
  const site = (w.adaptive!.sites[input.id] = {
    ...input,
    ...cellPosition(w, input.cell),
    founded: w.month,
    openingCapacity: input.capacity,
    openingBuilt: w.localEconomy?.built[input.cell] ?? 0,
    capitalReference: 0,
  })
  return site
}
export function syncSites(w: World) {
  const a = w.adaptive
  if (!a) return
  for (const firm of w.economy?.firms ?? []) {
    const pool = w.localEconomy!.units[localFirmRegion(firm)]
    const id = `firm:${firm.id}`
    if (!a.sites[id]) {
      const created = addSite(w, {
        id,
        cell: firm.cell ?? pool.center,
        pool: pool.id,
        kind: 'establishment',
        entity: id,
        capacity: Math.max(firm.employment, firm.desiredEmployment),
      })
      created.capitalReference = firm.capital
    }
    const site = a.sites[id]
    const cell = firm.cell ?? pool.center
    if (site.cell !== cell) {
      site.cell = cell
      Object.assign(site, cellPosition(w, cell))
    }
    // Investment/depreciation is settled by the firm's existing material and wage ledger.
    // Refinement never changes this capacity; a new firm has a real opening balance sheet.
    if (site.capitalReference > 0)
      site.capacity = (site.openingCapacity * firm.capital) / site.capitalReference
    site.pool = pool.id
    if (!firm.active) site.retired ??= w.month
    else delete site.retired
  }
}
function sitePopulation(w: World, site: PhysicalSite) {
  return site.kind === 'residential' && site.retired === undefined
    ? (site.residents ?? w.localEconomy!.units[site.pool]?.residents[site.cell] ?? 0)
    : 0
}
export function rebuildAdaptiveMesh(w: World, mode = w.adaptive!.mode, reconstruct = false): AdaptiveMesh {
  const a = w.adaptive!,
    root = rootBounds(w)
  const prior = new Set(a.tree.leaves),
    priorBranches = new Set<string>()
  for (const id of prior) for (let i = 1; i < id.length; i++) priorBranches.add(id.slice(0, i))
  const sites = Object.values(a.sites).filter((s) => s.retired === undefined)
  const jobs = new Map((w.economy?.firms ?? []).map((f) => [`firm:${f.id}`, f.active ? f.employment : 0]))
  // Mobile activity is a refinement signal, never an extra population/account entry.
  const activity = new Map<number, number>()
  for (const fleet of w.warfare?.fleets ?? [])
    if (w.cells[fleet.cell] && fleet.hull > 0)
      activity.set(
        fleet.cell,
        (activity.get(fleet.cell) ?? 0) + fleet.soldiers / 300 + (fleet.warships + fleet.transports) / 8,
      )
  for (const corridor of w.corridors ?? [])
    if (corridor.traffic > 0)
      for (const cell of [corridor.a, corridor.b])
        activity.set(cell, (activity.get(cell) ?? 0) + corridor.traffic / 20000)
  const fragments = w.cells.map((c) => {
    const polygon = cellPolygon(w, c.id)
    return { cell: c.id, water: c.terrain === 'water', polygon, area: polygonArea(polygon) }
  })
  const makeNode = (
    id: string,
    bounds: SpatialBounds,
    pieces: SpatialFragment[],
    members: PhysicalSite[],
  ): AdaptiveNode => {
    const residents = members.reduce((sum, s) => sum + sitePopulation(w, s), 0)
    const work = members.reduce((sum, s) => sum + (jobs.get(s.entity) ?? 0), 0)
    const pools = [...new Set(members.map((s) => s.pool))].sort((x, y) => x - y)
    const prices = pools.map((id) => w.localEconomy!.units[id].prices.food)
    const mean = prices.reduce((sum, p) => sum + p, 0) / Math.max(1, prices.length)
    const variation =
      Math.sqrt(prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / Math.max(1, prices.length)) /
      Math.max(0.001, mean)
    let landArea = 0,
      waterArea = 0,
      elevation = 0,
      elevation2 = 0,
      moisture = 0,
      moisture2 = 0,
      movingActivity = 0
    for (const piece of pieces) {
      const cell = w.cells[piece.cell]
      if (piece.water) waterArea += piece.area
      else landArea += piece.area
      elevation += cell.elevation * piece.area
      elevation2 += cell.elevation ** 2 * piece.area
      moisture += cell.moisture * piece.area
      moisture2 += cell.moisture ** 2 * piece.area
      const pressure = activity.get(piece.cell)
      if (pressure) {
        const p = cellPosition(w, piece.cell)
        if (
          p.x >= bounds.x &&
          p.x < bounds.x + bounds.size &&
          p.y >= bounds.y &&
          p.y < bounds.y + bounds.size
        )
          movingActivity += pressure
      }
    }
    const area = Math.max(1, landArea + waterArea)
    // Only known source variation contributes: finer cells cannot invent terrain or ore.
    const terrainError =
      Math.max(
        Math.sqrt(Math.max(0, elevation2 / area - (elevation / area) ** 2)) / 0.12,
        Math.sqrt(Math.max(0, moisture2 / area - (moisture / area) ** 2)) / 0.18,
        landArea > 0 && waterArea > 0 ? 1.1 : 0,
      ) * Math.min(1, (bounds.size / 2000) ** 2)
    const rivers = pieces.some((p) => w.cells[p.cell].river)
    const indicator =
      (residents / 12000 + work / 2500 + movingActivity) * Math.min(1, (bounds.size / 1000) ** 2) +
      terrainError +
      variation * 2 +
      (rivers && bounds.size > 4000 ? 1 : 0)
    return {
      id,
      bounds,
      fragments: pieces,
      sites: members.map((s) => s.id),
      pools,
      population: residents,
      jobs: work,
      landArea,
      waterArea,
      indicator,
    }
  }
  const leaves: AdaptiveNode[] = []
  const visit = (id: string, bounds: SpatialBounds, pieces: SpatialFragment[], members: PhysicalSite[]) => {
    if (!pieces.length) return
    const node = makeNode(id, bounds, pieces, members)
    const dwell = w.month - (a.tree.changed[id] ?? -100) < 12
    const refine = reconstruct
      ? priorBranches.has(id)
      : mode === 'coarse'
        ? bounds.size > 16 * CELL_METERS
        : mode === 'fine'
          ? bounds.size > CELL_METERS
          : bounds.size > 16 * CELL_METERS ||
            node.indicator > (priorBranches.has(id) ? 0.55 : 1) ||
            (priorBranches.has(id) && dwell)
    if (bounds.size / 2 >= a.minimumSpan && refine) {
      const children = splitFragments(pieces, bounds),
        groups: PhysicalSite[][] = [[], [], [], []]
      for (const site of members) groups[quadrant(site, bounds)].push(site)
      children.forEach((parts, i) => visit(id + i, nodeBounds(bounds, 'r' + i), parts, groups[i]))
    } else {
      if (reconstruct && !prior.has(id)) throw new Error('Saved spatial partition leaves land uncovered')
      leaves.push(node)
    }
  }
  visit('r', root, fragments, sites)
  // Enforce a 2:1 neighbor ratio without touching any economic state.
  let interfaces = meshInterfaces(leaves, false)
  for (;;) {
    const byId = new Map(leaves.map((n) => [n.id, n]))
    const split = new Set<string>()
    for (const edge of interfaces) {
      const x = byId.get(edge.a)!,
        y = byId.get(edge.b)!
      if (x.bounds.size > y.bounds.size * 2) split.add(x.id)
      if (y.bounds.size > x.bounds.size * 2) split.add(y.id)
    }
    if (!split.size) break
    if (reconstruct) throw new Error('Saved spatial partition violates 2:1 balance')
    for (let i = leaves.length - 1; i >= 0; i--)
      if (split.has(leaves[i].id)) {
        const old = leaves.splice(i, 1)[0],
          parts = splitFragments(old.fragments, old.bounds)
        for (let q = 0; q < 4; q++)
          if (parts[q].length)
            leaves.push(
              makeNode(
                old.id + q,
                nodeBounds(old.bounds, 'r' + q),
                parts[q],
                old.sites.map((id) => a.sites[id]).filter((s) => quadrant(s, old.bounds) === q),
              ),
            )
      }
    interfaces = meshInterfaces(leaves, false)
  }
  leaves.sort((x, y) => x.id.localeCompare(y.id))
  interfaces = meshInterfaces(leaves)
  if (reconstruct) {
    if (leaves.length !== prior.size || leaves.some((n) => !prior.has(n.id)))
      throw new Error('Saved spatial partition contains leaves outside the domain')
    const mesh = { leaves, interfaces, revision: a.revision }
    meshCache.set(w, { revision: a.revision, mesh })
    return mesh
  }
  const next = leaves.map((n) => n.id)
  const nextSet = new Set(next)
  for (const id of new Set([...prior, ...next]))
    if (prior.has(id) !== nextSet.has(id)) a.tree.changed[id] = w.month
  // Retain recent hysteresis history only; retired nodes carry no assets or contracts.
  for (const [id, month] of Object.entries(a.tree.changed))
    if (w.month - month > 24) delete a.tree.changed[id]
  a.tree.leaves = next
  a.tree.domain = 'world'
  a.tree.month = w.month
  a.mode = mode
  a.revision++
  const mesh = { leaves, interfaces, revision: a.revision }
  meshCache.set(w, { revision: a.revision, mesh })
  return mesh
}
export function adaptiveMesh(w: World): AdaptiveMesh {
  const cached = meshCache.get(w)
  if (cached && cached.revision === w.adaptive?.revision) return cached.mesh
  // Reconstruction is pure: querying detail must not change the saved tree or revision.
  const a = w.adaptive
  if (!a) throw new Error('Adaptive world not initialized')
  return rebuildAdaptiveMesh(w, a.mode, true)
}
export function adaptivePopulation(w: World) {
  return w.localEconomy!.active.reduce((sum, id) => sum + population(w.localEconomy!.units[id]), 0)
}

/** Between scheduled remeshes, update only derived totals. Physical polygons are unchanged. */
export function refreshAdaptiveTotals(w: World) {
  const a = w.adaptive!,
    mesh = adaptiveMesh(w),
    byId = new Map(mesh.leaves.map((n) => [n.id, n]))
  const root = rootBounds(w),
    poolSets = new Map<string, Set<number>>()
  for (const n of mesh.leaves) {
    n.population = 0
    n.jobs = 0
    n.sites = []
    n.pools = []
    poolSets.set(n.id, new Set())
  }
  const jobs = new Map((w.economy?.firms ?? []).map((f) => [`firm:${f.id}`, f.active ? f.employment : 0]))
  for (const site of Object.values(a.sites)) {
    if (site.retired !== undefined) continue
    let id = 'r',
      bounds = root
    while (!byId.has(id)) {
      const q = quadrant(site, bounds)
      id += q
      bounds = nodeBounds(bounds, 'r' + q)
      if (id.length > 40) throw new Error('Site is outside the active spatial partition')
    }
    const n = byId.get(id)!
    n.sites.push(site.id)
    n.population += sitePopulation(w, site)
    n.jobs += jobs.get(site.entity) ?? 0
    poolSets.get(id)!.add(site.pool)
  }
  for (const n of mesh.leaves) n.pools = [...poolSets.get(n.id)!].sort((x, y) => x - y)
  a.revision++
  mesh.revision = a.revision
  meshCache.set(w, { revision: a.revision, mesh })
}
