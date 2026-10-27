import * as THREE from 'three'

/** Screen-space detail changes never move or rescale the underlying models. */
export function sceneryDensity(scale: number) {
  return Math.min(1.08, (scale / 12) ** 2)
}
export function sceneryBucket(density: number) {
  return Math.min(1.08, Math.ceil(density * 8) / 8)
}

/** Opaque stippling avoids transparent sorting and fades whole compound models
 * together. A negative threshold is structural geometry and remains visible. */
export function sceneryLodMaterial(
  material: THREE.Material,
  density: { value: number },
  visibility: { value: number },
) {
  const compile = material.onBeforeCompile.bind(material),
    key = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer)
    shader.uniforms.sceneryDensity = density
    shader.uniforms.sceneryVisibility = visibility
    shader.vertexShader =
      'attribute float detailThreshold; varying float vDetailThreshold;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvDetailThreshold = detailThreshold;',
    )
    shader.fragmentShader =
      'uniform float sceneryDensity; uniform float sceneryVisibility; varying float vDetailThreshold;\n' +
      shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `
      #include <alphatest_fragment>
      float coverage = sceneryVisibility * clamp((sceneryDensity - vDetailThreshold) / 0.08, 0.0, 1.0);
      float screenNoise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898,78.233))) * 43758.5453);
      if (coverage <= screenNoise) discard;
    `,
    )
  }
  material.customProgramCacheKey = () => `${key}:continuous-scenery-lod-v1`
  return material
}
