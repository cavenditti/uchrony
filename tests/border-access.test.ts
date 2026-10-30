/** Political restrictions must survive neutral detours, expired terms and saved worlds. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { generateWorld } from '../src/sim/generate'
import { diplomaticAccessView } from '../src/sim/agreements'
import { borderPolicy, setBorderPolicy } from '../src/sim/border-policy'
import { tradePolicy } from '../src/sim/trade-policy'
import { militaryVisit } from '../src/sim/military-access'
import { capitalConnections, isolationPressure } from '../src/sim/territorial-supply'
import { transportNetwork } from '../src/sim/transport'
import { transportGraph, reserveTarget, trade } from '../src/sim/economy'
import { ensureStatecraft, acceptStatePlan } from '../src/sim/statecraft'
import { parseStatePlan } from '../src/sim/statecraft-schema'
import { statecraftAffordances } from '../src/sim/statecraft-affordances'
import { advanceSovereignty } from '../src/sim/sovereignty'
import { applyCommand } from '../src/sim/commands'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { ensureDistrictEconomy } from '../src/sim/districts'
import { tradeDistricts, type DistrictNetwork } from '../src/sim/district-transport'
import { corridorProfile, corridorUsage } from '../src/sim/corridors'
import { BorderAccess } from '../src/components/BorderAccess'
import { describeClause } from '../src/components/DiplomaticChancery'
import { GOODS, relation, type World } from '../src/sim/types'
import type { DiplomaticClause, DiplomaticOffer } from '../src/sim/statecraft-types'
import { rebaseEndowments } from './fixtures/endowment'

function grant(
  w: World,
  kind: DiplomaticClause['kind'],
  from: number,
  to: number,
  regions: number[] = [],
  duration = 0,
) {
  const state = ensureStatecraft(w)
  state.offers.push({
    id: state.nextId++,
    status: 'ratified',
    activated: w.month,
    ends: 0,
    resolved: [{ kind, from, to, regions, duration }],
  } as DiplomaticOffer)
}

test('directional scoped transit, supply and basing obey expiration, host denial and war', () => {
  const w = generateWorld('access scopes', 3, 4),
    host = w.regions.filter((r) => r.nation === 1)
  for (const r of w.relations) r.treaty = 'neutral'
  grant(w, 'transit', 1, 0, [host[0].id], 2)
  let access = diplomaticAccessView(w)
  assert(access(0, 1, 'transit', host[0].id))
  assert(!access(0, 1, 'transit', host[1].id))
  assert(!access(0, 1, 'supply', host[0].id))
  assert(!access(1, 0))
  grant(w, 'access', 1, 0)
  access = diplomaticAccessView(w)
  assert(access(0, 1, 'supply', host[1].id))
  assert(!access(0, 1, 'basing', host[0].id))
  grant(w, 'basing', 1, 0, [host[0].id], 2)
  assert(diplomaticAccessView(w)(0, 1, 'basing', host[0].id))
  w.month += 2
  assert(!diplomaticAccessView(w)(0, 1, 'basing', host[0].id))
  setBorderPolicy(w, 1, 0, { trade: 'normal', military: 'closed' })
  relation(w, 0, 1)!.treaty = 'alliance'
  assert(!diplomaticAccessView(w)(0, 1, 'transit', host[0].id))
  setBorderPolicy(w, 1, 0, { trade: 'normal', military: 'basing' })
  relation(w, 0, 1)!.treaty = 'war'
  assert(!diplomaticAccessView(w)(0, 1, 'basing', host[0].id))
})

test('visits expire without basing; revoked permission requires withdrawal without relocation', () => {
  const w = generateWorld('foreign deployment', 3, 4),
    region = w.nations[1].capital
  setBorderPolicy(w, 1, 0, { trade: 'normal', military: 'supply' })
  let stay: { host: number; months: number } | undefined
  for (let month = 1; month <= 4; month++) {
    const visit = militaryVisit(w, 0, region, stay)
    stay = visit.stay
    assert.equal(visit.withdraw, month > 3)
  }
  setBorderPolicy(w, 1, 0, { trade: 'normal', military: 'basing' })
  assert.deepEqual(militaryVisit(w, 0, region, stay), { stay: undefined, withdraw: false })
  setBorderPolicy(w, 1, 0, { trade: 'normal', military: 'closed' })
  assert(militaryVisit(w, 0, region).withdraw)
})

test('tariff preferences cannot override restrictions, arms bans, embargoes or war', () => {
  const w = generateWorld('commercial permissions', 3, 4)
  relation(w, 0, 1)!.treaty = 'neutral'
  w.nations[0].policies.tariff = 20
  grant(w, 'preferential-trade', 0, 1)
  assert.equal(tradePolicy(w).tariff(0, 1), 0.1)
  grant(w, 'trade', 0, 1)
  assert.equal(tradePolicy(w).tariff(0, 1), 0)
  setBorderPolicy(w, 1, 0, { trade: 'restricted', military: 'treaties' })
  let policy = tradePolicy(w)
  assert.equal(policy.tariff(0, 1), 0.45)
  assert(policy.allowed(0, 1, 'food'))
  assert(!policy.allowed(0, 1, 'arms'))
  setBorderPolicy(w, 1, 0, { trade: 'embargo', military: 'basing' })
  assert(!tradePolicy(w).allowed(0, 1))
  setBorderPolicy(w, 1, 0, { trade: 'normal', military: 'basing' })
  relation(w, 0, 1)!.treaty = 'war'
  policy = tradePolicy(w)
  assert(!policy.allowed(0, 1))
  assert(policy.allowed(0, 0))
})

/** Three real adjacent provinces, with a single surveyed two-link corridor. */
function corridorWorld() {
  const w = generateWorld('neutral trade corridor', 3, 4),
    network = transportNetwork(w),
    links = network.links.filter((l) => !l.seaCost)
  const left = links.find((a) =>
    links.some((b) => a !== b && [a.from, a.to].includes(b.from) !== [a.from, a.to].includes(b.to)),
  )!
  const right = links.find(
    (b) => b !== left && [left.from, left.to].includes(b.from) !== [left.from, left.to].includes(b.to),
  )!
  assert(left && right)
  const middle = [left.from, left.to].find((id) => [right.from, right.to].includes(id))!,
    from = left.from === middle ? left.to : left.from,
    to = right.from === middle ? right.to : right.from
  network.links = [left, right]
  for (const rel of w.relations) rel.treaty = 'neutral'
  for (const r of w.regions) r.nation = 1
  w.regions[from].nation = 0
  w.regions[to].nation = 2
  w.nations[0].capital = from
  w.nations[1].capital = middle
  w.nations[2].capital = to
  return { w, from, middle, to }
}

for (const local of [false, true])
  test(`${local ? 'district' : 'provincial'} trade cannot reach a wartime buyer through a neutral intermediary`, () => {
    const { w, from, middle, to } = corridorWorld()
    if (local) ensureDistrictEconomy(w)
    const units = local ? w.localEconomy!.active.map((id) => w.localEconomy!.units[id]) : w.regions
    for (const r of units) {
      for (const good of GOODS) r.stocks[good] = reserveTarget(r, good)
      w.economy!.producers[r.id].cash = 10000
    }
    const seller = local ? w.localEconomy!.units[from] : w.regions[from],
      buyer = local ? w.localEconomy!.units[to] : w.regions[to]
    seller.stocks.coal += 10000
    buyer.stocks.coal = 0
    relation(w, 0, 2)!.treaty = 'war'
    rebaseEndowments(w)
    if (local) {
      const profile = corridorProfile(w),
        base = transportGraph(w),
        graph: DistrictNetwork['graph'] = new Map()
      for (const id of [from, middle, to])
        graph.set(
          id,
          base[id].map((e) => ({ ...e, usage: corridorUsage(profile, e.legs) })),
        )
      tradeDistricts(w, { graph, profile })
      assert(!w.localEconomy!.shipments.some((s) => s.from === from && s.to === to))
    } else {
      trade(w)
      assert(!w.routes.some((r) => r.from === from && r.to === to))
    }
  })

test('a hostile intervening province cuts capital reach, and reopening the corridor restores it', () => {
  const { w, from, middle, to } = corridorWorld()
  w.regions[to].nation = 0
  assert(capitalConnections(w)[to])
  setBorderPolicy(w, 1, 0, { trade: 'embargo', military: 'closed' })
  assert.equal(capitalConnections(w)[to], 0)
  assert.equal(capitalConnections(w)[from], 1)
  const legs = transportNetwork(w).links.flatMap((l) => l.legs)
  assert(!tradePolicy(w).routeAllowed(0, 0, legs))
  assert(!transportGraph(w, 0)[from].some((e) => e.to === middle))
  setBorderPolicy(w, 1, 0, { trade: 'normal', military: 'transit' })
  assert(capitalConnections(w)[to])
  assert(transportGraph(w, 0)[from].some((e) => e.to === middle))
  assert.equal(isolationPressure(2, false).pressure, 0)
  assert.equal(isolationPressure(14, false).pressure, 1)
  assert.deepEqual(isolationPressure(15, true), { months: 13, pressure: 10 / 12 })
})

for (const local of [false, true])
  test(`${local ? 'district' : 'provincial'} restrictions cap real multi-commodity freight and prohibit arms`, () => {
    const { w, from, middle, to } = corridorWorld()
    if (local) ensureDistrictEconomy(w)
    const units = local ? w.localEconomy!.active.map((id) => w.localEconomy!.units[id]) : w.regions
    const buyer = local ? w.localEconomy!.units[to] : w.regions[to]
    // Oversized demand and cash make physical capacity the binding constraint.
    buyer.population.adults = 1e9
    for (const r of units) {
      for (const good of GOODS) r.stocks[good] = reserveTarget(r, good)
      w.economy!.producers[r.id].cash = 1e12
    }
    const seller = local ? w.localEconomy!.units[from] : w.regions[from]
    for (const good of ['coal', 'timber', 'arms'] as const) {
      seller.stocks[good] += 1e8
      buyer.stocks[good] = 0
    }
    setBorderPolicy(w, 2, 0, { trade: 'restricted', military: 'treaties' })
    rebaseEndowments(w)
    const profile = corridorProfile(w),
      base = transportGraph(w)
    if (local) {
      const graph: DistrictNetwork['graph'] = new Map()
      for (const id of [from, middle, to])
        graph.set(
          id,
          base[id].map((e) => ({ ...e, usage: corridorUsage(profile, e.legs) })),
        )
      tradeDistricts(w, { graph, profile })
    } else trade(w)
    const routes = w.routes.filter((r) => r.from === from && r.to === to)
    assert(routes.length > 0, 'restricted civilian commerce still ships')
    assert(
      routes.every((r) => r.goods.arms === 0),
      'arms never enter restricted routes',
    )
    const usage = corridorUsage(profile, routes[0].legs!),
      capacity = Math.min(...[...usage].map(([index, count]) => profile.capacity[index] / count))
    const shipped = routes.reduce((sum, r) => sum + r.volume, 0)
    assert(shipped <= capacity * 0.2 + 1e-6, `${shipped} exceeds the shared ${capacity * 0.2} quota`)
  })

test('signature terms identify the host, visitor, territorial scope and duration', () => {
  const w = generateWorld('readable access terms', 3, 4),
    region = w.nations[1].capital
  const description = describeClause(w, {
    kind: 'basing',
    from: 1,
    to: 0,
    regions: [region],
    duration: 12,
  } as DiplomaticClause)
  assert(description.startsWith(`${w.nations[1].shortName} grants`))
  assert(description.includes(`to ${w.nations[0].shortName}`))
  assert(description.includes(w.regions[region].name))
  assert(description.includes('for 12 months'))
})

test('commands preserve host direction, support human signatures, and save restrictions', () => {
  const w = generateWorld('border controls save', 3, 4)
  for (const n of w.nations) {
    n.ai = false
    n.treasury = 10000
  }
  relation(w, 0, 1)!.treaty = 'neutral'
  rebaseEndowments(w)
  applyCommand(w, {
    type: 'border-policy',
    nation: 0,
    target: 1,
    policy: { trade: 'restricted', military: 'basing' },
  })
  assert(diplomaticAccessView(w)(1, 0, 'basing'))
  assert(!diplomaticAccessView(w)(0, 1, 'basing'))
  applyCommand(w, {
    type: 'access-proposal',
    nation: 0,
    target: 1,
    kind: 'basing',
    duration: 12,
    regions: [],
  })
  const offer = w.statecraft!.offers.at(-1)!
  assert.equal(offer.status, 'proposed')
  assert.equal(offer.terms[0].from, 1)
  assert.deepEqual(
    offer.signatures.map((s) => s.nation),
    [0],
  )
  w.month = Math.max(w.month, offer.notBefore ?? 0) + 4
  applyCommand(w, { type: 'access-answer', nation: 1, offer: offer.id, accept: true })
  assert.equal(w.statecraft!.offers.at(-1)!.status, 'ratified')
  assert(diplomaticAccessView(w)(0, 1, 'basing'))
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.deepEqual(borderPolicy(relation(restored, 0, 1), 0), { trade: 'restricted', military: 'basing' })
  validateWorld(restored)
  relation(restored, 0, 1)!.aPolicy = { trade: 'magic' } as never
  assert.throws(() => validateWorld(restored), /diplomatic/)
})

test('dossier labels host permissions and wartime overrides without implying granted access', () => {
  const w = generateWorld('border ui', 3, 4)
  relation(w, 0, 1)!.treaty = 'war'
  const html = renderToStaticMarkup(
    createElement(BorderAccess, { world: w, nation: 0, target: 1, command: () => {} }),
  )
  assert.match(html, /Their troops on your territory/)
  assert.match(html, /At war: formal trade/)
  assert.match(html, /disabled=""[^>]*>Propose agreement/)
  assert.match(html, /Permanent military basing/)
})

test('agent policy orders use the same host direction and appear in the next affordance view', () => {
  const w = generateWorld('agent border orders', 3, 4)
  const plan = parseStatePlan(
    {
      assessment: '',
      strategy: '',
      memory: '',
      goals: [],
      escalate: false,
      reason: '',
      orders: [
        { kind: 'trade-policy', target: 1, key: 'embargo', value: 0, text: '' },
        { kind: 'military-access', target: 1, key: 'transit', value: 0, text: '' },
      ],
      messages: [],
      offers: [],
      answers: [],
    },
    false,
  )
  acceptStatePlan(w, 0, plan, false, 'fixture', w.month)
  assert.deepEqual(borderPolicy(relation(w, 0, 1), 0), { trade: 'embargo', military: 'transit' })
  assert.equal(borderPolicy(relation(w, 0, 1), 1).military, 'treaties')
  const view = statecraftAffordances(w, 0).borderPolicies.find((p) => p.nation === 1)!
  assert.equal(view.own.trade, 'embargo')
  assert(w.nations[0].ai)
})

test('prolonged exclusion erodes real provincial authority without an automatic ownership transfer', () => {
  const { w, from, to } = corridorWorld()
  w.regions[to].nation = 0
  // No nearby garrison: measure lost civil reach independently of armed protection.
  w.armies = []
  for (const r of w.regions) {
    r.unrest = 0
    for (const g of r.communities ?? []) {
      g.loyalty = 1
      g.grievance = 0
    }
  }
  advanceSovereignty(w)
  const initial = w.sovereignty!.provinces.find((p) => p.region === to)!.protection
  setBorderPolicy(w, 1, 0, { trade: 'embargo', military: 'closed' })
  for (let i = 0; i < 15; i++) {
    w.month++
    advanceSovereignty(w)
  }
  const isolated = w.sovereignty!.provinces.find((p) => p.region === to)!
  assert.equal(isolated.isolation, 15)
  assert(isolated.protection < initial)
  assert(w.regions[to].unrest > 0)
  assert.equal(w.regions[to].nation, 0)
  // A new sovereign starts its own connection history; the former state's
  // isolation cannot leak through the reused provincial report object.
  w.regions[to].nation = 2
  setBorderPolicy(w, 1, 2, { trade: 'normal', military: 'treaties' })
  advanceSovereignty(w)
  assert.equal(w.sovereignty!.provinces.find((p) => p.region === to)!.isolation, 0)
})

test('route political checks scan physical owners once per phase, with a constant-time peaceful fast path', () => {
  const { w, from, to } = corridorWorld(),
    legs = transportNetwork(w).links.flatMap((l) => l.legs)
  let reads = 0
  for (const r of w.regions) {
    const nation = r.nation
    Object.defineProperty(r, 'nation', {
      configurable: true,
      get: () => {
        reads++
        return nation
      },
    })
  }
  let policy = tradePolicy(w)
  for (let i = 0; i < 1000; i++) assert(policy.routeAllowed(0, 2, legs))
  assert.equal(reads, 0)
  setBorderPolicy(w, 1, 0, { trade: 'embargo', military: 'closed' })
  policy = tradePolicy(w)
  assert(!policy.routeAllowed(w.regions[from].nation, w.regions[to].nation, legs))
  const once = reads
  for (let i = 0; i < 1000; i++) assert(!policy.routeAllowed(0, 2, legs))
  assert.equal(reads, once)
})
