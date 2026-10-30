/** Complete military defeat confers settlement authority on the occupier. This
 * path never fabricates a defeated government's signature or asks a model to approve it. */
import { domesticMonthlyWage } from './decision-policy'
import { aggregateDistricts, linkDistrictPeople } from './districts'
import { formPersonalUnion, isMonarchy } from './dynasties'
import { recordWorldEvent } from './event-memory'
import { reconcileJurisdictionSovereignty } from './jurisdictions'
import { publicExpense, publicTransfer } from './ledger'
import { controlsProvince } from './military-control'
import { orderFleet, waterPath } from './navy'
import { createSettlementTrialWorld, commitSettlementTrialWorld } from './settlement-trial'
import { dependencyObstacle, establishDependency } from './state-dependencies'
import { demobilizeState, settleStateEstate, transferStateTerritory } from './state-succession'
import { transportNetwork } from './transport'
import { population, relation, type World } from './types'

export const CAPITULATION_OUTCOMES = ['annex', 'subject', 'personal-union', 'independence'] as const
export type CapitulationOutcome = (typeof CAPITULATION_OUTCOMES)[number]
export const CAPITULATION_LABELS: Record<CapitulationOutcome, string> = {
  annex: 'Annex the state',
  subject: 'Establish a subject state',
  'personal-union': 'Impose a personal union',
  independence: 'Disarm and restore independence',
}

/** A surviving field army can still contest the occupation. Effective strength,
 * rather than headcount, counts supplied, cohesive troops able to continue fighting. */
export function capitulationObstacle(w: World, victor: number, defeated: number) {
  if (victor === defeated || !w.nations[victor] || !w.nations[defeated]) return 'Choose an opposing state.'
  if (relation(w, victor, defeated)?.treaty !== 'war') return 'Capitulation requires an active war.'
  if (!w.regions.some((r) => r.nation === victor)) return 'The victor must still govern territory.'
  const own = w.regions.filter((r) => r.nation === defeated)
  if (!own.length) return 'This state has already lost its territory.'
  if (!own.every((r) => controlsProvince(w, r.id, victor)))
    return 'Secure military control of every remaining enemy province is required.'
  let attacking = 0,
    defending = 0
  for (const a of w.armies) {
    const power = a.soldiers * a.supply * a.morale * (a.operations?.cohesion ?? 0.7)
    if (a.nation === victor) attacking += power
    if (a.nation === defeated) defending += power
  }
  if (defending > attacking * 0.5)
    return 'The remaining enemy army can still contest defeat; establish at least two-to-one effective strength.'
  return ''
}

/** One quote powers manual controls and native decisions; execution always quotes again. */
export function capitulationQuote(w: World, victor: number, defeated: number, outcome: CapitulationOutcome) {
  let obstacle = capitulationObstacle(w, victor, defeated)
  const cost =
    outcome === 'annex'
      ? domesticMonthlyWage(w, victor) *
        w.regions
          .filter((r) => r.nation === defeated)
          .reduce((s, r) => s + Math.max(20, population(r) * 0.02), 0)
      : 0
  if (!obstacle && outcome === 'annex' && w.nations[victor].treasury < cost)
    obstacle = 'The treasury cannot fund annexation administration.'
  if (!obstacle && ['subject', 'personal-union'].includes(outcome))
    obstacle = dependencyObstacle(w, victor, defeated, true)
  if (!obstacle && outcome === 'personal-union' && (!isMonarchy(w, victor) || !isMonarchy(w, defeated)))
    obstacle = 'A personal union requires two monarchies.'
  return { obstacle, cost }
}

/** Transactional settlement preserves all money, people and physical goods.
 * Indemnity is a chosen share of available cash, not an uncollectible invented balance. */
export function imposeCapitulation(
  w: World,
  victor: number,
  defeated: number,
  outcome: CapitulationOutcome,
  indemnity = 0.5,
) {
  if (
    !CAPITULATION_OUTCOMES.includes(outcome) ||
    !Number.isFinite(indemnity) ||
    indemnity < 0 ||
    indemnity > 1
  )
    throw new Error('Choose a supported settlement and an indemnity between 0% and 100%.')
  const quote = capitulationQuote(w, victor, defeated, outcome)
  if (quote.obstacle) throw new Error(quote.obstacle)
  const trial = createSettlementTrialWorld(w, true)
  const cash = trial.nations[defeated].treasury
  if (outcome === 'annex') {
    publicExpense(trial, victor, quote.cost, 'annexation administration')
    transferStateTerritory(trial, defeated, victor, true)
    settleStateEstate(trial, defeated, victor, 'demobilize')
  } else {
    publicTransfer(trial, defeated, victor, cash * indemnity, 'capitulation indemnity')
    if (outcome === 'independence' && trial.dependencies)
      trial.dependencies = trial.dependencies.filter((d) => d.junior !== defeated)
    if (outcome === 'personal-union') formPersonalUnion(trial, victor, defeated, true)
    else demobilizeState(trial, defeated)
    if (outcome === 'subject') establishDependency(trial, victor, defeated, 'subject', true)
    endCapitulationHostilities(trial, victor, defeated, outcome === 'independence')
    trial.nations[defeated].legitimacy = Math.max(0, trial.nations[defeated].legitimacy - 15)
  }
  if (trial.localEconomy) {
    linkDistrictPeople(trial)
    aggregateDistricts(trial)
  }
  commitSettlementTrialWorld(w, trial)
  reconcileJurisdictionSovereignty(w)
  // Pending negotiations cannot undo a settlement by executing stale signed terms.
  for (const offer of w.statecraft?.offers ?? [])
    if (offer.status === 'proposed' && offer.parties.includes(defeated)) offer.status = 'expired'
  if (w.statecraft) w.statecraft.revision++
  const detail =
    outcome === 'annex'
      ? `The victor absorbs the remaining territory, ${cash.toFixed(3)}k in public cash, public assets and debts. Defeated troops return to civilian life; local property and resistance remain.`
      : `${CAPITULATION_LABELS[outcome]}. The defeated treasury pays ${(cash * indemnity).toFixed(3)}k. ${outcome === 'subject' ? 'The subject retains local government and pays 15% of public receipts; offensive foreign policy belongs to the victor.' : outcome === 'personal-union' ? 'The crowns share one ruler while keeping separate accounts, laws and forces.' : 'Defeated forces demobilize and the occupier withdraws under a five-year truce.'}`
  recordWorldEvent(w, {
    id: w.nextEvent++,
    month: w.month,
    type: 'peace',
    nation: victor,
    title: `${w.nations[defeated].shortName} capitulates to ${w.nations[victor].shortName}`,
    detail,
  })
  return detail
}

/** End occupation and combat orders while retaining the physical travel needed to withdraw. */
function endCapitulationHostilities(w: World, victor: number, defeated: number, withdraw: boolean) {
  const rel = relation(w, victor, defeated)!
  rel.treaty = 'truce'
  rel.since = w.month
  rel.warExhaustion = 0
  for (const r of w.regions)
    if (r.control && [victor, defeated].includes(r.nation) && [victor, defeated].includes(r.control.nation))
      delete r.control
  for (const a of w.armies)
    if (a.nation === victor || a.nation === defeated) {
      a.target = null
      if (a.operations) a.operations.march = []
      if (withdraw && a.nation === victor && w.regions[a.region].nation === defeated) {
        // Withdrawal is an order, not a teleport across intervening provinces.
        a.target = w.nations[victor].capital
        if (a.operations) {
          a.operations.stance = 'march'
          a.operations.entrenchment = 0
          a.operations.conduct = 'restrained'
        }
      }
    }
  for (const f of w.warfare?.fleets ?? [])
    if (f.nation === victor || f.nation === defeated) {
      f.target = null
      f.course = []
      f.mission = 'patrol'
      if (!withdraw) continue
      // Fleets sail home over a real sea route; an isolated fleet must wait
      // for access instead of materializing at a possibly inland capital.
      const harbor = transportNetwork(w).harbors.find(
        (h) => w.regions[h.region].nation === f.nation && waterPath(w, f.cell, h.water).length,
      )
      if (harbor) orderFleet(w, f.id, harbor.region, 'return')
    }
}
