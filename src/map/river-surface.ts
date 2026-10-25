import * as THREE from 'three'
import { riverPoint, type RiverCurve } from './rivers'
import type { TerrainPicker } from './relief-picking'

/** Retained vector ribbons keep river curves independent of the 4096px terrain
 * texture. Samples sit on the actual terrain triangles, not a second height field.
 */
export function riverSurface(curves: RiverCurve[], picker: TerrainPicker) {
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
    indices = new Uint32Array(steps.reduce((sum, n) => sum + n, 0) * 6)
  const ray = new THREE.Ray(new THREE.Vector3(0, 10000, 0), new THREE.Vector3(0, -1, 0))
  let vertex = 0,
    index = 0
  for (let c = 0; c < curves.length; c++) {
    const curve = curves[c],
      count = steps[c]
    const radius = Math.min(6, 0.35 + Math.sqrt(curve.flow) * 0.13) / 2
    for (let i = 0; i <= count; i++) {
      const t = i / count,
        u = 1 - t,
        p = riverPoint(curve, t)
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
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  const minimumFlow = { value: 0 }
  const material = new THREE.MeshBasicMaterial({
    color: '#438d9d',
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  material.customProgramCacheKey = () => 'uchrony-vector-rivers-v1'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.riverMinimumFlow = minimumFlow
    shader.vertexShader = 'attribute float riverFlow;\nvarying float vRiverFlow;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRiverFlow = riverFlow;',
    )
    shader.fragmentShader =
      'varying float vRiverFlow;\nuniform float riverMinimumFlow;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif(vRiverFlow < riverMinimumFlow) discard;',
    )
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 1
  return { mesh, minimumFlow }
}
