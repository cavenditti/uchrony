/** Untrusted facility records must conserve finite land slots and exact tier
 * progression. Commissioned capital does not require its former owner's technology. */
import { isFacilityKind, MAX_FACILITY_LEVELS } from './facility-types'
import { numberValidator, recordValue, validationFailure } from './persistence-primitives'
import type { World } from './types'

export function validateFacilities(w: World) {
  const state = w.facilities
  if (state === undefined) return
  const fail = validationFailure('Invalid world save: ', '', ''),
    num = numberValidator(0, 1e14)
  const cell = (id: number) => Number.isInteger(id) && !!w.cells[id] && w.cells[id].terrain !== 'water'
  if (
    !recordValue(state) ||
    !recordValue(state.sites) ||
    !Array.isArray(state.projects) ||
    state.projects.length > w.cells.length
  )
    fail('invalid facility system')
  for (const [id, site] of Object.entries(state.sites)) {
    if (String(Number(id)) !== id || !cell(Number(id)) || !recordValue(site)) fail('invalid facility site')
    let used = 0
    for (const [kind, level] of Object.entries(site)) {
      if (!isFacilityKind(kind) || !Number.isInteger(level) || !num(level, 1, MAX_FACILITY_LEVELS))
        fail('invalid facility level')
      used += level
    }
    if (!used || used > MAX_FACILITY_LEVELS) fail('invalid facility land capacity')
  }
  const pending = new Set<number>()
  for (const p of state.projects) {
    if (
      !recordValue(p) ||
      !cell(p.cell) ||
      !isFacilityKind(p.kind) ||
      pending.has(p.cell) ||
      !Number.isInteger(p.nation) ||
      !w.nations[p.nation] ||
      !Number.isInteger(p.level) ||
      p.level !== (state.sites[p.cell]?.[p.kind] ?? 0) + 1 ||
      !num(p.level, 1, MAX_FACILITY_LEVELS) ||
      Object.values(state.sites[p.cell] ?? {}).reduce((sum, level) => sum + level, 0) >=
        MAX_FACILITY_LEVELS ||
      !Number.isInteger(p.funded) ||
      !num(p.funded, 0, w.month) ||
      !Number.isInteger(p.completes) ||
      !num(p.completes - p.funded, 1, 120) ||
      !num(p.cost, Number.MIN_VALUE)
    )
      fail('invalid facility project')
    pending.add(p.cell)
  }
}
