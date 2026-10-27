import { habitableLand } from '../sim/terrain-access'
import * as THREE from 'three'
import { TILE_ACTIVITIES, type EconomicLandscape } from '../sim/economic-landscape'
import { localClimate } from '../sim/climate'
import { type World } from '../sim/types'

/** One texel per source tile. Crop rows are shader detail, not a field-sized
 * bitmap; the same plots stay in place across zoom, seasons and numerical remeshing. */
export function activityTexture(world: World, landscape: EconomicLandscape) {
  const data = new Uint8Array(world.width * world.height * 4),
    color = new THREE.Color()
  for (const c of world.cells) {
    if (!habitableLand(c)) continue
    const use = TILE_ACTIVITIES[landscape.activity[c.id]],
      climate = localClimate(world, c)
    if (use === 'fields')
      color.set(climate.crop === 'rice' ? '#789b75' : climate.crop === 'orchard' ? '#7d9060' : '#bdab68')
    else if (use === 'pasture') color.set('#94a66d')
    else if (use === 'quarry') color.set('#b2a292')
    else if (use === 'coal') color.set('#64655c')
    else if (use === 'iron') color.set('#9f8067')
    else color.set('#9e986e')
    if (use === 'fields') color.lerp(new THREE.Color('#6f8d50'), climate.growth * 0.45)
    data.set(
      [
        color.r * 255,
        color.g * 255,
        color.b * 255,
        (use === 'fields'
          ? 64
          : use === 'pasture'
            ? 128
            : ['quarry', 'iron', 'coal'].includes(use)
              ? 192
              : 0) + Math.round(landscape.intensity[c.id] * 50),
      ],
      c.id * 4,
    )
  }
  const texture = new THREE.DataTexture(data, world.width, world.height, THREE.RGBAFormat)
  texture.magFilter = texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

export const activityGroundShader = `
  vec2 tileUV = vGround.xz / activityWorldSize;
  vec4 landUse = texture2D(activityMap, tileUV);
  float code = floor(landUse.a * 255.0 + 0.5);
  float landKind = floor(code / 64.0);
  float cover = mod(code,64.0)/50.0;
  vec2 tile = floor(tileUV * activityGridSize);
  vec2 plot = fract(tileUV * activityGridSize) - 0.5;
  // Field boundaries use a landscape-wide, offset mosaic. A computational tile
  // does not stamp four identical rectangles onto every farm.
  vec2 field = vGround.xz * vec2(0.29,0.34);
  field.x += floor(field.y)*0.41 + surfaceNoise(vec2(floor(field.y)*0.5,7.0))*0.8;
  vec2 fieldID=floor(field), q=fract(field)-0.5;
  float lane=0.018+surfaceHash(fieldID+33.0)*0.045;
  float mask=(1.0-smoothstep(0.5-lane-0.012,0.5-lane,abs(q.x))) *
    (1.0-smoothstep(0.5-lane-0.012,0.5-lane,abs(q.y)));
  mask *= step(surfaceHash(fieldID+21.0),cover);
  mask *= smoothstep(0.10,0.19,length(plot));
  float closeRows = 1.0-smoothstep(0.02,0.14,length(fwidth(q)));
  float rowPhase = mix(q.x,q.y,step(0.5,surfaceHash(fieldID+3.0))) * (15.0 + surfaceHash(fieldID+19.0)*9.0);
  float rows = 0.5 + 0.5 * sin(rowPhase*6.28318);
  vec3 cultivated = landUse.rgb * (0.85 + surfaceHash(fieldID)*0.26) * mix(1.0, 0.80 + rows*0.25, closeRows);
  if (landKind == 1.0)
    diffuseColor.rgb = mix(diffuseColor.rgb, cultivated, mask*pigmentStrength*0.78);
  if (landKind == 2.0)
    diffuseColor.rgb = mix(diffuseColor.rgb, landUse.rgb,mask*pigmentStrength*0.3);
  if (landKind == 3.0) {
    float scar = 1.0-smoothstep(0.12,0.27,length(plot));
    diffuseColor.rgb = mix(diffuseColor.rgb,landUse.rgb,scar*pigmentStrength*0.7);
  }
`
