import { landscapeField, sampleLandscape } from './landscape-field'
import { hashSeed, noise } from '../sim/random'
import { clamp, type World } from '../sim/types'
import { illuminated } from './illuminated-palette'

const ease = (x: number) => {
  const t = clamp(x)
  return t * t * (3 - 2 * t)
}
const { dry, green, forest: trees, sand: dune, stone, snow: ice, tundra: frozen } = illuminated.land
const { deep, shallow, shore } = illuminated.sea
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Bounded, geographic albedo and bathymetry. Administrative remeshing never rebakes these rasters. */
export function landscapeRasters(
  world: World,
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number,
) {
  const make = () => {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    return c
  }
  const terrain = make(),
    ocean = make(),
    relief = make()
  const ctx = terrain.getContext('2d')!,
    albedo = ctx.createImageData(width, height)
  const water = ctx.createImageData(width, height),
    shade = ctx.createImageData(width, height)
  const salt = hashSeed(`${world.seed}:surface`),
    field = landscapeField(world)
  const values = new Float64Array(7)
  for (let py = 0; py < height; py++) {
    const y = (py / height) * worldHeight
    for (let px = 0; px < width; px++) {
      const x = (px / width) * worldWidth
      sampleLandscape(field, x, y, values)
      const [elevation, moisture, forest, desert, tundra, dx, dy] = values
      const broad = noise(x / 85, y / 85, salt),
        fine = noise(x / 9, y / 9, salt + 17)
      const detail = fine * 0.65 + noise(x / 3.1, y / 3.1, salt + 91) * 0.35
      const woods = ease(forest * 0.8 + moisture * 0.35 + broad * 0.28 - 0.25)
      const rock = ease((elevation - 0.36) * 3.3 + Math.hypot(dx, dy) * 2.3 + (fine - 0.5) * 0.3)
      const snow = ease((elevation - 0.63) * 8 + (broad - 0.5) * 0.7) * (1 - desert * 0.8)
      const sand = ease(desert * 0.9 + (0.35 - moisture) * 1.2)
      const grain = 0.95 + detail * 0.09
      const i = (py * width + px) * 4
      for (let k = 0; k < 3; k++) {
        let color = mix(dry[k], green[k], ease(moisture))
        color = mix(color, trees[k], woods * 0.85)
        color = mix(color, dune[k], sand)
        color = mix(color, frozen[k], tundra * 0.7)
        color = mix(color, stone[k], rock)
        albedo.data[i + k] = mix(color * grain, ice[k], snow)
        shade.data[i + k] = dx * 2.6 + dy * 1.8 > 0 ? 255 : 0
      }
      albedo.data[i + 3] = 255
      shade.data[i + 3] = clamp(Math.abs(dx * 2.6 + dy * 1.8), 0, 0.42) * 255
      const shelf = ease((elevation + 0.14) / 0.24)
      const shoal = ease((elevation - 0.055) / 0.045)
      for (let k = 0; k < 3; k++)
        water.data[i + k] = mix(mix(deep[k], shallow[k], shelf), shore[k], shoal) * (0.98 + detail * 0.04)
      water.data[i + 3] = 255
    }
  }
  ctx.putImageData(albedo, 0, 0)
  ocean.getContext('2d')!.putImageData(water, 0, 0)
  relief.getContext('2d')!.putImageData(shade, 0, 0)
  return { terrain, ocean, relief }
}
