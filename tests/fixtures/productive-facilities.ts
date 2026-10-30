/** Explicit synthetic endowments shared by facility accounting and UI checks. */
import { generateWorld } from '../../src/sim/generate'
import { ensureFirms } from '../../src/sim/firms'
import { facilitySitePotential } from '../../src/sim/facility-investment'
import type { FacilityKind } from '../../src/sim/facility-types'
import { beginEconomyMonth } from '../../src/sim/macroeconomy'
import { habitableLand } from '../../src/sim/terrain-access'
import { inventory, population } from '../../src/sim/types'
import { rebaseEndowments } from './endowment'

/** Construction accounting needs a feasible site: an inland tile cannot stand
 * in for every fishery or precious-metal mine in the expanded catalogue. */
export function facilityFixture(kind?: FacilityKind) {
  const w = generateWorld('district productive facilities', 3, 4)
  ensureFirms(w)
  const suitable = (id: number) =>
    habitableLand(w.cells[id]) && (kind === undefined || facilitySitePotential(w, id, kind) > 0)
  const r = w.regions.find((r) => r.nation >= 0 && population(r) > 10000 && r.cells.some(suitable))!,
    n = w.nations[r.nation],
    cell = r.cells.find(suitable)!
  for (const state of w.nations) state.ai = false
  n.treasury = 10000
  n.technologies.agriculture = n.technologies.industry = n.technologies.logistics = 6
  n.foodCoverage = r.foodCoverage = 1
  r.fertility = 0.8
  r.deposits = { timber: 1, stone: 1, iron: 1, coal: 1 }
  for (const id of r.cells)
    if (habitableLand(w.cells[id]))
      w.cells[id].landscape = {
        habitat: 0.8,
        attraction: 0.5,
        resources: { timber: 1, stone: 1, iron: 1, coal: 1 },
      }
  r.stocks = inventory(100000)
  rebaseEndowments(w)
  beginEconomyMonth(w)
  for (const h of Object.values(w.economy!.households[r.id])) {
    h.laborForce = 10000
    h.employed = 0
  }
  return { w, r, n, cell }
}
