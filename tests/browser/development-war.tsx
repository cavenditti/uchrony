import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PeaceNegotiation } from '../../src/components/PeaceNegotiation'
import { ArmyLogistics } from '../../src/components/MilitaryOperations'
import { generateWorld } from '../../src/sim/generate'
import { applyCommand } from '../../src/sim/engine'
import { establishControl, pillageProvince } from '../../src/sim/military-control'
import { relation, type Command } from '../../src/sim/types'
import { beginEconomyMonth } from '../../src/sim/macroeconomy'
import { rebaseEndowments } from '../fixtures/endowment'
import '../../src/styles.css'
import './development-war.css'

function create() {
  const w = generateWorld('peace browser fixture', 3, 4)
  for (const n of w.nations) {
    n.ai = false
    n.treasury = 1000
  }
  const a = w.armies.find((a) => a.nation === 0)!,
    r = w.regions.find((r) => r.nation === 1 && r.id !== w.nations[1].capital)!
  for (const enemy of w.armies.filter((a) => a.nation === 1)) enemy.region = w.nations[1].capital
  a.region = r.id
  a.morale = a.supply = 1
  a.operations!.cohesion = 1
  a.operations!.stance = 'hold'
  relation(w, 0, 1)!.treaty = 'war'
  relation(w, 0, 1)!.warExhaustion = 60
  establishControl(w, r.id, 0)
  w.month = 6
  rebaseEndowments(w)
  beginEconomyMonth(w)
  return { w, army: a.id, region: r.id }
}
function Fixture() {
  const [data, setData] = useState(create),
    [, render] = useState(0),
    [message, setMessage] = useState('Isolated fixture. No saving or model calls.')
  const { w, army, region } = data
  const command = (c: Command) => {
    try {
      setMessage(applyCommand(w, c))
      render((n) => n + 1)
    } catch (error) {
      setMessage(String(error))
    }
  }
  return (
    <main className="development-review">
      <h1>Development and peace controls</h1>
      <p role="status">{message}</p>
      <p>
        Month {w.month}. Owner: {w.nations[w.regions[region].nation].shortName}. Controller:{' '}
        {w.regions[region].control ? w.nations[w.regions[region].control!.nation].shortName : 'none'}.
        Treasury: {w.nations[0].treasury.toFixed(3)}k.
      </p>
      <button
        className="button secondary"
        onClick={() => {
          setData(create())
          setMessage('Fixture reset.')
        }}
      >
        Reset fixture
      </button>
      <button
        className="button secondary"
        onClick={() => {
          w.month++
          pillage()
        }}
      >
        Collect occupation levy
      </button>
      <div className="development-review-columns">
        <ArmyLogistics world={w} army={w.armies.find((a) => a.id === army)!} command={command} />
        <div>
          <PeaceNegotiation world={w} nation={0} target={1} command={command} />
          <button
            className="button secondary"
            onClick={() => {
              const p = w.statecraft?.offers
                .filter((p) => p.status === 'proposed' && p.terms.some((t) => t.kind === 'peace'))
                .at(-1)
              if (p) {
                w.month = Math.max(w.month, p.notBefore ?? 0)
                command({ type: 'peace-answer', nation: 1, offer: p.id, accept: true })
              }
            }}
          >
            Counterparty signs after preparation
          </button>
        </div>
      </div>
    </main>
  )
  function pillage() {
    const paid = pillageProvince(
      w,
      w.armies.find((a) => a.id === army)!,
    )
    setMessage(`Occupation levy: ${paid.toFixed(3)}k`)
    render((n) => n + 1)
  }
}
createRoot(document.getElementById('root')!).render(<Fixture />)
