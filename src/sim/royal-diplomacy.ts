/** Royal diplomacy uses the ordinary signed-offer pipeline; only complete
 * battlefield defeat permits the separate, unilateral capitulation command. */
import { nativeStrategicControl } from './cabinet-state'
import { capitulationObstacle, imposeCapitulation } from './capitulation'
import {
  acceptsRoyalAgreement,
  isMonarchy,
  marriageOf,
  royalAgreementObstacle,
  type RoyalAgreement,
} from './dynasties'
import { capitulationOptions, chooseCapitulation, requestSovereignReviews } from './sovereign-strategy'
import { crossedPeriodMonth } from './simulation-period'
import { admitDiplomaticConsent, settleConventionalOffers, tryStandingOffer } from './statecraft'
import { type World } from './types'

/** Proposals preserve the senior/junior direction explicitly in their terms. */
export function proposeRoyalAgreement(
  w: World,
  from: number,
  to: number,
  kind: RoyalAgreement,
  manual = false,
) {
  const obstacle = royalAgreementObstacle(w, kind, from, to)
  if (obstacle) throw new Error(obstacle)
  const offer = tryStandingOffer(
    w,
    from,
    {
      title:
        `${w.nations[from].shortName}–${w.nations[to].shortName} ${kind === 'royal-marriage' ? 'royal marriage' : 'personal union'}`.slice(
          0,
          140,
        ),
      parties: [from, to],
      visibility: 'public',
      duration: 24,
      supersedes: 0,
      terms: [
        {
          kind,
          from,
          to,
          amount: 0,
          good: '',
          field: '',
          regions: [],
          duration: 0,
          text:
            kind === 'royal-marriage'
              ? 'Join the royal houses by marriage, sustaining diplomatic ties and an inheritance claim if no direct heir remains.'
              : 'Share the senior crown’s ruler and offensive foreign policy; retain separate territory, laws, treasuries, debts and forces.',
        },
      ],
    },
    manual,
  )
  if (offer && nativeStrategicControl(w, w.nations[to]) && acceptsRoyalAgreement(w, to, kind, from, to))
    admitDiplomaticConsent(w, to, offer)
  return offer
}

/** A defeated cabinet cannot pre-empt the victor's settlement with an ordinary peace offer. */
export function advanceCapitulations(w: World) {
  for (const rel of w.relations) {
    if (rel.treaty !== 'war') continue
    for (const [victor, defeated] of [
      [rel.a, rel.b],
      [rel.b, rel.a],
    ]) {
      const n = w.nations[victor]
      if (!nativeStrategicControl(w, n) || capitulationObstacle(w, victor, defeated)) continue
      const { outcome } = chooseCapitulation(w, victor, capitulationOptions(w, victor, defeated))
      if (outcome) imposeCapitulation(w, victor, defeated, outcome, 0.5)
      break
    }
  }
}

/** Native courts deliberate annually and answer pending offers monthly. Human signatures are never synthesized. */
export function advanceRoyalDiplomacy(w: World) {
  requestSovereignReviews(w)
  for (const offer of w.statecraft?.offers ?? []) {
    if (offer.status !== 'proposed') continue
    const term = offer.terms.length === 1 ? offer.terms[0] : undefined
    if (!term || (term.kind !== 'royal-marriage' && term.kind !== 'personal-union')) continue
    for (const id of offer.parties)
      if (
        nativeStrategicControl(w, w.nations[id]) &&
        acceptsRoyalAgreement(w, id, term.kind, term.from, term.to)
      )
        admitDiplomaticConsent(w, id, offer)
  }
  if (crossedPeriodMonth(w.month, 0, 12))
    for (const rel of w.relations) {
      if (rel.treaty === 'war' || rel.opinion < 45) continue
      const [a, b] = [w.nations[rel.a], w.nations[rel.b]]
      if (![a, b].every((n) => nativeStrategicControl(w, n) && isMonarchy(w, n.id))) continue
      const kind: RoyalAgreement = marriageOf(w, a.id, b.id) ? 'personal-union' : 'royal-marriage'
      const senior = a.population >= b.population ? a.id : b.id,
        junior = senior === a.id ? b.id : a.id
      if (
        royalAgreementObstacle(w, kind, senior, junior) ||
        !acceptsRoyalAgreement(w, junior, kind, senior, junior)
      )
        continue
      if (
        w.statecraft?.offers.some(
          (o) => o.status === 'proposed' && o.parties.includes(a.id) && o.parties.includes(b.id),
        )
      )
        continue
      proposeRoyalAgreement(w, senior, junior, kind)
    }
  settleConventionalOffers(w)
}
