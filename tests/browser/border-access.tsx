import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BorderAccess } from '../../src/components/BorderAccess'
import { ArmyLogistics, NavalForces } from '../../src/components/MilitaryOperations'
import { generateWorld } from '../../src/sim/generate'
import { applyCommand } from '../../src/sim/commands'
import { relation, type Command } from '../../src/sim/types'
import { rebaseEndowments } from '../fixtures/endowment'
import '../../src/styles.css'
import './development-war.css'

/** Real command wiring in an ephemeral world; no persistence or model service. */
function Fixture() {
  const [world] = useState(() => {
    const w = generateWorld('border UI qualification', 3, 4)
    for (const n of w.nations) {
      n.ai = false
      n.treasury = 100000
    }
    relation(w, 0, 1)!.treaty = 'neutral'
    rebaseEndowments(w)
    return w
  })
  const [, render] = useState(0),
    [message, setMessage] = useState('Changes apply to this review world only.')
  const command = (c: Command) => {
    try {
      setMessage(applyCommand(world, c))
    } catch (error) {
      setMessage(String(error))
    }
    render((n) => n + 1)
  }
  return (
    <main className="development-review">
      <h1>Trade and military access</h1>
      <p role="status">{message}</p>
      <button
        className="button secondary"
        onClick={() => {
          const rel = relation(world, 0, 1)!
          rel.treaty = rel.treaty === 'war' ? 'neutral' : 'war'
          render((n) => n + 1)
        }}
      >
        Toggle war for review
      </button>
      <div className="development-review-columns">
        <section aria-label="Diplomatic controls">
          <BorderAccess world={world} nation={0} target={1} command={command} />
        </section>
        <section aria-label="Military controls">
          <h2>Military operations</h2>
          <ArmyLogistics world={world} army={world.armies.find((a) => a.nation === 0)!} command={command} />
          <NavalForces world={world} nation={0} command={command} />
        </section>
      </div>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
