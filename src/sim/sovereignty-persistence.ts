import { integerValidator, numberValidator, validationFailure } from './persistence-primitives'
import type { World } from './types'
import { MAX_STATE_IDENTITIES } from './types'
export function validateSovereignty(world: World) {
  const state = world.sovereignty
  if (state === undefined) return
  const fail = validationFailure('Invalid provincial protection or political organization in this save.'),
    integer = integerValidator(0, Infinity, false),
    unit = numberValidator(0, 1)
  if (
    !state ||
    !Array.isArray(state.provinces) ||
    state.provinces.length > world.regions.length ||
    !Array.isArray(state.successors) ||
    state.successors.length > MAX_STATE_IDENTITIES
  )
    fail()
  const ids = new Set<number>()
  for (const report of state.provinces) {
    if (
      !report ||
      !integer(report.region, 0, world.regions.length - 1) ||
      ids.has(report.region) ||
      !integer(report.nation, 0, world.nations.length - 1) ||
      !integer(report.since, 0, world.month) ||
      !integer(report.warned, 0, world.month) ||
      !integer(report.neglect, 0, world.month + 1) ||
      (report.isolation !== undefined && !integer(report.isolation, 0, world.month + 1)) ||
      !integer(report.contested, 0, world.month + 1) ||
      !unit(report.protection) ||
      !unit(report.organization) ||
      !unit(report.support) ||
      !integer(report.mobilizable, 0, 1e9) ||
      typeof report.loyalStrength !== 'number' ||
      !Number.isFinite(report.loyalStrength) ||
      report.loyalStrength < 0 ||
      report.loyalStrength > 1e9 ||
      !integer(report.movement, -1, (world.demography?.identities.length ?? 0) - 1) ||
      (report.movement !== -1 && world.demography?.identities[report.movement]?.kind !== 'movement') ||
      !['stable', 'fragile', 'organizing', 'contested'].includes(report.stage)
    )
      fail()
    ids.add(report.region)
  }
  const successors = new Set<number>()
  for (const entry of state.successors) {
    if (
      !entry ||
      !integer(entry.nation, 0, world.nations.length - 1) ||
      !integer(entry.parent, 0, world.nations.length - 1) ||
      entry.nation === entry.parent ||
      successors.has(entry.nation) ||
      !integer(entry.movement, 0, (world.demography?.identities.length ?? 0) - 1) ||
      world.demography?.identities[entry.movement]?.kind !== 'movement'
    )
      fail()
    successors.add(entry.nation)
  }
  if (state.frontiers !== undefined) {
    if (!Array.isArray(state.frontiers) || state.frontiers.length > world.regions.length) fail()
    const regions = new Set<number>()
    for (const entry of state.frontiers) {
      if (
        !entry ||
        !integer(entry.region, 0, world.regions.length - 1) ||
        regions.has(entry.region) ||
        !integer(entry.since, 0, world.month) ||
        !integer(entry.updated, entry.since, world.month) ||
        !integer(entry.nation, -1, world.nations.length - 1) ||
        !unit(entry.influence) ||
        !integer(entry.mandate, 0, world.month) ||
        !integer(entry.prosperity, 0, world.month) ||
        !(
          entry.city === null ||
          (integer(entry.city, 0, (world.localEconomy?.nextCity ?? 0) - 1) &&
            world.localEconomy?.cities.some((city) => city.id === entry.city))
        )
      )
        fail()
      regions.add(entry.region)
    }
  }
}
