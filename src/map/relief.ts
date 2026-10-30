import { spatialState } from '../sim/spatial'
import { CityScenery } from './city-scenery'
import { describeCity } from './city-layout'
import * as THREE from 'three'
import { type World, type Layer } from '../sim/types'
import type { ResourceMapData } from './natural-resources'
import { type AtlasCache, drawAtlas, drawAtlasLinework } from './renderer'
import { OverlayUpdates, resizeCanvas } from './render-budget'
import { overlayWindow, TerrainCoverage, type OverlayWindow } from './overlay-window'
import { TerrainPicker } from './relief-picking'
import { terrainHeight, reliefRandom } from './relief-field'
import { terrainMaterial, oceanMaterial } from './landscape-material'
import { forestSites } from './forest-sites'
import { riverSurface } from './river-surface'
import { SceneryMotion } from './scenery-motion'
import { windMaterial } from './city-materials'
import { illuminated } from './illuminated-palette'
import { ActivityScenery } from './activity-scenery'
import { activityTexture } from './activity-material'
import { economicLandscape } from '../sim/economic-landscape'
import { drawGroundRoads } from './ground-roads'
import { renderedLand } from './land-surface'
import { sceneryModel } from './scenery-models'

export type ReliefCamera = { w: number; h: number; scale: number; x: number; y: number; tilt: boolean }

/** A retained GPU scene. Geography is rebuilt only for a new world; camera and data are independent. */
export class ReliefMap {
  private rivers: ReturnType<typeof riverSurface>
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera()
  private terrain: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  private texture: THREE.CanvasTexture
  private oceanTexture: THREE.CanvasTexture
  private overlay: THREE.CanvasTexture
  private overlayMaterial: THREE.MeshBasicMaterial
  private overlayBounds?: OverlayWindow
  private maximumHeight = 0
  private terrainCoverage: TerrainCoverage
  private lineworkWorld: World
  private lineworkLayer: Layer = 'terrain'
  private overlayCanvas = document.createElement('canvas')
  private textureCanvas = document.createElement('canvas')
  private scenery = new THREE.Group()
  private treeScale = { value: 0.16 }
  private motion = new SceneryMotion()
  private pigment = { value: 1 }
  private sun = new THREE.DirectionalLight('#fff0d8', 1.85)
  private cities: CityScenery
  private activities: ActivityScenery
  private activityMap: { value: THREE.Texture }
  private activityWorld?: World
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
    this.lineworkWorld = world
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
    this.renderer.setClearColor('#193354')
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    const resolution = Math.min(1.5, 4096 / this.width)
    this.textureCanvas.width = Math.ceil(this.width * resolution)
    this.textureCanvas.height = Math.ceil(this.height * resolution)
    this.overlayCanvas.width = this.overlayCanvas.height = 1
    this.texture = new THREE.CanvasTexture(this.textureCanvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    this.overlay = this.makeOverlayTexture()
    const segmentsX = Math.min(768, world.width * 3)
    const segmentsY = Math.min(496, world.height * 3)
    const geometry = new THREE.PlaneGeometry(this.width, this.height, segmentsX, segmentsY)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(this.width / 2, 0, this.height / 2)
    const positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      positions.setY(i, terrainHeight(world, positions.getX(i), positions.getZ(i)))
      this.maximumHeight = Math.max(this.maximumHeight, positions.getY(i))
    }
    geometry.computeVertexNormals()
    this.terrainCoverage = new TerrainCoverage(this.width, this.height, segmentsX, segmentsY, (column, row) =>
      positions.getY(row * (segmentsX + 1) + column),
    )
    this.picker = new TerrainPicker(geometry)
    const landscape = world.viewLandscape ?? economicLandscape(world)
    this.activityMap = { value: activityTexture(world, landscape) }
    const material = terrainMaterial(this.texture, this.pigment, {
      texture: this.activityMap,
      size: new THREE.Vector2(this.width, this.height),
      grid: new THREE.Vector2(world.width, world.height),
    })
    this.terrain = new THREE.Mesh(geometry, material)
    this.terrain.receiveShadow = true
    this.scene.add(this.terrain)
    this.oceanTexture = new THREE.CanvasTexture(atlas.ocean)
    this.oceanTexture.colorSpace = THREE.SRGBColorSpace
    const oceanGeometry = new THREE.PlaneGeometry(this.width, this.height)
    oceanGeometry.rotateX(-Math.PI / 2)
    oceanGeometry.translate(this.width / 2, -0.1, this.height / 2)
    const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial(this.oceanTexture, this.motion.time))
    this.scene.add(ocean)
    this.rivers = riverSurface(
      atlas.riverCurves,
      this.picker,
      {
        texture: this.texture,
        ocean: this.oceanTexture,
        width: this.width,
        height: this.height,
      },
      this.motion.time,
    )
    this.scene.add(this.rivers.mesh)
    this.overlayMaterial = new THREE.MeshBasicMaterial({
      map: this.overlay,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    })
    // Texture coordinates address a moving geographic window. Outside it,
    // discard instead of stretching the last row of pixels over the world.
    this.overlayMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
          if (any(lessThan(vMapUv, vec2(0.0))) || any(greaterThan(vMapUv, vec2(1.0)))) discard;
        #endif
        #include <map_fragment>
      `,
      )
    }
    this.overlayMaterial.customProgramCacheKey = () => 'uchrony-windowed-linework-v1'
    const overlayMesh = new THREE.Mesh(geometry, this.overlayMaterial)
    overlayMesh.renderOrder = 2
    this.scene.add(overlayMesh)
    this.scene.add(new THREE.HemisphereLight('#f3ead1', '#647b70', 1.65))
    const sun = this.sun
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.00015
    sun.shadow.normalBias = 0.05
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 2000
    this.scene.add(sun.target)
    sun.position.set(-700, 850, -500)
    this.scene.add(sun)
    this.scene.add(this.scenery)
    this.cities = new CityScenery(world, this.picker, atlas.riverCurves)
    this.scene.add(this.cities.group)
    this.activities = new ActivityScenery(world, this.picker)
    this.scene.add(this.activities.group)
    this.buildScenery(world)
  }

  private buildScenery(world: World) {
    const dummy = new THREE.Object3D(),
      color = new THREE.Color()
    const cityBins = new Map<string, ReturnType<typeof describeCity>[]>()
    for (const site of spatialState(world).settlements) {
      const city = describeCity(world, site),
        key = `${Math.floor(city.x / 50)}:${Math.floor(city.z / 50)}`
      const bin = cityBins.get(key) ?? []
      bin.push(city)
      cityBins.set(key, bin)
    }
    const trees = forestSites(world).filter((tree) => {
      const x = Math.floor(tree.x / 50),
        z = Math.floor(tree.z / 50)
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (const city of cityBins.get(`${x + dx}:${z + dz}`) ?? [])
            if (Math.hypot(tree.x - city.x, tree.z - city.z) < city.radius + 5) return false
      return true
    })
    // Blender trees share the canopy's bounds: round trees become broadleaves
    // and slender ones conifers. The sphere remains if the kit cannot load.
    const kinds = [
      {
        geometry: sceneryModel('broadleaf', canopyGeometry),
        trees: trees.filter((t) => t.variation <= 0.64),
      },
      { geometry: sceneryModel('conifer', canopyGeometry), trees: trees.filter((t) => t.variation > 0.64) },
    ]
    const material = windMaterial(this.motion.time, false, this.treeScale)
    material.vertexColors = kinds[0].geometry.hasAttribute('color')
    for (const { geometry, trees } of kinds) {
      const crowns = new THREE.InstancedMesh(geometry, material, trees.length)
      let index = 0
      for (const { x, z, variation: r } of trees) {
        dummy.position.set(x, this.picker.heightAt(x, z), z)
        dummy.rotation.set((r - 0.5) * 0.18, r * Math.PI, 0)
        const slender = r > 0.64
        dummy.scale.set(
          slender ? 2.1 : 3.1 + r * 2.2,
          slender ? 10 + r * 3 : 4 + r * 5,
          slender ? 2 : 2.7 + r * 2.5,
        )
        dummy.updateMatrix()
        crowns.setMatrixAt(index, dummy.matrix)
        color.setHSL(0.37 + r * 0.06, 0.39 + r * 0.1, 0.18 + r * 0.1)
        crowns.setColorAt(index++, color)
      }
      crowns.computeBoundingSphere()
      this.scenery.add(crowns)
    }
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
    const bounds = overlayWindow(
      this.width,
      this.height,
      next,
      this.maximumHeight,
      this.renderer.getPixelRatio(),
      this.renderer.capabilities.maxTextureSize,
      this.overlayBounds,
      this.terrainCoverage,
    )
    if (bounds !== this.overlayBounds) {
      this.overlayBounds = bounds
      if (this.overlayCanvas.width !== bounds.pixelsWide || this.overlayCanvas.height !== bounds.pixelsHigh) {
        // Reallocate the GPU texture when its dimensions change, releasing the
        // previous storage instead of growing a full-world high-resolution map.
        this.overlay.dispose()
        resizeCanvas(this.overlayCanvas, bounds.pixelsWide, bounds.pixelsHigh)
        this.overlay = this.makeOverlayTexture()
        this.overlayMaterial.map = this.overlay
      }
      this.overlay.repeat.set(this.width / bounds.width, this.height / bounds.height)
      this.overlay.offset.set(
        -bounds.x / bounds.width,
        (bounds.y + bounds.height - this.height) / bounds.height,
      )
      this.overlayUpdates.invalidate()
    }
    this.cities.view(this.camera, next.w, next.h, next.scale)
    this.activities.view(this.camera, next.w, next.h, next.scale)
    this.sun.shadow.intensity = THREE.MathUtils.smoothstep(next.scale, 2.5, 4)
    this.sun.castShadow = this.sun.shadow.intensity > 0
    if (this.sun.castShadow) {
      const extent = Math.min(300, Math.max(35, (next.w / next.scale) * 0.7))
      this.sun.target.position.copy(target)
      this.sun.position.copy(target).add(new THREE.Vector3(-400, 700, -300))
      Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent })
      this.sun.shadow.camera.updateProjectionMatrix()
      this.renderer.shadowMap.needsUpdate = true
    }
  }

  paint(world: World, layer: Layer, scale: number, resources?: ResourceMapData) {
    this.lineworkWorld = world
    this.lineworkLayer = layer
    this.cities.update(world)
    if (this.activityWorld !== world) {
      const landscape = world.viewLandscape ?? economicLandscape(world)
      this.activityMap.value.dispose()
      this.activityMap.value = activityTexture(world, landscape)
      this.activities.update(world, landscape)
      this.activityWorld = world
    }
    this.activities.view(this.camera, this.cameraState.w, this.cameraState.h, scale)
    if (this.sun.castShadow) this.renderer.shadowMap.needsUpdate = true
    this.cities.view(this.camera, this.cameraState.w, this.cameraState.h, scale)
    this.rivers.minimumFlow.value = scale >= 0.7 ? 0 : 12 / Math.max(0.08, scale)
    this.pigment.value = layer === 'terrain' ? 1 : 0
    this.rivers.mesh.material.color.set(layer === 'terrain' ? illuminated.river : '#3d6872')
    const ctx = this.textureCanvas.getContext('2d')!
    const ratio = this.textureCanvas.width / this.width
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    drawAtlas(ctx, this.atlas, world, layer, scale, true, false, false, resources)
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
    const bounds = this.overlayBounds
    if (!bounds || !this.overlayUpdates.shouldPaint(revision, time, animated)) return
    const ctx = this.overlayCanvas.getContext('2d')!,
      sx = this.overlayCanvas.width / bounds.width,
      sy = this.overlayCanvas.height / bounds.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height)
    ctx.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy)
    drawGroundRoads(ctx, this.lineworkWorld, this.cameraState.scale, bounds, this.atlas.land)
    drawAtlasLinework(ctx, this.atlas, this.lineworkWorld, this.lineworkLayer, this.cameraState.scale, true)
    draw(ctx)
    this.overlay.needsUpdate = true
  }

  private makeOverlayTexture() {
    const texture = new THREE.CanvasTexture(this.overlayCanvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    return texture
  }

  project(x: number, y: number, lift = 2) {
    const floor = renderedLand(this.geography, x, y) ? this.picker.heightAt(x, y) : -0.1
    const p = new THREE.Vector3(x, floor + lift, y).project(this.camera)
    return { x: ((p.x + 1) * this.cameraState.w) / 2, y: ((1 - p.y) * this.cameraState.h) / 2 }
  }

  locate(x: number, y: number) {
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / this.cameraState.w) * 2 - 1, 1 - (y / this.cameraState.h) * 2),
      this.camera,
    )
    const hit = this.picker.intersect(this.raycaster.ray, (x, z) => renderedLand(this.geography, x, z))
    if (hit) return { x: hit.x, y: hit.z }
    const ray = this.raycaster.ray,
      t = (-0.1 - ray.origin.y) / ray.direction.y
    const xSea = ray.origin.x + ray.direction.x * t,
      zSea = ray.origin.z + ray.direction.z * t
    return t >= 0 && xSea >= 0 && zSea >= 0 && xSea <= this.width && zSea <= this.height
      ? { x: xSea, y: zSea }
      : null
  }

  pauseMotion() {
    this.motion.advance(0, false)
  }

  render(time = 0, animated = false) {
    this.motion.advance(time, animated)
    this.cities.time.value = this.motion.time.value
    this.activities.animate(this.motion.time.value)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.cities.dispose()
    this.activities.dispose()
    this.activityMap.value.dispose()
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
    this.sun.shadow.map?.dispose()
    this.sun.shadow.mapPass?.dispose()
    this.renderer.dispose()
    // Safari may keep detached canvas backing stores alive until explicitly released.
    this.textureCanvas.width = this.textureCanvas.height = 1
    this.overlayCanvas.width = this.overlayCanvas.height = 1
  }
}

function canopyGeometry() {
  const geometry = new THREE.SphereGeometry(1, 8, 6)
  const canopy = geometry.attributes.position
  for (let i = 0; i < canopy.count; i++) {
    const x = canopy.getX(i),
      y = canopy.getY(i),
      z = canopy.getZ(i)
    const irregularity = 0.88 + reliefRandom(Math.round((x + 2) * 31 + (y + 2) * 71 + (z + 2) * 113)) * 0.24
    canopy.setXYZ(i, x * irregularity, y * irregularity, z * irregularity)
  }
  // Keep continuous crown normals across the non-indexed triangular faces.
  const normals = geometry.attributes.normal
  for (let i = 0; i < canopy.count; i++) {
    const x = canopy.getX(i),
      y = canopy.getY(i),
      z = canopy.getZ(i)
    const length = Math.hypot(x, y, z)
    normals.setXYZ(i, x / length, y / length, z / length)
  }
  return geometry.translate(0, 0.8, 0)
}
