/** Physical districts own implementation; provincial identity evolution consumes a
 * population-weighted rollup rather than treating a declaration as funded action. */
import { governance } from './governance'
import { economicRegions } from './local-units'
import { realService } from './public-services'
import { periodRate } from './simulation-period'
import { population, type Region, type World } from './types'
import {
  IDENTITY_POLICY_KEYS,
  ZERO_IDENTITY_POLICY,
  policyCapacityTargets,
  resolveIdentityPolicy,
  type IdentityPolicy,
} from './identity-policy'

/** A new administration starts without implementation; adjustment takes months.
 * Losing purchased capacity also erodes implementation instead of minting services. */
export function advanceIdentityImplementation(world: World, region: Region) {
  const metrics = region.populationDynamics!
  if (metrics.identityPolicyMonth === world.month) return
  const perPerson = Math.max(1, population(region) / 10000)
  const targets = policyCapacityTargets(
    resolveIdentityPolicy(governance(world, region.nation).policies),
    realService(world, region, 'education') / perPerson,
    (realService(world, region, 'administration') + realService(world, region, 'policing')) / perPerson,
  )
  const applied = metrics.appliedIdentityPolicy ?? { ...ZERO_IDENTITY_POLICY }
  const rate = periodRate(0.04)
  for (const key of IDENTITY_POLICY_KEYS) applied[key] += (targets[key] - applied[key]) * rate
  metrics.appliedIdentityPolicy = applied
  metrics.identityPolicyMonth = world.month
}

/** O(districts × eight fields), once per identity phase, independent of communities. */
export function provincialIdentityImplementation(world: World): IdentityPolicy[] {
  const policies = world.regions.map(() => ({ ...ZERO_IDENTITY_POLICY }))
  const totals = new Float64Array(world.regions.length)
  for (const unit of economicRegions(world)) {
    const province = unit.province ?? unit.id
    const people = population(unit)
    const applied = unit.populationDynamics?.appliedIdentityPolicy ?? ZERO_IDENTITY_POLICY
    totals[province] += people
    for (const key of IDENTITY_POLICY_KEYS) policies[province][key] += applied[key] * people
  }
  for (let id = 0; id < policies.length; id++)
    if (totals[id]) for (const key of IDENTITY_POLICY_KEYS) policies[id][key] /= totals[id]
  return policies
}
