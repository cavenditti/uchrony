import { urbanFixture, type UrbanScenario } from './urban-evolution'
import { generateWorld } from '../../src/sim/generate'
import { ensureDistrictEconomy } from '../../src/sim/districts'
import { ensureUrbanFabric } from '../../src/sim/urban-fabric'
export function fundedUrbanFixture(scenario: UrbanScenario = 'market') {
  const { w, sites } = urbanFixture(scenario)
  const economyWorld = generateWorld('Urban funding')
  ensureDistrictEconomy(economyWorld)
  // Actual complete accounts and stocks; the physical scenario is prescribed.
  w.economy = economyWorld.economy
  w.nations = economyWorld.nations
  w.institutions = economyWorld.institutions
  const r = economyWorld.localEconomy!.units[0]
  Object.assign(w.localEconomy!.units[0], { stocks: r.stocks, consumption: r.consumption })
  for (const h of Object.values(w.economy!.households[0])) {
    h.laborForce = 1000
    h.employed = 0
  }
  w.economy!.producers[0].wage = 1
  ensureUrbanFabric(w)
  return { w, sites }
}
