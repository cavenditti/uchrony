import { habitableLand } from './terrain-access'
import { governance } from './governance'
import type { World } from './types'
import type { PhysicalSite } from './adaptive-types'
import { movementNeighbors, CELL_METERS } from './grid'
import { realService } from './public-services'
import { residentialPools } from './residential-sites'
import { landscapeAt } from './landscape'
import { urbanEmploymentIndex, urbanEmploymentLocations } from './urban-location'
import {
  appendInfluenceTree,
  solveInfluence,
  type InfluenceInput,
  type InfluenceSource,
} from './influence-kernel'

let executor: (input: InfluenceInput) => Float64Array = solveInfluence
/** Worker installation is runtime-only; no hardware setting enters a saved world. */
export function setInfluenceExecutor(solve: (input: InfluenceInput) => Float64Array) {
  executor = solve
}
export function influenceSnapshot(w: World, pools = residentialPools(w), tolerance = 0.02) {
  const a = w.adaptive!,
    local = w.localEconomy!,
    count = w.cells.length
  const nation = new Int32Array(count).fill(-1),
    terrain = new Float64Array(count)
  for (const c of w.cells) {
    const region = w.regions[c.region]
    if (!habitableLand(c) || !region || region.devastation > 0.9) continue
    nation[c.id] = region.nation
    terrain[c.id] = c.terrain === 'mountains' ? 2.2 : c.terrain === 'hills' ? 1.4 : 1
  }
  const sources = new Map<number, InfluenceSource[]>()
  const add = (cell: number, x: number, y: number, jobs: number, services: number) => {
    if (nation[cell] < 0 || (jobs <= 0 && services <= 0)) return
    const list = sources.get(cell) ?? []
    list.push({ x, y, jobs, services })
    sources.set(cell, list)
  }
  const premises = urbanEmploymentIndex(w)
  for (const firm of w.economy?.firms ?? []) {
    const site = a.sites[`firm:${firm.id}`]
    if (!firm.active || !site || site.retired !== undefined) continue
    const nonfarm = Math.max(
      0,
      1 - (firm.laborMix?.food ?? (firm.specialization === 'agricultural' ? 1 : 0.5)),
    )
    for (const placed of urbanEmploymentLocations(w, firm, premises))
      add(placed.site.cell, placed.site.x, placed.site.y, placed.workers * nonfarm, 0)
    add(site.cell, site.x, site.y, (firm.labor?.unfilled ?? 0) * nonfarm, 0)
  }
  // Real service output is paid labor, distributed among legal service offices.
  // A title, capital flag, or empty municipality supplies no attraction by itself.
  const serviceByCell = new Float64Array(count)
  for (const id of local.active) {
    const unit = local.units[id]
    const service =
      realService(w, unit, 'administration') +
      realService(w, unit, 'education') +
      realService(w, unit, 'policing')
    const perCell = service / Math.max(1, unit.cells.length)
    for (const cell of unit.cells) serviceByCell[cell] += perCell
  }
  for (const jurisdiction of Object.values(a.jurisdictions)) {
    if (jurisdiction.retired !== undefined || jurisdiction.level !== 'municipality') continue
    const seats = [...new Set(jurisdiction.serviceSeats ?? [jurisdiction.seat])].filter(
      (cell) => nation[cell] === jurisdiction.nation,
    )
    const funded = jurisdiction.cells.reduce((sum, cell) => sum + serviceByCell[cell], 0)
    for (const cell of seats)
      add(
        cell,
        ((cell % w.width) + 0.5) * CELL_METERS,
        (Math.floor(cell / w.width) + 0.5) * CELL_METERS,
        0,
        funded / seats.length / 0.0015,
      )
  }
  const roots = new Int32Array(count).fill(-1),
    nodes: number[] = []
  for (const [cell, list] of [...sources].sort((a, b) => a[0] - b[0]))
    roots[cell] = appendInfluenceTree(nodes, list)
  const corridors = new Map((w.corridors ?? []).map((edge) => [`${edge.a}:${edge.b}`, edge]))
  const offsets = new Int32Array(count + 1),
    edges: number[] = [],
    costs: number[] = []
  // Reverse adjacency: next is the source, cell the destination. Geography and
  // paid roads constrain access before any spatial aggregation can take place.
  for (let cell = 0; cell < count; cell++) {
    offsets[cell] = edges.length
    if (!habitableLand(w.cells[cell])) continue
    const r = w.regions[w.cells[cell].region],
      technology = governance(w, nation[cell]).technologies.logistics
    const q = cell % w.width,
      row = Math.floor(cell / w.width)
    for (const next of movementNeighbors(w.cells, cell, w.width, w.height)) {
      if (w.cells[next].terrain === 'water' || nation[next] !== nation[cell]) continue
      const nq = next % w.width,
        nr = Math.floor(next / w.width)
      if (
        q !== nq &&
        row !== nr &&
        [row * w.width + nq, nr * w.width + q].some((side) => nation[side] !== nation[cell])
      )
        continue
      const infrastructure = Math.min(r.infrastructure, w.regions[w.cells[next].region].infrastructure)
      const corridor = corridors.get(`${Math.min(cell, next)}:${Math.max(cell, next)}`)
      const connected = (corridor?.familiarity ?? 0) > 0.3 && infrastructure > 0.5
      const speed = connected && technology >= 3 ? (technology >= 5 ? 30 : 25) : 4
      const congestion = 1 + (corridor?.traffic ?? 0) / (5000 * Math.max(0.1, infrastructure))
      edges.push(next)
      costs.push(
        ((Math.hypot(q - nq, row - nr) * CELL_METERS) / 1000 / speed) * 60 * terrain[cell] * congestion,
      )
    }
  }
  offsets[count] = edges.length
  const homes = [...pools.values()].flat().sort((a, b) => a.cell - b.cell || a.id.localeCompare(b.id))
  const targets = new Float64Array(homes.length * 4),
    batches: number[] = [0]
  let batchStart = 0
  homes.forEach((home, i) => {
    targets.set([home.x, home.y, home.cell, landscapeAt(w.cells[home.cell]).habitat], i * 4)
    if (i > batchStart && (home.cell !== homes[i - 1].cell || i - batchStart >= 64)) {
      batches.push(i)
      batchStart = i
    }
  })
  if (homes.length) batches.push(homes.length)
  const input: InfluenceInput = {
    width: w.width,
    offsets,
    edges: Int32Array.from(edges),
    costs: Float64Array.from(costs),
    terrain,
    roots,
    nodes: Float64Array.from(nodes),
    targets,
    batches: Int32Array.from(batches),
    tolerance,
  }
  return { input, homes }
}
export function settlementInfluence(w: World, pools = residentialPools(w)) {
  const { input, homes } = influenceSnapshot(w, pools),
    values = executor(input)
  const scores = new Map<string, number>()
  homes.forEach((home, i) =>
    scores.set(
      home.id,
      0.18 * Math.log1p(values[i * 2] / 100) +
        0.12 * Math.log1p(values[i * 2 + 1] / 100) +
        0.12 * input.targets[i * 4 + 3],
    ),
  )
  return (home: PhysicalSite) => scores.get(home.id) ?? 0.12 * landscapeAt(w.cells[home.cell]).habitat
}
