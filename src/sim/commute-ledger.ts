import { STRATA, type EconomicStratum } from './economic-types'
import type { CommuteFlow } from './adaptive-types'
import type { World } from './types'

/** Residence, firm, physical route, then five exact FTE counts and five wage payments. */
export type CommuteRow = [number, number, string, ...number[]]
const indexes = new WeakMap<CommuteRow[], Map<number, Map<number, CommuteRow>>>()
const residenceIndexes = new WeakMap<CommuteRow[], Map<number, CommuteRow[]>>()
export function recordCommute(
  w: World,
  residence: number,
  firm: number,
  route: string,
  stratum: EconomicStratum,
  workers: number,
  wages: number,
) {
  if (!w.adaptive || workers <= 0) return
  const rows = (w.adaptive.commutingRows ??= [])
  let index = indexes.get(rows)
  if (!index) {
    index = new Map()
    indexes.set(rows, index)
  }
  let byFirm = index.get(residence)
  if (!byFirm) index.set(residence, (byFirm = new Map()))
  let row = byFirm.get(firm)
  if (!row) {
    row = [residence, firm, route, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    byFirm.set(firm, row)
    rows.push(row)
  }
  const slot = STRATA.indexOf(stratum)
  row[3 + slot] = (row[3 + slot] as number) + workers
  row[8 + slot] = (row[8 + slot] as number) + wages
  return row
}
function* expand(w: World, rows: CommuteRow[]): Generator<CommuteFlow> {
  for (const row of rows) {
    const path = w.adaptive!.commuteRoutes![row[2]]
    for (let s = 0; s < 5; s++)
      if (row[3 + s])
        yield {
          residence: row[0],
          workplace: `firm:${row[1]}`,
          route: row[2],
          stratum: STRATA[s],
          workers: row[3 + s] as number,
          wage: row[8 + s] as number,
          minutes: path.minutes,
          mode: path.mode,
        }
  }
}
export function* commuteFlows(w: World): Generator<CommuteFlow> {
  yield* w.adaptive?.commuting ?? [] // legacy uncompressed records remain readable
  yield* expand(w, w.adaptive?.commutingRows ?? [])
}
export function commutesAt(w: World, residence: number) {
  const rows = w.adaptive?.commutingRows ?? []
  let index = residenceIndexes.get(rows)
  if (!index) {
    index = new Map()
    for (const row of rows) {
      const entries = index.get(row[0]) ?? []
      entries.push(row)
      index.set(row[0], entries)
    }
    residenceIndexes.set(rows, index)
  }
  return [
    ...(w.adaptive?.commuting.filter((flow) => flow.residence === residence) ?? []),
    ...expand(w, index.get(residence) ?? []),
  ]
}
