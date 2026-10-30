/** Controlled district choices; never loads a personal save or contacts a provider. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FacilityDevelopment } from '../../src/components/FacilityDevelopment'
import { ensureAdaptiveWorld } from '../../src/sim/adaptive-world'
import { applyCommand } from '../../src/sim/commands'
import { refreshEndowment } from '../../src/sim/districts'
import { economicRegions } from '../../src/sim/local-units'
import { completeFacilityProjects } from '../../src/sim/productive-facilities'
import { inventory, type Command } from '../../src/sim/types'
import { beginEconomyMonth } from '../../src/sim/macroeconomy'
import { facilityFixture } from '../fixtures/productive-facilities'
import { rebaseEndowments } from '../fixtures/endowment'
import '../../src/styles.css'

function create() {
  const { w, r } = facilityFixture()
  ensureAdaptiveWorld(w)
  const units = economicRegions(w).filter((u) => u.province === r.id && u.population.adults > 0)
  units.forEach((unit, i) => {
    unit.name = i ? `Mixed hinterland ${i}` : 'Ore valley'
    unit.stocks = inventory(1000)
    for (const cell of unit.cells) {
      w.localEconomy!.reserves[cell].iron = i ? 0 : 300000
      w.localEconomy!.reserves[cell].coal = i ? 0 : 300000
      if (w.cells[cell].landscape) {
        w.cells[cell].landscape!.resources.iron = i ? 0 : 2
        w.cells[cell].landscape!.resources.coal = i ? 0 : 2
      }
    }
    refreshEndowment(w, unit as NonNullable<typeof w.localEconomy>['units'][number], false)
  })
  rebaseEndowments(w)
  beginEconomyMonth(w)
  for (const unit of units)
    for (const h of Object.values(w.economy!.households[unit.id])) {
      h.laborForce = 10000
      h.employed = 0
    }
  return { w, r }
}
function Review() {
  const [{ w, r }] = useState(create),
    [, render] = useState(0),
    [message, setMessage] = useState('Paused synthetic districts. No saving or model calls.')
  const command = (c: Command) => {
    setMessage(applyCommand(w, c))
    render((n) => n + 1)
  }
  return (
    <main className="facility-review">
      <h1>District facilities</h1>
      <p role="status">{message}</p>
      <p>
        Ore valley has iron and coal; the neighboring hinterland has no mineral reserve. Compare mines,
        workshops and markets.
      </p>
      <div className="review-actions">
        <button
          className="button secondary"
          onClick={() => {
            w.month += 6
            completeFacilityProjects(w)
            for (const id of w.localEconomy!.active) refreshEndowment(w, w.localEconomy!.units[id], false)
            render((n) => n + 1)
          }}
        >
          Complete six months of construction
        </button>
      </div>
      <aside className="inspector">
        <FacilityDevelopment world={w} province={r.id} command={command} />
      </aside>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Review />)
