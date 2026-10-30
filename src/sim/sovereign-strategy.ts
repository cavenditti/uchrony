/** Cabinet briefings distinguish legal options from political desirability and
 * private foreign balances. Quotes share execution's rules; future reign-end dates
 * remain simulation bookkeeping, not information available to a government. */
import {
  CAPITULATION_OUTCOMES,
  capitulationObstacle,
  capitulationQuote,
  type CapitulationOutcome,
} from './capitulation'
import { crownOf, isMonarchy, marriageOf, royalAgreementObstacle } from './dynasties'
import { intelligenceService } from './intelligence'
import { dependencyOf } from './state-dependencies'
import type { World } from './types'

/** Consequences are stated independently of uncertain foreign wealth and intent. */
export const CAPITULATION_CONSEQUENCES = {
  annex: {
    authority: 'Absorb the remaining provinces and end the defeated state’s independent government.',
    finances:
      'Inherit all public cash, public ownership claims and debt, including supplier obligations. Pay administration before receiving the estate.',
    forces: 'Defeated armies and fleets demobilize; people and supplies return locally.',
    risks:
      'Resistance and administrative burdens remain. Private property is not a treasury windfall; physical resources stay in place.',
  },
  subject: {
    authority: 'Retain local government under the victor’s offensive foreign-policy authority.',
    finances:
      'Collect a chosen 0–100% cash indemnity and 15% of subsequent public receipts, limited by available cash. Debt remains with the subject.',
    forces:
      'Defeated forces demobilize. Common authority grants military access subject to explicit border restrictions.',
    risks:
      'Tribute depends on actual receipts and liquidity. Taking all cash can weaken the future tax base.',
  },
  'personal-union': {
    authority:
      'Two monarchies share the victor’s ruler; the junior crown delegates offensive foreign policy.',
    finances:
      'Collect a chosen cash indemnity. Treasuries, debts and laws remain separate; there is no automatic union tribute.',
    forces:
      'Both states retain their own forces; sharing a ruler does not transfer ownership of the junior army.',
    risks:
      'War between the crowns or an end to monarchy breaks the union. Existing dependencies can block accession.',
  },
  independence: {
    authority:
      'Restore independent government and end any previous overlord relationship under a five-year truce.',
    finances:
      'Collect a chosen 0–100% cash indemnity. Remaining assets and debts stay with the defeated state; no continuing tribute.',
    forces: 'Defeated forces demobilize; occupying armies and fleets receive physical withdrawal orders.',
    risks: 'The restored state can later rearm. Withdrawal still requires time and accessible routes.',
  },
} satisfies Record<
  CapitulationOutcome,
  { authority: string; finances: string; forces: string; risks: string }
>

/** A ruler knows their present house and heir, not the engine's future succession date. */
export function cabinetCrown(w: World, nation: number) {
  const crown = crownOf(w, nation)
  return crown ? { house: crown.house, ruler: crown.ruler, heir: crown.heir } : null
}

/** Show every outcome and its blocker, rather than silently hiding unaffordable choices. */
export function capitulationOptions(w: World, nation: number, target: number) {
  return CAPITULATION_OUTCOMES.map((outcome) => {
    const quote = capitulationQuote(w, nation, target, outcome)
    return {
      outcome,
      available: !quote.obstacle,
      obstacle: quote.obstacle,
      administrationCost: quote.cost,
      ...CAPITULATION_CONSEQUENCES[outcome],
    }
  })
}

/** Native preferences retain character while accounting for the cash needed to
 * govern after victory. Captured reserves cannot fund administration paid first. */
export function chooseCapitulation(
  w: World,
  nation: number,
  options: ReturnType<typeof capitulationOptions>,
) {
  const n = w.nations[nation],
    character = n.character!,
    drives = character.leader.politics?.drives,
    annex = options.find((o) => o.outcome === 'annex')!
  const preferences: CapitulationOutcome[] =
    character.effective.solidarity > 0.75
      ? ['independence', 'subject', 'annex', 'personal-union']
      : character.effective.openness < 0.5 &&
          options.some((o) => o.outcome === 'personal-union' && o.available)
        ? ['personal-union', 'subject', 'annex', 'independence']
        : (drives?.dominance ?? 0.5) > 0.65
          ? ['annex', 'subject', 'independence', 'personal-union']
          : ['subject', 'annex', 'independence', 'personal-union']
  const thinReserve = n.treasury - annex.administrationCost < Math.max(0, n.spending - n.income) * 6
  const protectReserve = thinReserve && (drives?.riskTolerance ?? 0.5) < 0.75
  if (protectReserve) {
    preferences.splice(preferences.indexOf('annex'), 1)
    preferences.push('annex')
  }
  const outcome = preferences.find((kind) => options.some((o) => o.outcome === kind && o.available))
  return {
    outcome: outcome ?? null,
    reasoning: !outcome
      ? 'No imposed settlement is currently available; further military control or a negotiated agreement is needed.'
      : protectReserve && outcome !== 'annex'
        ? 'Direct annexation would consume the six-month deficit reserve; prefer an available settlement that preserves governing capacity.'
        : 'Prefer the available settlement consistent with this leadership’s constitutional, dominance and public-welfare priorities.',
  }
}

/** The cabinet may assess only contacted states or its own direct constitutional ties.
 * Foreign cash/debt comes from the existing dated dossier, never live state accounts. */
export function sovereignStrategyContext(w: World, nation: number) {
  const knowledge = intelligenceService(w, nation),
    n = w.nations[nation],
    ties = (w.dependencies ?? []).filter((d) => d.senior === nation || d.junior === nation),
    marriages = (w.dynasties?.marriages ?? []).filter((m) => m.a === nation || m.b === nation),
    known = new Set(knowledge.dossiers.map((d) => d.nation))
  for (const d of ties) known.add(d.senior === nation ? d.junior : d.senior)
  for (const m of marriages) known.add(m.a === nation ? m.b : m.a)
  const wars = w.relations.filter((r) => r.treaty === 'war' && (r.a === nation || r.b === nation))
  const royalPartners = isMonarchy(w, nation)
    ? [...known]
        .filter((id) => id !== nation && isMonarchy(w, id))
        .map((target) => {
          const marriage = marriageOf(w, nation, target)
          return {
            nation: target,
            marriageSince: marriage?.since ?? null,
            marriageObstacle: royalAgreementObstacle(w, 'royal-marriage', nation, target),
            seniorUnionObstacle: royalAgreementObstacle(w, 'personal-union', nation, target),
            juniorUnionObstacle: royalAgreementObstacle(w, 'personal-union', target, nation),
            consent:
              'Legal eligibility is not acceptance. Both governments must sign the exact proposal and complete diplomatic preparation.',
            inheritance: marriage
              ? 'A mature marriage can supply a claim if no direct heir remains; inheritance is contingent, not guaranteed.'
              : 'No marriage claim exists.',
          }
        })
    : []
  return {
    ownCrown: cabinetCrown(w, nation),
    dependencies: ties,
    offensiveAuthority: dependencyOf(w, nation)?.senior ?? nation,
    treasuryRunwayMonths: n.spending > n.income ? n.treasury / (n.spending - n.income) : null,
    royalPartners,
    warSettlements: wars.map((rel) => {
      const target = rel.a === nation ? rel.b : rel.a,
        options = capitulationOptions(w, nation, target),
        report = knowledge.dossiers.find((d) => d.nation === target)?.economy
      return {
        nation: target,
        options,
        nativeRecommendation: chooseCapitulation(w, nation, options),
        enemyCanImpose: !capitulationQuote(w, target, nation, 'independence').obstacle,
        reportedEstate: report
          ? {
              month: report.month,
              confidence: report.confidence,
              treasury: report.values.treasury ?? null,
              debt: report.values.debt ?? null,
            }
          : null,
        uncertainty:
          'Reported reserves and debt can be stale or unknown. No missing figure means zero; an indemnity is a share of cash actually available at execution.',
      }
    }),
  }
}

// Deliberation triggers are ephemeral: restoring a world may request one fresh
// review, but unchanged opportunities never demand another review every month.
const reviewedSituations = new WeakMap<World, Map<number, string>>()
/** Bring new conquest authority, mature royal opportunities or changed crowns to a model cabinet. */
export function requestSovereignReviews(w: World) {
  for (const agent of w.statecraft?.agents ?? []) {
    const n = w.nations[agent.nation]
    if (!n?.ai || n.extinct !== undefined || !agent.lastModel) continue
    const signals = reviewSignature(w, n.id)
    let seen = reviewedSituations.get(w)
    if (!seen) reviewedSituations.set(w, (seen = new Map()))
    if (seen.get(n.id) === signals) continue
    const previous = seen.get(n.id)
    seen.set(n.id, signals)
    if (!signals && !previous) continue
    agent.nextDecision = Math.min(agent.nextDecision, w.month)
    agent.nextStrategy = Math.min(agent.nextStrategy, w.month)
    agent.escalation =
      'Sovereignty review: crown, union opportunities, dependency authority or capitulation options changed. Compare the current sovereignStrategy briefing before committing.'
  }
}

/** Monthly triggers inspect only existing constitutional ties and wars. Building
 * every contacted court's full briefing here would multiply diplomatic scans by
 * all active model cabinets, although new unions require an existing marriage. */
function reviewSignature(w: World, nation: number) {
  const crown = crownOf(w, nation),
    signals = crown ? [`crown:${crown.house}:${crown.ruler}:${crown.heir ?? 'no-heir'}`] : []
  for (const d of w.dependencies ?? [])
    if (d.senior === nation || d.junior === nation)
      signals.push(`authority:${d.senior}:${d.junior}:${d.kind}`)
  for (const m of w.dynasties?.marriages ?? []) {
    if (m.a !== nation && m.b !== nation) continue
    const target = m.a === nation ? m.b : m.a,
      senior = !royalAgreementObstacle(w, 'personal-union', nation, target),
      junior = !royalAgreementObstacle(w, 'personal-union', target, nation)
    if (senior || junior) signals.push(`union:${target}:${senior}:${junior}`)
  }
  for (const r of w.relations) {
    if (r.treaty !== 'war' || (r.a !== nation && r.b !== nation)) continue
    const target = r.a === nation ? r.b : r.a,
      choices = capitulationObstacle(w, nation, target)
        ? []
        : capitulationOptions(w, nation, target)
            .filter((o) => o.available)
            .map((o) => o.outcome),
      enemyCanImpose = !capitulationObstacle(w, target, nation)
    if (choices.length || enemyCanImpose)
      signals.push(`settlement:${target}:${choices.join(',')}:${enemyCanImpose}`)
  }
  return signals.sort().join('|')
}
