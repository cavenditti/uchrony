import { generateWorld } from '../../src/sim/generate'
import { ensureCharacters } from '../../src/sim/character'
import { ensureDynasties } from '../../src/sim/dynasties'
import { establishControl } from '../../src/sim/military-control'
import { demobilizeState } from '../../src/sim/state-succession'
import { musterArmy } from '../../src/sim/recruitment'
import { relation } from '../../src/sim/types'
import { beginEconomyMonth } from '../../src/sim/macroeconomy'
import { ensureDistrictEconomy, aggregateDistricts } from '../../src/sim/districts'
import { rebaseEndowments } from './endowment'

/** Deterministic one-province monarchies with real civilian and military cohorts. */
export function sovereignFixture(war = false) {
  const w = generateWorld('royal succession and capitulation', 3, 4, undefined, 'regional', 'frontier')
  for (const n of w.nations) {
    n.ai = false
    n.treasury = 1000
    n.government = 'Monarchy'
    n.legitimacy = 80
  }
  ensureCharacters(w)
  ensureDynasties(w)
  ensureDistrictEconomy(w)
  rebaseEndowments(w)
  beginEconomyMonth(w)
  for (const n of w.nations) demobilizeState(w, n.id)
  const home = w.regions[w.nations[0].capital],
    last = w.regions[w.nations[1].capital]
  const army = musterArmy(w, home, {
    nation: 0,
    name: 'Victor',
    soldiers: 200,
    establishment: 200,
    morale: 1,
    supply: 1,
    experience: 0.5,
    armsPerSoldier: 0,
  })
  const enemy = musterArmy(w, last, {
    nation: 1,
    name: 'Defeated',
    soldiers: 40,
    establishment: 40,
    morale: 0.3,
    supply: 0.3,
    experience: 0,
    armsPerSoldier: 0,
  })
  army.operations!.cohesion = enemy.operations!.cohesion = 1
  const rel = relation(w, 0, 1)!
  rel.opinion = 80
  if (war) {
    rel.treaty = 'war'
    army.region = last.id
    establishControl(w, last.id, 0)
  }
  aggregateDistricts(w)
  return { w, army, enemy, last }
}
