/** Cabinet desks translate persistent intent into funded operations. Research
 * scores share one domestic snapshot; foreign choices use received reports. */
import { cabinetOrderReserved, ensureCabinet, setCabinetAgenda } from './cabinet-state'
import { shortestPaths } from './economy'
import { landGraph } from './military'
import { buildPublicWork, PUBLIC_WORKS, publicWorkQuote, publicWorkValue } from './public-works'
import { crossedPeriodMonth } from './simulation-period'
import { submitStandingOffer, settleConventionalOffers } from './statecraft'
import type { ProvincialAuthority } from './sovereignty'
import { territorialIndex } from './territory-index'
import { type Nation, type Region, type World } from './types'

export { cabinetResearchFocus, cabinetResearchScores, cabinetPolicyTargets } from './cabinet-policy'

/** Public projects compete on expected local benefit per crown. Severe food or
 * material shortages leave savings to the farm/enterprise desks instead. */
export function cabinetWorks(w: World, n: Nation, own: readonly Region[]) {
  const reserve = Math.max(0, n.spending, n.income) * 6
  const budget = Math.max(0, n.treasury - reserve) * 0.1
  if (budget < 500) return []
  return own
    .flatMap((r) =>
      PUBLIC_WORKS.flatMap((kind) => {
        const q = publicWorkQuote(w, r.id, kind)
        if (q.obstacle || q.cost > budget) return []
        return [{ region: r.id, kind, cost: q.cost, score: publicWorkValue(w, r.id, kind, q.cost) }]
      }),
    )
    .sort((a, b) => b.score - a.score || a.region - b.region)
}

/** Crisis response assigns each available formation once and uses ordinary
 * provincial charters when a reachable garrison cannot supply protection. */
export function respondToSovereignty(w: World, n: Nation, reports = w.sovereignty?.provinces ?? []) {
  if (!n.ai || n.extinct !== undefined) return
  const crises = reports
    .filter((r) => r.nation === n.id && r.stage !== 'stable' && w.regions[r.region]?.nation === n.id)
    .sort((a, b) => b.contested - a.contested || b.neglect - a.neglect || a.region - b.region)
  if (!crises.length) return
  if (!cabinetOrderReserved(w, n, 'policy:tax'))
    n.policies.tax = Math.max(5, n.policies.tax - Math.min(2, Math.max(0, n.policies.tax - 25)))
  if (!cabinetOrderReserved(w, n, 'policy:welfare')) n.policies.welfare = Math.min(80, n.policies.welfare + 2)
  const assigned = new Set<number>()
  let graph: ReturnType<typeof landGraph> | undefined
  const routes = new Map<number, ReturnType<typeof shortestPaths>>()
  for (const crisis of crises) {
    const r = w.regions[crisis.region]
    if (r.control) continue
    const candidates = w.armies.filter(
      (a) =>
        a.nation === n.id &&
        !assigned.has(a.id) &&
        a.operations?.embarkedOn == null &&
        !a.operations?.disorder &&
        a.supply >= 0.5 &&
        a.soldiers >= 50 &&
        !cabinetOrderReserved(w, n, `army:${a.id}`) &&
        w.regions[a.region].nation === n.id,
    )
    const ranked = candidates
      .map((army) => {
        if (!routes.has(army.region))
          routes.set(army.region, shortestPaths((graph ??= landGraph(w, n.id)), army.region))
        return { army, distance: routes.get(army.region)!.distance[r.id] }
      })
      .filter((a) => Number.isFinite(a.distance))
      .sort((a, b) => a.distance - b.distance || a.army.id - b.army.id)
    const garrison = ranked[0]?.army
    if (garrison?.operations) {
      assigned.add(garrison.id)
      garrison.target = garrison.region === r.id ? null : r.id
      garrison.operations.stance = garrison.region === r.id ? 'hold' : 'march'
    } else if (
      crisis.stage !== 'fragile' &&
      !r.delegation &&
      r.id !== n.capital &&
      !w.statecraft?.offers.some(
        (o) =>
          o.status === 'proposed' &&
          o.author === n.id &&
          o.terms.some((t) => t.kind === 'devolution' && t.regions.includes(r.id)),
      )
    ) {
      submitStandingOffer(w, n.id, {
        title: `Provincial charter of ${r.name}`.slice(0, 140),
        visibility: 'public',
        parties: [n.id],
        duration: 12,
        supersedes: 0,
        terms: [
          {
            kind: 'devolution',
            from: n.id,
            to: n.id,
            amount: 0.4,
            good: '',
            field: '',
            regions: [r.id],
            duration: 0,
            text: 'Local services and policing restore provincial protection.',
            delegation: { powers: ['taxation', 'education', 'policing', 'infrastructure'] },
          },
        ],
      })
    }
  }
}

/** One territorial index per monthly phase; large project searches run quarterly. */
export function advanceCabinet(w: World) {
  const territory = territorialIndex(w)
  const crises = new Map<number, ProvincialAuthority[]>()
  for (const report of w.sovereignty?.provinces ?? []) {
    if (report.stage === 'stable' || w.regions[report.region]?.nation !== report.nation) continue
    const group = crises.get(report.nation) ?? []
    group.push(report)
    crises.set(report.nation, group)
  }
  for (const n of w.nations) {
    const own = territory.regions(n.id)
    if (!n.ai || n.extinct !== undefined || !own.length) continue
    const c = ensureCabinet(w, n)
    c.overrides = c.overrides.filter((o) => o.until > w.month)
    const war = w.relations.find((r) => r.treaty === 'war' && (r.a === n.id || r.b === n.id))
    const reports = crises.get(n.id) ?? []
    const crisis = reports[0]
    if (war && c.posture !== 'wage-war') setCabinetAgenda(w, n, 'wage-war', war.a === n.id ? war.b : war.a)
    else if (!war && crisis && c.posture !== 'pacify-crisis')
      setCabinetAgenda(w, n, 'pacify-crisis', crisis.region)
    else if (
      !war &&
      !crisis &&
      ((w.month >= c.review && c.posture !== 'prepare-war') ||
        c.posture === 'wage-war' ||
        c.posture === 'pacify-crisis')
    ) {
      const frontier = own.some((r) => r.neighbors.some((id) => w.regions[id].nation === -1))
      setCabinetAgenda(
        w,
        n,
        n.foodCoverage < 0.9 || n.stability < 45 ? 'consolidate' : frontier ? 'colonize' : 'industrialize',
      )
    }
    respondToSovereignty(w, n, reports)
    if (!crossedPeriodMonth(w.month, n.id % 3, 3) || n.foodCoverage < 0.97 || c.posture === 'prepare-war')
      continue
    const works = cabinetWorks(w, n, own)[0]
    if (works && own.every((r) => (r.materialCoverage ?? 1) >= 0.7))
      buildPublicWork(w, works.region, works.kind)
  }
  // Signed charters replace nation records; commit only after this phase's iteration.
  if (w.statecraft) settleConventionalOffers(w)
}
