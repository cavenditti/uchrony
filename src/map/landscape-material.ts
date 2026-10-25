import * as THREE from 'three'

export const surfaceNoiseShader = `
float surfaceHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float surfaceNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1.,0.)),f.x),
             mix(surfaceHash(i+vec2(0.,1.)),surfaceHash(i+vec2(1.,1.)),f.x),f.y);
}`

/** Close-range detail is evaluated in world coordinates, independent of district size or camera zoom. */
export function terrainMaterial(texture: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.94,
    metalness: 0,
    alphaTest: 0.3,
  })
  material.customProgramCacheKey = () => 'uchrony-natural-ground-v1'
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vGround;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvGround = position;',
    )
    shader.fragmentShader = 'varying vec3 vGround;\n' + surfaceNoiseShader + '\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      float visibleDetail = 1.0 - smoothstep(0.5, 3.0, length(fwidth(vGround.xz)));
      float mineral = surfaceNoise(vGround.xz * 0.6) * 0.65 + surfaceNoise(vGround.xz * 1.9) * 0.35;
      diffuseColor.rgb *= mix(1.0, 0.86 + mineral * 0.28, visibleDetail);
    `,
    )
  }
  return material
}

/** Wind ripples share the scene clock and existing frame budget. */
export function oceanMaterial(texture: THREE.Texture, time = { value: 0 }) {
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.58, metalness: 0.03 })
  material.customProgramCacheKey = () => 'uchrony-natural-water-v1'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sceneryTime = time
    shader.vertexShader = 'varying vec3 vSea;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvSea = position;',
    )
    shader.fragmentShader =
      'uniform float sceneryTime;\nvarying vec3 vSea;\n' + surfaceNoiseShader + '\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `
      #include <normal_fragment_maps>
      float footprint = length(fwidth(vSea.xz));
      float ripple = 1.0-smoothstep(0.75,3.0,footprint);
      vec2 p = vSea.xz * 0.12 - sceneryTime * vec2(0.025,0.01);
      vec2 slope = vec2(
        surfaceNoise(p+vec2(0.4,0.0))-surfaceNoise(p-vec2(0.4,0.0)),
        surfaceNoise(p+vec2(0.0,0.4))-surfaceNoise(p-vec2(0.0,0.4))
      ) * 0.045 * ripple;
      normal = normalize(mat3(viewMatrix) * normalize(vec3(slope.x,1.0,slope.y)));
    `,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float fresnel = pow(1.0-max(0.0,dot(normal,normalize(vViewPosition))),4.0);
      outgoingLight = mix(outgoingLight,vec3(0.29,0.43,0.48),fresnel*0.38);
      #include <opaque_fragment>
    `,
    )
  }
  return material
}
