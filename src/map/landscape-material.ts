import * as THREE from 'three'
import { activityGroundShader } from './activity-material'

export const surfaceNoiseShader = `
float surfaceHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float surfaceNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1.,0.)),f.x),
             mix(surfaceHash(i+vec2(0.,1.)),surfaceHash(i+vec2(1.,1.)),f.x),f.y);
}`

/** Short, irregular brush marks, filtered in screen space rather than an unbounded texture. */
export const waterMarksShader = `
float waterMarks(vec2 position, float time) {
  vec2 p=position*0.17;
  // Offset each row and vary the individual strokes so the sea never reads as a grid.
  p.x+=floor(p.y)*0.43;
  vec2 cell=floor(p), q=fract(p)-0.5;
  float seed=surfaceHash(cell);
  q-=vec2(seed-0.5,surfaceHash(cell+17.0)-0.5)*0.5;
  float bend=sin(q.x*12.0+seed*6.28+time*0.35)*0.035;
  float wave=abs(q.y-bend);
  float aa=max(fwidth(p.y),0.002);
  float line=1.0-smoothstep(0.006,0.006+aa,wave);
  float strokeLength=mix(0.13,0.23,surfaceHash(cell+31.0));
  float ends=1.0-smoothstep(strokeLength*0.5,strokeLength,abs(q.x));
  return line*ends*step(0.46,seed)*(1.0-smoothstep(0.04,0.15,length(fwidth(position*0.17))));
}
`

/** The mouth and open sea share pigment and ripple lighting at their meeting point. */
export const coastalWaterShader =
  waterMarksShader +
  `
vec3 coastalWaterColor(vec3 pigment, vec2 position, float time) {
  return mix(pigment,vec3(0.42,0.63,0.67),waterMarks(position,time)*0.23);
}
vec3 coastalWaterNormal(vec2 position, float time) {
  float ripple=1.0-smoothstep(0.75,3.0,length(fwidth(position)));
  vec2 p=position*0.12-time*vec2(0.025,0.01);
  vec2 slope=vec2(
    surfaceNoise(p+vec2(0.4,0.0))-surfaceNoise(p-vec2(0.4,0.0)),
    surfaceNoise(p+vec2(0.0,0.4))-surfaceNoise(p-vec2(0.0,0.4))
  )*0.045*ripple;
  return normalize(vec3(slope.x,1.0,slope.y));
}
`

/** Close-range detail is evaluated in world coordinates, independent of district size or camera zoom. */
export function terrainMaterial(
  texture: THREE.Texture,
  pigment = { value: 1 },
  activity?: { texture: { value: THREE.Texture }; size: THREE.Vector2; grid: THREE.Vector2 },
) {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.94,
    metalness: 0,
    alphaTest: 0.3,
  })
  material.customProgramCacheKey = () => `uchrony-illuminated-ground-v2-${!!activity}`
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pigmentStrength = pigment
    if (activity) {
      shader.uniforms.activityMap = activity.texture
      shader.uniforms.activityWorldSize = { value: activity.size }
      shader.uniforms.activityGridSize = { value: activity.grid }
    }
    shader.vertexShader = 'varying vec3 vGround;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvGround = position;',
    )
    shader.fragmentShader =
      'uniform float pigmentStrength;\nvarying vec3 vGround;\n' +
      (activity
        ? 'uniform sampler2D activityMap;\nuniform vec2 activityWorldSize;\nuniform vec2 activityGridSize;\n'
        : '') +
      surfaceNoiseShader +
      '\n' +
      shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      float visibleDetail = 1.0 - smoothstep(0.5, 3.0, length(fwidth(vGround.xz)));
      float mineral = surfaceNoise(vGround.xz * 0.6) * 0.65 + surfaceNoise(vGround.xz * 1.9) * 0.35;
      diffuseColor.rgb *= mix(1.0, 0.95 + mineral * 0.10, visibleDetail*pigmentStrength);
      ${activity ? activityGroundShader : ''}
    `,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      // Keep pigment in shaded slopes instead of letting the landscape turn muddy.
      outgoingLight=mix(outgoingLight,diffuseColor.rgb*1.12,pigmentStrength*0.28);
      #include <opaque_fragment>
      `,
    )
  }
  return material
}

/** Wind ripples share the scene clock and existing frame budget. */
export function oceanMaterial(texture: THREE.Texture, time = { value: 0 }) {
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0 })
  material.customProgramCacheKey = () => 'uchrony-illuminated-water-v2'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sceneryTime = time
    shader.vertexShader = 'varying vec3 vSea;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvSea = position;',
    )
    shader.fragmentShader =
      'uniform float sceneryTime;\nvarying vec3 vSea;\n' +
      surfaceNoiseShader +
      '\n' +
      coastalWaterShader +
      shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      diffuseColor.rgb=coastalWaterColor(diffuseColor.rgb,vSea.xz,sceneryTime);
      `,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `
      #include <normal_fragment_maps>
      normal = normalize(mat3(viewMatrix)*coastalWaterNormal(vSea.xz,sceneryTime));
    `,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      outgoingLight=mix(outgoingLight,diffuseColor.rgb*1.08,0.45);
      #include <opaque_fragment>
    `,
    )
  }
  return material
}
