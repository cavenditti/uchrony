/** Campaign planning consumes reported opposition and actual home readiness.
 * Persistent objectives concentrate forces without granting movement or supplies. */
import {
  cabinetOrderReserved,
  ensureCabinet,
  nativeStrategicControl,
  setCabinetAgenda,
} from './cabinet-state'
import { decisionPolicy } from './decision-policy'
import { shortestPaths } from './economy'
import { foreignPolicyMandate } from './institutions'
import { knownMap, knownRelation, observedThreat, perceivedAllies, perceivedPower } from './intelligence'
import { landGraph } from './military'
import { controller, occupationStrengthRequired } from './military-control'
import { tryStandingOffer, admitDiplomaticConsent } from './statecraft'
import { relation, type Army, type Nation, type World } from './types'

const strength = (army: Army) =>
  army.soldiers * army.morale * army.supply * (army.operations?.cohesion ?? 0.7)
const balance = (w: World, n: Nation, rival: number) =>
  perceivedPower(w, n.id, n.id) /
  Math.max(decisionPolicy().realCosts ? 30 : 500, perceivedPower(w, n.id, rival))

/** Retain the last peace even after the truce expires. An unchanged grievance is
 * not a new reason to repeat the same costly, inconclusive war. */
export function rememberWars(w: World, n: Nation) {
  const c = ensureCabinet(w, n)
  for (const rel of w.relations) {
    if (rel.a !== n.id && rel.b !== n.id) continue
    const rival = rel.a === n.id ? rel.b : rel.a
    let memory = c.wars.find((m) => m.rival === rival)
    if (!memory && (rel.treaty === 'war' || rel.treaty === 'truce')) {
      memory = {
        rival,
        active: rel.treaty === 'war',
        peace: rel.treaty === 'truce' ? rel.since : 0,
        grievance: rel.grievance,
        balance: balance(w, n, rival),
      }
      c.wars.push(memory)
    }
    if (!memory) continue
    if (memory.active && rel.treaty !== 'war')
      Object.assign(memory, {
        active: false,
        peace: w.month,
        grievance: rel.grievance,
        balance: balance(w, n, rival),
      })
    else if (rel.treaty === 'war') memory.active = true
  }
}

/** Territorial claims mean lost home provinces, not a generic dislike of a peer. */
export function hasCampaignCause(w: World, n: Nation, rival: number) {
  const rel = relation(w, n.id, rival)
  if (!rel || ['truce', 'alliance', 'war'].includes(rel.treaty)) return false
  const memory = n.cabinet?.wars.find((m) => m.rival === rival)
  const claim = knownMap(w, n.id).some(
    (r) => r.nation === rival && w.regions[r.id].occupation?.former === n.id,
  )
  if (!memory) return claim || rel.grievance >= 15 || rel.opinion <= -35
  if (w.month - memory.peace < 60) return false
  return (
    (claim && rel.grievance >= memory.grievance + 5) ||
    rel.grievance >= memory.grievance + 15 ||
    (balance(w, n, rival) >= Math.max(1.5, memory.balance * 1.5) && (claim || rel.grievance >= 10))
  )
}

/** A campaign is ready only after its men reach a supplied frontier. Time expiry
 * aborts an unready campaign; it never authorizes an otherwise impossible war. */
export function campaignReadiness(w: World, n: Nation, rival: number) {
  const border = w.regions.filter(
    (r) => r.nation === n.id && !r.control && r.neighbors.some((id) => w.regions[id].nation === rival),
  )
  const ids = new Set(border.map((r) => r.id))
  const armies = w.armies.filter((a) => a.nation === n.id && a.operations?.embarkedOn == null)
  const total = armies.reduce((s, a) => s + strength(a), 0)
  const deployed = armies
    .filter((a) => ids.has(a.region) && a.supply >= 0.65 && a.morale >= 0.5)
    .reduce((s, a) => s + strength(a), 0)
  const opposition = Math.max(
    decisionPolicy().realCosts ? 30 : 500,
    perceivedPower(w, n.id, rival) +
      perceivedAllies(w, n.id, rival).reduce((s, id) => s + perceivedPower(w, n.id, id), 0) * 0.6,
  )
  const risk = n.character!.leader.politics!.drives.riskTolerance
  return {
    border,
    total,
    deployed,
    opposition,
    ready:
      deployed >= opposition * (1.2 - risk * 0.3) &&
      deployed >= total * 0.6 &&
      n.foodCoverage >= 0.9 &&
      n.stability >= 40,
    deterred: total < opposition * 0.35 && w.month - ensureCabinet(w, n).started >= 9,
  }
}

/** Route whole formations to a common staging province; inaccessible troops do
 * not count toward readiness and cannot teleport across neutral borders. */
export function advanceCampaignPreparation(w: World, n: Nation) {
  if (!n.ai || n.extinct !== undefined) return false
  const c = ensureCabinet(w, n)
  if (c.posture !== 'prepare-war' || c.target === null) return false
  const rival = c.target,
    rel = relation(w, n.id, rival)
  const readiness = campaignReadiness(w, n, rival)
  if (
    !rel ||
    w.nations[rival]?.extinct !== undefined ||
    !readiness.border.length ||
    ['alliance', 'truce'].includes(rel.treaty) ||
    w.month >= c.review ||
    readiness.deterred ||
    n.foodCoverage < 0.75
  ) {
    setCabinetAgenda(w, n, 'consolidate')
    c.review = w.month + 36
    return true
  }
  const graph = landGraph(w, n.id),
    paths = new Map<number, ReturnType<typeof shortestPaths>>()
  const staging = readiness.border
    .slice()
    .sort((a, b) => b.infrastructure - a.infrastructure || a.id - b.id)[0]
  for (const army of w.armies) {
    if (
      army.nation !== n.id ||
      !army.operations ||
      army.operations.embarkedOn !== null ||
      cabinetOrderReserved(w, n, `army:${army.id}`)
    )
      continue
    if (!paths.has(army.region)) paths.set(army.region, shortestPaths(graph, army.region))
    if (!Number.isFinite(paths.get(army.region)!.distance[staging.id])) continue
    army.target = army.region === staging.id ? null : staging.id
    army.operations.stance = army.region === staging.id ? 'hold' : 'march'
  }
  if (w.month - c.started < 3 || !readiness.ready || !foreignPolicyMandate(w, n.id, [n.id])) return true
  // A model's explicit preparation directive supplies strategic intent. Native
  // campaigns must still have a cause after any intervening diplomatic changes.
  if (c.source !== 'model' && !hasCampaignCause(w, n, rival)) return true
  const offer = tryStandingOffer(w, n.id, {
    title: `${n.shortName} opens its prepared campaign`.slice(0, 140),
    parties: [n.id],
    visibility: 'public',
    duration: 12,
    supersedes: 0,
    terms: [
      {
        kind: 'war',
        from: n.id,
        to: rival,
        amount: 0,
        good: '',
        field: '',
        regions: [],
        duration: 0,
        text: 'Supplied forces have assembled for the government’s declared frontier objective.',
      },
    ],
  })
  if (offer) setCabinetAgenda(w, n, 'wage-war', rival, c.source)
  return true
}

/** Seek one real partner facing the same rival. Each native partner supplies its
 * own consent; a model or human partner remains free to answer later. */
export function seekCampaignSupport(w: World, n: Nation, rival: number) {
  const chart = knownMap(w, n.id)
  const adjacent = new Set(chart.filter((r) => r.nation === rival).flatMap((r) => r.neighbors))
  const partner = w.nations.find(
    (other) =>
      other.id !== n.id &&
      other.id !== rival &&
      other.extinct === undefined &&
      chart.some((r) => r.nation === other.id && adjacent.has(r.id)) &&
      (relation(w, n.id, other.id)?.opinion ?? -100) >= 20 &&
      ['neutral', 'trade'].includes(relation(w, n.id, other.id)?.treaty ?? '') &&
      knownRelation(w, n.id, other.id, rival)?.treaty === 'war',
  )
  if (!partner) return
  const offer = tryStandingOffer(w, n.id, {
    title: `${n.shortName}–${partner.shortName} defense accord`.slice(0, 140),
    parties: [n.id, partner.id],
    visibility: 'public',
    duration: 18,
    supersedes: 0,
    terms: [
      {
        kind: 'alliance',
        from: n.id,
        to: partner.id,
        amount: 0,
        good: '',
        field: '',
        regions: [],
        duration: 60,
        text: 'Mutual military access and support in the face of a shared rival.',
      },
    ],
  })
  if (offer && nativeStrategicControl(w, partner)) admitDiplomaticConsent(w, partner.id, offer)
}

/** One retained objective per enemy front. Reserve one adequate occupation
 * garrison, then concentrate surplus formations on the weakest reported entry. */
export function directTheaters(w: World, n: Nation, enemies: Set<number>) {
  if (!n.ai || n.extinct !== undefined) return
  const c = ensureCabinet(w, n),
    chart = knownMap(w, n.id)
  const own = w.armies.filter((a) => a.nation === n.id && a.operations?.embarkedOn == null)
  const reserved = new Set<number>()
  for (const r of w.regions) {
    if (r.control?.nation !== n.id) continue
    let held = 0
    for (const a of own.filter((a) => a.region === r.id).sort((a, b) => strength(b) - strength(a))) {
      if (held >= occupationStrengthRequired(w, r.id)) break
      held += strength(a)
      reserved.add(a.id)
      if (a.operations && !cabinetOrderReserved(w, n, `army:${a.id}`)) {
        a.target = null
        a.operations.stance = 'hold'
      }
    }
  }
  const objectives = [] as NonNullable<typeof c.objectives>
  for (const rival of enemies) {
    const candidates = chart.filter(
      (r) =>
        (r.nation === rival || (r.nation === n.id && controller(w, r.id) === rival)) &&
        controller(w, r.id) !== n.id &&
        r.neighbors.some((id) => controller(w, id) === n.id),
    )
    const retained = c.objectives?.find(
      (o) => o.rival === rival && o.review > w.month && candidates.some((r) => r.id === o.province),
    )
    const target = candidates.sort(
      (a, b) => observedThreat(w, n.id, a.id) - observedThreat(w, n.id, b.id) || a.id - b.id,
    )[0]
    if (retained) objectives.push(retained)
    else if (target) objectives.push({ rival, province: target.id, review: w.month + 6 })
  }
  c.objectives = objectives
  if (!objectives.length || !own.length) return
  const graph = landGraph(w, n.id),
    paths = new Map<number, ReturnType<typeof shortestPaths>>()
  for (const a of own) {
    if (
      !a.operations ||
      reserved.has(a.id) ||
      cabinetOrderReserved(w, n, `army:${a.id}`) ||
      a.operations.disorder
    )
      continue
    // Domestic garrisons already assigned to an ongoing crisis retain their task.
    if (
      w.sovereignty?.provinces.some(
        (r) => r.nation === n.id && r.stage !== 'stable' && (r.region === a.target || r.region === a.region),
      )
    )
      continue
    if (!paths.has(a.region)) paths.set(a.region, shortestPaths(graph, a.region))
    const distances = paths.get(a.region)!.distance
    const target = objectives
      .filter((o) => Number.isFinite(distances[o.province]))
      .sort((x, y) => distances[x.province] - distances[y.province] || x.rival - y.rival)[0]
    if (!target) continue
    a.target = target.province
    a.operations.stance = a.supply >= 0.5 && a.morale >= 0.35 ? 'march' : 'entrench'
  }
}
