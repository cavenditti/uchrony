import * as THREE from 'three'
import { CityScenery } from '../../src/map/city-scenery'
import { TerrainPicker } from '../../src/map/relief-picking'
import { settlementPlaces } from '../../src/map/settlement-scenery'
import { cityLayout, describeCity } from '../../src/map/city-layout'
import { CELL_SIZE } from '../../src/sim/grid'
import type { World } from '../../src/sim/types'
const scale = 1024 / CELL_SIZE,
  width = 40,
  height = 40
const cells = Array.from({ length: width * height }, (_, id) => ({
  id,
  q: id % width,
  r: Math.floor(id / width),
  x: ((id % width) + 0.5) * CELL_SIZE,
  y: (Math.floor(id / width) + 0.5) * CELL_SIZE,
  terrain: 'plains',
  elevation: 0.2,
  moisture: 0.4,
  region: 0,
}))
const ids = [815, 817, 819],
  capacities = [1200, 180000, 1600],
  activities = ['agricultural', 'urban', 'industrial']
const sites = Object.fromEntries(
  ids.map((id, i) => {
    const c = cells[id],
      x = c.x * scale,
      y = c.y * scale
    return [
      `home:${id}`,
      {
        id: `home:${id}`,
        kind: 'residential',
        cell: id,
        pool: i,
        x,
        y,
        capacity: capacities[i],
        residents: capacities[i] * 0.85,
        parcel: { x: x - 425, y: y - 425, size: 850 },
      },
    ]
  }),
)
const world = {
  seed: 'Urban form fixture',
  width,
  height,
  cells,
  regions: [{ culture: 1 }],
  adaptive: { metersPerMapUnit: scale, sites },
  localEconomy: { units: Object.fromEntries(activities.map((activity, id) => [id, { activity }])) },
  spatial: {
    version: 1,
    month: 0,
    districts: [],
    splits: [],
    settlements: ids.map((cell, i) => ({
      id: `city:${i}`,
      cell,
      region: 0,
      name: activities[i],
      kind: i === 1 ? 'city' : 'town',
      population: capacities[i],
      capital: false,
      nucleusSite: `home:${cell}`,
    })),
  },
} as unknown as World
const plane = new THREE.PlaneGeometry(480, 480).rotateX(-Math.PI / 2).translate(240, 0, 240)
const scenery = new CityScenery(world, new TerrainPicker(plane)),
  scene = new THREE.Scene()
scene.background = new THREE.Color('#d8dfca')
scene.add(scenery.group)
scene.add(new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ color: '#9eb28c', roughness: 1 })))
scene.add(new THREE.HemisphereLight('#fff8de', '#465749', 2.1))
const sun = new THREE.DirectionalLight('#ffedd0', 3)
sun.position.set(140, 150, 120)
scene.add(sun)
const camera = new THREE.OrthographicCamera(),
  renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas')!, antialias: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.outputColorSpace = THREE.SRGBColorSpace
let detail = true
function render() {
  const canvas = renderer.domElement,
    w = canvas.clientWidth,
    h = canvas.clientHeight,
    aspect = w / h,
    span = aspect < 1 ? 72 : 60
  renderer.setSize(w, h, false)
  camera.left = -span / 2
  camera.right = span / 2
  camera.top = span / aspect / 2
  camera.bottom = -span / aspect / 2
  camera.near = 0.1
  camera.far = 1000
  camera.position.set(cells[817].x, 65, cells[817].y + 38)
  camera.lookAt(cells[817].x, 0, cells[817].y)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  scenery.view(camera, w, h, detail ? 20 : 2)
  renderer.render(scene, camera)
}
document.querySelector('#detail')!.addEventListener('click', () => {
  detail = true
  render()
})
document.querySelector('#overview')!.addEventListener('click', () => {
  detail = false
  render()
})
window.addEventListener('resize', render)
document.querySelector('output')!.textContent = settlementPlaces(world)
  .map((s) => {
    const layout = cityLayout(world, describeCity(world, s))
    return `${s.form!.district}: ${s.capacity} housing places; ${layout.buildings.length} drawn buildings; tallest ${Math.max(...layout.buildings.map((b) => b.storeys ?? 1)).toFixed(1)} visible floors`
  })
  .join('\n')
render()
