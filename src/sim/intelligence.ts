import { clamp, relation, type World } from './types'
import { hashSeed, random } from './random'
import type { DiplomaticOffer } from './statecraft-types'

export const INTELLIGENCE_PRIORITIES = [
  'balanced',
  'military',
  'economy',
  'politics',
  'counterintelligence',
] as const
export type IntelligencePriority = (typeof INTELLIGENCE_PRIORITIES)[number]
export interface Estimate {
  estimate: number
  low: number
  high: number
}
export interface IntelligenceReport {
  month: number
  confidence: number
  sources: string[]
  values: Record<string, Estimate>
}
export interface Dossier {
  nation: number
  name: string
  discovered: number
  lastContact?: number
  access: number
  expansion: number
  military?: IntelligenceReport
  economy?: IntelligenceReport
  politics?: IntelligenceReport & { government: string; leader: string; culture?: number; language?: number }
}
export interface KnownProvince {
  id: number
  name: string
  nation: number
  neighbors: number[]
  coastal: boolean
  terrain: string
  month: number
}
export interface ReportedRelation {
  a: number
  b: number
  treaty: string
  since: number
  aggressor?: number
  month: number
}
export interface IntelligenceService {
  nation: number
  established: number
  budgetShare: number
  priority: IntelligencePriority
  focus: number | null
  capacity: number
  spent: number
  totalSpent: number
  lastMonth: number
  dossiers: Dossier[]
  chart: KnownProvince[]
  relations: ReportedRelation[]
  sightings: { region: number; nation: number; month: number; strength: Estimate }[]
  agreements: { offer: DiplomaticOffer; month: number }[]
  news: number[]
  broadcasts: number[]
}
export interface IntelligenceState {
  version: 1
  services: IntelligenceService[]
}
const owns = (w: World, n: number) => w.regions.filter((r) => r.nation === n)
const ownPower = (w: World, n: number) =>
  w.armies
    .filter((a) => a.nation === n)
    .reduce(
      (s, a) => s + a.soldiers * a.morale * (0.25 + 0.75 * a.supply) * (a.operations?.cohesion ?? 0.7),
      0,
    )
const hasDefense = (w: World, a: number, b: number) =>
  relation(w, a, b)?.treaty === 'alliance' ||
  (w.institutions?.organizations.some(
    (o) =>
      o.status === 'active' &&
      o.members.includes(a) &&
      o.members.includes(b) &&
      o.charter.powers.includes('defense'),
  ) ??
    false)
function dossier(w: World, s: IntelligenceService, nation: number) {
  let d = s.dossiers.find((d) => d.nation === nation)
  if (!d && w.nations[nation] && nation !== s.nation) {
    d = { nation, name: w.nations[nation].name, discovered: w.month, access: 0, expansion: 0 }
    s.dossiers.push(d)
  }
  return d
}
function chartProvince(w: World, s: IntelligenceService, id: number) {
  const r = w.regions[id]
  if (!r) return
  const old = s.chart.find((p) => p.id === id)
  if (old && old.nation !== r.nation && r.nation !== s.nation) dossier(w, s, r.nation)!.expansion += 1
  const entry = {
    id,
    name: r.name,
    nation: r.nation,
    neighbors: [...r.neighbors],
    coastal: r.coastal,
    terrain: r.terrain,
    month: w.month,
  }
  if (old) Object.assign(old, entry)
  else s.chart.push(entry)
  if (r.nation !== s.nation) dossier(w, s, r.nation)
}
function localSight(w: World, s: IntelligenceService) {
  const provinces = new Set(owns(w, s.nation).flatMap((r) => [r.id, ...r.neighbors]))
  for (const a of w.armies.filter((a) => a.nation === s.nation)) {
    provinces.add(a.region)
    for (const id of w.regions[a.region].neighbors) provinces.add(id)
  }
  // Ships observe coasts they physically reach, rather than revealing every fleet on an ocean.
  for (const f of w.warfare?.fleets.filter((f) => f.nation === s.nation) ?? [])
    for (const r of w.regions.filter(
      (r) =>
        r.coastal &&
        r.cells.some(
          (id) =>
            Math.abs(w.cells[id].q - w.cells[f.cell].q) <= 2 &&
            Math.abs(w.cells[id].r - w.cells[f.cell].r) <= 2,
        ),
    ))
      provinces.add(r.id)
  for (const id of provinces) chartProvince(w, s, id)
  s.sightings = s.sightings.filter((r) => !provinces.has(r.region) && w.month - r.month <= 12)
  const groups = new Map<string, { region: number; nation: number; strength: number }>()
  for (const a of w.armies)
    if (a.nation !== s.nation && provinces.has(a.region) && a.operations?.embarkedOn == null) {
      const key = `${a.region}:${a.nation}`,
        entry = groups.get(key) ?? { region: a.region, nation: a.nation, strength: 0 }
      entry.strength += a.soldiers
      groups.set(key, entry)
    }
  for (const g of groups.values())
    s.sightings.push({
      region: g.region,
      nation: g.nation,
      month: w.month,
      strength: report(w, s, g.nation, `sighting:${g.region}`, { strength: g.strength }, 0.45, [
        'field patrols',
      ]).values.strength,
    })
  for (const rel of w.relations)
    if ((rel.a === s.nation || rel.b === s.nation) && rel.treaty !== 'neutral')
      dossier(w, s, rel.a === s.nation ? rel.b : rel.a)
  for (const route of w.routes) {
    const a = w.regions[route.from],
      b = w.regions[route.to]
    if (a?.nation === s.nation || b?.nation === s.nation) {
      for (const id of route.path) chartProvince(w, s, id)
    }
  }
  for (const message of w.statecraft?.messages ?? [])
    if (message.from === s.nation || message.to.includes(s.nation)) {
      dossier(w, s, message.from)
      for (const id of message.to) dossier(w, s, id)
    }
  for (const offer of w.statecraft?.offers ?? [])
    if (offer.parties.includes(s.nation)) for (const id of offer.parties) dossier(w, s, id)
}
function report(
  w: World,
  s: IntelligenceService,
  target: number,
  domain: string,
  values: Record<string, number>,
  confidence: number,
  sources: string[],
): IntelligenceReport {
  // Persistent source bias prevents rerolling a new answer by requesting another context.
  const estimates = Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const seed = { rng: hashSeed(`${w.seed}:intelligence:${s.nation}:${target}:${domain}:${key}`) },
        error = 0.12 + (1 - confidence) * 1.2,
        bias = (random(seed) - 0.5) * 2,
        maximum = key === 'food' ? 1 : domain === 'politics' ? 100 : 1e14,
        estimate = clamp(Math.max(0, value) * Math.exp(bias * error), 0, maximum),
        scale = Math.max(key === 'food' ? 0.05 : domain === 'politics' ? 3 : 1, estimate * error),
        step = key === 'food' ? 0.01 : 1
      return [
        key,
        {
          estimate: Math.round(estimate * 100) / 100,
          low: Math.max(0, Math.floor((estimate - scale) / step) * step),
          high: Math.min(maximum, Math.ceil((estimate + scale) / step) * step),
        },
      ]
    }),
  )
  return { month: w.month, confidence, sources, values: estimates }
}
function collect(w: World, s: IntelligenceService, d: Dossier, bootstrap = false) {
  const n = w.nations[d.nation],
    own = owns(w, s.nation),
    foreign = owns(w, d.nation)
  if (!n || !foreign.length) return // Old reports survive an unobserved collapse.
  const border = own.some((r) => r.neighbors.some((id) => w.regions[id].nation === n.id)),
    trading = w.routes.some(
      (r) =>
        [w.regions[r.from]?.nation, w.regions[r.to]?.nation].includes(s.nation) &&
        [w.regions[r.from]?.nation, w.regions[r.to]?.nation].includes(n.id),
    ),
    ally = hasDefense(w, s.nation, n.id),
    focused = s.focus === n.id,
    opposition = w.intelligence?.services.find((x) => x.nation === n.id),
    counter = opposition?.priority === 'counterintelligence' ? opposition.capacity * 0.3 : 0,
    access = Math.max(0, d.access - counter),
    sources = [
      ...(border ? ['frontier patrols'] : []),
      ...(trading ? ['merchant correspondence'] : []),
      ...(ally ? ['allied liaison'] : []),
      ...(access > 0.08 ? ['foreign reporting network'] : []),
    ],
    reach = border || trading || ally || access > 0.08
  if (!reach) return
  d.lastContact = w.month
  const confidence = clamp(
      (border ? 0.18 : 0) + (trading ? 0.14 : 0) + (ally ? 0.28 : 0) + access * 0.42,
      0.1,
      0.82,
    ),
    cadence = bootstrap ? 1 : focused && s.spent > 0 ? 3 : 6,
    due = (domain: IntelligenceReport | undefined, offset: number) =>
      !domain || (!bootstrap && w.month - domain.month >= cadence + offset),
    visible = new Set(s.chart.filter((p) => p.month >= w.month - 1).map((p) => p.id))
  if (due(d.military, s.priority === 'military' ? -1 : 1)) {
    const formations = w.armies.filter((a) => a.nation === n.id),
      observed = formations.filter((a) => visible.has(a.region)),
      informed = ally || access > 0.25,
      scouts = observed.reduce((sum, a) => sum + a.soldiers, 0),
      // Frontier sightings do not supply a magical census of the entire foreign army.
      estimate = informed
        ? formations.reduce((sum, a) => sum + a.soldiers, 0)
        : Math.max(scouts, ownPower(w, s.nation) * 1.5),
      force = informed ? ownPower(w, n.id) : estimate * 0.4,
      fleets =
        w.warfare?.fleets.filter(
          (f) =>
            f.nation === n.id &&
            (informed ||
              w.warfare!.fleets.some(
                (our) =>
                  our.nation === s.nation &&
                  Math.abs(w.cells[our.cell].q - w.cells[f.cell].q) < 4 &&
                  Math.abs(w.cells[our.cell].r - w.cells[f.cell].r) < 4,
              )),
        ) ?? []
    d.military = report(
      w,
      s,
      n.id,
      'military',
      {
        soldiers: estimate,
        effectivePower: force,
        ...(informed
          ? {
              warships: fleets.reduce((sum, f) => sum + f.warships, 0),
              transports: fleets.reduce((sum, f) => sum + f.transports, 0),
            }
          : {}),
      },
      confidence,
      sources,
    )
  }
  if (due(d.economy, s.priority === 'economy' ? 0 : 3) && (trading || ally || access > 0.12))
    d.economy = report(
      w,
      s,
      n.id,
      'economy',
      {
        population: n.population,
        output: n.gdp,
        treasury: n.treasury,
        food: n.foodCoverage,
        iron: foreign.reduce((sum, r) => sum + r.production.iron, 0),
        coal: foreign.reduce((sum, r) => sum + r.production.coal, 0),
        timber: foreign.reduce((sum, r) => sum + r.production.timber, 0),
      },
      confidence,
      sources,
    )
  if (due(d.politics, s.priority === 'politics' ? 0 : 6) && (border || ally || access > 0.1)) {
    d.name = n.name
    d.politics = {
      ...report(
        w,
        s,
        n.id,
        'politics',
        { stability: n.stability, legitimacy: n.legitimacy },
        confidence,
        sources,
      ),
      government: n.government,
      leader: n.character?.leader.name ?? '',
      culture: n.identity?.culture,
      language: n.identity?.language,
    }
  }
}

export function ensureIntelligence(w: World) {
  w.intelligence ??= { version: 1, services: [] }
  for (const n of w.nations)
    if (!w.intelligence.services.some((s) => s.nation === n.id)) {
      const s: IntelligenceService = {
        nation: n.id,
        established: w.month,
        budgetShare: 0.005,
        priority: 'balanced',
        focus: null,
        capacity: 0,
        spent: 0,
        totalSpent: 0,
        lastMonth: w.month,
        dossiers: [],
        chart: [],
        relations: [],
        sightings: [],
        agreements: [],
        news: [],
        broadcasts: [],
      }
      w.intelligence.services.push(s)
      localSight(w, s)
      for (const d of s.dossiers) collect(w, s, d, true)
    }
  return w.intelligence
}
export function intelligenceService(w: World, nation: number) {
  return (
    w.intelligence?.services.find((s) => s.nation === nation) ??
    ensureIntelligence(w).services.find((s) => s.nation === nation)!
  )
}
export function configureIntelligence(
  w: World,
  nation: number,
  budgetShare: number,
  priority: IntelligencePriority,
  focus: number | null,
) {
  if (
    !w.nations[nation] ||
    !owns(w, nation).length ||
    !Number.isFinite(budgetShare) ||
    budgetShare < 0 ||
    budgetShare > 0.15 ||
    !INTELLIGENCE_PRIORITIES.includes(priority)
  )
    throw new Error('Choose a valid intelligence priority and a budget between 0 and 15% of revenue.')
  const s = intelligenceService(w, nation)
  if (focus !== null && (!Number.isInteger(focus) || !s.dossiers.some((d) => d.nation === focus)))
    throw new Error('An intelligence focus must be a state already known to this government.')
  s.budgetShare = budgetShare
  s.priority = priority
  s.focus = focus
}
export function advanceIntelligence(w: World) {
  const state = ensureIntelligence(w)
  for (const s of state.services) {
    if (s.lastMonth >= w.month) continue
    s.lastMonth = w.month
    s.spent = 0
    const n = w.nations[s.nation]
    if (!owns(w, n.id).length) continue
    s.spent = Math.min(Math.max(0, n.treasury), Math.max(0, n.income) * s.budgetShare)
    n.treasury -= s.spent
    n.spending += s.spent
    s.totalSpent += s.spent
    const scale = Math.max(1, n.population / 100000),
      funded = clamp(s.spent / scale, 0, 2)
    s.capacity = clamp(s.capacity + funded * 0.012 - (s.spent > 0 ? 0.001 : 0.008), 0, 0.95)
    localSight(w, s)
    // Slow cartography: adjacent reported territory, or a funded focus, never the full world.
    if (s.spent > 0 && w.month % 3 === s.nation % 3) {
      const known = new Set(s.chart.map((p) => p.id)),
        next = s.chart
          .flatMap((p) => p.neighbors)
          .filter((id) => !known.has(id) && (s.focus === null || w.regions[id].nation === s.focus))
      for (const id of [...new Set(next)].slice(0, 1 + Math.floor(s.capacity * 3))) chartProvince(w, s, id)
    }
    for (const d of s.dossiers) {
      const attention =
        s.focus === null ? 1 / Math.max(1, s.dossiers.length) : s.focus === d.nation ? 1 : 0.05
      d.access = clamp(d.access + funded * 0.025 * attention - (s.spent > 0 ? 0.001 : 0.01), 0, 0.9)
      d.expansion *= 0.98
      const oldPower = d.military?.values.effectivePower.estimate
      collect(w, s, d)
      if (
        oldPower !== undefined &&
        d.military?.month === w.month &&
        d.military.values.effectivePower.estimate > Math.max(500, oldPower) * 1.5
      ) {
        const agent = w.statecraft?.agents.find((a) => a.nation === s.nation)
        if (agent) {
          agent.escalation =
            'New military reports suggest a substantial foreign buildup; reassess their reliability and the strategic response.'
          agent.nextDecision = w.month
          agent.nextStrategy = Math.min(agent.nextStrategy, w.month)
        }
      }
    }
    const known = new Set(
        s.dossiers.filter((d) => w.month - (d.lastContact ?? d.discovered) <= 3).map((d) => d.nation),
      ),
      delay = 2 + Math.round((1 - s.capacity) * 4)
    for (const rel of w.relations)
      if (
        rel.a !== s.nation &&
        rel.b !== s.nation &&
        known.has(rel.a) &&
        known.has(rel.b) &&
        w.month - rel.since >= delay &&
        w.month % 3 === s.nation % 3
      ) {
        const old = s.relations.find((r) => r.a === rel.a && r.b === rel.b),
          entry = {
            a: rel.a,
            b: rel.b,
            treaty: rel.treaty,
            since: rel.since,
            ...(rel.aggressor === undefined ? {} : { aggressor: rel.aggressor }),
            month: w.month,
          }
        if (
          rel.treaty === 'war' &&
          rel.aggressor !== undefined &&
          (!old || old.treaty !== 'war' || old.since !== rel.since)
        ) {
          const stance = relation(w, s.nation, rel.aggressor)
          if (stance && stance.treaty !== 'war') {
            stance.opinion = clamp(stance.opinion - 8, -100, 100)
            stance.grievance = clamp(stance.grievance + 8, 0, 100)
          }
        }
        if (old) Object.assign(old, entry)
        else s.relations.push(entry)
      }
    for (const offer of w.statecraft?.offers ?? [])
      if (
        offer.visibility === 'public' &&
        !offer.parties.includes(s.nation) &&
        offer.parties.some((id) => known.has(id)) &&
        w.month - Math.max(offer.month, offer.activated) >= delay
      ) {
        const old = s.agreements.find((r) => r.offer.id === offer.id)
        if (!old || w.month - old.month >= 6) {
          const entry = { offer: structuredClone(offer), month: w.month }
          if (old) Object.assign(old, entry)
          else s.agreements.push(entry)
        }
      }
    s.agreements = s.agreements.slice(-64)
    s.relations = s.relations.slice(-1024)
    const live = new Set(w.events.map((e) => e.id))
    s.news = s.news.filter((id) => live.has(id))
    for (const event of w.events)
      if (
        event.nation !== undefined &&
        known.has(event.nation) &&
        w.month - event.month >= delay &&
        !s.news.includes(event.id)
      )
        s.news.push(event.id)
    s.news = s.news.slice(-120)
    const messages = w.statecraft?.messages ?? []
    s.broadcasts = s.broadcasts.filter((id) => messages.some((m) => m.id === id))
    for (const message of messages)
      if (
        message.visibility === 'public' &&
        known.has(message.from) &&
        w.month - message.month >= delay &&
        !s.broadcasts.includes(message.id)
      )
        s.broadcasts.push(message.id)
    s.broadcasts = s.broadcasts.slice(-120)
  }
}
export function knownMap(w: World, nation: number) {
  const s = intelligenceService(w, nation),
    ids = new Set(s.chart.map((p) => p.id))
  return s.chart.map((p) => ({ ...p, neighbors: p.neighbors.filter((id) => ids.has(id)) }))
}
export function foreignIntelligence(w: World, nation: number) {
  const s = intelligenceService(w, nation)
  const age = (r: IntelligenceReport | undefined) =>
    r
      ? {
          ...r,
          age: w.month - r.month,
          currentConfidence: clamp(r.confidence * Math.exp(-(w.month - r.month) / 36)),
        }
      : null
  return s.dossiers.map((d) => ({
    id: d.nation,
    name: d.name,
    discovered: d.discovered,
    expansionReports: d.expansion,
    military: age(d.military),
    economy: age(d.economy),
    politics: age(d.politics),
    relation: relation(w, nation, d.nation),
  }))
}
export function perceivedPower(w: World, observer: number, target: number) {
  if (observer === target) return ownPower(w, target)
  const d = intelligenceService(w, observer).dossiers.find((d) => d.nation === target)
  const estimate = d?.military?.values.effectivePower.estimate
  // Unknown force strength uses a prior from the observer's experience, never a hidden foreign statistic.
  return estimate ?? Math.max(500, ownPower(w, observer))
}
export function knownRelation(w: World, observer: number, a: number, b: number) {
  if (a === observer || b === observer) return relation(w, a, b)
  return intelligenceService(w, observer).relations.find(
    (r) => r.a === Math.min(a, b) && r.b === Math.max(a, b),
  )
}
export function perceivedAllies(w: World, observer: number, target: number) {
  const s = intelligenceService(w, observer),
    ids = new Set<number>()
  for (const n of s.dossiers)
    if (n.nation !== target && knownRelation(w, observer, target, n.nation)?.treaty === 'alliance')
      ids.add(n.nation)
  if (observer !== target && relation(w, observer, target)?.treaty === 'alliance') ids.add(observer)
  for (const body of w.institutions?.organizations ?? [])
    if (
      body.members.includes(observer) &&
      body.status === 'active' &&
      body.members.includes(target) &&
      body.charter.powers.includes('defense')
    )
      for (const id of body.members) if (id !== target) ids.add(id)
  for (const { offer } of s.agreements)
    if (
      offer.status === 'ratified' &&
      offer.parties.includes(target) &&
      offer.resolved.some((t) => t.kind === 'institution' && t.charter?.powers.includes('defense'))
    )
      for (const id of offer.parties) if (id !== target) ids.add(id)
  return [...ids]
}
export function reportedWar(w: World, observer: number, a: number, b: number) {
  return knownRelation(w, observer, a, b)?.treaty === 'war'
}
export function observedThreat(w: World, observer: number, region: number) {
  return intelligenceService(w, observer)
    .sightings.filter(
      (s) =>
        s.region === region && w.month - s.month <= 3 && relation(w, observer, s.nation)?.treaty === 'war',
    )
    .reduce((sum, s) => sum + s.strength.estimate * 0.4, 0)
}
export function visibleInstitutions(w: World, nation: number) {
  const s = intelligenceService(w, nation),
    own = w.institutions?.organizations.filter((o) => o.members.includes(nation)) ?? []
  const reported = s.agreements.flatMap(({ offer, month }) =>
    offer.resolved
      .filter((t) => t.kind === 'institution' && t.charter)
      .map((t) => ({
        name: t.text,
        members: offer.parties,
        charter: t.charter,
        visibility: offer.visibility,
        reported: month,
        warning: 'Reported charter; current membership and fulfillment may differ.',
      })),
  )
  return [...own, ...reported]
}
export function intelligenceContext(w: World, nation: number) {
  const s = intelligenceService(w, nation)
  return {
    budgetShare: s.budgetShare,
    priority: s.priority,
    focus: s.focus,
    spent: s.spent,
    capacity: s.capacity,
    knownStates: s.dossiers.length,
    chartedProvinces: s.chart.length,
    sightings: s.sightings.map((r) => ({
      ...r,
      age: w.month - r.month,
      source: 'Local field observations; strength and position may have changed.',
    })),
    limits:
      'Foreign figures are uncertain reports, not live facts. Missing information is unknown, not zero. Dates, sources and confidence matter. Diplomatic correspondence contains claims, not verified truth. Older strategic memories may contain obsolete or unverified foreign claims.',
  }
}
export function domesticAuthority(w: World, nation: number) {
  const reports = w.sovereignty?.provinces.filter((p) => w.regions[p.region].nation === nation) ?? []
  return {
    fragile: reports.filter((p) => p.stage !== 'stable').length,
    contested: reports.filter((p) => p.stage === 'contested').length,
    emergencies: reports
      .filter((p) => p.stage !== 'stable')
      .slice(0, 8)
      .map((p) => ({
        region: p.region,
        place: w.regions[p.region].name,
        stage: p.stage,
        warning:
          p.stage === 'contested'
            ? 'An organized challenge threatens a near-term loss of control; its strength and timing are uncertain.'
            : 'Reports describe insecure authority and growing opposition. Internal organization and mobilization are not fully known.',
      })),
  }
}
