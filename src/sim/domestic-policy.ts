import { characterPolicyTargets } from './character'
import { cabinetOrderReserved } from './cabinet-state'
import { cabinetPolicyTargets } from './cabinet-policy'
import { crossedPeriodMonth } from './simulation-period'
import { clamp, type Nation, type World } from './types'

/** Model leadership directs the cabinet; only human governments disable it. */
export function nativeDomesticControl(_w: World, n: Nation) {
  return n.ai && n.extinct === undefined
}

export function advanceDomesticPolicy(w: World) {
  for (const n of w.nations) {
    if (
      !nativeDomesticControl(w, n) ||
      !crossedPeriodMonth(w.month, n.id % 6, 6) ||
      !w.regions.some((r) => r.nation === n.id)
    )
      continue
    const targets = cabinetPolicyTargets(w, n, characterPolicyTargets(n))
    for (const key of [
      'tax',
      'welfare',
      'education',
      'military',
      'research',
      'tariff',
      'conscription',
    ] as const)
      if (!cabinetOrderReserved(w, n, `policy:${key}`))
        n.policies[key] += clamp(
          targets[key] - n.policies[key],
          key === 'conscription' ? -0.2 : -2,
          key === 'conscription' ? 0.2 : 2,
        )
    const hungry = n.foodCoverage < 0.97
    if (!cabinetOrderReserved(w, n, 'policy:priority'))
      n.policies.priority = hungry
        ? 'agriculture'
        : n.cabinet?.posture === 'prepare-war' ||
            w.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war')
          ? 'military'
          : n.character!.effective.commercialism > 0.6
            ? 'industry'
            : 'balanced'
    // A stalled unrelated discovery must not lock a hungry state out of farming.
    // Progress in the previous field is retained when the cabinet changes focus.
    if (hungry && n.technologies.agriculture < 6 && !cabinetOrderReserved(w, n, 'research'))
      n.researchFocus = 'agriculture'
    if ((n.stability < 45 || n.foodCoverage < 0.8) && !cabinetOrderReserved(w, n, 'policy:welfare'))
      n.policies.welfare = clamp(n.policies.welfare + 3, 0, 80)
  }
}
