import { capitulationObstacle } from './capitulation'
import { relation, population, type World } from './types'
import type { DiplomaticClause, DiplomaticOffer, StateAgentPlan } from './statecraft-types'
import { nativeDomesticControl } from './domestic-policy'
import { nativeStrategicControl } from './cabinet-state'
import { intelligenceService } from './intelligence'
import { sovereigntyAssessment } from './strategic-assessment'
import { tryStandingOffer, admitDiplomaticConsent, settleConventionalOffers } from './statecraft'

const clause = (kind: DiplomaticClause['kind'], from: number, to: number): DiplomaticClause => ({
  kind,
  from,
  to,
  amount: 0,
  good: '',
  field: '',
  regions: [],
  duration: 0,
  text: '',
})

export function peaceTerms(
  w: World,
  from: number,
  to: number,
  payer: number,
  payment: number,
  cede: number[],
) {
  if (relation(w, from, to)?.treaty !== 'war') throw new Error('Peace terms require an active war.')
  if (![from, to].includes(payer) || !Number.isFinite(payment) || payment < 0 || payment > 1e12)
    throw new Error('Choose a participating payer and a finite, nonnegative payment.')
  if (!Array.isArray(cede) || new Set(cede).size !== cede.length || cede.length > 24)
    throw new Error('Choose distinct provinces for the settlement.')
  const terms: DiplomaticClause[] = [
    {
      ...clause('peace', from, to),
      duration: 60,
      text: 'End hostilities for five years, implement the signed concessions and withdraw from territory not ceded.',
    },
  ]
  if (payment > 0) terms.push({ ...clause('payment', payer, payer === from ? to : from), amount: payment })
  for (const id of cede) {
    const r = w.regions[id]
    if (!r || ![from, to].includes(r.nation))
      throw new Error('Only a participating state can cede its territory.')
    terms.push({ ...clause('cede', r.nation, r.nation === from ? to : from), regions: [id] })
  }
  return terms
}

/** Each cabinet evaluates its own burden. Neither signature nor the referee is
 * a substitute for consent; cash and ownership are rechecked on settlement. */
export function acceptablePeace(w: World, nation: number, offer: DiplomaticOffer) {
  const other = offer.parties.find((id) => id !== nation)
  if (
    other === undefined ||
    relation(w, nation, other)?.treaty !== 'war' ||
    !offer.terms.some((t) => t.kind === 'peace')
  )
    return false
  const n = w.nations[nation],
    rel = relation(w, nation, other)!
  const own = w.regions.filter((r) => r.nation === nation)
  const loss = own.filter((r) => r.control?.nation === other)
  const ceded = new Set(
    offer.terms.filter((t) => t.kind === 'cede' && t.from === nation).flatMap((t) => t.regions),
  )
  const pay = offer.terms
    .filter((t) => t.kind === 'payment' && t.from === nation)
    .reduce((s, t) => s + t.amount, 0)
  const receives = offer.terms
    .filter((t) => t.kind === 'payment' && t.to === nation)
    .reduce((s, t) => s + t.amount, 0)
  const pressure =
    rel.warExhaustion / 100 + (loss.length / Math.max(1, own.length)) * 2 + (n.stability < 35 ? 0.3 : 0)
  if (pay > n.treasury * Math.min(0.65, 0.1 + pressure * 0.4)) return false
  const occupiedConcession =
    ceded.size > 0 &&
    [...ceded].every((id) => loss.some((r) => r.id === id)) &&
    ceded.size <= Math.max(1, Math.floor(own.length * 0.35)) &&
    !ceded.has(n.capital)
  if (ceded.size && !occupiedConcession && !sovereigntyAssessment(w, nation, offer).acceptable) return false
  const held = w.regions.filter((r) => r.nation === other && r.control?.nation === nation)
  const gains = offer.terms.some((t) => t.kind === 'cede' && t.to === nation) || receives > 0
  // A successful occupier can prefer bargaining to an empty armistice.
  if (held.length && !gains && rel.warExhaustion < 65 && n.foodCoverage > 0.8) return false
  return pressure >= 0.25 || gains || occupiedConcession
}

export function proposePeace(
  w: World,
  from: number,
  to: number,
  payer = from,
  payment = 0,
  cede: number[] = [],
  manual = false,
) {
  const terms = peaceTerms(w, from, to, payer, payment, cede)
  const proposal: StateAgentPlan['offers'][number] = {
    title: `${w.nations[from].shortName}–${w.nations[to].shortName} peace settlement`,
    visibility: 'public',
    parties: [from, to],
    terms,
    duration: 24,
    supersedes: 0,
  }
  return tryStandingOffer(w, from, proposal, manual)
}

export function advancePeaceNegotiations(w: World) {
  for (const rel of w.relations) {
    if (rel.treaty !== 'war') continue
    if (!capitulationObstacle(w, rel.a, rel.b) || !capitulationObstacle(w, rel.b, rel.a)) continue
    const pair = [rel.a, rel.b]
    let offer = w.statecraft?.offers.find(
      (p) =>
        p.status === 'proposed' &&
        pair.every((id) => p.parties.includes(id)) &&
        p.terms.some((t) => t.kind === 'peace'),
    )
    const occupied = w.regions.filter(
      (r) => pair.includes(r.nation) && r.control && pair.includes(r.control.nation),
    )
    const decisive =
      occupied.some((r) => w.nations[r.nation].capital === r.id) ||
      pair.some(
        (id) =>
          occupied.filter((r) => r.nation === id).length >=
          Math.max(1, w.regions.filter((r) => r.nation === id).length * 0.3),
      )
    const canNegotiate = (id: number) =>
      nativeDomesticControl(w, w.nations[id]) &&
      (nativeStrategicControl(w, w.nations[id]) || rel.warExhaustion >= 65 || decisive)
    if (!offer && (rel.warExhaustion > 30 || (occupied.length > 0 && (rel.warExhaustion > 15 || decisive)))) {
      const author = pair
        .filter(canNegotiate)
        .sort(
          (a, b) =>
            w.regions.filter((r) => r.nation === b && r.control).length -
              w.regions.filter((r) => r.nation === a && r.control).length || a - b,
        )[0]
      if (author !== undefined) {
        const other = pair.find((id) => id !== author)!
        const held = occupied.filter((r) => r.control?.nation === author)
        const lost = occupied.filter((r) => r.nation === author)
        const loser = held.length > lost.length ? other : author
        const losses = occupied
          .filter((r) => r.nation === loser && r.id !== w.nations[loser].capital)
          .sort((a, b) => population(a) - population(b) || a.id - b.id)
        const limit = decisive
          ? Math.min(3, Math.max(1, Math.floor(w.regions.filter((r) => r.nation === loser).length * 0.35)))
          : 1
        const treasury =
          loser === author
            ? w.nations[loser].treasury
            : (intelligenceService(w, author).dossiers.find((d) => d.nation === loser)?.economy?.values
                .treasury?.estimate ?? 0)
        const payment = losses.length ? Math.max(0, treasury) * (decisive ? 0.15 : 0.05) : 0
        offer =
          proposePeace(
            w,
            author,
            other,
            loser,
            payment,
            losses.slice(0, limit).map((r) => r.id),
          ) ?? undefined
      }
    }
    if (!offer) continue
    for (const id of pair)
      if (canNegotiate(id) && acceptablePeace(w, id, offer)) admitDiplomaticConsent(w, id, offer)
  }
  settleConventionalOffers(w)
}
