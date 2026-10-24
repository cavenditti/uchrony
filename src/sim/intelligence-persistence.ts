import type { World } from './types'
import { INTELLIGENCE_PRIORITIES, type IntelligenceReport } from './intelligence'
import { validateStatecraft } from './statecraft-persistence'

export function validateIntelligence(w: World) {
  const state = w.intelligence
  if (state === undefined) return
  const fail = (): never => {
      throw new Error('Invalid intelligence service or report in this save.')
    },
    object = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v),
    number = (v: unknown, low = 0, high = 1e16) =>
      typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high,
    integer = (v: unknown, low = 0, high = 1e12) => number(v, low, high) && Number.isInteger(v),
    nation = (v: unknown) => integer(v, 0, w.nations.length - 1),
    month = (v: unknown) => integer(v, 0, w.month),
    text = (v: unknown, max = 180) => typeof v === 'string' && v.length <= max
  const report = (r: IntelligenceReport | undefined) => {
    if (r === undefined) return
    if (
      !object(r) ||
      !month(r.month) ||
      !number(r.confidence, 0, 1) ||
      !Array.isArray(r.sources) ||
      r.sources.length > 8 ||
      r.sources.some((s) => !text(s, 80)) ||
      !object(r.values) ||
      Object.keys(r.values).length > 20
    )
      fail()
    for (const e of Object.values(r.values))
      if (
        !object(e) ||
        !number(e.estimate) ||
        !number(e.low) ||
        !number(e.high) ||
        e.low > e.estimate ||
        e.estimate > e.high
      )
        fail()
  }
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.services) ||
    state.services.length > w.nations.length
  )
    fail()
  const services = new Set<number>()
  for (const s of state.services) {
    if (
      !s ||
      !nation(s.nation) ||
      services.has(s.nation) ||
      !month(s.established) ||
      !month(s.lastMonth) ||
      !number(s.budgetShare, 0, 0.15) ||
      !INTELLIGENCE_PRIORITIES.includes(s.priority) ||
      !number(s.capacity, 0, 0.95) ||
      !number(s.spent) ||
      !number(s.totalSpent) ||
      s.spent > s.totalSpent ||
      !Array.isArray(s.dossiers) ||
      s.dossiers.length >= w.nations.length ||
      !Array.isArray(s.chart) ||
      s.chart.length > w.regions.length ||
      !Array.isArray(s.relations) ||
      s.relations.length > 1024 ||
      !Array.isArray(s.sightings) ||
      s.sightings.length > w.regions.length * w.nations.length ||
      !Array.isArray(s.agreements) ||
      s.agreements.length > 64 ||
      !Array.isArray(s.news) ||
      s.news.length > 120 ||
      s.news.some((id) => !integer(id, 1, w.nextEvent - 1)) ||
      !Array.isArray(s.broadcasts) ||
      s.broadcasts.length > 120 ||
      s.broadcasts.some((id) => !integer(id, 1)) ||
      new Set(s.news).size !== s.news.length ||
      new Set(s.broadcasts).size !== s.broadcasts.length
    )
      fail()
    services.add(s.nation)
    const states = new Set<number>(),
      chart = new Set<number>(),
      relations = new Set<string>(),
      offers = new Set<number>()
    for (const d of s.dossiers) {
      if (
        !d ||
        !nation(d.nation) ||
        d.nation === s.nation ||
        states.has(d.nation) ||
        !text(d.name) ||
        !month(d.discovered) ||
        (d.lastContact !== undefined && !month(d.lastContact)) ||
        !number(d.access, 0, 0.9) ||
        !number(d.expansion)
      )
        fail()
      states.add(d.nation)
      report(d.military)
      report(d.economy)
      report(d.politics)
      if (d.military && !['soldiers', 'effectivePower'].every((k) => k in d.military!.values)) fail()
      if (
        d.economy &&
        !['population', 'output', 'treasury', 'food', 'iron', 'coal', 'timber'].every(
          (k) => k in d.economy!.values,
        )
      )
        fail()
      if (
        d.politics &&
        (!text(d.politics.government) ||
          !text(d.politics.leader) ||
          !('stability' in d.politics.values) ||
          !('legitimacy' in d.politics.values) ||
          (d.politics.culture !== undefined && !integer(d.politics.culture, 0, 1e6)) ||
          (d.politics.language !== undefined && !integer(d.politics.language, 0, 1e6)))
      )
        fail()
    }
    if (s.focus !== null && !states.has(s.focus)) fail()
    for (const p of s.chart) {
      if (
        !p ||
        !integer(p.id, 0, w.regions.length - 1) ||
        chart.has(p.id) ||
        !text(p.name) ||
        !nation(p.nation) ||
        !month(p.month) ||
        typeof p.coastal !== 'boolean' ||
        !text(p.terrain, 20) ||
        !Array.isArray(p.neighbors) ||
        p.neighbors.length > w.regions.length ||
        p.neighbors.some((id) => !integer(id, 0, w.regions.length - 1))
      )
        fail()
      chart.add(p.id)
    }
    for (const r of s.relations) {
      if (!r) fail()
      const key = `${r.a}:${r.b}`
      if (
        !r ||
        !nation(r.a) ||
        !nation(r.b) ||
        r.a >= r.b ||
        relations.has(key) ||
        !month(r.since) ||
        !month(r.month) ||
        !['neutral', 'trade', 'alliance', 'war', 'truce'].includes(r.treaty) ||
        (r.aggressor !== undefined && r.aggressor !== r.a && r.aggressor !== r.b)
      )
        fail()
      relations.add(key)
    }
    for (const r of s.sightings) {
      if (
        !r ||
        !integer(r.region, 0, w.regions.length - 1) ||
        !nation(r.nation) ||
        r.nation === s.nation ||
        !month(r.month)
      )
        fail()
      report({ month: r.month, confidence: 0.45, sources: [], values: { strength: r.strength } })
    }
    for (const r of s.agreements) {
      if (
        !r ||
        !month(r.month) ||
        !r.offer ||
        r.offer.visibility !== 'public' ||
        r.offer.parties.includes(s.nation) ||
        offers.has(r.offer.id)
      )
        fail()
      offers.add(r.offer.id)
    }
    if (s.agreements.length) {
      if (!w.statecraft) fail()
      validateStatecraft({
        ...w,
        statecraft: {
          ...w.statecraft!,
          offers: s.agreements.map((r) => r.offer),
          messages: [],
          rulings: [],
          audit: [],
        },
      })
    }
  }
}
