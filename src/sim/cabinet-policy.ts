/** Pure domestic utility and fiscal targets, shared by the cabinet desks. */
import {
  FIELDS,
  clamp,
  population,
  type Nation,
  type Policies,
  type Region,
  type Research,
  type World,
} from './types'

/** Score all six fields, discounting successive discoveries. Baseline public
 * health/administration benefits prevent a permanent industrial monoculture. */
export function cabinetResearchScores(w: World, n: Nation, own: readonly Region[]) {
  let people = 0,
    health = 0,
    literacy = 0,
    materials = 0,
    infrastructure = 0,
    unrest = 0
  for (const r of own) {
    const p = population(r)
    people += p
    health += r.health * p
    literacy += r.literacy * p
    materials += (r.materialCoverage ?? 1) * p
    infrastructure += r.infrastructure * p
    unrest += (r.unrest / 100) * p
  }
  const divisor = Math.max(1, people),
    a = n.character!.effective,
    skills = n.character!.leader.skills
  const war = w.relations.some((r) => r.treaty === 'war' && (r.a === n.id || r.b === n.id))
  const preparing = n.cabinet?.posture === 'prepare-war'
  let congestion = 0,
    routes = 0
  for (const route of w.routes) {
    if (w.regions[route.from]?.nation !== n.id && w.regions[route.to]?.nation !== n.id) continue
    if (route.capacity > 0 && Number.isFinite(route.capacity)) {
      congestion += clamp(route.volume / route.capacity)
      routes++
    }
  }
  const scores: Record<Research, number> = {
    agriculture: 0.7 + clamp(1 - n.foodCoverage) * 7 + a.solidarity * 0.3,
    industry: 0.7 + clamp(1 - materials / divisor) * 2 + a.commercialism * 0.6,
    medicine: 0.8 + clamp(1 - health / divisor) * 4 + a.solidarity * 0.5 + skills.scholarship * 0.3,
    logistics:
      0.8 +
      clamp(1 - infrastructure / divisor) * 2 +
      skills.logistics * 0.4 +
      (routes ? congestion / routes : 0) * 1.2 +
      (n.cabinet?.posture === 'colonize' ? 0.7 : 0),
    governance:
      0.8 +
      (unrest / divisor) * 3 +
      (1 - literacy / divisor) +
      a.centralization * 0.3 +
      (n.cabinet?.posture === 'pacify-crisis' ? 1 : 0),
    military: 0.6 + (war ? 2.5 : preparing ? 2 : 0) + a.assertiveness * 0.5 + skills.command * 0.3,
  }
  if (n.cabinet?.posture === 'industrialize') scores.industry += 0.8
  for (const field of FIELDS)
    scores[field] =
      n.technologies[field] >= 6 ? -Infinity : scores[field] / (1 + n.technologies[field] * 0.65)
  return scores
}

/** Stable tie-breaking and modest persistence avoid abandoning knowledge monthly. */
export function cabinetResearchFocus(w: World, n: Nation, own: readonly Region[]): Research {
  const scores = cabinetResearchScores(w, n, own)
  if (n.foodCoverage < 0.75 && n.technologies.agriculture < 6) return 'agriculture'
  let best = n.researchFocus
  for (const field of FIELDS)
    if (scores[field] > scores[best] * 1.12 || scores[best] === -Infinity) best = field
  return best
}

/** Treasury runway uses observed monthly spending, not prospective tax receipts.
 * Scarcity lowers import barriers; short runways fund essentials before expansion. */
export function cabinetPolicyTargets(w: World, n: Nation, base: Policies): Policies {
  const deficit = Math.max(0, n.spending - n.income),
    runway = deficit ? n.treasury / deficit : Infinity
  const inflation = w.economy?.banking?.policy?.inflation ?? 0
  const unemployment = w.economy?.national[n.id]?.unemployment ?? 0
  const mobilizing = ['prepare-war', 'wage-war'].includes(n.cabinet?.posture ?? '')
  const crisis = n.cabinet?.posture === 'pacify-crisis' || n.stability < 40
  return {
    ...base,
    tax: clamp(
      base.tax +
        (runway < 6 ? 8 : runway > 36 ? -3 : 0) +
        clamp(inflation - 0.08, 0, 0.2) * 20 -
        (crisis ? 10 : 0),
      5,
      55,
    ),
    tariff: n.foodCoverage < 0.95 || inflation > 0.08 ? Math.min(base.tariff, 5) : base.tariff,
    welfare: clamp(
      base.welfare + (n.foodCoverage < 0.9 || crisis ? 12 : 0) + clamp(unemployment - 0.08) * 20,
      0,
      80,
    ),
    military: clamp(base.military + (mobilizing ? 20 : 0), 0, 80),
    conscription: clamp(base.conscription + (mobilizing ? 1 : 0), 0, 5),
    education: runway < 6 ? Math.min(base.education, 20) : base.education,
    research: runway < 6 ? Math.min(base.research, 18) : base.research,
  }
}
