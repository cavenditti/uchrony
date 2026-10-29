import {
  integerValidator,
  numberValidator,
  textValidator,
  validationFailure,
  worldValidators,
} from './persistence-primitives'
import type { World } from './types'

export function validateForeignOffices(w: World) {
  const state = w.foreignOffices
  if (state === undefined) return
  const number = numberValidator(0, 1e16),
    integer = integerValidator(0, 1e12, false),
    nation = worldValidators(w).nationId,
    text = textValidator(Infinity, 0),
    fail = validationFailure('Invalid foreign office workload or diplomatic expenditure in this save.')
  if (!state || !Array.isArray(state.offices) || state.offices.length > w.nations.length) fail()
  const ids = new Set<number>()
  for (const o of state.offices) {
    if (
      !o ||
      !nation(o.nation) ||
      ids.has(o.nation) ||
      !number(o.load, 0, 24) ||
      !number(o.spent) ||
      !number(o.totalSpent) ||
      o.spent > o.totalSpent ||
      !integer(o.lastMonth, 0, w.month) ||
      !text(o.notice, 500) ||
      !Array.isArray(o.initiatives) ||
      o.initiatives.length > 96
    )
      fail()
    ids.add(o.nation)
    for (const i of o.initiatives)
      if (
        !i ||
        !integer(i.month, 0, w.month) ||
        !text(i.key, 40) ||
        !text(i.pressure, 2000) ||
        !['proposal', 'message'].includes(i.kind) ||
        !integer(i.offer) ||
        !Array.isArray(i.parties) ||
        i.parties.length > 32 ||
        !i.parties.includes(o.nation) ||
        new Set(i.parties).size !== i.parties.length ||
        i.parties.some((id) => !nation(id))
      )
        fail()
  }
}
