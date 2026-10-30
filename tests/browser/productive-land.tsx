/** Isolated paid-project review. No saves, providers or background simulation. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Inspector } from '../../src/components/Inspector'
import { WorldOverview } from '../../src/components/WorldOverview'
import { generateWorld } from '../../src/sim/generate'
import { ensureFirms } from '../../src/sim/firms'
import { beginEconomyMonth } from '../../src/sim/macroeconomy'
import { completeLandProjects } from '../../src/sim/productive-land'
import { applyCommand } from '../../src/sim/commands'
import { inventory, population, type Command } from '../../src/sim/types'
import { rebaseEndowments } from '../fixtures/endowment'
import '../../src/styles.css'

function create() {
  const w = generateWorld('productive land browser review', 3, 4)
  ensureFirms(w)
  for (const n of w.nations) {
    n.ai = false
    n.treasury = 10000
    n.technologies.agriculture = n.technologies.industry = n.technologies.logistics = 6
  }
  const r = w.regions.find((r) => r.nation >= 0 && population(r) > 10000)!
  r.fertility = 1.2
  r.stocks = inventory(100000)
  rebaseEndowments(w)
  beginEconomyMonth(w)
  for (const h of Object.values(w.economy!.households[r.id])) {
    h.laborForce = 10000
    h.employed = 0
  }
  // Ranking observation for the paused synthetic economy, not a recorded goods flow.
  r.production.food = 1000
  return { w, r }
}
function Review() {
  const [{ w, r }] = useState(create),
    [, render] = useState(0),
    [message, setMessage] = useState('Paused synthetic fixture. No saving or model calls.'),
    [table, setTable] = useState(false)
  const command = (c: Command) => {
    setMessage(applyCommand(w, c))
    render((n) => n + 1)
  }
  return (
    <main className="land-review">
      <h1>Productive land development</h1>
      <p role="status">{message}</p>
      <div className="review-actions">
        <button
          className="button secondary"
          onClick={() => {
            w.month += 6
            completeLandProjects(w)
            render((n) => n + 1)
          }}
        >
          Complete six months of works
        </button>
        <button className="button secondary" onClick={() => setTable(!table)}>
          {table ? 'Show province' : 'Show world accounts'}
        </button>
      </div>
      {table ? (
        <WorldOverview world={w} nation={r.nation} onNation={() => {}} onCommand={command} />
      ) : (
        <Inspector
          world={w}
          nationId={r.nation}
          regionId={r.id}
          tab="atlas"
          onTab={() => {}}
          onCommand={command}
          agentStatus={{ pending: 0, active: [], decisionModel: '', strategyModel: '', error: '' }}
          onStrategy={() => {}}
          onEventDetails={() => {}}
          pendingDetails={[]}
          onFocus={() => {}}
          onRegion={() => {}}
          onNation={() => {}}
          onArmy={() => {}}
          orderedArmy={null}
        />
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Review />)
