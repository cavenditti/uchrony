import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldMap } from '../../src/components/WorldMap'
import { spatialState } from '../../src/sim/spatial'
import type { World, Layer } from '../../src/sim/types'
import '../../src/styles.css'
import './map-stress.css'

function Fixture({ world }: { world: World }) {
  const [focus, setFocus] = useState<{ region: number; key: number; settlement?: string } | null>(null)
  const cityPreview = new URLSearchParams(location.search).has('cities')
  const cities = spatialState(world).settlements
  const [layer, setLayer] = useState<Layer>('terrain'),
    [region, setRegion] = useState<number | null>(null)
  const [running, setRunning] = useState(false),
    [routes, setRoutes] = useState(true),
    [armies, setArmies] = useState(true)
  return (
    <>
      <header className="stress-header">
        <span>
          Stress fixture · {world.cells.length.toLocaleString()} cells ·{' '}
          {world.routes.length.toLocaleString()} shipments · no saving or model calls
        </span>
        {cityPreview && (
          <label>
            Explore city{' '}
            <select
              aria-label="Explore city"
              defaultValue=""
              onChange={(e) => {
                const city = cities.find((s) => s.id === e.target.value)
                if (city) setFocus({ region: city.region, settlement: city.id, key: Date.now() })
              }}
            >
              <option value="" disabled>
                Select a settlement
              </option>
              {cities
                .filter((s) => s.capital)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <button onClick={() => setRunning((v) => !v)}>{running ? 'Pause animation' : 'Animate world'}</button>
      </header>
      <main className="atlas-shell stress-map">
        <WorldMap
          world={world}
          mapKey="huge-stress-fixture"
          layer={layer}
          nation={0}
          region={region}
          showRoutes={routes}
          showArmies={armies}
          running={running}
          focus={focus}
          onSelect={setRegion}
          onLayer={setLayer}
          onInspect={() => {}}
          onClear={() => setRegion(null)}
          onToggleRoutes={() => setRoutes((v) => !v)}
          onToggleArmies={() => setArmies((v) => !v)}
          orderMode={false}
          showContext={cityPreview}
        />
      </main>
    </>
  )
}
const root = createRoot(document.getElementById('root')!)
root.render(<p>Preparing the isolated huge-world stress fixture…</p>)
const worker = new Worker(new URL('./map-stress-world.ts', import.meta.url), { type: 'module' })
worker.onmessage = ({ data }: MessageEvent<World>) => {
  Object.assign(window, { mapStressWorld: data })
  root.render(<Fixture world={data} />)
  worker.terminate()
}
worker.onerror = () => root.render(<p>Stress fixture generation failed. Check the console.</p>)
worker.postMessage({ months: new URLSearchParams(location.search).has('landscape') ? 0 : 3 })

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    worker.terminate()
    root.unmount()
  })
