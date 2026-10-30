/** Civilian landing grants never grant army transit or naval basing rights. */
import { agreementTerms } from './agreements'
import { controlsProvince } from './military-control'
import { portBlockadeView } from './naval-control'
import { activeExpedition } from './overseas-types'
import type { Fleet } from './military-types'
import { relation, type World } from './types'

/** Settlement permission is distinct from commerce or military transit. */
export function settlementPermission(w: World, nation: number, province: number) {
  const r = w.regions[province]
  if (!r || (r.control && r.control.nation !== nation)) return false
  if (r.nation === nation || r.nation === -1 || controlsProvince(w, province, nation)) return true
  return (
    relation(w, nation, r.nation)?.treaty !== 'war' &&
    w.nations[r.nation].policies.migration !== 'closed' &&
    agreementTerms(w, 'settlement').some(
      ({ term }) =>
        term.from === r.nation &&
        term.to === nation &&
        (!term.regions.length || term.regions.includes(province)),
    )
  )
}

/** Only the reserved carrier can use the expedition's scoped civilian grant. */
export function civilianLanding(w: World, fleet: Fleet, province: number) {
  return (
    !fleet.embarked.length &&
    portBlockadeView(w)(fleet.nation, province) > 0 &&
    settlementPermission(w, fleet.nation, province) &&
    !!w.overseas?.expeditions.some(
      (e) =>
        activeExpedition(e) && e.fleet === fleet.id && e.nation === fleet.nation && e.arrival === province,
    )
  )
}
