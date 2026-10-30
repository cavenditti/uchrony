import { advanceCoarsePeriod } from './engine'
import type { World } from './types'

import { FAST_FORWARD_MONTHS } from './simulation-invariants'
export { FAST_FORWARD_MONTHS } from './simulation-invariants'

/** One six-month production/consumption and cohort integration. Local migration,
 * household assets, housing, employment and settlement census reconcile at the end.
 */
export function fastForwardStep(world: World): boolean {
  const previous = world.fastForward?.months ?? 0
  advanceCoarsePeriod(world, FAST_FORWARD_MONTHS)
  world.fastForward = { months: previous + FAST_FORWARD_MONTHS, lastMonth: world.month }
  return true
}
