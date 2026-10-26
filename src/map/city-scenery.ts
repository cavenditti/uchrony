import { StringTable } from './string-table'
import * as THREE from 'three'
import type { World } from '../sim/types'
import { settlementPlaces } from './settlement-scenery'
import { describeCity, cityLayout, type CityDescription, type CityPoint } from './city-layout'
import type { RiverCurve } from './rivers'
import { TerrainPicker } from './relief-picking'
import { architectureMaterial, townGroundMaterial, windMaterial } from './city-materials'
import { illuminated } from './illuminated-palette'
import { reliefRandom } from './relief-field'
import { streetRibbon } from './street-geometry'

const PALETTES = illuminated.cities
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
  private heights = new StringTable<number>()
  private ranges = new StringTable<[number, number]>()
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
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    ring: new THREE.TorusGeometry(0.5, 0.08, 6, 20).rotateX(Math.PI / 2),
    flag: new THREE.PlaneGeometry(1, 1, 8, 2),
  }
  readonly time = { value: 0 }
  private wallMaterial = architectureMaterial('wall')
  private roofMaterial = architectureMaterial('roof')
  private groundMaterial = townGroundMaterial()
  private detailMaterial = new THREE.MeshStandardMaterial({ roughness: 0.93 })
  private foliageMaterial = windMaterial(this.time)
  private clothMaterial = windMaterial(this.time, true)
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
    const places = settlementPlaces(world)
    const cities = places.map((s) => {
      const city = describeCity(world, s),
        civic = s.civic ?? true
      return { ...city, civic, key: `${city.key}:${civic}` }
    })
    if (
      cities.length === this.descriptions.length &&
      cities.every((c, i) => c.key === this.descriptions[i].key)
    )
      return
    this.viewKey = ''
    this.descriptions = cities
    this.heights.clear()
    this.ranges.clear()
    this.hidden.clear()
    const keys = new StringTable<true>()
    for (const city of cities) keys.set(city.key, true)
    for (const [id, entry] of this.cache)
      if (!keys.has(entry.key)) {
        this.release(entry.group)
        this.cache.delete(id)
      }
    this.release(this.overview)
    this.overview = new THREE.Group()
    // Overview samples the same physical building form as detail. Huge generic
    // houses cannot suddenly replace a neighboring district at the cache edge.
    const native = new Map(
      cities
        .filter((c) => c.form)
        .map((c) => {
          const all = cityLayout(this.geography, c, this.rivers).buildings
          const count = Math.min(32, all.length)
          return [
            c.id,
            Array.from({ length: count }, (_, i) => all[Math.floor((i * all.length) / count)]),
          ] as const
        }),
    )
    const countFor = (c: CityDescription) =>
      native.get(c.id)?.length ??
      (c.capacity === undefined
        ? c.kind === 'city'
          ? 7
          : c.kind === 'town'
            ? 4
            : 2
        : Math.max(1, Math.min(12, Math.ceil(Math.sqrt(c.capacity / 150)))))
    const total = cities.reduce((n, c) => n + countFor(c), 0)
    // Write straight into GPU instance buffers. Materializing hundreds of thousands
    // of temporary Piece/Color records also required one large JS array allocation.
    const walls = new THREE.InstancedMesh(this.geometries.box, this.wallMaterial, total)
    const roofs = new THREE.InstancedMesh(this.geometries.hip, this.roofMaterial, total)
    const colors = PALETTES.map((p) => ({ walls: new THREE.Color(p.walls), roof: new THREE.Color(p.roof) }))
    let index = 0
    const put = (
      mesh: THREE.InstancedMesh,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: THREE.Color,
      angle = 0,
    ) => {
      this.dummy.position.set(x, y, z)
      this.dummy.rotation.set(0, angle, 0)
      this.dummy.scale.set(w, h, d)
      this.dummy.updateMatrix()
      mesh.setMatrixAt(index, this.dummy.matrix)
      mesh.setColorAt(index, color)
    }
    for (const c of cities) {
      this.heights.set(c.id, this.height(c.x, c.z))
      const first = index,
        count = countFor(c),
        palette = colors[c.style]
      for (let j = 0; j < count; j++) {
        const physical = native.get(c.id)?.[j]
        if (physical) {
          const b = physical,
            floor = this.height(b.x, b.z),
            roofHeight = Math.min(b.width, b.depth) * (b.roof === 'flat' ? 0.08 : 0.3)
          put(walls, b.x, floor + b.height / 2, b.z, b.width, b.height, b.depth, palette.walls, b.angle)
          put(
            roofs,
            b.x,
            floor + b.height + roofHeight / 2,
            b.z,
            b.width * 1.04,
            roofHeight,
            b.depth * 1.04,
            palette.roof,
            b.angle,
          )
          index++
          continue
        }

        const a = j * 2.4 + (c.capacity === undefined ? 0 : reliefRandom(c.seed + j) * Math.PI * 2),
          d = c.capacity === undefined ? Math.sqrt(j) * 1.25 : Math.sqrt((j + 0.3) / count) * c.radius * 0.75,
          x = c.x + Math.cos(a) * d,
          z = c.z + Math.sin(a) * d
        const floor = this.height(x, z)
        const form = c.form,
          workshop = form && (form.district === 'industrial' || form.district === 'mining') && j % 3 === 0
        const span = form ? form.parcel.size / form.metersPerMapUnit : 0
        const width = form ? span * Math.sqrt(form.coverage / count) : 1
        const floors = form ? form.floorAreaRatio / Math.max(0.01, form.coverage) : 0
        const h = form
          ? ((workshop ? 6 : 3 * floors * (1.25 - (j / count) * 0.5)) / form.metersPerMapUnit) * 2
          : j === 0 && c.civic
            ? 3.7
            : c.capacity === undefined
              ? 1.5
              : 0.6 + reliefRandom(c.seed + j + 91) * 0.8
        const roofHeight = form ? Math.min(width * 0.3, h * 0.2) : 0.8
        put(walls, x, floor + h / 2, z, width, h, workshop ? width * 1.5 : width, palette.walls)
        put(
          roofs,
          x,
          floor + h + roofHeight / 2,
          z,
          width * 1.08,
          roofHeight,
          width * (workshop ? 1.6 : 1.08),
          palette.roof,
        )
        index++
      }
      this.ranges.set(c.id, [first, count])
    }
    for (const mesh of [walls, roofs]) {
      mesh.computeBoundingSphere()
      mesh.castShadow = true
      mesh.receiveShadow = true
      if (total) this.overview.add(mesh)
      else mesh.dispose()
    }
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
    for (const { city } of visible.slice(0, visible.some(({ city }) => city.form) ? 16 : DETAIL_LIMIT)) {
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
    while (this.cache.size > (this.descriptions.some((c) => c.form) ? 24 : CACHE_LIMIT)) {
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
    mesh.castShadow = shape !== 'flag'
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
      cylinder: [],
      ring: [],
      flag: [],
    }
    const trim: Piece[] = []
    const ground: number[] = [],
      groundColors: number[] = [],
      groundKinds: number[] = []
    const paving = new THREE.Color(palette.paving)
    const face = (points: CityPoint[], color: THREE.Color, kind = 0, lift = 0.06) => {
      for (let i = 1; i < points.length - 1; i++)
        for (const p of [points[0], points[i], points[i + 1]]) {
          ground.push(p.x, this.height(p.x, p.z) + lift, p.z)
          groundColors.push(color.r, color.g, color.b)
          groundKinds.push(kind)
        }
    }
    const stroke = (points: CityPoint[], width: number, color: THREE.Color, kind = 0) => {
      for (const quad of streetRibbon(points, width)) face(quad, color, kind, kind === 0 ? 0.065 : 0.06)
    }
    // Slightly separate surfaces at junctions instead of coplanar z-fighting.
    face(layout.square, paving, 0, 0.075)
    for (const street of layout.streets)
      stroke(
        street.points,
        street.width,
        street.width < 0.7 ? paving.clone().multiplyScalar(0.87) : paving,
        street.width < 0.7 ? 1 : 0,
      )
    for (const b of layout.buildings) {
      const floor = this.height(b.x, b.z),
        footing = city.form ? 0.5 / city.form.metersPerMapUnit : 0.09,
        lift = city.form ? 0.2 / city.form.metersPerMapUnit : 0.04,
        corners = rectangle(b.x, b.z, b.width + footing * 2, b.depth + footing * 2, b.angle)
      const floors = corners.map((p) => this.height(p.x, p.z)),
        high = Math.max(...floors)
      if (high - Math.min(...floors) > 1.4) continue
      const base = high + lift
      const wall = new THREE.Color(palette.walls).multiplyScalar(0.94 + b.tone * 0.1)
      const roof = new THREE.Color(palette.roof).multiplyScalar(0.88 + b.tone * 0.22)
      trim.push({
        x: b.x,
        y: floor + (base - floor) / 2,
        z: b.z,
        w: b.width + footing,
        h: Math.max(lift, base - floor),
        d: b.depth + footing,
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
      if (city.form) {
        const cap = Math.min(b.width, b.depth) * 0.08
        const roofHeight = b.roof === 'flat' ? cap : Math.min(b.width, b.depth) * 0.3
        parts[b.roof === 'flat' ? 'box' : b.roof].push({
          x: b.x,
          y: base + b.height + roofHeight / 2,
          z: b.z,
          w: b.width * 1.04,
          h: roofHeight,
          d: b.depth * 1.04,
          a: b.angle,
          color: roof,
        })
        const bands = Math.max(1, Math.min(5, Math.round(b.storeys ?? 2)))
        const facade = (u: number, v: number) => ({
          x: b.x + u * Math.cos(b.angle) + v * Math.sin(b.angle),
          z: b.z - u * Math.sin(b.angle) + v * Math.cos(b.angle),
        })
        const columns = b.use === 'workshop' ? 3 : 2 + Number(b.width > b.depth * 1.2)
        for (const side of [-1, 1])
          for (let row = 0; row < bands; row++)
            for (let column = 0; column < columns; column++) {
              const p = facade(((column + 0.5) / columns - 0.5) * b.width * 0.78, side * b.depth * 0.505)
              trim.push({
                ...p,
                y: base + ((row + 0.58) / bands) * b.height,
                w: b.width * 0.105,
                h: Math.min((b.height / bands) * 0.3, b.width * 0.12),
                d: b.depth * 0.018,
                a: b.angle,
                color: new THREE.Color(palette.trim).multiplyScalar(0.55),
              })
            }
        const door = facade(-b.width * 0.12, b.depth * 0.51)
        trim.push({
          ...door,
          y: base + (b.height / bands) * 0.22,
          w: b.width * 0.14,
          h: (b.height / bands) * 0.44,
          d: b.depth * 0.025,
          a: b.angle,
          color: new THREE.Color(palette.trim).multiplyScalar(0.55),
        })
        continue
      }
      const offset = (u: number, v: number) => ({
        x: b.x + u * Math.cos(b.angle) + v * Math.sin(b.angle),
        z: b.z - u * Math.sin(b.angle) + v * Math.cos(b.angle),
      })
      // Cornices and entrance steps ground the facade and give the roof a real edge.
      trim.push({
        x: b.x,
        y: base + b.height - 0.04,
        z: b.z,
        w: b.width + 0.08,
        h: 0.09,
        d: b.depth + 0.08,
        a: b.angle,
        color: wall.clone().multiplyScalar(1.08),
      })
      const step = offset(0, b.depth / 2 + 0.08)
      trim.push({
        ...step,
        y: base + 0.05,
        w: 0.32,
        h: 0.1,
        d: 0.24,
        a: b.angle,
        color: new THREE.Color(palette.paving),
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
        for (const side of [-1, 1]) {
          const p = offset(side * (b.width / 2 - 0.04), 0)
          trim.push({
            ...p,
            y: base + b.height + 0.22,
            w: 0.08,
            h: 0.24,
            d: b.depth,
            a: b.angle,
            color: wall,
          })
        }
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
        if (b.roof === 'gable') {
          trim.push({
            x: b.x,
            y: base + b.height + h + 0.02,
            z: b.z,
            w: 0.09,
            h: 0.08,
            d: b.depth + 0.2,
            a: b.angle,
            color: roof.clone().multiplyScalar(1.12),
          })
          if (b.tone > 0.35) {
            const p = offset(b.width * 0.24, 0.08)
            parts.box.push({
              ...p,
              y: base + b.height + 0.25,
              w: 0.29,
              h: 0.34,
              d: 0.35,
              a: b.angle + Math.PI / 2,
              color: wall,
            })
            parts.gable.push({
              ...p,
              y: base + b.height + 0.48,
              w: 0.37,
              h: 0.22,
              d: 0.42,
              a: b.angle + Math.PI / 2,
              color: roof,
            })
          }
        }
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
    if (layout.square.length && city.civic !== false && city.form) {
      const plaza = layout.plaza,
        base = this.height(plaza.x, plaza.z)
      const span = Math.min(...layout.square.map((p) => Math.hypot(p.x - plaza.x, p.z - plaza.z)))
      const width = Math.min(span * 0.62, city.radius * 0.2)
      parts.cylinder.push({
        x: plaza.x,
        y: base + width * 0.07,
        z: plaza.z,
        w: width,
        h: width * 0.14,
        d: width,
        color: new THREE.Color(palette.walls),
      })
      parts.cylinder.push({
        x: plaza.x,
        y: base + width * 0.15,
        z: plaza.z,
        w: width * 0.73,
        h: width * 0.06,
        d: width * 0.73,
        color: new THREE.Color(illuminated.river),
      })
      parts.cylinder.push({
        x: plaza.x,
        y: base + width * 0.5,
        z: plaza.z,
        w: width * 0.12,
        h: width * 0.75,
        d: width * 0.12,
        color: new THREE.Color(palette.walls),
      })
    }
    if (layout.square.length && city.civic !== false && !city.form) {
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
      const portico = civic(0, -1.25)
      trim.push({ ...portico, y: floor + 1.38, w: 2.55, h: 0.14, d: 0.48, a: layout.angle, color: stone })
      for (let i = 0; i < 5; i++) {
        const column = civic(-1.1 + i * 0.55, -1.13)
        parts.cylinder.push({ ...column, y: floor + 0.65, w: 0.12, h: 1.3, d: 0.12, color: stone })
      }
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
      for (const level of [towerHeight * 0.55, towerHeight - 0.25])
        trim.push({
          x: towerX,
          y: floor + level,
          z: towerZ,
          w: 0.85,
          h: 0.13,
          d: 0.85,
          a: layout.angle,
          color: stone.clone().multiplyScalar(0.86),
        })
      if (layout.landmark === 'dome')
        parts.dome.push({
          x: towerX,
          y: floor + towerHeight,
          z: towerZ,
          w: 1.2,
          h: 1.2,
          d: 1.2,
          color: new THREE.Color('#398f96'),
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
      // One restrained gold finial marks the civic silhouette, not every roof.
      if (layout.landmark !== 'keep')
        parts.cylinder.push({
          x: towerX,
          y: floor + towerHeight + (layout.landmark === 'dome' ? 0.78 : 1.3),
          z: towerZ,
          w: 0.075,
          h: 0.35,
          d: 0.075,
          color: new THREE.Color(illuminated.gold),
        })
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
          color: new THREE.Color(i % 2 ? palette.roof : '#ead7a7'),
        })
        for (let j = 0; j < 2; j++) {
          const crate = civic(-1.5 + i * 0.9 + (j - 0.5) * 0.28, 1.8)
          trim.push({
            ...crate,
            y: y + 0.35,
            w: 0.22,
            h: 0.18,
            d: 0.24,
            a: layout.angle,
            color: new THREE.Color(j ? '#8e9a57' : '#ba7650'),
          })
        }
      }
      parts.ring.push({ x: p.x, y: floor + 0.22, z: p.z + 0.25, w: 0.9, h: 1, d: 0.9, color: stone })
      parts.cylinder.push({
        x: p.x,
        y: floor + 0.21,
        z: p.z + 0.25,
        w: 0.78,
        h: 0.025,
        d: 0.78,
        color: new THREE.Color(illuminated.river),
      })
      parts.cylinder.push({ x: p.x, y: floor + 0.5, z: p.z + 0.25, w: 0.13, h: 0.65, d: 0.13, color: stone })
      for (const side of [-1, 1]) {
        const flag = civic(side * 2.4, 0.5),
          y = this.height(flag.x, flag.z)
        parts.cylinder.push({
          ...flag,
          y: y + 1.1,
          w: 0.055,
          h: 2.2,
          d: 0.055,
          color: new THREE.Color('#7e6e51'),
        })
        parts.flag.push({
          x: flag.x + 0.39,
          y: y + 1.88,
          z: flag.z,
          w: 0.78,
          h: 0.46,
          d: 1,
          color: new THREE.Color(palette.roof),
        })
      }
    }
    for (const garden of layout.gardens) {
      const corners = rectangle(garden.x, garden.z, garden.width, garden.depth, garden.angle)
      const heights = corners.map((p) => this.height(p.x, p.z))
      if (Math.max(...heights) - Math.min(...heights) > 0.6) continue
      face(corners, new THREE.Color('#7f9a70'), 2, 0.08)
      for (let j = 0; j < 3; j++) {
        const v = (j - 1) * garden.depth * 0.25,
          x = garden.x + v * Math.sin(garden.angle),
          z = garden.z + v * Math.cos(garden.angle)
        trim.push({
          x,
          y: this.height(x, z) + 0.12,
          z,
          w: garden.width * 0.8,
          h: 0.18,
          d: 0.13,
          a: garden.angle,
          color: new THREE.Color(j % 2 ? '#a0b27e' : '#467b58'),
        })
      }
      // A low boundary wall defines the planted parcel without closing the street.
      for (const side of [-1, 1]) {
        const u = (side * garden.width) / 2,
          x = garden.x + u * Math.cos(garden.angle),
          z = garden.z - u * Math.sin(garden.angle)
        trim.push({
          x,
          y: this.height(x, z) + 0.12,
          z,
          w: 0.07,
          h: 0.24,
          d: garden.depth,
          a: garden.angle,
          color: new THREE.Color(palette.trim),
        })
      }
    }
    const planted = layout.trees.filter(
      (p) =>
        !layout.gardens.some(
          (g) => Math.hypot(g.x - p.x, g.z - p.z) < Math.hypot(g.width, g.depth) / 2 + 0.4,
        ),
    )
    for (const p of planted) {
      const y = this.height(p.x, p.z)
      if (city.form) {
        const unit = 1 / city.form.metersPerMapUnit
        trim.push({
          x: p.x,
          y: y + 12 * unit,
          z: p.z,
          w: 1.3 * unit,
          h: 24 * unit,
          d: 1.3 * unit,
          color: new THREE.Color('#66533c'),
        })
        parts.tree.push({
          x: p.x,
          y: y + 28 * unit,
          z: p.z,
          w: 28 * unit,
          h: 32 * unit,
          d: 28 * unit,
          color: new THREE.Color(illuminated.foliage),
        })
        continue
      }
      const slender = Math.sin(p.x * 12.9 + p.z * 7.8) > 0.25
      trim.push({ x: p.x, y: y + 0.45, z: p.z, w: 0.13, h: 0.9, d: 0.13, color: new THREE.Color('#66533c') })
      for (let j = 0; j < 3; j++)
        parts.tree.push({
          x: p.x + (slender ? 0 : Math.cos(j * 2.4) * 0.22),
          y: y + (slender ? 1.15 + j * 0.26 : 0.95 + j * 0.13),
          z: p.z + (slender ? 0 : Math.sin(j * 2.4) * 0.22),
          w: slender ? 0.47 - j * 0.08 : 0.78,
          h: slender ? 1.3 : 0.95,
          d: slender ? 0.47 - j * 0.08 : 0.78,
          color: new THREE.Color(illuminated.foliage).multiplyScalar(0.86 + j * 0.12),
        })
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(ground, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(groundColors, 3))
    geometry.setAttribute('surfaceKind', new THREE.Float32BufferAttribute(groundKinds, 1))
    geometry.computeVertexNormals()
    const groundMesh = new THREE.Mesh(geometry, this.groundMaterial)
    groundMesh.receiveShadow = true
    groundMesh.material.side = THREE.DoubleSide
    group.add(groundMesh)
    for (const shape of Object.keys(parts) as (keyof typeof parts)[])
      this.addInstances(
        group,
        shape,
        parts[shape],
        shape === 'box'
          ? this.wallMaterial
          : shape === 'tree'
            ? this.foliageMaterial
            : shape === 'flag'
              ? this.clothMaterial
              : shape === 'cylinder' || shape === 'ring'
                ? this.detailMaterial
                : this.roofMaterial,
      )
    this.addInstances(group, 'box', trim, this.detailMaterial)
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
    this.detailMaterial.dispose()
    this.foliageMaterial.dispose()
    this.clothMaterial.dispose()
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
