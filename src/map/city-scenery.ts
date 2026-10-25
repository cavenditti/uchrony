import * as THREE from 'three'
import type { World } from '../sim/types'
import { spatialState } from '../sim/spatial'
import { describeCity, cityLayout, type CityDescription, type CityPoint } from './city-layout'
import type { RiverCurve } from './rivers'
import { TerrainPicker } from './relief-picking'

const PALETTES = [
  { walls: '#d6c5a4', roof: '#8d5845', paving: '#a29173', trim: '#89765d' },
  { walls: '#c6c4b6', roof: '#506675', paving: '#96988a', trim: '#747b75' },
  { walls: '#deca9e', roof: '#c19d72', paving: '#ac9570', trim: '#947650' },
  { walls: '#d4bd9e', roof: '#7d645c', paving: '#9e8e77', trim: '#796956' },
]
const DETAIL_LIMIT = 6,
  CACHE_LIMIT = 12

type Piece = {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  a?: number
  color: THREE.Color
}
type CityEntry = { key: string; group: THREE.Group; used: number }

/** Six visible townscapes and twelve cached, regardless of the total world size. */
export class CityScenery {
  readonly group = new THREE.Group()
  private descriptions: CityDescription[] = []
  private cache = new Map<string, CityEntry>()
  private overview = new THREE.Group()
  private signature = ''
  private heights = new Map<string, number>()
  private ranges = new Map<string, [number, number]>()
  private overviewMatrices: Float32Array[] = []
  private hidden = new Set<string>()
  private clock = 0
  private viewKey = ''
  private geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    hip: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
    gable: gableGeometry(),
    dome: new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    cone: new THREE.ConeGeometry(0.5, 1, 8),
    tree: new THREE.IcosahedronGeometry(0.5, 1),
  }
  private wallMaterial = facadeMaterial()
  private roofMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9 })
  private groundMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  private dummy = new THREE.Object3D()
  private ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0))
  private projection = new THREE.Vector3()
  private geography: Pick<World, 'cells' | 'width' | 'height'>

  constructor(
    world: World,
    private picker: TerrainPicker,
    private rivers: readonly RiverCurve[] = [],
  ) {
    this.geography = { cells: world.cells, width: world.width, height: world.height }
    this.group.add(this.overview)
    this.update(world)
  }

  update(world: World) {
    const cities = spatialState(world).settlements.map((s) => describeCity(world, s))
    const signature = cities.map((c) => c.key).join('|')
    if (signature === this.signature) return
    this.signature = signature
    this.viewKey = ''
    this.descriptions = cities
    this.heights.clear()
    this.ranges.clear()
    this.hidden.clear()
    const keys = new Set(cities.map((c) => c.key))
    for (const [id, entry] of this.cache)
      if (!keys.has(entry.key)) {
        this.release(entry.group)
        this.cache.delete(id)
      }
    this.release(this.overview)
    this.overview = new THREE.Group()
    const walls: Piece[] = [],
      roofs: Piece[] = []
    for (const c of cities) {
      this.heights.set(c.id, this.height(c.x, c.z))
      const first = walls.length
      const palette = PALETTES[c.style]
      for (let j = 0; j < (c.kind === 'city' ? 7 : c.kind === 'town' ? 4 : 2); j++) {
        const a = j * 2.4,
          d = Math.sqrt(j) * 1.25,
          x = c.x + Math.cos(a) * d,
          z = c.z + Math.sin(a) * d
        const floor = this.height(x, z),
          h = j === 0 ? 3.7 : 1.5
        walls.push({ x, y: floor + h / 2, z, w: 1, h, d: 1, color: new THREE.Color(palette.walls) })
        roofs.push({ x, y: floor + h + 0.4, z, w: 1.2, h: 0.8, d: 1.2, color: new THREE.Color(palette.roof) })
      }
      this.ranges.set(c.id, [first, walls.length - first])
    }
    this.addInstances(this.overview, 'box', walls, this.wallMaterial)
    this.addInstances(this.overview, 'hip', roofs, this.roofMaterial)
    this.overviewMatrices = this.overview.children.map((mesh) =>
      ((mesh as THREE.InstancedMesh).instanceMatrix.array as Float32Array).slice(),
    )
    this.group.add(this.overview)
  }

  private height(x: number, z: number) {
    this.ray.origin.set(x, 1000, z)
    return this.picker.intersect(this.ray)?.y ?? 0
  }

  /** Called on camera changes. Offscreen details are hidden immediately; visible and cached detail both have fixed limits. */
  view(camera: THREE.Camera, width: number, height: number, scale: number) {
    const key = `${camera.position.x}:${camera.position.y}:${camera.position.z}:${width}:${height}:${scale}`
    if (key === this.viewKey) return
    this.viewKey = key
    for (const id of this.hidden) this.hideOverview(id, false)
    this.hidden.clear()
    for (const entry of this.cache.values()) entry.group.visible = false
    if (scale < 3) return
    const visible: { city: CityDescription; distance: number }[] = []
    for (const city of this.descriptions) {
      this.projection.set(city.x, this.heights.get(city.id) ?? 0, city.z).project(camera)
      const marginX = (city.radius * scale * 2) / width,
        marginY = (city.radius * scale * 2) / height
      if (Math.abs(this.projection.x) > 1 + marginX || Math.abs(this.projection.y) > 1 + marginY) continue
      visible.push({ city, distance: this.projection.x ** 2 + this.projection.y ** 2 })
    }
    visible.sort((a, b) => a.distance - b.distance)
    for (const { city } of visible.slice(0, DETAIL_LIMIT)) {
      let entry = this.cache.get(city.id)
      if (!entry) {
        // There are at most six near-camera towns. Each layout has a finite parcel budget.
        entry = { key: city.key, group: this.build(city), used: ++this.clock }
        this.cache.set(city.id, entry)
        this.group.add(entry.group)
      }
      entry.group.visible = true
      this.hideOverview(city.id, true)
      this.hidden.add(city.id)
      entry.used = ++this.clock
    }
    while (this.cache.size > CACHE_LIMIT) {
      let oldestId = '',
        oldest = Infinity
      for (const [id, entry] of this.cache)
        if (!entry.group.visible && entry.used < oldest) {
          oldestId = id
          oldest = entry.used
        }
      if (!oldestId) break
      this.release(this.cache.get(oldestId)!.group)
      this.cache.delete(oldestId)
    }
  }

  private hideOverview(id: string, hide: boolean) {
    const range = this.ranges.get(id)
    if (!range) return
    this.overview.children.forEach((object, index) => {
      const mesh = object as THREE.InstancedMesh,
        array = mesh.instanceMatrix.array
      for (let i = range[0] * 16; i < (range[0] + range[1]) * 16; i++)
        array[i] = hide ? 0 : this.overviewMatrices[index][i]
      mesh.instanceMatrix.needsUpdate = true
    })
  }

  private addInstances(
    group: THREE.Group,
    shape: keyof CityScenery['geometries'],
    pieces: Piece[],
    material: THREE.Material,
  ) {
    if (!pieces.length) return
    const mesh = new THREE.InstancedMesh(this.geometries[shape], material, pieces.length)
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]
      this.dummy.position.set(p.x, p.y, p.z)
      this.dummy.rotation.set(0, p.a ?? 0, 0)
      this.dummy.scale.set(p.w, p.h, p.d)
      this.dummy.updateMatrix()
      mesh.setMatrixAt(i, this.dummy.matrix)
      mesh.setColorAt(i, p.color)
    }
    mesh.computeBoundingSphere()
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  private build(city: CityDescription) {
    const layout = cityLayout(this.geography, city, this.rivers),
      palette = PALETTES[city.style]
    const group = new THREE.Group()
    const parts: Record<keyof CityScenery['geometries'], Piece[]> = {
      box: [],
      hip: [],
      gable: [],
      dome: [],
      cone: [],
      tree: [],
    }
    const trim: Piece[] = []
    const ground: number[] = [],
      groundColors: number[] = []
    const paving = new THREE.Color(palette.paving)
    const face = (points: CityPoint[], color: THREE.Color, lift = 0.06) => {
      for (let i = 1; i < points.length - 1; i++)
        for (const p of [points[0], points[i], points[i + 1]]) {
          ground.push(p.x, this.height(p.x, p.z) + lift, p.z)
          groundColors.push(color.r, color.g, color.b)
        }
    }
    const stroke = (points: CityPoint[], width: number, color: THREE.Color) => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          length = Math.hypot(b.x - a.x, b.z - a.z)
        const dx = ((-(b.z - a.z) / length) * width) / 2,
          dz = (((b.x - a.x) / length) * width) / 2
        face(
          [
            { x: a.x + dx, z: a.z + dz },
            { x: b.x + dx, z: b.z + dz },
            { x: b.x - dx, z: b.z - dz },
            { x: a.x - dx, z: a.z - dz },
          ],
          color,
        )
      }
    }
    face(layout.square, paving)
    for (const street of layout.streets) stroke(street.points, street.width, paving)
    for (const b of layout.buildings) {
      const floor = this.height(b.x, b.z),
        corners = rectangle(b.x, b.z, b.width + 0.18, b.depth + 0.18, b.angle)
      const floors = corners.map((p) => this.height(p.x, p.z)),
        high = Math.max(...floors)
      if (high - Math.min(...floors) > 1.4) continue
      const base = high + 0.04
      const wall = new THREE.Color(palette.walls).multiplyScalar(0.86 + b.tone * 0.22)
      const roof = new THREE.Color(palette.roof).multiplyScalar(0.8 + b.tone * 0.35)
      trim.push({
        x: b.x,
        y: floor + (base - floor) / 2,
        z: b.z,
        w: b.width + 0.1,
        h: Math.max(0.12, base - floor),
        d: b.depth + 0.1,
        a: b.angle,
        color: new THREE.Color(palette.trim),
      })
      parts.box.push({
        x: b.x,
        y: base + b.height / 2,
        z: b.z,
        w: b.width,
        h: b.height,
        d: b.depth,
        a: b.angle,
        color: wall,
      })
      if (b.roof === 'flat') {
        trim.push({
          x: b.x,
          y: base + b.height + 0.07,
          z: b.z,
          w: b.width + 0.09,
          h: 0.14,
          d: b.depth + 0.09,
          a: b.angle,
          color: roof,
        })
      } else {
        const h = b.roof === 'gable' ? 0.55 : 0.65
        parts[b.roof].push({
          x: b.x,
          y: base + b.height + h / 2,
          z: b.z,
          w: b.width + 0.18,
          h,
          d: b.depth + 0.18,
          a: b.angle,
          color: roof,
        })
        if (b.tone > 0.55)
          trim.push({
            x: b.x + 0.2,
            y: base + b.height + 0.5,
            z: b.z,
            w: 0.16,
            h: 0.5,
            d: 0.19,
            a: b.angle,
            color: wall,
          })
      }
    }
    for (const bridge of layout.bridges) {
      const { a, b, width } = bridge,
        length = Math.hypot(b.x - a.x, b.z - a.z),
        angle = -Math.atan2(b.z - a.z, b.x - a.x)
      const x = (a.x + b.x) / 2,
        z = (a.z + b.z) / 2,
        y = Math.max(this.height(a.x, a.z), this.height(b.x, b.z)) + 0.25
      const stone = new THREE.Color(palette.trim)
      trim.push({ x, y, z, w: length, h: 0.25, d: width, a: angle, color: stone })
      for (const side of [-1, 1]) {
        const dx = (-(b.z - a.z) / length) * width * 0.47 * side,
          dz = ((b.x - a.x) / length) * width * 0.47 * side
        trim.push({ x: x + dx, y: y + 0.3, z: z + dz, w: length, h: 0.38, d: 0.08, a: angle, color: stone })
      }
    }
    const p = layout.plaza,
      floor = this.height(p.x, p.z),
      stone = new THREE.Color(palette.walls),
      roof = new THREE.Color(palette.roof)
    if (layout.square.length) {
      const civic = (u: number, v: number) => ({
        x: p.x + u * Math.cos(layout.angle) + v * Math.sin(layout.angle),
        z: p.z - u * Math.sin(layout.angle) + v * Math.cos(layout.angle),
      })
      const hallPoint = civic(0, -1.9),
        towerPoint = civic(1.05, -1.9)
      // Civic centerpiece: a public hall, courtyard monument, and a city-specific skyline.
      const hall = {
        x: hallPoint.x,
        y: floor + 0.85,
        z: hallPoint.z,
        w: 2.9,
        h: 1.7,
        d: 0.9,
        a: layout.angle,
        color: stone,
      }
      parts.box.push(hall)
      parts.gable.push({ ...hall, y: floor + 2, h: 0.6, w: 3.1, d: 1.1, color: roof })
      const towerX = towerPoint.x,
        towerZ = towerPoint.z
      const towerHeight = city.capital ? 5.4 : 4.2
      parts.box.push({
        x: towerX,
        y: floor + towerHeight / 2,
        z: towerZ,
        w: 0.72,
        h: towerHeight,
        d: 0.72,
        a: layout.angle,
        color: stone,
      })
      if (layout.landmark === 'dome')
        parts.dome.push({
          x: towerX,
          y: floor + towerHeight,
          z: towerZ,
          w: 1.2,
          h: 1.2,
          d: 1.2,
          color: new THREE.Color('#728f87'),
        })
      else if (layout.landmark === 'belfry')
        parts.cone.push({
          x: towerX,
          y: floor + towerHeight + 0.6,
          z: towerZ,
          w: 1,
          h: 1.2,
          d: 1,
          color: roof,
        })
      else {
        for (let i = 0; i < 4; i++)
          trim.push({
            x: towerX + (i % 2 ? 0.32 : -0.32),
            y: floor + towerHeight + 0.1,
            z: towerZ + (i > 1 ? 0.32 : -0.32),
            w: 0.24,
            h: 0.35,
            d: 0.24,
            color: stone,
          })
      }
      // Market canopies and an open central basin retain the square as negative space.
      for (let i = 0; i < 4; i++) {
        const market = civic(-1.5 + i * 0.9, 1.8),
          x = market.x,
          z = market.z,
          y = this.height(x, z)
        trim.push({
          x,
          y: y + 0.3,
          z,
          w: 0.58,
          h: 0.6,
          d: 0.08,
          a: layout.angle,
          color: new THREE.Color(palette.trim),
        })
        trim.push({
          x,
          y: y + 0.65,
          z,
          w: 0.8,
          h: 0.09,
          d: 0.65,
          a: layout.angle,
          color: new THREE.Color(i % 2 ? '#b88b63' : '#d9cdb1'),
        })
      }
      trim.push({ x: p.x, y: floor + 0.1, z: p.z + 0.25, w: 0.65, h: 0.2, d: 0.65, color: stone })
      trim.push({
        x: p.x,
        y: floor + 0.21,
        z: p.z + 0.25,
        w: 0.45,
        h: 0.025,
        d: 0.45,
        color: new THREE.Color('#537f80'),
      })
    }
    for (const p of layout.trees) {
      const y = this.height(p.x, p.z)
      trim.push({ x: p.x, y: y + 0.45, z: p.z, w: 0.13, h: 0.9, d: 0.13, color: new THREE.Color('#66533c') })
      parts.tree.push({
        x: p.x,
        y: y + 1,
        z: p.z,
        w: 0.85,
        h: 1.2,
        d: 0.85,
        color: new THREE.Color('#667b48'),
      })
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(ground, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(groundColors, 3))
    geometry.computeVertexNormals()
    const groundMesh = new THREE.Mesh(geometry, this.groundMaterial)
    groundMesh.receiveShadow = true
    groundMesh.material.side = THREE.DoubleSide
    group.add(groundMesh)
    for (const shape of Object.keys(parts) as (keyof typeof parts)[])
      this.addInstances(group, shape, parts[shape], shape === 'box' ? this.wallMaterial : this.roofMaterial)
    this.addInstances(group, 'box', trim, this.roofMaterial)
    return group
  }

  private release(group: THREE.Group) {
    group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose()
      else if (object instanceof THREE.Mesh) object.geometry.dispose()
    })
    group.removeFromParent()
  }
  dispose() {
    this.release(this.overview)
    for (const entry of this.cache.values()) this.release(entry.group)
    this.cache.clear()
    Object.values(this.geometries).forEach((g) => g.dispose())
    this.wallMaterial.dispose()
    this.roofMaterial.dispose()
    this.groundMaterial.dispose()
    this.group.removeFromParent()
  }
}

function rectangle(x: number, z: number, w: number, d: number, a: number): CityPoint[] {
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([u, v]) => ({ x: x + u * Math.cos(a) + v * Math.sin(a), z: z - u * Math.sin(a) + v * Math.cos(a) }))
}
function gableGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0, 0.5, 0.5, -0.5,
        -0.5, 0.5, -0.5, -0.5, -0.5, 0, 0.5, -0.5, -0.5, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0.5, -0.5,
        -0.5, 0.5, -0.5, 0.5, 0, 0.5, 0.5, 0.5, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5,
      ],
      3,
    ),
  )
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i += 3) {
    const x = positions.getX(i + 1),
      y = positions.getY(i + 1),
      z = positions.getZ(i + 1)
    positions.setXYZ(i + 1, positions.getX(i + 2), positions.getY(i + 2), positions.getZ(i + 2))
    positions.setXYZ(i + 2, x, y, z)
  }
  geometry.computeVertexNormals()
  return geometry
}
function facadeMaterial() {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.95 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vFacade;\nvarying vec3 vFaceNormal;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvec3 dimensions=vec3(1.0);\n#ifdef USE_INSTANCING\ndimensions=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));\n#endif\nvFacade=(position+0.5)*dimensions; vFaceNormal=normal;',
    )
    shader.fragmentShader = 'varying vec3 vFacade;\nvarying vec3 vFaceNormal;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float horizontal = abs(vFaceNormal.x) > 0.5 ? vFacade.z : vFacade.x;
      vec2 pane = fract(vec2(horizontal, vFacade.y) * vec2(2.2, 1.8));
      vec2 edge = fwidth(pane) * 0.7;
      float windowMask = smoothstep(0.31-edge.x,0.31+edge.x,pane.x) * (1.0-smoothstep(0.65-edge.x,0.65+edge.x,pane.x)) * smoothstep(0.29-edge.y,0.29+edge.y,pane.y) * (1.0-smoothstep(0.69-edge.y,0.69+edge.y,pane.y));
      float side = 1.0-step(0.5,abs(vFaceNormal.y));
      diffuseColor.rgb *= 1.0-windowMask*side*0.73;
      diffuseColor.rgb *= 0.86+0.14*smoothstep(0.0,0.25,vFacade.y);
    `,
    )
  }
  material.customProgramCacheKey = () => 'city-facades-v1'
  return material
}
