import { highMountain } from '../../src/sim/terrain-access'
import { traversableLegs } from '../../src/sim/transport'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorldMap } from '../../src/components/WorldMap'
import { spatialState } from '../../src/sim/spatial'
import { groundRoads } from '../../src/map/ground-roads'
import type { Layer, World } from '../../src/sim/types'
import '../../src/styles.css'
import './map-stress.css'

function Fixture() {
  const worker = useRef<Worker | null>(null)
  const [world, setWorld] = useState<World | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('')
  const [layer, setLayer] = useState<Layer>('terrain'),
    [region, setRegion] = useState<number | null>(null)
  const [focus, setFocus] = useState<{ region: number; key: number; settlement: string } | null>(null)
  const [area, setArea] = useState('')
  const [candidate, setCandidate] = useState<{ cell: number; region: number; name: string } | null>(null)
  useEffect(() => {
    const instance = new Worker(new URL('./quadtree-world.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = ({ data }) => {
      if (data.error) setError(data.error)
      else {
        setError('')
        setWorld(data.world)
        setCandidate(data.candidate)
        if (data.message) setArea(data.message)
      }
      setBusy(false)
    }
    instance.postMessage({
      create: true,
      start: new URLSearchParams(location.search).get('start') === 'settled' ? 'settled' : 'frontier',
    })
    return () => instance.terminate()
  }, [])
  if (!world) return <p role="status">{error || 'Preparing the isolated quadtree world…'}</p>
  const cities = [...spatialState(world).settlements].sort((a, b) => b.population - a.population)
  const homes = world.viewHomes ?? []
  const peaks = world.cells.filter(highMountain)
  const highest = peaks.reduce((best, c) => (c.elevation > best.elevation ? c : best), peaks[0])
  Object.assign(window, {
    quadtreeWorld: world,
    quadtreeReport: {
      month: world.month,
      mountainCells: peaks.length,
      mountainResidents: homes
        .filter((h) => highMountain(world.cells[h.cell]))
        .reduce((n, h) => n + (h.residents ?? 0), 0),
      mountainBuildings: homes.filter((h) => h.building && highMountain(world.cells[h.cell])).length,
      blockedRoutes: world.routes.filter((r) => r.legs && !traversableLegs(world, r.legs)).length,
      states: world.nations.length,
      buildings: homes.filter((h) => h.building).length,
      localLanes: world.adaptive?.lanes?.length ?? 0,
      tradeRoads: groundRoads(world).filter((r) => r.kind === 'trade').length,
      economicPools: world.localEconomy?.active.length,
      minimumSpan: world.adaptive?.minimumSpan,
      settlements: cities.length,
      unclaimed: world.regions.filter((r) => r.nation < 0).length,
      candidate,
      leaves: world.viewMesh?.addresses.length,
      residents: homes.reduce((n, h) => n + (h.residents ?? 0), 0),
      developed: homes.filter((h) => h.developed).length,
      construction: homes.filter((h) => h.construction! > 0).length,
      capacity: homes.reduce((n, h) => n + h.capacity, 0),
      meshBytes:
        JSON.stringify(world.viewMesh?.addresses).length + (world.viewMesh?.population.byteLength ?? 0) * 3,
      plots: homes
        .filter((h) => h.developed || h.construction! > 0)
        .map(({ id, residents, capacity, parcel, construction }) => ({
          id,
          residents,
          capacity,
          parcel,
          construction,
        })),
      error,
    },
  })
  return (
    <>
      <header
        className="stress-header"
        style={{ flexWrap: 'wrap', height: 'auto', minHeight: 54, padding: '8px 16px', gap: 10 }}
      >
        <span>Month {world.month} · isolated world · no saving or model calls</span>
        <select
          aria-label="Explore settlement"
          defaultValue=""
          onChange={(e) => {
            const city = cities.find((s) => s.id === e.target.value)
            if (city) setFocus({ region: city.region, key: Date.now(), settlement: city.id })
          }}
        >
          <option value="" disabled>
            Explore a settlement
          </option>
          {cities.slice(0, 30).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            worker.current?.postMessage({ months: 6 })
          }}
        >
          {busy ? 'Simulating…' : 'Advance six months'}
        </button>
        {highest && (
          <button
            onClick={() => {
              setRegion(highest.region)
              setFocus({ region: highest.region, key: Date.now(), settlement: '' })
            }}
          >
            Explore mountains
          </button>
        )}
        {candidate && (
          <button
            disabled={busy}
            onClick={() => {
              setRegion(candidate.region)
              setFocus({ region: candidate.region, key: Date.now(), settlement: '' })
            }}
          >
            Explore frontier · {candidate.name}
          </button>
        )}
        {area && <span role="status">{area}</span>}
        {error && <span role="alert">{error}</span>}
      </header>
      <main className="atlas-shell stress-map">
        <WorldMap
          world={world}
          mapKey="quadtree-fixture"
          layer={layer}
          nation={0}
          onFound={(cell) => {
            setBusy(true)
            worker.current?.postMessage({ command: { type: 'found-settlement', nation: 0, cell } })
          }}
          region={region}
          showRoutes={false}
          showArmies={false}
          running={false}
          focus={focus}
          onSelect={setRegion}
          onLayer={setLayer}
          onInspect={() => {}}
          onClear={() => setRegion(null)}
          onToggleRoutes={() => {}}
          onToggleArmies={() => {}}
          orderMode={false}
          showContext={true}
          onInspectArea={(b) => setArea(`Inspected ${b.size} m at ${b.x}, ${b.y}`)}
        />
      </main>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
