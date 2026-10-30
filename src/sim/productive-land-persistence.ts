/** Strict bounds for optional cell-addressed capital in legacy and current saves. */
import { MAX_LAND_LEVEL } from './productive-land'
import { numberValidator, recordValue, validationFailure } from './persistence-primitives'
import type { World } from './types'

export function validateProductiveLand(w: World) {
  const state = w.productiveLand
  if (state === undefined) return
  const fail = validationFailure('Invalid world save: ', '', ''),
    number = numberValidator(0, 1e14)
  const cell = (id: number) => Number.isInteger(id) && !!w.cells[id] && w.cells[id].terrain !== 'water'
  if (
    !recordValue(state) ||
    !recordValue(state.levels) ||
    !Array.isArray(state.projects) ||
    state.projects.length > w.cells.length
  )
    fail('invalid productive land')
  for (const [id, level] of Object.entries(state.levels))
    if (
      String(Number(id)) !== id ||
      !cell(Number(id)) ||
      !Number.isInteger(level) ||
      !number(level, 1, MAX_LAND_LEVEL)
    )
      fail('invalid productive land level')
  const pending = new Set<number>()
  for (const p of state.projects) {
    if (
      !recordValue(p) ||
      !cell(p.cell) ||
      pending.has(p.cell) ||
      !Number.isInteger(p.nation) ||
      !w.nations[p.nation] ||
      !Number.isInteger(p.funded) ||
      !number(p.funded, 0, w.month) ||
      !Number.isInteger(p.completes) ||
      !number(p.completes - p.funded, 1, 120) ||
      !Number.isInteger(p.level) ||
      p.level !== (state.levels[p.cell] ?? 0) + 1 ||
      !number(p.level, 1, MAX_LAND_LEVEL) ||
      !number(p.cost, Number.MIN_VALUE)
    )
      fail('invalid productive land project')
    pending.add(p.cell)
  }
}
