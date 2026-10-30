/** Isolated real-world fixture: controls execute normal commands, never edit a user's save. */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NavalForces } from '../../src/components/MilitaryOperations'
import { generateWorld } from '../../src/sim/generate'
import { prepareSpatialWorld } from '../../src/sim/engine'
import { applyCommand } from '../../src/sim/commands'
import { intelligenceService } from '../../src/sim/intelligence'
import { aggregateDistricts } from '../../src/sim/districts'
import { overseasOptions } from '../../src/sim/overseas'
import { transportNetwork } from '../../src/sim/transport'
import { GOODS, population, type Command } from '../../src/sim/types'
import { viewSnapshot } from '../../src/sim/view-snapshot'
import '../../src/styles.css'

const world = generateWorld('Overseas families', 5, 8, undefined, 'regional', 'frontier')
prepareSpatialWorld(world)
for (const n of world.nations) {
  n.ai = false
  n.treasury = 100000
  intelligenceService(world, n.id).chart = world.regions.map((r) => ({
    id: r.id,
    name: r.name,
    nation: r.nation,
    neighbors: r.neighbors,
    coastal: r.coastal,
    terrain: r.terrain,
    month: 0,
  }))
}
for (const id of world.localEconomy!.active) {
  const u = world.localEconomy!.units[id]
  if (u.nation >= 0) for (const g of GOODS) u.stocks[g] = 100000
}
aggregateDistricts(world)
for (const h of transportNetwork(world).harbors) {
  const r = world.regions[h.region]
  if (r.nation >= 0 && population(r) >= 1000)
    applyCommand(world, { type: 'commission', nation: r.nation, region: r.id, warships: 0, transports: 2 })
}
const nation = world.nations.find((n) => overseasOptions(world, n.id, 1).length)!.id
function Fixture() {
  const [snapshot, setSnapshot] = useState(() => ({ ...viewSnapshot(world, nation), cells: world.cells }))
  const [result, setResult] = useState('')
  function command(c: Command) {
    try {
      setResult(applyCommand(world, c))
    } catch (error) {
      setResult(String(error))
    }
    setSnapshot({ ...viewSnapshot(world, nation), cells: world.cells })
  }
  return (
    <main style={{ maxWidth: 400, margin: '24px auto', padding: 20 }}>
      <h1>{world.nations[nation].shortName} · Maritime affairs</h1>
      {result && <p role="status">{result}</p>}
      <NavalForces world={snapshot} nation={nation} command={command} />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
