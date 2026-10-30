/** Temporary admission is a visit, not a permanent right to station forces. */
import { diplomaticAccessView } from './agreements'
import { simulationMonths } from './simulation-period'
import { relation, type World } from './types'

/** Return a new visit record. Revocation requires immediate physical withdrawal;
 * transit/resupply grants permit three months, while basing allows an indefinite stay. */
export function militaryVisit(
  w: World,
  nation: number,
  region: number,
  previous?: { host: number; months: number },
  access = diplomaticAccessView(w),
) {
  const host = w.regions[region].control?.nation ?? w.regions[region].nation
  if (
    host < 0 ||
    host === nation ||
    relation(w, nation, host)?.treaty === 'war' ||
    access(nation, host, 'basing', region)
  )
    return { stay: undefined, withdraw: false }
  const stay = { host, months: (previous?.host === host ? previous.months : 0) + simulationMonths() }
  return { stay, withdraw: !access(nation, host, 'transit', region) || stay.months > 3 }
}
