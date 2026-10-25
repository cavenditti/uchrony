import assert from 'node:assert/strict'
import { corridorCost, corridorProfile, corridorUsage, learnCorridors } from '../src/sim/corridors'
import { refreshTransport, transportNetwork } from '../src/sim/transport'
import { completedFreight, independentHarbors as parallelHarbors } from './fixtures/corridors'

// Legacy independent survey: one established crossing, with a parallel port pair nearby.
// This isolates corridor learning from population, supplier, war and price changes.
const world = parallelHarbors(),
  base = transportNetwork(world),
  trunk = base.links.find((link) => link.from === 0 && link.to === 1)!,
  original = base.links.find((link) => link.from === 2 && link.to === 3)!,
  profile = corridorProfile(world),
  trunkEdges = corridorUsage(profile, trunk.legs),
  overlap = (legs: typeof trunk.legs) =>
    [...corridorUsage(profile, legs).keys()].filter((index) => trunkEdges.has(index)).length,
  rawCost = (legs: typeof trunk.legs) => {
    let effort = legs.filter((leg) => leg.mode === 'sea').length * 2
    for (const [index, count] of corridorUsage(profile, legs)) effort += profile.baseCost[index] * count
    return effort
  }
let changes = 0,
  firstMergeMonth: number | null = null,
  previous = JSON.stringify(original.legs)
for (let month = 0; month <= 48; month++) {
  world.month = month
  const current = corridorProfile(world)
  refreshTransport(world, current)
  const neighbor = transportNetwork(world).links.find((link) => link.from === 2 && link.to === 3)!,
    path = JSON.stringify(neighbor.legs)
  if (path !== previous) changes++
  if (overlap(neighbor.legs) > overlap(original.legs) && firstMergeMonth === null) firstMergeMonth = month
  previous = path
  world.routes = [completedFreight(trunk)]
  learnCorridors(world, current)
}
const learned = transportNetwork(world).links.find((link) => link.from === 2 && link.to === 3)!,
  final = corridorProfile(world),
  saving = 1 - corridorCost(final, learned.legs) / corridorCost(final, original.legs)
assert(overlap(learned.legs) > overlap(original.legs) + 20)
assert(firstMergeMonth! >= 12)
console.log(
  JSON.stringify(
    {
      months: 48,
      sharedSegmentsBefore: overlap(original.legs),
      sharedSegmentsAfter: overlap(learned.legs),
      neighborSegmentsBefore: corridorUsage(profile, original.legs).size,
      neighborSegmentsAfter: corridorUsage(profile, learned.legs).size,
      unreinforcedEffortBefore: rawCost(original.legs),
      unreinforcedEffortAfter: rawCost(learned.legs),
      learnedCostSaving: saving,
      firstMergeMonth,
      pathChanges: changes,
    },
    null,
    2,
  ),
)
