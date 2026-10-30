/** Political subordination leaves local property and public accounts intact.
 * A state has at most one superior; flat dependencies avoid ambiguous chains of command. */
import { publicTransfer } from './ledger'
import { periodFlow } from './simulation-period'
import { clamp, relation, type World } from './types'

/** A direct constitutional superior, with a funded fiscal obligation for subject states. */
export interface StateDependency {
  senior: number
  junior: number
  kind: 'subject' | 'personal-union'
  since: number
  imposed: boolean
  /** Share of current public receipts, never a grant of newly created money. */
  tribute: number
  paid: number
}

/** Public constitutional relationships; historical events preserve ended arrangements. */
export const dependencyOf = (w: World, nation: number) => w.dependencies?.find((d) => d.junior === nation)
/** Sibling dependencies share access through their common superior. */
export const sameSovereign = (w: World, a: number, b: number) =>
  a !== b && (dependencyOf(w, a)?.senior ?? a) === (dependencyOf(w, b)?.senior ?? b)

/** Independence cannot be signed away twice, nor can a subject acquire its own subjects. */
export function dependencyObstacle(w: World, senior: number, junior: number, replaceSuperior = false) {
  if (senior === junior || !w.nations[senior] || !w.nations[junior]) return 'Choose two distinct states.'
  if (dependencyOf(w, senior)) return 'A subordinate state cannot acquire another state.'
  if (!replaceSuperior && dependencyOf(w, junior)) return 'This state already has a superior.'
  if (w.dependencies?.some((d) => d.senior === junior))
    return 'Resolve this state’s existing dependencies first.'
  if ([senior, junior].some((id) => !w.regions.some((r) => r.nation === id)))
    return 'Both states need territory.'
  return ''
}

/** All entry points share the constitutional invariant, including imposed settlements. */
export function establishDependency(
  w: World,
  senior: number,
  junior: number,
  kind: StateDependency['kind'],
  imposed: boolean,
) {
  const obstacle = dependencyObstacle(w, senior, junior, imposed)
  if (obstacle) throw new Error(obstacle)
  // Complete defeat can replace an earlier overlord; voluntary treaties cannot
  // dispose of that third party's authority without its participation.
  if (imposed && w.dependencies) w.dependencies = w.dependencies.filter((d) => d.junior !== junior)
  ;(w.dependencies ??= []).push({
    senior,
    junior,
    kind,
    imposed,
    since: w.month,
    tribute: kind === 'subject' ? 0.15 : 0,
    paid: 0,
  })
}

/** A senior controls offensive diplomacy; defensive commitments remain separately authorized. */
export function dependencyMandate(w: World, nation: number, parties: readonly number[]) {
  const d = dependencyOf(w, nation)
  return !d || parties.includes(d.senior)
}

/** Public leverage explains actual constitutional and dynastic influence, not hidden military strength. */
export function diplomaticInfluence(w: World, actor: number, target: number) {
  if (actor === target) return 0
  const dependency = dependencyOf(w, target)
  if (dependency?.senior === actor) return dependency.kind === 'subject' ? 90 : 75
  const marriage = w.dynasties?.marriages.some(
    (m) => [m.a, m.b].includes(actor) && [m.a, m.b].includes(target),
  )
  return clamp((marriage ? 25 : 0) + Math.max(0, relation(w, actor, target)?.opinion ?? 0) * 0.2, 0, 100)
}

/** O(states + dependencies), once per month after public revenue is booked. */
export function advanceDependencies(w: World) {
  if (!w.dependencies?.length) return
  const alive = new Set(w.regions.map((r) => r.nation))
  w.dependencies = w.dependencies.filter((d) => alive.has(d.senior) && alive.has(d.junior))
  for (const d of w.dependencies) {
    const junior = w.nations[d.junior]
    const due = Math.min(junior.treasury, Math.max(0, junior.income) * periodFlow(d.tribute))
    if (due > 0) {
      const paid = publicTransfer(w, d.junior, d.senior, due, 'subject tribute')
      junior.spending += paid
      // Do not add tribute to taxable receipts and recursively tax the same transfer.
      d.paid += paid
    }
  }
}
