import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useState } from 'react'
import { PlaceAtlas } from '../../src/components/PlaceAtlas'
import { ModelAssignments } from '../../src/components/ModelAssignments'
import { generateWorld } from '../../src/sim/generate'
import { advanceAlmanac, queryPlaces } from '../../src/sim/almanac'
import { recordWorldEvent } from '../../src/sim/event-memory'
import type { PlaceQuery, PlaceResult } from '../../src/sim/almanac-types'
import type { WorkerRequest, WorkerResponse } from '../../src/sim/types'
import '../../src/styles.css'
const world = generateWorld('Atlas qualification', 2, 4, undefined, 'regional')
recordWorldEvent(world, {
  id: world.nextEvent++,
  month: 0,
  type: 'economy',
  title: 'The first workshops',
  detail: 'The settlement’s public record lists the opening workshops.',
  region: 0,
  nation: 0,
})
advanceAlmanac(world, true)
const worker = new Worker(new URL('../../src/sim/worker.ts', import.meta.url), { type: 'module' })
worker.postMessage({ type: 'load', world } satisfies WorkerRequest)
function Fixture() {
  const [settings, setSettings] = useState(false),
    [result, setResult] = useState<PlaceResult | null>(queryPlaces(world, { id: 0 })),
    [refresh, setRefresh] = useState(0),
    [enabled, setEnabled] = useState(false),
    [jobs, setJobs] = useState<Record<string, { state: string; message?: string }>>({}),
    [ready, setReady] = useState(false)
  const query = useCallback(
    (q: Omit<PlaceQuery, 'id'>) =>
      worker.postMessage({ type: 'places', query: { ...q, id: 1 } } satisfies WorkerRequest),
    [],
  )
  useEffect(() => {
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'world') {
        setReady(true)
        worker.postMessage({ type: 'snapshot-ack', mapKey: data.mapKey } satisfies WorkerRequest)
      }
      if (data.type === 'places') setResult(data.result)
      if (data.type === 'llm-policy') setEnabled(data.policy.enabled)
      if (data.type === 'world-writing') {
        setJobs((j) => ({ ...j, [data.id]: data }))
        if (data.state === 'done') setRefresh((x) => x + 1)
      }
    }
    return () => {
      worker.onmessage = null
    }
  }, [])
  return (
    <div className="app-shell atlas-shell">
      <header className="topbar atlas-header">
        <strong>Atlas qualification</strong>
        <span role="status">{ready ? 'Worker ready' : 'Loading worker…'}</span>
        <button className="button" onClick={() => setSettings((v) => !v)}>
          {settings ? 'Places' : 'Model assignments'}
        </button>
        <button
          className="button"
          onClick={() =>
            worker.postMessage({ type: 'llm-policy', enabled: !enabled } satisfies WorkerRequest)
          }
        >
          {enabled ? 'Disable test models' : 'Enable test models'}
        </button>
      </header>
      <main className="atlas-main" style={{ position: 'relative', height: 'calc(100dvh - 54px)' }}>
        {settings ? (
          <div className="fixture-models">
            <ModelAssignments
              onSaved={() => worker.postMessage({ type: 'models-changed' } satisfies WorkerRequest)}
            />
          </div>
        ) : (
          <PlaceAtlas
            result={result}
            startYear={world.startYear}
            currentMonth={world.month}
            enabled={enabled}
            jobs={jobs}
            refresh={refresh}
            onQuery={query}
            onWrite={(request) =>
              worker.postMessage({ type: 'world-writing', request } satisfies WorkerRequest)
            }
            onClose={() => setSettings(true)}
            onLocate={() => {}}
          />
        )}
      </main>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
