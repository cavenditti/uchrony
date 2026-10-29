import { characterPolicyTargets } from './character'
import { crossedPeriodMonth } from './simulation-period'
import { clamp, type Nation, type World } from './types'

/** A diplomacy record is not a governing model. Only a recent accepted plan
 * temporarily defers the native cabinet; manual governments remain authoritative. */
export function nativeDomesticControl(w: World, n: Nation) {
  const agent = w.statecraft?.agents.find((a) => a.nation === n.id)
  return n.ai && n.extinct === undefined && !(agent?.lastModel && w.month - agent.lastDecision <= 6)
}

export function advanceDomesticPolicy(w: World) {
  for (const n of w.nations) {
    if (
      !nativeDomesticControl(w, n) ||
      !crossedPeriodMonth(w.month, n.id % 6, 6) ||
      !w.regions.some((r) => r.nation === n.id)
    )
      continue
    const targets = characterPolicyTargets(n)
    for (const key of [
      'tax',
      'welfare',
      'education',
      'military',
      'research',
      'tariff',
      'conscription',
    ] as const)
      n.policies[key] += clamp(
        targets[key] - n.policies[key],
        key === 'conscription' ? -0.2 : -2,
        key === 'conscription' ? 0.2 : 2,
      )
    const hungry = n.foodCoverage < 0.97
    n.policies.priority = hungry
      ? 'agriculture'
      : w.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war')
        ? 'military'
        : n.character!.effective.commercialism > 0.6
          ? 'industry'
          : 'balanced'
    // A stalled unrelated discovery must not lock a hungry state out of farming.
    // Progress in the previous field is retained when the cabinet changes focus.
    if (hungry && n.technologies.agriculture < 6) n.researchFocus = 'agriculture'
    if (n.stability < 45 || n.foodCoverage < 0.8) n.policies.welfare = clamp(n.policies.welfare + 3, 0, 80)
  }
}
