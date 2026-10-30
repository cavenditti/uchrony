import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld } from '../src/sim/engine'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { ensureFirms } from '../src/sim/firms'
import { commuteRoute, knownCommuteCandidates, matchCommuters } from '../src/sim/commuting'
import { recordCommute } from '../src/sim/commute-ledger'
import { localFirmRegion } from '../src/sim/local-units'
import { cellPosition } from '../src/sim/physical-space'

function fixture() {
  const w = generateWorld('commute-review', 3, 8, undefined, 'regional', 'settled')
  prepareSpatialWorld(w)
  ensureFirms(w)
  beginEconomyMonth(w)
  const units = Object.values(w.localEconomy!.units)
  for (const pools of Object.values(w.economy!.households))
    for (const h of Object.values(pools)) {
      h.laborForce = 0
      h.employed = 0
    }
  for (const f of w.economy!.firms!) {
    f.labor = { opening: 0, retained: 0, hires: 0, separations: 0, vacancies: 0, unfilled: 0 }
    f.employment = 0
    f.payroll = 0
  }
  for (const residence of units) {
    const origin = cellPosition(w, residence.center)
    for (const firm of w.economy!.firms!) {
      const workplace = w.localEconomy!.units[localFirmRegion(firm)]
      const cell = firm.cell ?? workplace.center
      const destination = cellPosition(w, cell)
      if (
        !firm.active ||
        residence.id === workplace.id ||
        residence.nation !== workplace.nation ||
        residence.province === workplace.province ||
        Math.hypot(origin.x - destination.x, origin.y - destination.y) > 6000
      )
        continue
      const route = commuteRoute(w, residence.center, cell)
      if (!route) continue
      firm.labor!.unfilled = 100
      firm.cash = 10000
      firm.wage = 1
      w.economy!.households[residence.id].laborer.laborForce = 100
      w.adaptive!.commutingRows = []
      w.adaptive!.commuteRoutes = {}
      return { w, residence, workplace, firm, route }
    }
  }
  throw new Error('Fixture needs reachable workplaces in two same-country provinces')
}

test('an empty commuting history still discovers reachable funded vacancies', () => {
  const { w, residence, firm } = fixture()
  const known = knownCommuteCandidates(w)
  assert.equal(known?.size, 0)
  matchCommuters(w, known)
  assert.equal(firm.employment, 35)
  assert.equal(w.economy!.households[residence.id].laborer.employed, 35)
  assert.equal(w.adaptive!.commutingRows!.length, 1)
})

for (const disruption of ['devastation', 'ownership'] as const)
  test(`retained journeys are revalidated after ${disruption} changes`, () => {
    const { w, residence, workplace, firm, route } = fixture()
    const id = `${residence.center}:${firm.cell ?? workplace.center}`
    w.adaptive!.commuteRoutes![id] = route
    recordCommute(w, residence.id, firm.id, id, 'laborer', 35, 35)
    const known = knownCommuteCandidates(w)
    assert(known?.get(residence.id)?.has(firm.id))
    // Seed a valid cached search before changing access within this same month.
    if (disruption === 'devastation') w.regions[workplace.province].devastation = 1
    else w.regions[workplace.province].nation = (residence.nation + 1) % w.nations.length
    const cash = firm.cash
    matchCommuters(w, known)
    assert.equal(firm.employment, 0)
    assert.equal(firm.cash, cash, 'an inaccessible workplace must not pay commuter wages')
    assert.equal(w.economy!.households[residence.id].laborer.employed, 0)
  })
