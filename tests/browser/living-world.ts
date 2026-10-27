import { generateWorld } from '../../src/sim/generate'
import { tick } from '../../src/sim/engine'
import { CELL_SIZE } from '../../src/sim/grid'
import { economicLandscape, TILE_ACTIVITIES, type EconomicLandscape } from '../../src/sim/economic-landscape'
import type { World } from '../../src/sim/types'
import { buildAtlas } from '../../src/map/renderer'
import { ReliefMap } from '../../src/map/relief'
import { loadSceneryModels } from '../../src/map/scenery-models'
import { activityLayout, detailRoads } from '../../src/map/activity-layout'
import { activityPose } from '../../src/map/activity-motion'
import { landSurface } from '../../src/map/land-surface'
import type { TerrainPicker } from '../../src/map/relief-picking'
import type { ActivityScenery } from '../../src/map/activity-scenery'
import type { CityScenery } from '../../src/map/city-scenery'
import type { WebGLRenderer } from 'three'

const generated = generateWorld('Living landscape browser', 2, 4),
  width = 16,
  height = 12,
  scale = 1024 / CELL_SIZE
const cells = Array.from({ length: width * height }, (_, id) => {
  const q = id % width,
    r = Math.floor(id / width),
    water = q >= 12
  return {
    id,
    q,
    r,
    x: (q + 0.5) * CELL_SIZE,
    y: (r + 0.5) * CELL_SIZE,
    region: water ? -1 : 0,
    terrain: water ? ('water' as const) : q >= 4 && q <= 5 ? ('forest' as const) : ('plains' as const),
    elevation: water ? 0.04 : 0.13,
    moisture: q >= 4 && q <= 5 ? 0.75 : 0.48,
    river: false,
  }
})
const land: EconomicLandscape = {
  month: 7,
  activity: new Uint8Array(cells.length),
  intensity: new Float32Array(cells.length).fill(0.7),
  workers: new Float64Array(cells.length),
  residents: new Float64Array(cells.length),
  harbors: [{ cell: 5 * width + 11, water: 5 * width + 12, region: 0, level: 3 }],
}
for (const c of cells) {
  const use =
    c.q < 4
      ? 'fields'
      : c.q < 6
        ? 'forest'
        : c.q === 6
          ? 'quarry'
          : c.q === 7
            ? 'iron'
            : c.q === 8
              ? 'coal'
              : c.q === 9
                ? 'workshops'
                : c.q === 11
                  ? 'town'
                  : 'pasture'
  land.activity[c.id] = TILE_ACTIVITIES.indexOf(use)
  if (c.terrain !== 'water') {
    land.workers[c.id] = 240
    land.residents[c.id] = 900
  }
}
const cityCell = 5 * width + 11,
  center = cells[cityCell]
const roadPath = [80, 81, 82, 83, 84, 85, 86, 70, 71, 72, 88, 89, 90, 91]
const fixture = {
  ...generated,
  seed: 'Living landscape fixture',
  width,
  height,
  month: 7,
  cells,
  regions: [
    {
      ...generated.regions[0],
      id: 0,
      nation: 0,
      center: cityCell,
      cells: cells.filter((c) => c.region === 0).map((c) => c.id),
      neighbors: [],
      coastal: true,
      publicWorks: { road: 'rail' },
    },
  ],
  nations: [{ ...generated.nations[0], id: 0, capital: 0 }],
  routes: [],
  corridors: roadPath.slice(1).map((b, i) => ({ a: roadPath[i], b, familiarity: 1, traffic: 40 })),
  corridorPlan: {
    links: Array.from({ length: 11 }, (_, q) => ({
      from: 0,
      to: 0,
      legs: [{ mode: 'land', cells: [5 * width + q, 5 * width + q + 1] }],
    })),
  },
  spatial: {
    version: 1,
    month: 7,
    settlements: [
      {
        id: 'city:harbor',
        cell: cityCell,
        region: 0,
        name: 'Harbor',
        kind: 'town',
        population: 9000,
        capital: false,
        nucleusSite: `home:${cityCell}`,
      },
    ],
    districts: [],
    splits: [],
  },
  adaptive: { metersPerMapUnit: scale, sites: {}, jurisdictions: {}, boundaries: [] },
  viewHomes: [
    {
      id: `home:${cityCell}`,
      cell: cityCell,
      pool: 0,
      capacity: 12000,
      residents: 9000,
      x: center.x * scale,
      y: center.y * scale,
      parcel: { x: center.x * scale - 350, y: center.y * scale - 350, size: 700 },
    },
  ],
  localEconomy: undefined,
  viewLandscape: land,
} as unknown as World
const canvas = document.querySelector('canvas')!,
  result = document.querySelector('#result')!
// `?primitives` compares the scene without the Blender model kit.
if (!new URLSearchParams(location.search).has('primitives')) await loadSceneryModels()
let world = fixture,
  atlas = buildAtlas(world),
  relief = new ReliefMap(canvas, world, atlas),
  playing = true,
  focus = { x: 8 * CELL_SIZE, y: 5.5 * CELL_SIZE, span: 110 }
function render() {
  const { width: w, height: h } = canvas.getBoundingClientRect(),
    zoom = h / focus.span
  relief.setCamera({
    w,
    h,
    scale: zoom,
    x: (atlas.worldWidth / 2 - focus.x) * zoom,
    y: (atlas.worldHeight / 2 - focus.y) * zoom * Math.sin(Math.PI * 0.29),
    tilt: true,
  })
  relief.paint(world, 'terrain', zoom)
  relief.paintOverlay(() => {}, 0, world, false)
  result.textContent = `${world === fixture ? 'Controlled illustration' : 'Generated simulation geography'} · ${world.cells.length.toLocaleString()} tiles · month ${world.month + 1} · zoom ${zoom.toFixed(1)}`
}
const focusOn = (x: number, y: number, span: number) => {
  focus = { x: x * CELL_SIZE, y: y * CELL_SIZE, span }
  render()
}
// Isolated browser qualification only; no production-world access or saving.
Object.assign(window, {
  rendererReview: {
    focusOn,
    metrics: () => {
      const scene = relief as unknown as { renderer: WebGLRenderer; activities: ActivityScenery }
      return {
        world: world === fixture ? 'controlled' : 'generated',
        cells: world.cells.length,
        focus,
        zoom: canvas.clientHeight / focus.span,
        activities: scene.activities.stats,
        memory: { ...scene.renderer.info.memory },
        render: { ...scene.renderer.info.render },
      }
    },
    snapshot: () => {
      const scene = relief as unknown as {
        picker: TerrainPicker
        activities: ActivityScenery
        cities: CityScenery
      }
      const roads = detailRoads(world)
      const landscape = world.viewLandscape ?? economicLandscape(world)
      const plans = world.cells
        .filter((c) => c.terrain !== 'water')
        .map((c) =>
          activityLayout(
            world,
            landscape,
            c.id,
            roads.filter((r) => r.a === c.id || r.b === c.id),
            (x, z) => scene.picker.heightAt(x, z),
          ),
        )
      const coast = landSurface(world)
      const piers = plans.flatMap((p) => p.pieces).filter((p) => p.role === 'pier')
      const carts = plans.flatMap((p) => p.motions).filter((m) => m.kind === 'cart')
      const positions = [world.cells[85], world.cells[94]].map((p) => {
        const screen = relief.project(p.x, p.y, 0),
          pick = relief.locate(screen.x, screen.y)
        return { cell: p.id, error: pick ? Math.hypot(pick.x - p.x, pick.y - p.y) : null }
      })
      return {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        focus,
        zoom: canvas.clientHeight / focus.span,
        activities: scene.activities.stats,
        visibleCities: scene.cities.group.children.slice(1).filter((g) => g.visible).length,
        piers: piers.map((p) => ({
          x: p.x,
          z: p.z,
          height: p.y,
          rootOnLand: coast.contains(
            p.x - (Math.sin(p.angle) * p.d) / 2,
            p.z - (Math.cos(p.angle) * p.d) / 2,
          ),
          tipOnWater: !coast.contains(
            p.x + (Math.sin(p.angle) * p.d) / 2,
            p.z + (Math.cos(p.angle) * p.d) / 2,
          ),
        })),
        carts: carts.map((m) => ({ path: m.path, pose: activityPose(m, 13.7, world) })),
        positions,
      }
    },
  },
})
document.querySelector('#overview')!.addEventListener('click', () => focusOn(8, 5.5, 110))
document.querySelector('#fields')!.addEventListener('click', () => focusOn(4, 5.5, 42))
document.querySelector('#industry')!.addEventListener('click', () => focusOn(8, 5.5, 42))
document.querySelector('#harbor')!.addEventListener('click', () => focusOn(11.5, 5.5, 30))
document.querySelector('#motion')!.addEventListener('click', (e) => {
  playing = !playing
  ;(e.target as HTMLButtonElement).textContent = playing ? 'Pause activity' : 'Resume activity'
})
document.querySelector('#season')!.addEventListener('click', () => {
  world = { ...world, month: (world.month + 6) % 12 }
  if (world.viewLandscape) world.viewLandscape = { ...world.viewLandscape, month: world.month }
  render()
})
document.querySelector('#real')!.addEventListener('click', () => {
  relief.dispose()
  if (!generated.month) tick(generated)
  world = generated
  document.querySelector('#description')!.textContent = 'Generated economy after one simulated month.'
  atlas = buildAtlas(world)
  relief = new ReliefMap(canvas, world, atlas)
  const c = world.cells[world.regions[0].center]
  focus = { x: c.x, y: c.y, span: 80 }
  render()
})
window.addEventListener('resize', render)
window.addEventListener('error', (e) => {
  result.textContent = `ERROR: ${e.message}`
})
function frame(time: number) {
  relief.render(time, playing)
  requestAnimationFrame(frame)
}
render()
requestAnimationFrame(frame)
