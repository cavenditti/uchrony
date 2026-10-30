import { cabinetResearchFocus } from './cabinet-policy'
import { cabinetOrderReserved } from './cabinet-state'
import { nativeDomesticControl } from './domestic-policy'
import { decisionPolicy } from './decision-policy'
import { economicRegions, provinceId } from './local-units'
import { developmentBudget, developmentCreditLimit, governmentDebtPayments } from './government-budget'
import { recordWorldEvent } from './event-memory'
import { simulationMonths, periodRate, crossedPeriodMonth } from './simulation-period'
import { clamp, population, type Nation, type Research, type World } from './types'

export interface DevelopmentPlan {
  focus: Research
  started: number
  review: number
  baselineOutput: number
  targetOutput: number
  currentOutput: number
  revenue: number
  appropriation: number
  borrowed: number
}

/** A rolling five-year cabinet mandate, measured in real output per resident.
 * Revenue and capital remain actual accounts; a target never awards output. */
export function advanceDevelopment(w: World) {
  if (!decisionPolicy().development) return
  const units = economicRegions(w)
  const payments = governmentDebtPayments(w)
  for (const n of w.nations) {
    if (!nativeDomesticControl(w, n)) continue
    const own = units.filter((r) => r.nation === n.id && !w.regions[provinceId(r)].control)
    const people = own.reduce((sum, r) => sum + population(r), 0)
    if (!people) continue
    const output = (w.economy?.national[n.id]?.realOutput ?? 0) / Math.max(1, n.population)
    const emergency = n.foodCoverage < 0.75 && n.development?.focus !== 'agriculture'
    if (!n.development || w.month >= n.development.review || emergency) {
      const focus = cabinetResearchFocus(w, n, own)
      const old = n.development
      n.development = {
        focus,
        started: w.month,
        review: w.month + 60,
        baselineOutput: output,
        targetOutput: output * 1.1,
        currentOutput: output,
        revenue: old?.revenue ?? Math.max(0, n.income),
        appropriation: 0,
        borrowed: 0,
      }
      recordWorldEvent(w, {
        id: w.nextEvent++,
        month: w.month,
        type: 'economy',
        nation: n.id,
        title: `${n.shortName} adopts a five-year ${focus} program`,
        detail:
          'The cabinet targets 10% more real output per resident through funded research, skills and infrastructure. It reviews results after five years; targets do not create resources.',
      })
    }
    const p = n.development
    if (
      !cabinetOrderReserved(w, n, 'research') &&
      (p.started === w.month ||
        crossedPeriodMonth(w.month, n.id % 6, 6) ||
        n.technologies[n.researchFocus] >= 6)
    )
      n.researchFocus = cabinetResearchFocus(w, n, own)
    // The long-term mandate persists, but short-term food security can redirect labor.
    if (!cabinetOrderReserved(w, n, 'policy:priority')) {
      if (n.foodCoverage < 0.97) n.policies.priority = 'agriculture'
      else if (['prepare-war', 'wage-war'].includes(n.cabinet?.posture ?? ''))
        n.policies.priority = 'military'
      else if (p.focus === 'industry') n.policies.priority = 'industry'
    }
    if (!cabinetOrderReserved(w, n, 'policy:research'))
      n.policies.research = Math.max(n.policies.research, 18)
    if (!cabinetOrderReserved(w, n, 'policy:education'))
      n.policies.education = Math.max(n.policies.education, 20)
    const months = simulationMonths()
    // The initial tax base is domestic payroll, not assumed future growth.
    const payroll =
      own.reduce(
        (sum, r) =>
          sum +
          (w.economy?.producers[r.id]?.wage ?? 0) *
            Object.values(w.economy!.households[r.id]).reduce((s, h) => s + h.laborForce, 0),
        0,
      ) / months
    // Payroll is only a bootstrap estimate. Once receipts have been observed,
    // hypothetical full employment must not overrule the actual tax base.
    const revenue = p.revenue > 0 || w.month > 1 ? p.revenue : ((payroll * n.policies.tax) / 100) * 0.35
    const limit = developmentCreditLimit(w, revenue)
    const unemployment = w.economy?.national[n.id]?.unemployment ?? 0
    p.appropriation = developmentBudget(
      revenue,
      n.treasury,
      n.debt,
      limit,
      payments.get(n.id) ?? 0,
      unemployment,
    )
    // Funding waits until taxes have cleared. Borrowing here, before this month's
    // receipts, would turn an ordinary cash-timing gap into unnecessary new debt.
  }
}

export function activeDevelopment(w: World, n: Nation) {
  return decisionPolicy().development && nativeDomesticControl(w, n) ? n.development : undefined
}

export function recordDevelopment(w: World) {
  for (const n of w.nations) {
    const p = n.development
    if (!p) continue
    // Called after accounting has normalized all recorded income to one month.
    p.revenue += (Math.max(0, n.income) - p.revenue) * periodRate(0.08)
    const output = (w.economy?.national[n.id]?.realOutput ?? 0) / Math.max(1, n.population)
    p.currentOutput += (output - p.currentOutput) * periodRate(0.08)
    if (!p.baselineOutput && output > 0) {
      p.baselineOutput = output
      p.targetOutput = output * 1.1
    }
    p.revenue = clamp(p.revenue, 0, 1e14)
  }
}
