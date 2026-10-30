import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SovereignRelations } from '../../src/components/SovereignRelations'
import { sovereignFixture } from '../fixtures/sovereign-world'
import { applyCommand } from '../../src/sim/commands'
import { advanceRoyalDiplomacy } from '../../src/sim/royal-diplomacy'
import type { Command } from '../../src/sim/types'
import '../../src/styles.css'
import './development-war.css'

function Fixture() {
  const [war, setWar] = useState(() => sovereignFixture(true).w)
  const [peace, setPeace] = useState(() => sovereignFixture().w)
  const [, render] = useState(0)
  const [message, setMessage] = useState('Isolated qualification worlds. No saving or model calls.')
  const execute = (world: typeof war) => (command: Command) => {
    try {
      setMessage(applyCommand(world, command))
      render((n) => n + 1)
    } catch (error) {
      setMessage(String(error))
    }
  }
  return (
    <main className="development-review">
      <h1>Royal diplomacy and capitulation</h1>
      <p role="status">{message}</p>
      <button
        className="button secondary"
        onClick={() => {
          setWar(sovereignFixture(true).w)
          setPeace(sovereignFixture().w)
          setMessage('Worlds reset.')
        }}
      >
        Reset worlds
      </button>
      <div className="development-review-columns">
        <section aria-label="Defeated state">
          <h2>Complete occupation</h2>
          <p>One remaining province is securely occupied.</p>
          <SovereignRelations
            key={`war:${war.seed}`}
            world={war}
            nation={0}
            target={1}
            command={execute(war)}
          />
          <p>
            Defeated treasury: {war.nations[1].treasury.toFixed(3)}k. Provinces:{' '}
            {war.regions.filter((r) => r.nation === 1).length}.
          </p>
        </section>
        <section aria-label="Royal partners">
          <h2>Two independent crowns</h2>
          <SovereignRelations world={peace} nation={0} target={1} command={execute(peace)} />
          <button
            className="button secondary"
            onClick={() => {
              const offer = peace.statecraft?.offers.find((o) => o.status === 'proposed')
              if (offer) {
                peace.month = Math.max(peace.month, offer.notBefore ?? 0)
                execute(peace)({ type: 'royal-answer', nation: 1, offer: offer.id, accept: true })
              }
            }}
          >
            Counterparty signs after preparation
          </button>
          <button
            className="button secondary"
            onClick={() => {
              peace.month += 12
              advanceRoyalDiplomacy(peace)
              render((n) => n + 1)
            }}
          >
            Advance one year
          </button>
        </section>
      </div>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
