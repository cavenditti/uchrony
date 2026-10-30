/** Isolated fixture exercises real commands and snapshots without loading user saves. */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IdentityPolicyControls } from '../../src/components/IdentityPolicyControls'
import { PopulationIdentities } from '../../src/components/PopulationIdentities'
import { generateWorld } from '../../src/sim/generate'
import { applyCommand, tick } from '../../src/sim/engine'
import { viewSnapshot } from '../../src/sim/view-snapshot'
import type { Policies } from '../../src/sim/types'
import '../../src/styles.css'

const world = generateWorld('Identity policy browser', 3, 6, undefined, 'regional')
for (const n of world.nations) n.ai = false
function Fixture() {
  const [snapshot, setSnapshot] = useState(() => viewSnapshot(world, 0))
  const [result, setResult] = useState('Ready')
  function change(key: keyof Policies, value: Policies[keyof Policies]) {
    setResult(applyCommand(world, { type: 'policy', nation: 0, key, value }))
    setSnapshot(viewSnapshot(world, 0))
  }
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 20 }}>
      <h1>Identity and citizenship</h1>
      <p role="status">{result}</p>
      <IdentityPolicyControls policies={snapshot.nations[0].policies} onChange={change} />
      <button
        onClick={() => {
          tick(world)
          setSnapshot(viewSnapshot(world, 0))
          setResult(`Month ${world.month}`)
        }}
      >
        Advance one month
      </button>
      <PopulationIdentities world={snapshot} nation={0} />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
