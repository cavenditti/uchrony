import * as THREE from 'three'
import { riverHalfWidth, riverPoint, type RiverCurve } from './rivers'
import type { TerrainPicker } from './relief-picking'
import { surfaceNoiseShader } from './landscape-material'

/** Retained vector ribbons keep river curves independent of the 4096px terrain
 * texture. Samples sit on the actual terrain triangles, not a second height field.
 */
export function riverSurface(
  curves: RiverCurve[],
  picker: TerrainPicker,
  coast?: { texture: THREE.Texture; width: number; height: number },
  time = { value: 0 },
) {
  const incoming = new Map<number, number>()
  for (const curve of curves) incoming.set(curve.to, (incoming.get(curve.to) ?? 0) + 1)
  const lengths = curves.map(
    (c) =>
      Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) +
      Math.hypot(c.c.x - c.b.x, c.c.y - c.b.y) +
      Math.hypot(c.d.x - c.c.x, c.d.y - c.c.y),
  )
  // Adapt sampling to total geographic length; no camera-dependent geometry work.
  const spacing = Math.max(2.5, lengths.reduce((sum, n) => sum + n, 0) / 60000)
  const steps = lengths.map((n) => Math.max(2, Math.ceil(n / spacing)))
  const pairs = steps.reduce((sum, n) => sum + n + 1, 0)
  const positions = new Float32Array(pairs * 6),
    flows = new Float32Array(pairs * 2),
    across = new Float32Array(pairs * 2),
    banks = new Float32Array(pairs * 2),
    indices = new Uint32Array(steps.reduce((sum, n) => sum + n, 0) * 6)
  const ray = new THREE.Ray(new THREE.Vector3(0, 10000, 0), new THREE.Vector3(0, -1, 0))
  let vertex = 0,
    index = 0
  for (let c = 0; c < curves.length; c++) {
    const curve = curves[c],
      count = steps[c]
    for (let i = 0; i <= count; i++) {
      const t = i / count,
        u = 1 - t,
        p = riverPoint(curve, t),
        radius = riverHalfWidth(curve, t)
      // Let tributary waters merge instead of painting a bright bank through the junction.
      const bank = Math.min(
        1,
        (incoming.get(curve.from) ?? 0) > 1 ? Math.hypot(p.x - curve.a.x, p.y - curve.a.y) / (radius * 3) : 1,
        (incoming.get(curve.to) ?? 0) > 1 ? Math.hypot(p.x - curve.d.x, p.y - curve.d.y) / (radius * 3) : 1,
      )
      const dx =
          u * u * (curve.b.x - curve.a.x) +
          2 * u * t * (curve.c.x - curve.b.x) +
          t * t * (curve.d.x - curve.c.x),
        dy =
          u * u * (curve.b.y - curve.a.y) +
          2 * u * t * (curve.c.y - curve.b.y) +
          t * t * (curve.d.y - curve.c.y),
        length = Math.hypot(dx, dy) || 1
      for (let side = 0; side < 2; side++) {
        const sign = side ? -1 : 1,
          x = p.x - (dy / length) * radius * sign,
          z = p.y + (dx / length) * radius * sign
        ray.origin.set(x, 10000, z)
        const y = picker.intersect(ray)?.y ?? 0
        positions.set([x, y + 0.15, z], vertex * 3)
        across[vertex] = sign
        banks[vertex] = bank
        flows[vertex++] = curve.flow
      }
      if (i < count) {
        const a = vertex - 2
        indices.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], index)
        index += 6
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('riverFlow', new THREE.BufferAttribute(flows, 1))
  geometry.setAttribute('riverAcross', new THREE.BufferAttribute(across, 1))
  geometry.setAttribute('riverBank', new THREE.BufferAttribute(banks, 1))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const minimumFlow = { value: 0 }
  const material = new THREE.MeshStandardMaterial({
    color: '#306b70',
    roughness: 0.34,
    metalness: 0.02,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  if (coast) material.defines = { RIVER_COAST: 1 }
  material.customProgramCacheKey = () => `uchrony-vector-rivers-v2:${Boolean(coast)}`
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sceneryTime = time
    shader.uniforms.riverMinimumFlow = minimumFlow
    shader.uniforms.riverBankColor = { value: new THREE.Color('#82896a') }
    if (coast) {
      shader.uniforms.riverLand = { value: coast.texture }
      shader.uniforms.riverWorldSize = { value: new THREE.Vector2(coast.width, coast.height) }
    }
    const varying =
      'varying float vRiverFlow;\nvarying float vRiverAcross;\nvarying float vRiverBank;\nvarying vec3 vRiverPosition;\n'
    shader.vertexShader =
      'attribute float riverFlow;\nattribute float riverAcross;\nattribute float riverBank;\n' +
      varying +
      shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRiverFlow = riverFlow;\nvRiverAcross = riverAcross;\nvRiverBank = riverBank;\nvRiverPosition = position;',
    )
    shader.fragmentShader =
      varying +
      `
      uniform float riverMinimumFlow;
      uniform float sceneryTime;
      uniform vec3 riverBankColor;
      #ifdef RIVER_COAST
        uniform sampler2D riverLand;
        uniform vec2 riverWorldSize;
      #endif
      ` +
      surfaceNoiseShader +
      '\n' +
      shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif(vRiverFlow < riverMinimumFlow) discard;',
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float pixelWidth = max(fwidth(vRiverAcross), 0.003);
      float grain = surfaceNoise(vRiverPosition.xz * 1.6);
      float edge = abs(vRiverAcross) + (grain - 0.5) * 0.035;
      float bankDetail = vRiverBank * (1.0 - smoothstep(0.15, 0.55, pixelWidth));
      float bank = smoothstep(0.80 - min(pixelWidth, 0.16), 0.97, edge) * bankDetail;
      float shallows = smoothstep(0.2, 0.86, edge) * vRiverBank;
      diffuseColor.rgb *= mix(0.75, 1.27, shallows);
      diffuseColor.rgb = mix(diffuseColor.rgb, riverBankColor * (0.87 + grain * 0.23), bank);
      diffuseColor.a *= 1.0 - smoothstep(1.0 - pixelWidth * 1.5, 1.0, edge);
      #ifdef RIVER_COAST
        // Reuse the retained land mask: river mouths end at the real coastline,
        // instead of leaving square ribbons on top of the ocean.
        vec2 landUv = vec2(vRiverPosition.x / riverWorldSize.x, 1.0 - vRiverPosition.z / riverWorldSize.y);
        float land = texture2D(riverLand, landUv).a;
        diffuseColor.a *= smoothstep(0.02, 0.85, land);
      #endif
      if (diffuseColor.a < 0.01) discard;
      `,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.94, bank);',
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      float detail = 1.0 - smoothstep(0.35, 1.5, length(fwidth(vRiverPosition.xz)));
      vec2 p = vRiverPosition.xz * 0.9 - sceneryTime * vec2(0.18,0.07);
      vec2 slope = vec2(
        surfaceNoise(p + vec2(0.2, 0.0)) - surfaceNoise(p - vec2(0.2, 0.0)),
        surfaceNoise(p + vec2(0.0, 0.2)) - surfaceNoise(p - vec2(0.0, 0.2))
      ) * 0.08 * detail * (1.0 - bank);
      normal = normalize(normal + mat3(viewMatrix) * vec3(slope.x, 0.0, slope.y));
      `,
    )
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.renderOrder = 1
  return { mesh, minimumFlow }
}
