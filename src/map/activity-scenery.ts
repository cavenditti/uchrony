import * as THREE from 'three'
import type { World } from '../sim/types'
import { CELL_SIZE, cellAt } from '../sim/grid'
import { economicLandscape, type EconomicLandscape } from '../sim/economic-landscape'
import {
  activityLayout,
  detailRoads,
  type ActivityPlan,
  type DetailPiece,
  type DetailRoad,
  type DetailMotion,
  type DetailShape,
} from './activity-layout'
import { TerrainPicker } from './relief-picking'
import { architectureMaterial } from './city-materials'

type Actor = { shape: DetailShape; motion: DetailMotion; matrix: THREE.Matrix4; color: string }

export const ACTIVITY_DETAIL_LIMIT = 64
export const ACTIVITY_CACHE_LIMIT = 128
/** Only observed tiles get models. The source grid is its own spatial index;
 * detail meshes, motion and caches have fixed budgets regardless of world size. */
export class ActivityScenery {
  readonly group = new THREE.Group()
  private world: World
  private land: EconomicLandscape
  private plans = new Map<number, { key: string; plan: ActivityPlan; used: number }>()
  private roadsByCell = new Map<number, DetailRoad[]>()
  private clock = 0
  private current = ''
  private visible: number[] = []
  private dummy = new THREE.Object3D()
  private projection = new THREE.Vector3()
  private raycaster = new THREE.Raycaster()
  private ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0))
  private geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    roof: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
    cone: new THREE.ConeGeometry(0.5, 1, 8),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    crown: new THREE.IcosahedronGeometry(0.5, 1),
  }
  private material = architectureMaterial('wall')
  private roofMaterial = architectureMaterial('roof')
  private actors: Actor[] = []
  private animated: { mesh: THREE.InstancedMesh; actors: Actor[] }[] = []
  private composed = new THREE.Matrix4()
  private motionTick = -1
  constructor(
    world: World,
    private picker: TerrainPicker,
  ) {
    this.world = world
    this.land = world.viewLandscape ?? economicLandscape(world)
    this.update(world, this.land)
  }
  update(world: World, land = world.viewLandscape ?? economicLandscape(world)) {
    this.world = world
    this.land = land
    this.current = ''
    this.roadsByCell.clear()
    for (const road of detailRoads(world))
      for (const id of [road.a, road.b]) {
        const list = this.roadsByCell.get(id) ?? []
        list.push(road)
        this.roadsByCell.set(id, list)
      }
  }
  private height(x: number, z: number) {
    this.ray.origin.set(x, 2000, z)
    return this.picker.intersect(this.ray)?.y ?? 0
  }
  view(camera: THREE.Camera, width: number, height: number, scale: number) {
    if (scale < 3) {
      this.group.visible = false
      this.visible = []
      this.current = ''
      return
    }
    this.group.visible = true
    const xs: number[] = [],
      zs: number[] = []
    for (const y of [-1, 1])
      for (const x of [-1, 1]) {
        this.raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
        for (const elevation of [-2, 140]) {
          const ray = this.raycaster.ray,
            t = (elevation - ray.origin.y) / ray.direction.y
          if (t >= 0) {
            xs.push(ray.origin.x + ray.direction.x * t)
            zs.push(ray.origin.z + ray.direction.z * t)
          }
        }
      }
    if (!xs.length) return
    const left = Math.max(0, Math.floor(Math.min(...xs) / CELL_SIZE) - 1),
      right = Math.min(this.world.width - 1, Math.ceil(Math.max(...xs) / CELL_SIZE) + 1),
      top = Math.max(0, Math.floor(Math.min(...zs) / CELL_SIZE) - 1),
      bottom = Math.min(this.world.height - 1, Math.ceil(Math.max(...zs) / CELL_SIZE) + 1),
      candidates: { id: number; score: number }[] = []
    for (let r = top; r <= bottom; r++)
      for (let q = left; q <= right; q++) {
        const id = r * this.world.width + q,
          c = this.world.cells[id]
        if (c.terrain === 'water') continue
        this.projection.set(c.x, this.height(c.x, c.y), c.y).project(camera)
        const mx = (CELL_SIZE * scale) / width,
          my = (CELL_SIZE * scale) / height
        if (Math.abs(this.projection.x) > 1 + mx || Math.abs(this.projection.y) > 1 + my) continue
        candidates.push({ id, score: this.projection.x ** 2 + this.projection.y ** 2 })
      }
    candidates.sort((a, b) => a.score - b.score || a.id - b.id)
    const ids = candidates
      .slice(0, ACTIVITY_DETAIL_LIMIT)
      .map((c) => c.id)
      .sort((a, b) => a - b)
    const key = `${this.world.month}:${ids.join(',')}:${this.land.month}`
    if (key === this.current) return
    this.current = key
    this.visible = ids
    this.clock++
    const pieces: DetailPiece[] = [],
      motions: DetailMotion[] = [],
      roads = new Map<string, DetailRoad>()
    for (const id of ids) {
      const adjacent = this.roadsByCell.get(id) ?? []
      const planKey = `${this.land.activity[id]}:${this.world.month % 12}:${Math.round(this.land.workers[id])}:${Math.round(this.land.residents[id])}:${this.land.harbors.find((h) => h.cell === id)?.level ?? 0}:${adjacent.map((r) => r.surface).join(',')}`
      let cached = this.plans.get(id)
      if (!cached || cached.key !== planKey) {
        cached = {
          key: planKey,
          plan: activityLayout(this.world, this.land, id, adjacent, (x, z) => this.height(x, z)),
          used: this.clock,
        }
        this.plans.set(id, cached)
      }
      cached.used = this.clock
      pieces.push(...cached.plan.pieces)
      motions.push(...cached.plan.motions)
      for (const road of adjacent) roads.set(`${road.a}:${road.b}`, road)
    }
    for (const road of roads.values()) this.roadPieces(road, pieces)
    this.clearMeshes()
    const color = new THREE.Color()
    for (const shape of Object.keys(this.geometries) as DetailShape[]) {
      const list = pieces.filter((p) => p.shape === shape)
      if (!list.length) continue
      const mesh = new THREE.InstancedMesh(
        this.geometries[shape],
        shape === 'roof' ? this.roofMaterial : this.material,
        list.length,
      )
      list.forEach((p, i) => {
        this.dummy.position.set(p.x, (p.water ? 0 : this.height(p.x, p.z)) + p.y, p.z)
        this.dummy.rotation.set(0, p.angle, 0)
        this.dummy.scale.set(p.w, p.h, p.d)
        this.dummy.updateMatrix()
        mesh.setMatrixAt(i, this.dummy.matrix)
        mesh.setColorAt(i, color.set(p.color))
      })
      mesh.castShadow = shape !== 'box'
      mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      this.group.add(mesh)
    }
    for (const motion of motions.slice(0, 384)) this.addMotion(motion)
    for (const shape of Object.keys(this.geometries) as DetailShape[]) {
      const actors = this.actors.filter((a) => a.shape === shape)
      if (!actors.length) continue
      const mesh = new THREE.InstancedMesh(this.geometries[shape], this.material, actors.length)
      actors.forEach((a, i) => mesh.setColorAt(i, color.set(a.color)))
      mesh.frustumCulled = false
      this.animated.push({ mesh, actors })
      this.group.add(mesh)
    }
    for (const [id] of [...this.plans].sort((a, b) => a[1].used - b[1].used)) {
      if (this.plans.size <= ACTIVITY_CACHE_LIMIT) break
      this.plans.delete(id)
    }
    this.motionTick = -1
    this.animate(0)
  }
  private roadPieces(road: DetailRoad, pieces: DetailPiece[]) {
    const a = this.world.cells[road.a],
      b = this.world.cells[road.b],
      dx = b.x - a.x,
      dz = b.y - a.y,
      len = Math.hypot(dx, dz),
      turn = Math.atan2(dx, dz),
      steps = Math.max(1, Math.ceil(len / 0.45)),
      rail = road.surface === 'rail',
      width = road.surface === 'path' ? 0.12 : road.surface === 'gravel' ? 0.2 : 0.28
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps,
        x = a.x + dx * t,
        z = a.y + dz * t,
        cell = cellAt(x, z, this.world.width, this.world.height)
      if (cell === undefined || this.world.cells[cell].terrain === 'water') continue
      pieces.push({
        shape: 'box',
        x,
        z,
        y: 0.025,
        w: width,
        h: 0.05,
        d: len / steps + 0.025,
        angle: turn,
        color: road.surface === 'paved' ? '#bbb39d' : '#a48c61',
        role: 'road',
      })
      if (rail) {
        pieces.push({
          shape: 'box',
          x,
          z,
          y: 0.07,
          w: 0.32,
          h: 0.06,
          d: 0.09,
          angle: turn,
          color: '#776246',
          role: 'sleeper',
        })
        for (const side of [-1, 1])
          pieces.push({
            shape: 'box',
            x: x + Math.cos(turn) * side * 0.075,
            z: z - Math.sin(turn) * side * 0.075,
            y: 0.11,
            w: 0.035,
            h: 0.045,
            d: len / steps + 0.03,
            angle: turn,
            color: '#59605a',
            role: 'rail',
          })
      }
    }
  }
  private addMotion(motion: DetailMotion) {
    const add = (
      shape: DetailShape,
      color: string,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      rz = 0,
    ) => {
      this.dummy.position.set(x, y, z)
      this.dummy.rotation.set(0, 0, rz)
      this.dummy.scale.set(w, h, d)
      this.dummy.updateMatrix()
      this.actors.push({ shape, color, motion, matrix: this.dummy.matrix.clone() })
    }
    if (motion.kind === 'mill')
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2
        add('box', '#d9c49a', Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0, 0.16, 0.8, 0.045, a - Math.PI / 2)
      }
    else if (motion.kind === 'boat') {
      add('roof', '#805c3b', 0, 0.12, 0, 0.35, 0.25, 0.95)
      add('box', '#594b39', 0, 0.5, 0, 0.04, 0.9, 0.04)
      add('box', '#e5d4ad', 0.13, 0.7, 0, 0.25, 0.42, 0.025)
    } else if (motion.kind === 'cart') {
      add('box', '#ad8553', 0, 0.18, 0, 0.3, 0.23, 0.5)
      for (const side of [-1, 1]) add('crown', '#4e4940', side * 0.18, 0.1, 0, 0.07, 0.2, 0.2)
    } else {
      add('box', '#b17f58', 0, 0.13, 0, 0.08, 0.19, 0.08)
      add('crown', '#dbc49b', 0, 0.26, 0, 0.09, 0.09, 0.09)
    }
  }
  animate(time: number) {
    const frame = Math.floor(time * 15)
    if (frame === this.motionTick || !this.group.visible) return
    this.motionTick = frame
    for (const { mesh, actors } of this.animated) {
      actors.forEach(({ motion: m, matrix }, i) => {
        const phase = time * (m.kind === 'cart' ? 0.25 : 0.4) + m.phase
        const travel =
          m.kind === 'cart'
            ? Math.sin(phase) * CELL_SIZE * 0.32
            : m.kind === 'worker'
              ? Math.sin(phase) * 0.7
              : 0
        const x = m.x + Math.sin(m.angle) * travel,
          z = m.z + Math.cos(m.angle) * travel
        this.dummy.position.set(
          x,
          m.water ? 0.03 + Math.sin(phase) * 0.025 : this.height(x, z) + (m.kind === 'mill' ? 1.45 : 0.06),
          z,
        )
        this.dummy.rotation.set(0, m.angle, m.kind === 'mill' ? phase : 0)
        this.dummy.scale.set(1, 1, 1)
        this.dummy.updateMatrix()
        mesh.setMatrixAt(i, this.composed.multiplyMatrices(this.dummy.matrix, matrix))
      })
      mesh.instanceMatrix.needsUpdate = true
    }
  }
  get stats() {
    return {
      visible: this.visible.length,
      cached: this.plans.size,
      moving: new Set(this.actors.map((a) => a.motion)).size,
      instances: this.group.children.reduce(
        (n, c) => n + (c instanceof THREE.InstancedMesh ? c.count : 0),
        0,
      ),
    }
  }
  private clearMeshes() {
    for (const child of this.group.children) {
      if (child instanceof THREE.InstancedMesh) child.dispose()
      else
        child.traverse((part) => {
          if (part instanceof THREE.Mesh) (part.material as THREE.Material).dispose()
        })
    }
    this.group.clear()
    this.actors = []
    this.animated = []
  }
  dispose() {
    this.clearMeshes()
    this.plans.clear()
    Object.values(this.geometries).forEach((g) => g.dispose())
    this.material.dispose()
    this.roofMaterial.dispose()
  }
}
