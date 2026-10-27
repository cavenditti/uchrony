import * as THREE from 'three'
import type { World } from '../sim/types'
import { CELL_SIZE } from '../sim/grid'
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
import { activityPose } from './activity-motion'
import { reliefRandom } from './relief-field'
import { sceneryBucket, sceneryDensity, sceneryLodMaterial } from './scenery-lod'

type Actor = {
  shape: DetailShape
  motion: DetailMotion
  matrix: THREE.Matrix4
  color: string
  threshold: number
}

export const ACTIVITY_CACHE_LIMIT = 128
/** Structures cover the visible terrain. Fine detail is sampled by projected
 * size, never by a nearest-N cutoff that can delete an on-screen facility. */
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
  private geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    roof: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
    cone: new THREE.ConeGeometry(0.5, 1, 8),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    crown: new THREE.IcosahedronGeometry(0.5, 1),
  }
  private density = { value: 1 }
  private visibility = { value: 1 }
  private material = sceneryLodMaterial(architectureMaterial('wall'), this.density, this.visibility)
  private roofMaterial = sceneryLodMaterial(architectureMaterial('roof'), this.density, this.visibility)
  private depthMaterial = sceneryLodMaterial(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    this.density,
    this.visibility,
  )
  private actors: Actor[] = []
  private animated: { mesh: THREE.InstancedMesh; actors: Actor[] }[] = []
  private composed = new THREE.Matrix4()
  private motionTick = -1
  private time = 0
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
    this.plans.clear()
    this.roadsByCell.clear()
    for (const road of detailRoads(world))
      for (const id of [road.a, road.b]) {
        const list = this.roadsByCell.get(id) ?? []
        list.push(road)
        this.roadsByCell.set(id, list)
      }
  }
  private height(x: number, z: number) {
    return this.picker.heightAt(x, z)
  }
  view(camera: THREE.Camera, width: number, height: number, scale: number) {
    this.density.value = sceneryDensity(scale)
    this.visibility.value = THREE.MathUtils.smoothstep(scale, 1.5, 3)
    if (!this.visibility.value) {
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
        for (const elevation of [this.picker.minimumHeight - 2, this.picker.maximumHeight + 8]) {
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
      ids: number[] = []
    for (let r = top; r <= bottom; r++)
      for (let q = left; q <= right; q++) {
        const id = r * this.world.width + q,
          c = this.world.cells[id]
        if (c.terrain === 'water') continue
        this.projection.set(c.x, this.height(c.x, c.y), c.y).project(camera)
        const mx = (CELL_SIZE * scale * 2) / width,
          my = ((CELL_SIZE + 8) * scale * 2) / height
        if (this.projection.z < -1 || this.projection.z > 1) continue
        if (Math.abs(this.projection.x) > 1 + mx || Math.abs(this.projection.y) > 1 + my) continue
        ids.push(id)
      }
    const bucket = sceneryBucket(this.density.value)
    const key = `${this.world.month}:${ids.join(',')}:${this.land.month}:${bucket}`
    if (key === this.current) return
    this.current = key
    this.visible = ids
    this.clock++
    const pieces: DetailPiece[] = [],
      motions: DetailMotion[] = []
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
      pieces.push(...cached.plan.pieces.filter((p) => (p.detailThreshold ?? -1) < bucket))
      motions.push(...cached.plan.motions.filter((m) => this.motionThreshold(m) < bucket))
    }
    this.clearMeshes()
    const color = new THREE.Color()
    for (const shape of Object.keys(this.geometries) as DetailShape[]) {
      const list = pieces.filter((p) => p.shape === shape)
      if (!list.length) continue
      const mesh = new THREE.InstancedMesh(
        this.geometries[shape].clone(),
        shape === 'roof' ? this.roofMaterial : this.material,
        list.length,
      )
      mesh.geometry.setAttribute(
        'detailThreshold',
        new THREE.InstancedBufferAttribute(new Float32Array(list.map((p) => p.detailThreshold ?? -1)), 1),
      )
      list.forEach((p, i) => {
        this.dummy.position.set(p.x, (p.baseY ?? (p.water ? 0 : this.height(p.x, p.z))) + p.y, p.z)
        this.dummy.rotation.set(0, p.angle, 0)
        this.dummy.scale.set(p.w, p.h, p.d)
        this.dummy.updateMatrix()
        mesh.setMatrixAt(i, this.dummy.matrix)
        mesh.setColorAt(i, color.set(p.color))
      })
      mesh.castShadow = shape !== 'box'
      mesh.customDepthMaterial = this.depthMaterial
      mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      this.group.add(mesh)
    }
    for (const motion of motions) this.addMotion(motion)
    for (const shape of Object.keys(this.geometries) as DetailShape[]) {
      const actors = this.actors.filter((a) => a.shape === shape)
      if (!actors.length) continue
      const mesh = new THREE.InstancedMesh(this.geometries[shape].clone(), this.material, actors.length)
      mesh.geometry.setAttribute(
        'detailThreshold',
        new THREE.InstancedBufferAttribute(new Float32Array(actors.map((a) => a.threshold)), 1),
      )
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
    this.animate(this.time)
  }
  private motionThreshold(m: DetailMotion) {
    // A windmill rotor is part of its structure; roads and people receive
    // deterministic detail samples that remain the same when the camera pans.
    return m.kind === 'mill' || m.kind === 'boat'
      ? -1
      : reliefRandom(Math.round(m.x * 1024 + m.z * 8192 + m.phase * 32768))
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
      this.actors.push({
        shape,
        color,
        motion,
        matrix: this.dummy.matrix.clone(),
        threshold: this.motionThreshold(motion),
      })
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
    this.time = time
    const frame = Math.floor(time * 15)
    if (frame === this.motionTick || !this.group.visible) return
    this.motionTick = frame
    for (const { mesh, actors } of this.animated) {
      actors.forEach(({ motion: m, matrix }, i) => {
        const { x, z, angle, phase } = activityPose(m, time, this.world)
        this.dummy.position.set(
          x,
          m.water
            ? -0.07 + Math.sin(phase) * 0.025
            : (m.baseY ?? this.height(x, z)) + (m.kind === 'mill' ? 1.45 : 0.06),
          z,
        )
        this.dummy.rotation.set(0, angle, m.kind === 'mill' ? phase : 0)
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
      if (child instanceof THREE.InstancedMesh) {
        child.geometry.dispose()
        child.dispose()
      } else
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
    this.depthMaterial.dispose()
  }
}
