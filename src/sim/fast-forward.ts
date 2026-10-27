import { advanceCoarsePeriod } from './engine'
import type { World } from './types'

export const FAST_FORWARD_MONTHS = 6

/** One six-month production/consumption and cohort integration. Local migration,
 * household assets, housing, employment and settlement census reconcile at the end.
 * Legacy partial intervals finish their remaining months before starting a new block.
 */
export function fastForwardStep(world: World): boolean {
  const previous = world.fastForward ?? { months: 0, lastMonth: world.month, phase: 0 }
  const months = FAST_FORWARD_MONTHS - previous.phase
  advanceCoarsePeriod(world, months)
  world.fastForward = { months: previous.months + months, lastMonth: world.month, phase: 0 }
  return true
}
