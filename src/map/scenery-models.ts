import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Meshes authored in Blender by `scripts/blender/scenery_models.py`. Each one
 * keeps the bounds of the primitive it replaces, so instance transforms that
 * place the primitive also place the model. */
export const SCENERY_MODELS = [
  'broadleaf',
  'conifer',
  'crown',
  'sheep',
  'roof-gable',
  'roof-hip',
  'boat',
  'cart',
  'figure',
  'mill-sails',
] as const
export type SceneryModelName = (typeof SCENERY_MODELS)[number]

const models = new Map<SceneryModelName, THREE.BufferGeometry>()
let loading: Promise<boolean> | undefined

export async function parseSceneryModels(data: ArrayBuffer) {
  const gltf = await new GLTFLoader().parseAsync(data, '')
  const parsed = new Map<SceneryModelName, THREE.BufferGeometry>()
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && (SCENERY_MODELS as readonly string[]).includes(object.name))
      parsed.set(object.name as SceneryModelName, object.geometry)
  })
  return parsed
}

export function installSceneryModels(parsed: ReadonlyMap<SceneryModelName, THREE.BufferGeometry>) {
  models.clear()
  for (const [name, geometry] of parsed) models.set(name, geometry)
}

/** Resolves once the kit is installed. A failed load keeps the primitive
 * fallbacks, so the 3D map never depends on the asset arriving. */
export function loadSceneryModels() {
  loading ??= fetch(new URL('./models/scenery-models.glb', import.meta.url))
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.arrayBuffer()
    })
    .then(parseSceneryModels)
    .then((parsed) => {
      installSceneryModels(parsed)
      return true
    })
    .catch((error) => {
      console.warn('Scenery models unavailable; using primitive shapes.', error)
      return false
    })
  return loading
}

/** A private copy of the Blender model, or the primitive it replaces. Models
 * carry linear vertex colors; materials enable them only when present. */
export function sceneryModel(name: SceneryModelName, fallback: () => THREE.BufferGeometry) {
  return models.get(name)?.clone() ?? fallback()
}
