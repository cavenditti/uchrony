import { spatialState } from '../sim/spatial'
import { CityScenery } from './city-scenery'
import { describeCity } from './city-layout'
import * as THREE from 'three'
import { type World, type Layer } from '../sim/types'
import { type AtlasCache, drawAtlas } from './renderer'
import { OverlayUpdates } from './render-budget'
import { TerrainPicker } from './relief-picking'
import { terrainHeight, reliefRandom } from './relief-field'
import { terrainMaterial, oceanMaterial } from './landscape-material'
import { forestSites } from './forest-sites'
import { riverSurface } from './river-surface'
import { SceneryMotion } from './scenery-motion'

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
  private overlayCanvas = document.createElement('canvas')
  private textureCanvas = document.createElement('canvas')
  private scenery = new THREE.Group()
  private treeScale = { value: 1 }
  private motion = new SceneryMotion()
  private sun = new THREE.DirectionalLight('#fff0d8', 2.65)
  private cities: CityScenery
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
    this.renderer.setClearColor('#102c3b')
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
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
    const material = terrainMaterial(this.texture)
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
        width: this.width,
        height: this.height,
      },
      this.motion.time,
    )
    this.scene.add(this.rivers.mesh)
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
    this.scene.add(new THREE.HemisphereLight('#d6e7f0', '#303d25', 1.1))
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
    const geometry = new THREE.IcosahedronGeometry(1, 0)
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
    geometry.translate(0, 0.8, 0)
    const crowns = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ roughness: 1, flatShading: false }),
      trees.length,
    )
    crowns.material.onBeforeCompile = (shader) => {
      shader.uniforms.townTreeScale = this.treeScale
      shader.uniforms.sceneryTime = this.motion.time
      shader.vertexShader = 'uniform float townTreeScale;\nuniform float sceneryTime;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed *= townTreeScale;\ntransformed.x += sin(sceneryTime*1.3+dot(instanceMatrix[3].xz,vec2(0.31,0.17))+position.y)*max(0.0,position.y)*0.025*townTreeScale;',
      )
    }
    crowns.material.customProgramCacheKey = () => 'town-tree-scale-v1'
    let index = 0
    for (const { x, z, variation: r } of trees) {
      dummy.position.set(x, terrainHeight(world, x, z) + 0.2, z)
      dummy.rotation.set((r - 0.5) * 0.18, r * Math.PI, 0)
      dummy.scale.set(3.1 + r * 2.2, 4 + r * 5, 2.7 + r * 2.5)
      dummy.updateMatrix()
      crowns.setMatrixAt(index, dummy.matrix)
      color.setHSL(0.25 + r * 0.07, 0.24 + r * 0.1, 0.14 + r * 0.12)
      crowns.setColorAt(index++, color)
    }
    crowns.computeBoundingSphere()
    this.scenery.add(crowns)
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
    this.cities.group.visible = next.scale > 0.38
    this.cities.view(this.camera, next.w, next.h, next.scale)
    this.treeScale.value = THREE.MathUtils.lerp(1, 0.16, THREE.MathUtils.smoothstep(next.scale, 1.5, 6))
    this.sun.castShadow = next.scale >= 3
    if (this.sun.castShadow) {
      const extent = Math.min(300, Math.max(35, (next.w / next.scale) * 0.7))
      this.sun.target.position.copy(target)
      this.sun.position.copy(target).add(new THREE.Vector3(-400, 700, -300))
      Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent })
      this.sun.shadow.camera.updateProjectionMatrix()
      this.renderer.shadowMap.needsUpdate = true
    }
  }

  paint(world: World, layer: Layer, scale: number) {
    this.cities.update(world)
    if (this.sun.castShadow) this.renderer.shadowMap.needsUpdate = true
    this.cities.view(this.camera, this.cameraState.w, this.cameraState.h, scale)
    this.rivers.minimumFlow.value = scale >= 0.7 ? 0 : 12 / Math.max(0.08, scale)
    this.rivers.mesh.material.color.set(layer === 'terrain' ? '#306b70' : '#3d6872')
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

  pauseMotion() {
    this.motion.advance(0, false)
  }

  render(time = 0, animated = false) {
    this.motion.advance(time, animated)
    this.cities.time.value = this.motion.time.value
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.cities.dispose()
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
