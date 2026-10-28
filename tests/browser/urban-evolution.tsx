import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { CityScenery } from '../../src/map/city-scenery'
import { TerrainPicker } from '../../src/map/relief-picking'
import { LocalInspection } from '../../src/components/LocalInspection'
import { fundedUrbanFixture } from '../fixtures/funded-urban-evolution'
import { planUrbanRenewal } from '../../src/sim/urban-renewal'
import { fundUrbanProject } from '../../src/sim/urban-projects'
import { advanceUrbanConstruction } from '../../src/sim/urban-construction'
import { urbanCharacter } from '../../src/sim/urban-character'
import { mapHomesSnapshot } from '../../src/sim/map-snapshot'
import type { InspectionSnapshot } from '../../src/sim/inspection'
import '../../src/styles.css'

const { w, sites } = fundedUrbanFixture()
w.spatial = { version: 1, month: w.month, districts: [], splits: [], settlements: [] } as typeof w.spatial
const initial = structuredClone(w)
for (const [i, kind, use] of [
  [0, 'replace', 'housing'],
  [2, 'convert', 'market'],
  [4, 'extend', 'housing'],
] as const) {
  const project = planUrbanRenewal(w, sites[i], kind, use)!
  if (!project || !fundUrbanProject(w, project, 1)) throw new Error(`Fixture project failed: ${kind}`)
}
w.month += 2
advanceUrbanConstruction(w)
const working = structuredClone(w)
w.month += 4
advanceUrbanConstruction(w)
const completed = structuredClone(w)
function Fixture() {
  const [stage, setStage] = useState<'initial' | 'working' | 'completed'>('working'),
    [open, setOpen] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const world = { initial, working, completed }[stage]
  const physical = Object.values(world.adaptive!.sites).filter((s) => s.retired === undefined)
  const snapshot: InspectionSnapshot = {
    request: 1,
    revision: world.adaptive!.revision,
    month: world.month,
    bounds: { x: 730, y: 330, size: 600 },
    population: physical.reduce((n, s) => n + (s.residents ?? 0), 0),
    representedWorkers: 0,
    capacity: physical.reduce((n, s) => n + s.capacity, 0),
    jurisdictions: [],
    nodes: [],
    routines: [],
    totalSites: physical.length,
    sampled: false,
    sites: physical.map((s) => ({ ...s, residents: s.residents ?? 0, jobs: 0 })),
    urban: urbanCharacter(world, physical),
  }
  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    const plane = new THREE.PlaneGeometry(40, 25).rotateX(-Math.PI / 2).translate(12, 0, 6)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#385753')
    const view = { ...world, viewHomes: mapHomesSnapshot(world) }
    const scenery = new CityScenery(view, new TerrainPicker(plane))
    scene.add(scenery.group)
    scene.add(new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ color: '#8d9f78', roughness: 1 })))
    scene.add(new THREE.HemisphereLight('#fff8de', '#465749', 2.1))
    const sun = new THREE.DirectionalLight('#ffedd0', 3)
    sun.position.set(10, 30, 20)
    scene.add(sun)
    const camera = new THREE.OrthographicCamera()
    function render() {
      const rect = canvas.current!.getBoundingClientRect(),
        aspect = rect.width / rect.height,
        span = 7
      renderer.setSize(rect.width, rect.height, false)
      camera.left = (-span * aspect) / 2
      camera.right = (span * aspect) / 2
      camera.top = span / 2
      camera.bottom = -span / 2
      camera.near = 0.01
      camera.far = 100
      camera.position.set(11.8, 12, 13)
      camera.lookAt(11.8, 0, 5.4)
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      scenery.view(camera, rect.width, rect.height, 24)
      renderer.render(scene, camera)
    }
    render()
    window.addEventListener('resize', render)
    return () => {
      window.removeEventListener('resize', render)
      renderer.dispose()
      scenery.dispose()
      plane.dispose()
    }
  }, [world])
  return (
    <>
      <header style={{ padding: '1rem', maxWidth: '45rem' }}>
        <h1 style={{ fontSize: '1.4rem' }}>Urban evolution · controlled validation</h1>
        <p>
          Prescribed neighbourhood using the real funding, building renderer and inspector. Population stays
          at 96.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['initial', 'working', 'completed'] as const).map((s) => (
            <button key={s} onClick={() => setStage(s)} aria-pressed={stage === s}>
              {s === 'initial' ? 'Before works' : s === 'working' ? 'During construction' : 'Completed works'}
            </button>
          ))}
          <button onClick={() => setOpen(true)}>Inspect neighbourhood</button>
        </div>
      </header>
      <canvas
        ref={canvas}
        style={{ display: 'block', width: '100%', height: '65vh' }}
        aria-label="Recorded neighbourhood buildings"
      />
      {open && (
        <LocalInspection
          snapshot={snapshot}
          currentMonth={world.month}
          onClose={() => setOpen(false)}
          onRefresh={() => {}}
        />
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
