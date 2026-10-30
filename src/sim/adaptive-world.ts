import { refreshSpatial } from './spatial'
import type { World } from './types'
import { population } from './types'
import { localFirmRegion } from './local-units'
import { ensureDistrictEconomy } from './districts'
import { CELL_METERS } from './grid'
import { compactResidence, openingHousingCapacity } from './residential-sites'
import { openingFabricPosition } from './opening-settlements'
import { SpatialBuckets } from './spatial-buckets'
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
  unbalancedMeshNodes,
} from './physical-space'
import type {
  AdaptiveNode,
  AdaptiveMesh,
  PhysicalSite,
  SpatialBounds,
  SpatialFragment,
} from './adaptive-types'

const meshCache = new WeakMap<World, { revision: number; mesh: AdaptiveMesh }>()
const meshGeometry = new WeakMap<
  AdaptiveMesh,
  {
    partition: string[]
    sources: Float64Array
    rootSize: number
    scale: number
    minimumSpan: number
    mode: string
  }
>()
const membershipCache = new WeakMap<
  AdaptiveMesh,
  {
    byId: Map<string, AdaptiveNode>
    sites: WeakMap<PhysicalSite, { x: number; y: number; node: AdaptiveNode }>
    occupied: AdaptiveNode[]
  }
>()
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
      const capacity = openingHousingCapacity(pool.residents[cell] ?? 0, local.built[cell] ?? 0)
      const home = addSite(w, {
        id: `home:${cell}`,
        cell,
        pool: id,
        kind: 'residential',
        entity: `residents:${id}`,
        capacity,
      })
      // Coarse housing sits where its sample's opening fabric is, not at the
      // sample centre; `ensureResidentialSites` fits its support around it.
      Object.assign(
        home,
        openingFabricPosition(w, cell, (c) => local.built[c] ?? 0),
      )
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
    if (region.nation < 0) continue
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
  const previousMesh = meshCache.get(w)?.mesh
  const geometry = previousMesh && meshGeometry.get(previousMesh)
  // During the dwell period no existing branch can close. Start at its leaves
  // and refine the changed physical activity there, retaining exact source
  // fragments instead of cutting the entire world into the same pieces again.
  const retainPartition =
    !reconstruct &&
    mode === 'adaptive' &&
    a.mode === mode &&
    geometry?.partition === a.tree.leaves &&
    geometry.mode === mode &&
    a.minimumSpan <= geometry.minimumSpan &&
    geometry.rootSize === root.size &&
    geometry.scale === a.metersPerMapUnit &&
    geometry.sources.length === w.cells.length * 3 &&
    w.cells.every(
      (c, i) =>
        geometry.sources[i * 3] === c.x &&
        geometry.sources[i * 3 + 1] === c.y &&
        geometry.sources[i * 3 + 2] === Number(c.terrain === 'water'),
    ) &&
    a.tree.leaves.every((id) => w.month - (a.tree.changed[id] ?? -100) < 12)
  const prior = new Set(a.tree.leaves),
    priorBranches = new Set<string>()
  if (!retainPartition)
    for (const id of prior)
      for (let i = id.length - 1; i >= 1; i--) {
        const ancestor = id.slice(0, i)
        if (priorBranches.has(ancestor)) break
        priorBranches.add(ancestor)
      }
  // A new deep leaf must keep all its ancestors open during the dwell period.
  // Some of those branches were never leaves, so they have no direct change entry.
  const changedAt = new Map<string, number>()
  if (!retainPartition)
    for (const id of Object.keys(a.tree.changed)) {
      const month = a.tree.changed[id]
      for (let i = id.length; i >= 1; i--) {
        const ancestor = id.slice(0, i)
        if ((changedAt.get(ancestor) ?? -Infinity) >= month) break
        changedAt.set(ancestor, month)
      }
    }
  const sites = Object.values(a.sites).filter((s) => s.retired === undefined)
  const jobs = new Map((w.economy?.firms ?? []).map((f) => [`firm:${f.id}`, f.active ? f.employment : 0]))
  const construction = new Set(a.construction?.map((project) => project.site))
  const development = sites.flatMap((site) => {
    if (site.kind !== 'residential' || !site.parcel) return []
    const people = sitePopulation(w, site)
    if (!(people > 0 && compactResidence(site)) && !construction.has(site.id)) return []
    return [
      {
        bounds: site.parcel,
        span: site.building
          ? 8
          : Math.max(a.minimumSpan, Math.min(512, site.parcel.size / (1 + Math.sqrt(people / 12000)))),
      },
    ]
  })
  const overlaps = (a: SpatialBounds, b: SpatialBounds) =>
    a.x < b.x + b.size && a.x + a.size > b.x && a.y < b.y + b.size && a.y + a.size > b.y
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
  const makeNode = (
    id: string,
    bounds: SpatialBounds,
    pieces: SpatialFragment[],
    members: PhysicalSite[],
    developed: typeof development = [],
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
    // Occupied development and paid building works deserve parcel-scale detail,
    // even before they have enough residents to earn a city name. Vacant stock
    // stays physically present while the existing dwell rule permits coarsening.
    const developing = developed.some((plot) => bounds.size > plot.span)
    const indicator =
      (residents / 12000 + work / 2500 + movingActivity) * Math.min(1, (bounds.size / 1000) ** 2) +
      members.length / 64 +
      terrainError +
      (developing ? 1.1 : 0) +
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
  let leaves: AdaptiveNode[] = []
  const visit = (
    id: string,
    bounds: SpatialBounds,
    pieces: SpatialFragment[],
    members: PhysicalSite[],
    developed: typeof development,
  ) => {
    if (!pieces.length) return
    let node: AdaptiveNode | undefined
    const dwell = w.month - (changedAt.get(id) ?? -100) < 12
    const refine = reconstruct
      ? priorBranches.has(id)
      : mode === 'coarse'
        ? bounds.size > 16 * CELL_METERS
        : mode === 'fine'
          ? bounds.size > CELL_METERS
          : bounds.size > 16 * CELL_METERS ||
            (priorBranches.has(id) && dwell) ||
            developed.some((plot) => bounds.size > plot.span) ||
            (node = makeNode(id, bounds, pieces, members, developed)).indicator >
              (priorBranches.has(id) ? 0.55 : 1)
    if (bounds.size / 2 >= a.minimumSpan && refine) {
      const children = splitFragments(pieces, bounds),
        groups: PhysicalSite[][] = [[], [], [], []]
      for (const site of members) groups[quadrant(site, bounds)].push(site)
      children.forEach((parts, i) => {
        const child = nodeBounds(bounds, 'r' + i)
        visit(
          id + i,
          child,
          parts,
          groups[i],
          developed.filter((plot) => overlaps(plot.bounds, child)),
        )
      })
    } else {
      if (reconstruct && !prior.has(id)) throw new Error('Saved spatial partition leaves land uncovered')
      leaves.push(node ?? makeNode(id, bounds, pieces, members, developed))
    }
  }
  if (retainPartition) {
    const byId =
      membershipCache.get(previousMesh!)?.byId ?? new Map(previousMesh!.leaves.map((node) => [node.id, node]))
    const groups = new Map<AdaptiveNode, PhysicalSite[]>()
    const priorMembership = membershipCache.get(previousMesh!)?.sites
    for (const site of sites) {
      const previous = priorMembership?.get(site)
      let node = previous && previous.x === site.x && previous.y === site.y ? previous.node : undefined
      if (!node) {
        let id = 'r',
          bounds = root
        while (!byId.has(id)) {
          const q = quadrant(site, bounds)
          id += q
          bounds = nodeBounds(bounds, 'r' + q)
          if (id.length > 40) throw new Error('Site is outside the active spatial partition')
        }
        node = byId.get(id)!
      }
      const members = groups.get(node) ?? []
      members.push(site)
      groups.set(node, members)
    }
    const plots = new SpatialBuckets<(typeof development)[number]>(CELL_METERS)
    for (const plot of development) {
      const b = plot.bounds
      plots.insert(plot, b.x, b.y, b.x + b.size, b.y + b.size)
    }
    for (const node of previousMesh!.leaves) {
      const b = node.bounds
      const developed =
        b.size <= Math.min(a.minimumSpan, 8)
          ? []
          : [...plots.query(b.x, b.y, b.x + b.size, b.y + b.size)].filter((plot) => overlaps(plot.bounds, b))
      visit(node.id, b, node.fragments, groups.get(node) ?? [], developed)
    }
  } else {
    const fragments = w.cells.map((c) => {
      const polygon = cellPolygon(w, c.id)
      return { cell: c.id, water: c.terrain === 'water', polygon, area: polygonArea(polygon) }
    })
    visit('r', root, fragments, sites, development)
  }
  // Enforce a 2:1 neighbor ratio without touching any economic state.
  for (;;) {
    const split = unbalancedMeshNodes(leaves)
    if (!split.size) break
    if (reconstruct) throw new Error('Saved spatial partition violates 2:1 balance')
    const balanced: AdaptiveNode[] = []
    for (const old of leaves)
      if (split.has(old.id)) {
        const parts = splitFragments(old.fragments, old.bounds)
        for (let q = 0; q < 4; q++)
          if (parts[q].length)
            balanced.push(
              makeNode(
                old.id + q,
                nodeBounds(old.bounds, 'r' + q),
                parts[q],
                old.sites.map((id) => a.sites[id]).filter((s) => quadrant(s, old.bounds) === q),
              ),
            )
      } else balanced.push(old)
    // Keep Morton order during balancing so the next pass can search the same
    // sorted intervals directly, without sorting hundreds of thousands again.
    leaves = balanced
  }
  leaves.sort((x, y) => x.id.localeCompare(y.id))
  // Radial/site queries only need the tree. Materialize the physical face graph
  // on demand for callers that actually traverse it.
  let interfaces: AdaptiveMesh['interfaces'] | undefined
  const mesh: AdaptiveMesh = {
    leaves,
    get interfaces() {
      return (interfaces ??= meshInterfaces(leaves))
    },
    revision: a.revision,
  }
  if (reconstruct) {
    if (leaves.length !== prior.size || leaves.some((n) => !prior.has(n.id)))
      throw new Error('Saved spatial partition contains leaves outside the domain')
    meshCache.set(w, { revision: a.revision, mesh })
    return mesh
  }
  const next = leaves.map((n) => n.id)
  const nextSet = new Set(next)
  for (const id of prior) if (!nextSet.has(id)) a.tree.changed[id] = w.month
  for (const id of next) if (!prior.has(id)) a.tree.changed[id] = w.month
  // Retain recent hysteresis history only; retired nodes carry no assets or contracts.
  for (const id of Object.keys(a.tree.changed))
    if (w.month - a.tree.changed[id] > 24) delete a.tree.changed[id]
  a.tree.leaves = next
  meshGeometry.set(mesh, {
    partition: next,
    sources: retainPartition
      ? geometry.sources
      : Float64Array.from(w.cells.flatMap((c) => [c.x, c.y, Number(c.terrain === 'water')])),
    rootSize: root.size,
    scale: a.metersPerMapUnit,
    minimumSpan: a.minimumSpan,
    mode,
  })
  a.tree.domain = 'world'
  a.tree.month = w.month
  a.mode = mode
  a.revision++
  mesh.revision = a.revision
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
    mesh = adaptiveMesh(w)
  let membership = membershipCache.get(mesh)
  if (!membership) {
    membership = {
      byId: new Map(mesh.leaves.map((n) => [n.id, n])),
      sites: new WeakMap(),
      occupied: mesh.leaves.filter((n) => n.sites.length > 0),
    }
    membershipCache.set(mesh, membership)
  }
  const { byId } = membership
  const root = rootBounds(w),
    poolSets = new Map<AdaptiveNode, Set<number>>()
  // Fine meshes have many empty leaves around physical buildings. Only leaves
  // that previously contained sites can have totals or membership to clear.
  for (const n of membership.occupied) {
    n.population = 0
    n.jobs = 0
    n.sites.length = 0
    n.pools.length = 0
  }
  membership.occupied = []
  const jobs = new Map((w.economy?.firms ?? []).map((f) => [`firm:${f.id}`, f.active ? f.employment : 0]))
  for (const site of Object.values(a.sites)) {
    if (site.retired !== undefined) continue
    const prior = membership.sites.get(site)
    let n: AdaptiveNode
    if (prior && prior.x === site.x && prior.y === site.y) n = prior.node
    else {
      let id = 'r',
        bounds = root
      while (!byId.has(id)) {
        const q = quadrant(site, bounds)
        id += q
        const size = bounds.size / 2
        bounds = { x: bounds.x + (q % 2) * size, y: bounds.y + Math.floor(q / 2) * size, size }
        if (id.length > 40) throw new Error('Site is outside the active spatial partition')
      }
      n = byId.get(id)!
      membership.sites.set(site, { x: site.x, y: site.y, node: n })
    }
    n.sites.push(site.id)
    n.population += sitePopulation(w, site)
    n.jobs += jobs.get(site.entity) ?? 0
    let pools = poolSets.get(n)
    if (!pools) {
      pools = new Set()
      poolSets.set(n, pools)
      membership.occupied.push(n)
    }
    pools.add(site.pool)
  }
  for (const [n, pools] of poolSets) n.pools = [...pools].sort((x, y) => x - y)
  a.revision++
  mesh.revision = a.revision
  meshCache.set(w, { revision: a.revision, mesh })
}
