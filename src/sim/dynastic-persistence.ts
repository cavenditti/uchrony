/** Save validation checks constitutional topology and dated claims before any
 * restored data can authorize a ruler, a transfer or a foreign-policy decision. */
import {
  finiteNumber,
  integerNumber,
  recordValue,
  textValidator,
  worldValidators,
} from './persistence-primitives'
import type { World } from './types'

/** Reject malformed or ambiguous saved claims before they can confer authority. */
export function validateDynasticState(w: World) {
  const fail = (detail: string): never => {
    throw new Error(`Invalid dynastic save: ${detail}`)
  }
  const nation = worldValidators(w).nationId,
    text = textValidator(200, 1)
  if (w.dependencies !== undefined) {
    if (!Array.isArray(w.dependencies) || w.dependencies.length > w.nations.length) fail('dependencies')
    const juniors = new Set<number>()
    for (const d of w.dependencies) {
      if (
        !recordValue(d) ||
        !nation(d.senior) ||
        !nation(d.junior) ||
        d.senior === d.junior ||
        juniors.has(d.junior) ||
        !['subject', 'personal-union'].includes(d.kind) ||
        !integerNumber(d.since, 0, w.month) ||
        typeof d.imposed !== 'boolean' ||
        d.tribute !== (d.kind === 'subject' ? 0.15 : 0) ||
        !finiteNumber(d.paid, 0, 1e16)
      )
        fail('dependency authority')
      juniors.add(d.junior)
    }
    if (w.dependencies.some((d) => juniors.has(d.senior))) fail('dependency chains or cycles')
  }
  const s = w.dynasties
  if (s === undefined) return
  if (
    !recordValue(s) ||
    !Array.isArray(s.crowns) ||
    s.crowns.length > w.nations.length ||
    !Array.isArray(s.marriages) ||
    s.marriages.length > w.nations.length * 2 ||
    !integerNumber(s.advanced, -1, w.month)
  )
    fail('collections')
  const crowns = new Set<number>(),
    pairs = new Set<string>(),
    counts = new Map<number, number>()
  for (const c of s.crowns) {
    if (
      !recordValue(c) ||
      !nation(c.nation) ||
      crowns.has(c.nation) ||
      !text(c.house) ||
      !text(c.ruler) ||
      (c.heir !== null && !text(c.heir)) ||
      !integerNumber(c.generation, 0, 1e6) ||
      !integerNumber(c.succession, 0, w.month + 421)
    )
      fail('crown')
    crowns.add(c.nation)
  }
  for (const m of s.marriages) {
    if (
      !recordValue(m) ||
      !nation(m.a) ||
      !nation(m.b) ||
      m.a === m.b ||
      !crowns.has(m.a) ||
      !crowns.has(m.b) ||
      !integerNumber(m.since, 0, w.month) ||
      !text(m.houseA) ||
      !text(m.houseB) ||
      !text(m.royalA) ||
      !text(m.royalB)
    )
      fail('marriage')
    const key = `${Math.min(m.a, m.b)}:${Math.max(m.a, m.b)}`
    if (pairs.has(key)) fail('duplicate marriage')
    pairs.add(key)
    for (const id of [m.a, m.b]) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
      if (counts.get(id)! > 4) fail('marriage limit')
    }
  }
}
