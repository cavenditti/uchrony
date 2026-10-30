/** A compact dynastic model: houses, named heirs and marriage claims, rather than
 * a complete family census. Succession dates and heir availability are seeded once
 * per reign, so pausing, loading or asking for a quote cannot reroll an inheritance. */
import { generatedLeaderName, replaceStateLeader } from './character'
import { recordWorldEvent } from './event-memory'
import { hashSeed } from './random'
import { dependencyObstacle, dependencyOf, establishDependency } from './state-dependencies'
import { clamp, relation, type World } from './types'

/** The current reign and its next succession; dates are absolute simulation months. */
export interface RoyalCrown {
  nation: number
  house: string
  ruler: string
  heir: string | null
  generation: number
  succession: number
}
/** A continuing alliance between named representatives of the recorded royal houses. */
export interface RoyalMarriage {
  a: number
  b: number
  since: number
  houseA: string
  houseB: string
  royalA: string
  royalB: string
}
/** Saveable claims and the last monthly evaluation, preventing duplicate succession. */
export interface DynasticState {
  crowns: RoyalCrown[]
  marriages: RoyalMarriage[]
  advanced: number
}
/** Royal terms supported by the ordinary consent and settlement pipeline. */
export type RoyalAgreement = 'royal-marriage' | 'personal-union'
/** Government names currently carry constitutional form throughout the simulation. */
export const isMonarchy = (w: World, nation: number) =>
  /monarch|kingdom|crown|empire/i.test(w.nations[nation]?.government ?? '')
/** Return an existing crown without initializing or advancing simulation state. */
export const crownOf = (w: World, nation: number) => w.dynasties?.crowns.find((c) => c.nation === nation)
/** Marriage is symmetric; the senior/junior direction belongs to a later union. */
export const marriageOf = (w: World, a: number, b: number) =>
  a === b ? undefined : w.dynasties?.marriages.find((m) => [m.a, m.b].includes(a) && [m.a, m.b].includes(b))

function reign(w: World, nation: number, house: string): RoyalCrown {
  const n = w.nations[nation],
    leader = n.character!.leader
  const seed = hashSeed(`${w.seed}:crown:${nation}:${leader.generation}:${leader.since}`)
  return {
    nation,
    house,
    ruler: leader.name,
    generation: leader.generation,
    heir: seed % 5 === 0 ? null : generatedLeaderName(w, n, leader.generation + 1),
    // Reigns last 15–35 years in this abstraction; this is not a mortality calibration.
    succession: w.month + 180 + (seed % 241),
  }
}

/** Initializes old saves lazily, without changing accounts, populations or existing leaders. */
export function ensureDynasties(w: World) {
  const state = (w.dynasties ??= { crowns: [], marriages: [], advanced: -1 })
  const monarchies = new Set(w.regions.map((r) => r.nation).filter((id) => id >= 0 && isMonarchy(w, id)))
  state.crowns = state.crowns.filter((c) => monarchies.has(c.nation))
  const existing = new Set(state.crowns.map((c) => c.nation))
  for (const id of monarchies)
    if (!existing.has(id) && w.nations[id].character)
      state.crowns.push(reign(w, id, `House of ${w.nations[id].shortName}`))
  // The crown registry can also be refreshed between monthly advances, for
  // example by signing a treaty after a constitutional change. Keep claims valid.
  state.marriages = state.marriages.filter((m) => monarchies.has(m.a) && monarchies.has(m.b))
  return state
}

/** A voluntary union requires an established dynastic link; conquest has a separate authority test. */
export function royalAgreementObstacle(w: World, kind: RoyalAgreement, senior: number, junior: number) {
  if (senior === junior || !w.nations[senior] || !w.nations[junior]) return 'Choose two distinct monarchies.'
  if (![senior, junior].every((id) => isMonarchy(w, id) && w.regions.some((r) => r.nation === id)))
    return 'Royal agreements require two living monarchies.'
  if (relation(w, senior, junior)?.treaty === 'war')
    return 'End the war before negotiating a royal agreement.'
  if (kind === 'royal-marriage') {
    if (marriageOf(w, senior, junior)) return 'These royal houses are already joined by marriage.'
    if (
      [senior, junior].some(
        (id) => (w.dynasties?.marriages.filter((m) => m.a === id || m.b === id).length ?? 0) >= 4,
      )
    )
      return 'This house already has four active marriage alliances.'
    return ''
  }
  const obstacle = dependencyObstacle(w, senior, junior)
  if (obstacle) return obstacle
  const marriage = marriageOf(w, senior, junior)
  return !marriage || w.month - marriage.since < 12
    ? 'A personal union requires a royal marriage established for at least one year.'
    : ''
}

/** Native consent values kinship, legitimacy and independence; a player still decides for their own state. */
export function acceptsRoyalAgreement(
  w: World,
  nation: number,
  kind: RoyalAgreement,
  senior: number,
  junior: number,
) {
  if (royalAgreementObstacle(w, kind, senior, junior)) return false
  const opinion = relation(w, senior, junior)?.opinion ?? -100
  if (kind === 'royal-marriage') return opinion >= 25 && w.nations[nation].legitimacy >= 35
  return (
    nation === senior ||
    (opinion >= 65 &&
      w.nations[senior].legitimacy >= 60 &&
      w.nations[junior].legitimacy >= 40 &&
      (w.nations[junior].character?.leader.politics?.drives.dominance ?? 0.5) < 0.65)
  )
}

/** Both crowns name the same person, but keep separate administrations, debts and armies. */
export function synchronizeUnionRulers(w: World) {
  for (const d of w.dependencies ?? [])
    if (d.kind === 'personal-union') {
      const senior = w.nations[d.senior],
        junior = w.nations[d.junior]
      if (!senior.character || !junior.character) continue
      if (
        junior.character.leader.name !== senior.character.leader.name ||
        junior.character.leader.generation !== senior.character.leader.generation
      )
        junior.character.leader = structuredClone(senior.character.leader)
      const crown = crownOf(w, d.junior),
        parent = crownOf(w, d.senior)
      if (crown && parent) Object.assign(crown, { ...parent, nation: d.junior })
      const society = w.historical?.societies.find((s) => s.nation === d.junior)
      if (society) {
        society.leader = senior.character.leader.name
        society.since = senior.character.leader.since
      }
    }
}

/** Used only after the appropriate consent or occupation authority has been checked. */
export function formPersonalUnion(w: World, senior: number, junior: number, imposed = false) {
  if (!isMonarchy(w, senior) || !isMonarchy(w, junior))
    throw new Error('A personal union requires two monarchies.')
  ensureDynasties(w)
  establishDependency(w, senior, junior, 'personal-union', imposed)
  synchronizeUnionRulers(w)
}

/** Signed royal terms are native operations, with no model referee required. */
export function applyRoyalAgreement(w: World, kind: RoyalAgreement, senior: number, junior: number) {
  const obstacle = royalAgreementObstacle(w, kind, senior, junior)
  if (obstacle) throw new Error(obstacle)
  const state = ensureDynasties(w)
  if (kind === 'personal-union') {
    formPersonalUnion(w, senior, junior)
    return
  }
  const a = crownOf(w, senior)!,
    b = crownOf(w, junior)!
  state.marriages.push({
    a: senior,
    b: junior,
    since: w.month,
    houseA: a.house,
    houseB: b.house,
    royalA: marriageRepresentative(w, a),
    royalB: marriageRepresentative(w, b),
  })
  const rel = relation(w, senior, junior)!
  rel.opinion = clamp(rel.opinion + 10, -100, 100)
}

/** Several allied houses require different adult relatives, not repeated marriages of the same heir. */
function marriageRepresentative(w: World, crown: RoyalCrown) {
  const used = new Set(
    (w.dynasties?.marriages ?? []).flatMap((m) =>
      m.a === crown.nation ? [m.royalA] : m.b === crown.nation ? [m.royalB] : [],
    ),
  )
  if (crown.heir && !used.has(crown.heir)) return crown.heir
  for (let offset = 2; offset < 64; offset++) {
    const name = generatedLeaderName(w, w.nations[crown.nation], crown.generation + offset)
    if (!used.has(name)) return name
  }
  return `${crown.house} royal relative ${used.size + 1}`
}

/** Monthly work is bounded by crowns and at most four marriage ties per state. */
export function advanceDynasties(w: World) {
  const state = ensureDynasties(w)
  if (state.advanced === w.month) return
  state.advanced = w.month
  const crowns = new Map(state.crowns.map((c) => [c.nation, c]))
  state.marriages = state.marriages.filter(
    (m) =>
      crowns.get(m.a)?.house === m.houseA &&
      crowns.get(m.b)?.house === m.houseB &&
      relation(w, m.a, m.b)?.treaty !== 'war',
  )
  // A republic or war between the crowns ends a personal union, not its residents or debts.
  if (w.dependencies)
    w.dependencies = w.dependencies.filter(
      (d) =>
        d.kind !== 'personal-union' ||
        (crowns.has(d.senior) && crowns.has(d.junior) && relation(w, d.senior, d.junior)?.treaty !== 'war'),
    )
  for (const marriage of state.marriages) {
    const rel = relation(w, marriage.a, marriage.b)!
    rel.opinion = clamp(rel.opinion + 0.15, -100, 100)
  }
  for (const crown of state.crowns) {
    if (dependencyOf(w, crown.nation)?.kind === 'personal-union') continue
    const n = w.nations[crown.nation]
    if (n.character!.leader.name !== crown.ruler || n.character!.leader.generation !== crown.generation) {
      Object.assign(crown, reign(w, n.id, crown.house))
      continue
    }
    if (w.month < crown.succession) continue
    const candidate =
      crown.heir === null
        ? state.marriages
            .filter((m) => [m.a, m.b].includes(n.id) && w.month - m.since >= 12)
            .map((m) => (m.a === n.id ? m.b : m.a))
            .filter(
              (id) =>
                !dependencyObstacle(w, id, n.id) &&
                w.nations[id].legitimacy >= 40 &&
                (relation(w, id, n.id)?.opinion ?? -100) >= 0,
            )
            .sort(
              (a, b) => (relation(w, b, n.id)?.opinion ?? 0) - (relation(w, a, n.id)?.opinion ?? 0) || a - b,
            )[0]
        : undefined
    if (candidate !== undefined) {
      formPersonalUnion(w, candidate, n.id)
      royalEvent(
        w,
        n.id,
        `${n.shortName} enters a personal union`,
        `No direct heir remains. The marriage claim brings the crown under ${w.nations[candidate].character!.leader.name}; both states retain their own accounts and laws.`,
      )
    } else {
      const name = crown.heir ?? generatedLeaderName(w, n, crown.generation + 1)
      const house = crown.heir ? crown.house : `House of ${name}`
      replaceStateLeader(w, n.id, name)
      Object.assign(crown, reign(w, n.id, house))
      royalEvent(
        w,
        n.id,
        `${name} succeeds to the crown`,
        `${house} begins a new reign. ${crown.heir ? `The designated heir is ${crown.heir}.` : 'There is no direct heir; an established marriage may provide a future succession claim.'}`,
      )
    }
  }
  synchronizeUnionRulers(w)
}

function royalEvent(w: World, nation: number, title: string, detail: string) {
  recordWorldEvent(w, { id: w.nextEvent++, month: w.month, type: 'diplomacy', nation, title, detail })
}
