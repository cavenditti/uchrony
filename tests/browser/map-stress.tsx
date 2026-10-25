import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldMap } from '../../src/components/WorldMap'
import type { World, Layer } from '../../src/sim/types'
import '../../src/styles.css'
import './map-stress.css'

function Fixture({ world }: { world: World }) {
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
        <button onClick={() => setRunning((v) => !v)}>{running ? 'Pause freight' : 'Animate freight'}</button>
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
          focus={null}
          onSelect={setRegion}
          onLayer={setLayer}
          onInspect={() => {}}
          onClear={() => setRegion(null)}
          onToggleRoutes={() => setRoutes((v) => !v)}
          onToggleArmies={() => setArmies((v) => !v)}
          orderMode={false}
          showContext={false}
        />
      </main>
    </>
  )
}
const root = createRoot(document.getElementById('root')!)
root.render(<p>Preparing the isolated huge-world stress fixture…</p>)
const worker = new Worker(new URL('./map-stress-world.ts', import.meta.url), { type: 'module' })
worker.onmessage = ({ data }: MessageEvent<World>) => {
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
