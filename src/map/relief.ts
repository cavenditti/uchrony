import { spatialState } from '../sim/spatial'
import * as THREE from 'three'
import { HEX } from '../sim/hex'
import { type World, type Layer } from '../sim/types'
import { type AtlasCache, drawAtlas } from './renderer'
import { OverlayUpdates } from './render-budget'
import { TerrainPicker } from './relief-picking'
import { terrainHeight, reliefRandom } from './relief-field'

export type ReliefCamera = { w: number; h: number; scale: number; x: number; y: number; tilt: boolean }

/** A retained GPU scene. Geography is rebuilt only for a new world; camera and data are independent. */
export class ReliefMap {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera()
  private terrain: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  private texture: THREE.CanvasTexture
  private oceanTexture: THREE.CanvasTexture
  private overlay: THREE.CanvasTexture
  private overlayCanvas = document.createElement('canvas')
  private textureCanvas = document.createElement('canvas')
  private scenery = new THREE.Group()
  private settlements = new THREE.Group()
  private settlementKey = ''
  private raycaster = new THREE.Raycaster()
  private cameraState: ReliefCamera = { w: 1, h: 1, scale: 1, x: 0, y: 0, tilt: true }
  private overlayUpdates = new OverlayUpdates()
  private picker: TerrainPicker
  private geography: Pick<World, 'cells' | 'width' | 'height'>
  readonly width: number
  readonly height: number

  constructor(
    canvas: HTMLCanvasElement,
    world: World,
    private atlas: AtlasCache,
  ) {
    this.geography = { cells: world.cells, width: world.width, height: world.height }
    this.width = atlas.worldWidth
    this.height = atlas.worldHeight
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    this.renderer.setClearColor('#163e4d')
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    const resolution = Math.min(1.5, 4096 / this.width)
    for (const target of [this.textureCanvas, this.overlayCanvas]) {
      target.width = Math.ceil(this.width * resolution)
      target.height = Math.ceil(this.height * resolution)
    }
    this.texture = new THREE.CanvasTexture(this.textureCanvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.overlay = new THREE.CanvasTexture(this.overlayCanvas)
    this.overlay.colorSpace = THREE.SRGBColorSpace
    this.overlay.generateMipmaps = false
    this.overlay.minFilter = THREE.LinearFilter
    const segmentsX = Math.min(768, world.width * 3)
    const segmentsY = Math.min(496, world.height * 3)
    const geometry = new THREE.PlaneGeometry(this.width, this.height, segmentsX, segmentsY)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(this.width / 2, 0, this.height / 2)
    const positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      positions.setY(i, terrainHeight(world, positions.getX(i), positions.getZ(i)))
    }
    geometry.computeVertexNormals()
    this.picker = new TerrainPicker(geometry)
    const material = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.94,
      metalness: 0,
      transparent: true,
      alphaTest: 0.3,
    })
    this.terrain = new THREE.Mesh(geometry, material)
    this.scene.add(this.terrain)
    this.oceanTexture = new THREE.CanvasTexture(atlas.ocean)
    this.oceanTexture.colorSpace = THREE.SRGBColorSpace
    const oceanGeometry = new THREE.PlaneGeometry(this.width, this.height)
    oceanGeometry.rotateX(-Math.PI / 2)
    oceanGeometry.translate(this.width / 2, -0.1, this.height / 2)
    const ocean = new THREE.Mesh(
      oceanGeometry,
      new THREE.MeshBasicMaterial({ map: this.oceanTexture, toneMapped: false }),
    )
    this.scene.add(ocean)
    const overlayMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: this.overlay,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    )
    overlayMesh.renderOrder = 2
    this.scene.add(overlayMesh)
    this.scene.add(new THREE.HemisphereLight('#dceaf0', '#47503a', 1.35))
    const sun = new THREE.DirectionalLight('#fff0c9', 2.2)
    sun.position.set(-700, 1100, -500)
    this.scene.add(sun)
    this.scene.add(this.scenery)
    this.buildScenery(world)
  }

  private buildScenery(world: World) {
    const dummy = new THREE.Object3D(),
      color = new THREE.Color()
    const forests = world.cells.filter((c) => c.terrain === 'forest' && !c.river)
    const stride = Math.max(1, Math.ceil(forests.length / 12000))
    const trees = forests.filter((_, i) => i % stride === 0)
    const geometry = new THREE.ConeGeometry(1, 1, 5)
    geometry.translate(0, 0.5, 0)
    const crowns = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }),
      trees.length * 3,
    )
    let index = 0
    for (const cell of trees)
      for (let j = 0; j < 3; j++) {
        const seed = cell.id * 13 + j * 31,
          r = reliefRandom(seed)
        const x = cell.x + (reliefRandom(seed + 1) - 0.5) * HEX * 1.1
        const z = cell.y + (reliefRandom(seed + 2) - 0.5) * HEX
        dummy.position.set(x, terrainHeight(world, x, z) + 0.2, z)
        dummy.rotation.set(0, r * Math.PI, 0)
        dummy.scale.set(2.3 + r * 1.5, 7 + r * 7, 2.3 + r * 1.5)
        dummy.updateMatrix()
        crowns.setMatrixAt(index, dummy.matrix)
        color.setHSL(0.29 + r * 0.045, 0.22 + r * 0.1, 0.19 + r * 0.09)
        crowns.setColorAt(index++, color)
      }
    crowns.computeBoundingSphere()
    this.scenery.add(crowns)
    this.scenery.add(this.settlements)
    this.updateSettlements(world)
  }

  private updateSettlements(world: World) {
    const sites = spatialState(world).settlements
    const key = sites.map((s) => `${s.id}:${s.kind}:${s.capital}`).join('|')
    if (key === this.settlementKey) return
    this.settlementKey = key
    for (const object of [...this.settlements.children]) {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose()
      }
      this.settlements.remove(object)
    }
    const countFor = (kind: string) => (kind === 'city' ? 12 : kind === 'town' ? 5 : 1)
    const count = sites.reduce((sum, s) => sum + countFor(s.kind), 0)
    if (!count) return
    const buildings = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ded0a8', roughness: 0.95 }),
      count,
    )
    const roofs = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.85, 0.65, 4),
      new THREE.MeshStandardMaterial({ color: '#8e6553', roughness: 1 }),
      count,
    )
    const dummy = new THREE.Object3D()
    let index = 0
    for (const site of sites) {
      const c = world.cells[site.cell]
      for (let j = 0; j < countFor(site.kind); j++) {
        const angle = j * 2.4,
          distance = Math.sqrt(j) * 1.9
        const x = c.x + Math.cos(angle) * distance,
          z = c.y + Math.sin(angle) * distance
        const h =
          j === 0 && site.capital
            ? 12
            : 2.5 + reliefRandom(site.cell * 9 + j) * (site.kind === 'city' ? 6 : 3)
        const floor = terrainHeight(world, x, z)
        dummy.position.set(x, floor + h / 2, z)
        dummy.rotation.set(0, Math.PI / 4, 0)
        dummy.scale.set(2.2, h, 2.2)
        dummy.updateMatrix()
        buildings.setMatrixAt(index, dummy.matrix)
        dummy.position.y = floor + h + 0.5
        dummy.scale.set(2.2, 2.2, 2.2)
        dummy.updateMatrix()
        roofs.setMatrixAt(index++, dummy.matrix)
      }
    }
    buildings.computeBoundingSphere()
    roofs.computeBoundingSphere()
    this.settlements.add(buildings, roofs)
  }

  setCamera(next: ReliefCamera) {
    const previous = this.cameraState
    this.cameraState = next
    if (previous.w !== next.w || previous.h !== next.h) this.renderer.setSize(next.w, next.h, false)
    const aspect = next.w / next.h,
      span = next.h / next.scale
    const angle = next.tilt ? Math.PI * 0.29 : Math.PI / 2
    const target = new THREE.Vector3(
      this.width / 2 - next.x / next.scale,
      0,
      this.height / 2 - next.y / (next.scale * Math.sin(angle)),
    )
    this.camera.left = (-span * aspect) / 2
    this.camera.right = (span * aspect) / 2
    this.camera.top = span / 2
    this.camera.bottom = -span / 2
    this.camera.near = 1
    this.camera.far = 40000
    this.camera.up.set(0, 1, 0)
    this.camera.position
      .copy(target)
      .add(new THREE.Vector3(0, Math.sin(angle) * 12000, Math.cos(angle) * 12000))
    this.camera.lookAt(target)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    this.scenery.visible = next.scale > 0.38
  }

  paint(world: World, layer: Layer, scale: number) {
    this.updateSettlements(world)
    const ctx = this.textureCanvas.getContext('2d')!
    const ratio = this.textureCanvas.width / this.width
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    drawAtlas(ctx, this.atlas, world, layer, scale, true)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = '#fff'
    ctx.fill(this.atlas.land, 'evenodd')
    ctx.globalCompositeOperation = 'source-over'
    this.texture.needsUpdate = true
  }

  paintOverlay(
    draw: (ctx: CanvasRenderingContext2D) => void,
    time: number,
    revision: object,
    animated: boolean,
  ) {
    if (!this.overlayUpdates.shouldPaint(revision, time, animated)) return
    const ctx = this.overlayCanvas.getContext('2d')!,
      ratio = this.overlayCanvas.width / this.width
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    draw(ctx)
    this.overlay.needsUpdate = true
  }

  project(x: number, y: number, lift = 2) {
    const p = new THREE.Vector3(x, terrainHeight(this.geography, x, y) + lift, y).project(this.camera)
    return { x: ((p.x + 1) * this.cameraState.w) / 2, y: ((1 - p.y) * this.cameraState.h) / 2 }
  }

  locate(x: number, y: number) {
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / this.cameraState.w) * 2 - 1, 1 - (y / this.cameraState.h) * 2),
      this.camera,
    )
    const hit = this.picker.intersect(this.raycaster.ray)
    return hit ? { x: hit.x, y: hit.z } : null
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry)
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material)
      }
    })
    geometries.forEach((g) => g.dispose())
    materials.forEach((m) => m.dispose())
    this.texture.dispose()
    this.oceanTexture.dispose()
    this.overlay.dispose()
    this.renderer.dispose()
    // Safari may keep detached canvas backing stores alive until explicitly released.
    this.textureCanvas.width = this.textureCanvas.height = 1
    this.overlayCanvas.width = this.overlayCanvas.height = 1
  }
}
