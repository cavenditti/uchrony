import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import {
  SCENERY_MODELS,
  installSceneryModels,
  parseSceneryModels,
  sceneryModel,
  type SceneryModelName,
} from '../src/map/scenery-models'

const file = readFileSync(new URL('../src/map/models/scenery-models.glb', import.meta.url))
const kit = parseSceneryModels(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))

// Bounds of the primitive each model replaces; instance transforms rely on them.
const CANOPY: [number[], number[]] = [
  [-1, -0.2, -1],
  [1, 1.8, 1],
]
const UNIT: [number[], number[]] = [
  [-0.5, -0.5, -0.5],
  [0.5, 0.5, 0.5],
]
const BOUNDS: Partial<Record<SceneryModelName, [number[], number[]]>> = {
  broadleaf: CANOPY,
  conifer: CANOPY,
  crown: UNIT,
  sheep: UNIT,
  'roof-gable': UNIT,
  'roof-hip': UNIT,
}
// Forest trees and crowns are drawn tens of thousands of times: no more than
// the 80-triangle sphere and icosahedron they replace.
const TRIANGLES: Record<SceneryModelName, number> = {
  broadleaf: 80,
  conifer: 80,
  crown: 80,
  sheep: 160,
  'roof-gable': 64,
  'roof-hip': 32,
  boat: 200,
  cart: 320,
  figure: 200,
  'mill-sails': 320,
}

test('the Blender kit contains every scenery model within its triangle budget', async () => {
  const models = await kit
  assert.deepEqual([...models.keys()].sort(), [...SCENERY_MODELS].sort())
  for (const [name, geometry] of models) {
    const triangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    assert(triangles <= TRIANGLES[name], `${name}: ${triangles} triangles`)
  }
})

test('replacement models keep the bounds of the primitives they replace', async () => {
  const models = await kit
  for (const [name, [low, high]] of Object.entries(BOUNDS)) {
    const geometry = models.get(name as SceneryModelName)!
    geometry.computeBoundingBox()
    const { min, max } = geometry.boundingBox!
    low.forEach((v, i) => assert(Math.abs(min.getComponent(i) - v) < 1e-4, `${name} min ${i}`))
    high.forEach((v, i) => assert(Math.abs(max.getComponent(i) - v) < 1e-4, `${name} max ${i}`))
  }
})

test('models carry finite unit normals and linear vertex colors', async () => {
  for (const [name, geometry] of await kit) {
    const normal = geometry.getAttribute('normal'),
      color = geometry.getAttribute('color')
    assert(color, `${name} has vertex colors`)
    for (let i = 0; i < normal.count; i++)
      assert(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 1e-3, name)
    for (let i = 0; i < color.count; i++)
      for (const c of [color.getX(i), color.getY(i), color.getZ(i)])
        assert(Number.isFinite(c) && c >= 0 && c <= 1, `${name} color ${c}`)
  }
})

test('moving props face +Z, the heading the renderer gives them', async () => {
  const models = await kit
  for (const name of ['boat', 'cart'] as const) {
    const geometry = models.get(name)!
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())
    assert(size.z > size.x * 1.8, `${name} is longer along Z`)
  }
  // The boat's stem rises at the bow; the cart's draught animal leads it.
  const boat = models.get('boat')!.getAttribute('position')
  let bow = -Infinity,
    bowHeight = 0
  for (let i = 0; i < boat.count; i++)
    if (boat.getZ(i) > bow) {
      bow = boat.getZ(i)
      bowHeight = boat.getY(i)
    }
  assert(bow > 0.4 && bowHeight > 0.1)
  const cart = models.get('cart')!
  cart.computeBoundingBox()
  assert(cart.boundingBox!.max.z > -cart.boundingBox!.min.z - 0.05)
})

test('installed models are private copies; missing models fall back to primitives', async () => {
  const fallback = () => new THREE.BoxGeometry()
  installSceneryModels(new Map())
  assert(sceneryModel('crown', fallback) instanceof THREE.BoxGeometry)
  installSceneryModels(await kit)
  const a = sceneryModel('crown', fallback),
    b = sceneryModel('crown', fallback)
  assert(!(a instanceof THREE.BoxGeometry))
  assert.notEqual(a, b)
  assert(a.hasAttribute('color'))
  installSceneryModels(new Map())
})
