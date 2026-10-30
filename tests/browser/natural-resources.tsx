/** Isolated world map. Resource depletion is an explicit preview action, with no saves. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldMap } from '../../src/components/WorldMap'
import { ensureAdaptiveWorld } from '../../src/sim/adaptive-world'
import { generateWorld } from '../../src/sim/generate'
import type { Layer } from '../../src/sim/types'
import '../../src/styles.css'

function Review() {
  const [world, setWorld] = useState(() => {
      const w = generateWorld('natural resources browser review', 3, 6)
      ensureAdaptiveWorld(w)
      return w
    }),
    [layer, setLayer] = useState<Layer>('resources'),
    [region, setRegion] = useState<number | null>(null)
  return (
    <main className="atlas-shell resource-review">
      <header>
        <h1>Natural resources</h1>
        <p>Paused synthetic world · no saves or model calls</p>
        <button
          className="button secondary"
          onClick={() => {
            for (const reserve of Object.values(world.localEconomy!.reserves)) reserve.iron = 0
            setWorld({ ...world, month: world.month + 1 })
          }}
        >
          Exhaust iron deposits
        </button>
      </header>
      <WorldMap
        world={world}
        mapKey="resource-preview"
        layer={layer}
        onLayer={setLayer}
        nation={0}
        region={region}
        running={false}
        focus={null}
        onSelect={setRegion}
        onInspect={setRegion}
        onClear={() => setRegion(null)}
        showRoutes={false}
        showArmies={false}
        onToggleRoutes={() => {}}
        onToggleArmies={() => {}}
        orderMode={false}
        showContext={true}
      />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Review />)
