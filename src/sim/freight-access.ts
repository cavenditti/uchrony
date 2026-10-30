/** Display recent cargo only while its route remains open. Completed shipments
 * stay in history and the accounts even when a later declaration closes trade. */
import { seaPassageView } from './naval-control'
import { tradePolicy } from './trade-policy'
import type { Route, World } from './types'

/** Build once per map snapshot, never per animation frame. Peaceful maps need
 * no route scans; closures use the same phase-local rules as market clearing. */
export function currentFreightVolumeView(world: World): (route: Route) => number {
  const constrained = world.relations?.some(
    (r) =>
      r.treaty === 'war' ||
      (r.aPolicy && r.aPolicy.trade !== 'normal') ||
      (r.bPolicy && r.bPolicy.trade !== 'normal'),
  )
  if (!constrained) return (route) => route.volume
  const policy = tradePolicy(world),
    passage = seaPassageView(world)
  return (route) => {
    if (!route.legs) return 0
    const from = world.regions[route.from].nation,
      to = world.regions[route.to].nation
    if (!policy.routeAllowed(from, to, route.legs) || !passage(from, route.legs) || !passage(to, route.legs))
      return 0
    // Restricted trade bans arms. Do not apply capacity attenuation twice to
    // shipments already limited by the market's quota and naval calculations.
    return policy.routeAllowed(from, to, route.legs, 'arms')
      ? route.volume
      : Math.max(0, route.volume - route.goods.arms)
  }
}
