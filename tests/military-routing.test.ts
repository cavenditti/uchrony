/** Military supply must follow access in the delivery direction, including occupied territory. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { transportGraph } from '../src/sim/economy'
import { advanceArmies } from '../src/sim/military'
import { establishControl, occupationStrengthRequired } from '../src/sim/military-control'
import { ensureWarfare } from '../src/sim/navy'
import { transportNetwork } from '../src/sim/transport'
import { relation } from '../src/sim/types'
import { rebaseEndowments } from './fixtures/endowment'

/** An allied occupation permits local presence while the neutral legal owner bars entry. */
function supplyWorld() {
  const w = generateWorld('directional military supplies', 3, 4)
  ensureWarfare(w)
  for (const nation of w.nations) {
    nation.ai = false
    nation.treasury = 10000
  }
  for (const army of w.armies) {
    army.target = null
    army.operations!.stance = 'hold'
  }
  const link = transportNetwork(w).links.find(
    (link) =>
      link.legs.every((leg) => leg.mode === 'land') &&
      w.regions[link.from].nation !== w.regions[link.to].nation,
  )!
  assert(link)
  const home = w.regions[link.from],
    outpost = w.regions[link.to],
    traveler = home.nation,
    neutral = outpost.nation,
    ally = w.nations.find((nation) => nation.id !== traveler && nation.id !== neutral)!.id,
    army = w.armies.find((army) => army.nation === traveler)!,
    garrison = w.armies.find((army) => army.nation === ally)!
  relation(w, traveler, neutral)!.treaty = 'neutral'
  relation(w, traveler, ally)!.treaty = 'alliance'
  relation(w, ally, neutral)!.treaty = 'war'
  for (const defender of w.armies)
    if (defender.nation === neutral && defender.region === outpost.id)
      defender.region = w.regions.find((region) => region.nation === neutral && region.id !== outpost.id)!.id
  army.region = garrison.region = outpost.id
  garrison.supply = garrison.morale = 1
  assert(garrison.soldiers >= occupationStrengthRequired(w, outpost.id))
  establishControl(w, outpost.id, ally)
  army.operations!.food = army.operations!.arms = 0
  army.operations!.conduct = 'restrained'
  w.nations[traveler].capital = home.id
  for (const region of w.regions)
    if (region.nation === traveler && region.id !== home.id) region.infrastructure = 0.1
  home.stocks.food = home.stocks.arms = 100000
  rebaseEndowments(w)
  return { w, home, outpost, traveler, neutral, army }
}

test('an army cannot reverse an exit-only route into a supply delivery', () => {
  const { w, home, outpost, traveler, army } = supplyWorld(),
    graph = transportGraph(w, traveler)
  assert(
    graph[outpost.id].some((edge) => edge.to === home.id),
    'the army may leave neutral territory',
  )
  assert(!graph[home.id].some((edge) => edge.to === outpost.id), 'supply may not enter neutral territory')

  advanceArmies(w)
  assert.equal(w.warfare!.deliveries.filter((delivery) => delivery.army === army.id).length, 0)
  assert.equal(army.operations!.source, null)
  assert.deepEqual(army.operations!.line, [])
})

test('permitted supplies retain their depot-to-army path and physical leg orientation', () => {
  const { w, home, outpost, traveler, neutral, army } = supplyWorld()
  relation(w, traveler, neutral)!.treaty = 'alliance'
  advanceArmies(w)
  const deliveries = w.warfare!.deliveries.filter((delivery) => delivery.army === army.id)
  assert.equal(deliveries.length, 1)
  const [delivery] = deliveries
  assert(delivery.food > 0 && delivery.arms > 0)
  assert.equal(delivery.from, home.id)
  assert.deepEqual(delivery.path, [home.id, outpost.id])
  assert.equal(delivery.legs[0].cells[0], home.center)
  assert.equal(delivery.legs.at(-1)!.cells.at(-1), outpost.center)
  assert.equal(army.operations!.source, home.id)
  assert.deepEqual(army.operations!.line, delivery.path)
})

test('an army at its own depot receives local supplies without a transport edge', () => {
  const { w, home, army } = supplyWorld()
  army.region = home.id
  advanceArmies(w)
  const deliveries = w.warfare!.deliveries.filter((delivery) => delivery.army === army.id)
  assert.equal(deliveries.length, 1)
  const [delivery] = deliveries
  assert(delivery.food > 0 && delivery.arms > 0)
  assert.deepEqual(delivery.path, [home.id])
  assert.deepEqual(delivery.legs, [])
})
