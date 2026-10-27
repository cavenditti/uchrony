import { tick } from './engine'
import type { World } from './types'

export const FAST_FORWARD_MONTHS = 6

/** A multirate approximation: settle goods, money, births and deaths monthly;
 * reconsider spatial job search, migration, social mobility and housing locations at the boundary.
 * Housing uses aggregate shortages; new plots are surveyed only at the boundary.
 * Every retained job is still limited by current vacancies, workers and cash.
 */
export function fastForwardMonth(world: World): boolean {
  const previous = world.fastForward ?? { months: 0, lastMonth: world.month, phase: 0 }
  const phase = (previous.phase + 1) % FAST_FORWARD_MONTHS
  tick(world, phase === 0 ? 'reconcile' : 'coarse')
  world.fastForward = { months: previous.months + 1, lastMonth: world.month, phase }
  return phase === 0
}
