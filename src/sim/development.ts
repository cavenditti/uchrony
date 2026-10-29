import { nativeDomesticControl } from './domestic-policy'
import { decisionPolicy } from './decision-policy'
import { economicRegions, provinceId } from './local-units'
import { governmentAccount, borrow } from './ledger'
import { recordWorldEvent } from './event-memory'
import { simulationMonths, periodRate } from './simulation-period'
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
  for (const n of w.nations) {
    if (!nativeDomesticControl(w, n)) continue
    const own = units.filter((r) => r.nation === n.id && !w.regions[provinceId(r)].control)
    const people = own.reduce((sum, r) => sum + population(r), 0)
    if (!people) continue
    const avg = (key: 'literacy' | 'materialCoverage' | 'infrastructure') =>
      own.reduce((sum, r) => sum + (r[key] ?? 1) * population(r), 0) / people
    const output = (w.economy?.national[n.id]?.realOutput ?? 0) / Math.max(1, n.population)
    const emergency = n.foodCoverage < 0.75 && n.development?.focus !== 'agriculture'
    if (!n.development || w.month >= n.development.review || emergency) {
      const focus: Research =
        n.foodCoverage < 0.95
          ? 'agriculture'
          : avg('materialCoverage') < 0.9
            ? 'industry'
            : avg('literacy') < 0.6
              ? 'governance'
              : avg('infrastructure') < 0.7
                ? 'logistics'
                : 'industry'
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
    if (n.technologies[p.focus] < 6) n.researchFocus = p.focus
    // The long-term mandate persists, but short-term food security can redirect labor.
    if (n.foodCoverage < 0.97 || p.focus === 'agriculture') n.policies.priority = 'agriculture'
    else if (p.focus === 'industry') n.policies.priority = 'industry'
    n.policies.research = Math.max(n.policies.research, 18)
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
    const revenue = Math.max(p.revenue, ((payroll * n.policies.tax) / 100) * 0.35)
    const rate = (w.economy?.banking?.centralBank.rate ?? 0.002) + 0.002 + 1 / 240
    const limit = Math.min(revenue * 36, (revenue * 0.2) / Math.max(0.001, rate))
    const debtPressure = n.debt / Math.max(1e-9, revenue * 24)
    const reserve = revenue * 6
    const unemployment = w.economy?.national[n.id]?.unemployment ?? 0
    const recovery = clamp((unemployment - 0.06) / 0.2) * 0.5
    const budget =
      (revenue * (debtPressure < 1 ? 1.15 + recovery : 0.8) + Math.max(0, n.treasury - reserve) * 0.01) *
      months
    // Borrow only against a current tax base, with bank capital and servicing limits.
    if (n.treasury < budget && n.debt < limit)
      p.borrowed += borrow(w, governmentAccount(n.id), budget - n.treasury, limit)
    p.appropriation = Math.min(n.treasury, budget)
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
