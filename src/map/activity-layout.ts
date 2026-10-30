import { habitableLand } from '../sim/terrain-access'
import { CELL_SIZE, cellAt } from '../sim/grid'
import { hashSeed } from '../sim/random'
import { localClimate } from '../sim/climate'
import { TILE_ACTIVITIES, type EconomicLandscape } from '../sim/economic-landscape'
import type { World } from '../sim/types'
import { roadSurface, type RoadSurface } from '../sim/transport-development'
import { reliefRandom } from './relief-field'
import { illuminated } from './illuminated-palette'
import { tradeRoadEdges, roadKey, type RoadPoint } from './road-curves'
import { currentFreightVolumeView } from '../sim/freight-access'
import { footprint, landSurface, renderedLand } from './land-surface'

export type DetailShape = 'box' | 'roof' | 'cone' | 'cylinder' | 'crown' | 'conifer' | 'sheep'
export interface DetailPiece {
  shape: DetailShape
  x: number
  z: number
  y: number
  w: number
  h: number
  d: number
  angle: number
  color: string
  role: string
  water?: boolean
  baseY?: number
  detailThreshold?: number
}
export interface DetailMotion {
  kind: 'mill' | 'cart' | 'worker' | 'boat'
  x: number
  z: number
  angle: number
  phase: number
  water?: boolean
  path?: RoadPoint[]
  baseY?: number
}
export interface ActivityPlan {
  cell: number
  use: string
  pieces: DetailPiece[]
  motions: DetailMotion[]
}
export interface DetailRoad {
  a: number
  b: number
  surface: RoadSurface
  points: RoadPoint[]
  traffic: boolean
}

/** Detailed props are stateless conditional samples. Their identity depends on
 * geography, never the camera, draw order, mesh depth or the economic RNG. */
export function activityLayout(
  w: World,
  land: EconomicLandscape,
  id: number,
  roads: DetailRoad[] = [],
  height?: (x: number, z: number) => number,
): ActivityPlan {
  const terrainHeightAt = height
  let detailThreshold = -1
  const cell = w.cells[id],
    use = TILE_ACTIVITIES[land.activity[id]],
    climate = localClimate(w, cell),
    seed = hashSeed(`${w.seed}:living-land:${id}`),
    random = (n: number) => reliefRandom(seed + n * 1013),
    pieces: DetailPiece[] = [],
    motions: DetailMotion[] = [],
    angle = random(2) * 0.45 - 0.225
  // Building-scale worlds draw persistent physical sites. The older economic
  // activity illustrations are oversized symbols, not additional buildings or
  // people; adding them would invent development over the recorded lots.
  if (!habitableLand(cell) || w.adaptive?.buildingVersion === 1) return { cell: id, use, pieces, motions }
  const add = (
    shape: DetailShape,
    x: number,
    z: number,
    y: number,
    width: number,
    height: number,
    depth: number,
    color: string,
    role: string,
    turn = angle,
    water = false,
    baseY?: number,
  ) => {
    const at = cellAt(x, z, w.width, w.height)
    if (
      at === undefined ||
      (!water &&
        (!habitableLand(w.cells[at]) ||
          !footprint(x, z, width, depth, turn).every((p) => renderedLand(w, p.x, p.z))))
    )
      return
    pieces.push({
      shape,
      x,
      z,
      y,
      w: width,
      h: height,
      d: depth,
      angle: turn,
      color,
      role,
      water,
      baseY,
      detailThreshold,
    })
  }
  const timber = '#826144',
    stone = '#c5b394',
    dark = '#3e4943',
    roof = illuminated.cities[(w.regions[cell.region]?.culture ?? 0) % 4].roof
  const box = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    role: string,
    paint = stone,
    turn = angle,
  ) => {
    const corners = footprint(x, z, width * 1.08, depth * 1.08, turn)
    if (!corners.every((p) => renderedLand(w, p.x, p.z))) return
    const baseY = terrainHeightAt ? Math.max(...corners.map((p) => terrainHeightAt(p.x, p.z))) : undefined
    if (baseY !== undefined) {
      const low = Math.min(...corners.map((p) => terrainHeightAt!(p.x, p.z)))
      if (baseY - low > 0.001)
        add(
          'box',
          x,
          z,
          (baseY - low) / 2,
          width,
          baseY - low,
          depth,
          stone,
          `${role}-foundation`,
          turn,
          false,
          low,
        )
    }
    add('box', x, z, height / 2, width, height, depth, paint, role, turn, false, baseY)
    add(
      'roof',
      x,
      z,
      height + width * 0.16,
      width * 1.08,
      width * 0.32,
      depth * 1.08,
      roof,
      role,
      turn,
      false,
      baseY,
    )
    const dx = Math.sin(turn) * depth * 0.51,
      dz = Math.cos(turn) * depth * 0.51
    add(
      'box',
      x + dx,
      z + dz,
      height * 0.26,
      width * 0.18,
      height * 0.52,
      0.035,
      dark,
      role,
      turn,
      false,
      baseY,
    )
    for (const side of [-1, 1])
      add(
        'box',
        x + dx + Math.cos(turn) * width * side * 0.28,
        z + dz - Math.sin(turn) * width * side * 0.28,
        height * 0.65,
        width * 0.13,
        height * 0.18,
        0.04,
        dark,
        role,
        turn,
        false,
        baseY,
      )
  }
  const tree = (x: number, z: number, i: number, orchard = false) => {
    detailThreshold = orchard ? -1 : random(i + 1853)
    const v = random(i + 710),
      size = orchard ? 0.22 : 0.34 + v * 0.24,
      h = orchard ? 0.5 : 0.8 + v * 0.7
    add('cylinder', x, z, h * 0.35, 0.08, h * 0.7, 0.08, timber, 'tree')
    if (climate.biome === 'boreal' || climate.biome === 'polar') {
      add('conifer', x, z, h * 0.72, size * 1.4, h * 1.16, size * 1.4, '#326550', 'conifer', v * 6)
    } else if ((climate.biome === 'tropical' && v > 0.82) || climate.biome === 'arid') {
      for (let leaf = 0; leaf < 5; leaf++) {
        const a = (leaf * Math.PI * 2) / 5
        add(
          'crown',
          x + Math.sin(a) * size * 0.45,
          z + Math.cos(a) * size * 0.45,
          h * 0.9,
          size * 1.15,
          size * 0.24,
          size * 0.45,
          '#39785a',
          'palm',
          a,
        )
      }
    } else
      add(
        'crown',
        x,
        z,
        h * 0.85,
        size * 1.5,
        h * 0.75,
        size * 1.3,
        climate.growth < 0.2 ? '#7e8c55' : illuminated.foliage,
        'broadleaf',
        v * 6,
      )
    detailThreshold = -1
  }
  if (use === 'forest' || use === 'timber') {
    const count = use === 'forest' ? 180 : 110
    for (let i = 0; i < count; i++) {
      const x = cell.x + (random(i * 3 + 31) - 0.5) * CELL_SIZE * 0.96,
        z = cell.y + (random(i * 3 + 32) - 0.5) * CELL_SIZE * 0.96
      if (cell.river && Math.abs(x - cell.x) < 0.9) continue
      if (use === 'timber' && Math.hypot(x - cell.x, z - cell.y) < 2.5) continue
      if (
        roads.some(({ points }) =>
          points.slice(1).some((p, i) => distanceTo(x, z, points[i].x, points[i].y, p.x, p.y) < 0.65),
        )
      )
        continue
      tree(x, z, i)
    }
  }
  const yardX = cell.x + (random(18) - 0.5) * 1.5,
    yardZ = cell.y + (random(19) - 0.5) * 1.5
  if (use === 'fields' || use === 'pasture') {
    box(
      yardX + 0.85,
      yardZ + 0.7,
      0.7 + random(27) * 0.3,
      0.6 + random(28) * 0.3,
      0.5 + random(29) * 0.25,
      'farmhouse',
    )
    box(yardX + 1.8, yardZ + 0.7, 0.85, 1.4, 0.65, 'barn', timber)
    if (climate.crop === 'orchard')
      for (let row = 0; row < 5; row++)
        for (let col = 0; col < 6; col++)
          tree(yardX - 4.6 + col * 0.65, yardZ - 4.4 + row * 0.75, row * 6 + col, true)
    if (use === 'pasture' || climate.crop === 'pasture')
      for (let i = 0; i < 10; i++) {
        const x = yardX - 3 + random(i + 400) * 2,
          z = yardZ - 3 + random(i + 500) * 4
        add('sheep', x, z, 0.14, 0.24, 0.28, 0.46, '#dfdac2', 'livestock', random(i) * 6)
      }
    else if (random(88) < 0.28) {
      const x = yardX - 1.2,
        z = yardZ + 1
      add('cone', x, z, 0.65, 0.75, 1.3, 0.75, stone, 'windmill', 0)
      add('cone', x, z, 1.45, 0.85, 0.45, 0.85, roof, 'windmill', 0)
      motions.push({ kind: 'mill', x, z: z + 0.43, angle: 0, phase: random(77) * 6, baseY: height?.(x, z) })
    }
    for (let i = 0; i < 6; i++)
      add(
        'cylinder',
        yardX + 2.5 + (i % 3) * 0.35,
        yardZ - 0.6 + Math.floor(i / 3) * 0.4,
        0.18,
        0.28,
        0.36,
        0.28,
        '#c2a765',
        'harvest',
        0,
      )
  }
  if (use === 'timber') {
    box(yardX, yardZ, 1.2, 1.8, 0.7, 'sawmill', timber)
    for (let i = 0; i < 16; i++)
      add(
        'cylinder',
        yardX + 1.1 + (i % 4) * 0.18,
        yardZ - 0.8 + Math.floor(i / 4) * 0.5,
        0.13,
        0.15,
        0.26,
        0.9,
        timber,
        'log-stack',
        0,
      )
  }
  if (use === 'iron' || use === 'coal' || use === 'quarry') {
    if (use === 'quarry') {
      for (let i = 0; i < 4; i++)
        add(
          'cylinder',
          yardX,
          yardZ,
          0.025 + i * 0.014,
          3.2 - i * 0.5,
          0.025,
          2.8 - i * 0.4,
          ['#b8aa95', '#a39884', '#8c8473', '#716e60'][i],
          'quarry-bench',
          0,
        )
    } else {
      for (const side of [-1, 1])
        add('box', yardX + side * 0.38, yardZ, 0.8, 0.11, 1.6, 0.11, timber, 'headframe', 0)
      add('box', yardX, yardZ, 1.5, 1, 0.15, 0.35, timber, 'headframe', 0)
      add('cylinder', yardX, yardZ, 1.78, 0.65, 0.22, 0.65, dark, 'winding-drum', 0)
      add('box', yardX, yardZ - 0.5, 0.12, 0.7, 0.24, 1.1, dark, 'mine-mouth', 0)
    }
    box(yardX + 1.8, yardZ + 0.8, 0.9, 1.2, 0.7, 'mine-office')
    for (let i = 0; i < 6; i++)
      add(
        'cone',
        yardX - 1.8 + (i % 3) * 0.6,
        yardZ + 1 + Math.floor(i / 3) * 0.6,
        0.2,
        0.7,
        0.4,
        0.7,
        use === 'coal' ? '#444942' : '#9d7a59',
        'ore-pile',
        0,
      )
  }
  if (use === 'workshops') {
    for (let i = 0; i < 3; i++)
      box(yardX + (i - 1) * 1.45, yardZ, 1.1, 2, 0.95, 'workshop', i === 1 ? '#bd936c' : stone)
    add('cylinder', yardX + 2, yardZ - 0.7, 1.4, 0.3, 2.8, 0.3, '#ae7757', 'kiln-chimney', 0)
    for (let i = 0; i < 5; i++)
      add('box', yardX - 1 + i * 0.4, yardZ + 1.8, 0.2, 0.3, 0.4, 0.4, timber, 'goods', 0)
  }
  for (const harbor of land.harbors.filter((h) => h.cell === id)) {
    const sea = w.cells[harbor.water],
      dx = sea.x - cell.x,
      dz = sea.y - cell.y,
      length = Math.hypot(dx, dz),
      ux = dx / length,
      uz = dz / length,
      turn = Math.atan2(ux, uz)
    const coast = landSurface(w),
      anchor = coast.shore(cell, sea)
    if (!anchor || !length) continue
    const x = anchor.x,
      z = anchor.y
    const count = Math.min(4, harbor.level + 1)
    for (let dock = 0; dock < count; dock++) {
      const offset = (dock - (count - 1) / 2) * 0.9
      const root = coast.shore(
        { x: cell.x + uz * offset, y: cell.y - ux * offset },
        { x: sea.x + uz * offset, y: sea.y - ux * offset },
      )
      if (!root) continue
      const bx = root.x,
        bz = root.y,
        deck = Math.max(0.18, (height?.(bx - ux * 0.35, bz - uz * 0.35) ?? 0) + 0.18)
      add('box', bx + ux * 0.7, bz + uz * 0.7, deck, 0.42, 0.18, 2.1, timber, 'pier', turn, true)
      for (let j = 0; j < 4; j++)
        for (const side of [-1, 1])
          add(
            'box',
            bx + ux * j * 0.5 + uz * side * 0.2,
            bz + uz * j * 0.5 - ux * side * 0.2,
            (deck - 0.1) / 2,
            0.07,
            deck + 0.3,
            0.07,
            timber,
            'piling',
            turn,
            true,
          )
      const boat = {
        kind: 'boat',
        x: bx + ux * 1.7 + uz * 0.5,
        z: bz + uz * 1.7 - ux * 0.5,
        angle: turn,
        phase: random(dock + 600) * 6,
        water: true,
      } as DetailMotion
      if (!coast.contains(boat.x, boat.z)) motions.push(boat)
    }
    box(x - ux * 0.9, z - uz * 0.9, 1.1, 1.5, 0.9, 'warehouse', stone, turn)
    add(
      'box',
      x - ux * 0.2,
      z - uz * 0.2,
      (height?.(x - ux * 0.2, z - uz * 0.2) ?? 0) + 0.12,
      Math.min(5, harbor.level + 2),
      0.24,
      0.65,
      stone,
      'quay',
      turn,
      true,
    )
  }
  // Movement is present only where recorded workers/residents or traffic exist.
  if (land.workers[id] > 0 || land.residents[id] > 0)
    for (let i = 0; i < Math.min(6, Math.ceil(Math.log1p(land.workers[id] + land.residents[id]) / 2)); i++)
      motions.push({
        kind: 'worker',
        x: cell.x + (random(i + 501) - 0.5) * 3,
        z: cell.y + (random(i + 701) - 0.5) * 2,
        angle,
        phase: random(i + 901) * 6,
      })
  for (const road of roads)
    if (road.traffic && road.a === id && w.cells[road.b]) {
      const a = w.cells[road.a],
        b = w.cells[road.b],
        turn = Math.atan2(b.x - a.x, b.y - a.y)
      motions.push({
        kind: 'cart',
        x: (a.x + b.x) / 2,
        z: (a.y + b.y) / 2,
        angle: turn,
        phase: random(road.b) * 6,
        path: road.points,
      })
    }
  return { cell: id, use, pieces, motions: motions.filter((m) => m.water || renderedLand(w, m.x, m.z)) }
}
export function distanceTo(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax,
    dz = bz - az,
    t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

export function detailRoads(w: World): DetailRoad[] {
  // Remembered roads remain physical infrastructure. Only current open cargo
  // justifies moving carts; stale familiarity or last month's traffic does not.
  const active = new Set<string>(),
    volume = currentFreightVolumeView(w)
  for (const route of w.routes)
    if (volume(route) > 0)
      for (const leg of route.legs ?? [])
        if (leg.mode === 'land')
          for (let i = 1; i < leg.cells.length; i++) active.add(roadKey(leg.cells[i - 1], leg.cells[i]))
  return [...tradeRoadEdges(w).values()].map(({ a, b, points }) => ({
    a,
    b,
    points,
    surface: roadSurface(w, a, b),
    traffic: active.has(roadKey(a, b)),
  }))
}
