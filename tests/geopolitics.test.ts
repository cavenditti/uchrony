import { endowTreasury } from './fixtures/endowment'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { ensureStatecraft, settleConventionalOffers } from '../src/sim/statecraft'
import {
  advanceGeopolitics,
  advanceNativeAccords,
  ensureGeopolitics,
  markOccupation,
} from '../src/sim/geopolitics'
import { intelligenceService } from '../src/sim/intelligence'
import { applyCommand, summarize } from '../src/sim/engine'
import { allForces } from '../src/sim/forces'
import { population, relation, type World } from '../src/sim/types'
import { validateWorld } from '../src/sim/persistence'
import { withSimulationPeriod } from '../src/sim/simulation-period'

const people = (w: World) =>
  w.regions.reduce((s, r) => s + population(r), 0) + allForces(w).reduce((s, a) => s + a.soldiers, 0)
function ready(seed: string, nations = 8) {
  const w = generateWorld(seed, 3, nations)
  ensureStatecraft(w)
  for (const n of w.nations) {
    n.ai = false
    endowTreasury(w, n.id, 10000)
    n.budget.military = 1000
    n.foodCoverage = 1
    n.stability = 70
  }
  for (const r of w.regions) {
    r.stocks.arms = 1000
    r.stocks.food = population(r)
    r.foodCoverage = 1
  }
  for (const a of w.armies) {
    a.morale = 1
    a.supply = 1
    a.operations!.cohesion = 1
  }
  w.month = 24
  return w
}

test('an attacked cabinet mobilizes actual adults and resources without waiting for external deliberation', () => {
  const w = ready('native-defense'),
    target = w.regions.find((r) => r.nation === 0 && r.neighbors.some((id) => w.regions[id].nation !== 0))!,
    defender = w.regions[target.neighbors.find((id) => w.regions[id].nation !== 0)!].nation
  w.nations[defender].ai = true
  applyCommand(w, { type: 'diplomacy', nation: 0, target: defender, action: 'war' })
  const before = people(w),
    army = allForces(w)
      .filter((a) => a.nation === defender)
      .reduce((s, a) => s + a.soldiers, 0),
    cash = w.nations[defender].treasury
  advanceGeopolitics(w)
  assert.equal(people(w), before)
  assert(
    allForces(w)
      .filter((a) => a.nation === defender)
      .reduce((s, a) => s + a.soldiers, 0) > army,
  )
  assert(w.nations[defender].treasury < cash)
  assert(w.nations[defender].policies.military >= 40)
  summarize(w, false)
  validateWorld(w)
})

test('a capable ambitious cabinet initiates a military war locally; a cautious peer declines the same opportunity', () => {
  const strong = ready('native-opportunist'),
    border = strong.regions.find(
      (r) => r.nation === 0 && r.neighbors.some((id) => strong.regions[id].nation !== 0),
    )!,
    victim = strong.regions[border.neighbors.find((id) => strong.regions[id].nation !== 0)!].nation
  strong.nations[0].ai = true
  const drives = strong.nations[0].character!.leader.politics!.drives
  drives.ambition = drives.dominance = drives.opportunism = drives.riskTolerance = 1
  for (const rel of strong.relations)
    if ([rel.a, rel.b].includes(0)) {
      rel.treaty = 'alliance'
      rel.opinion = 75
      rel.grievance = 0
    }
  const rel = relation(strong, 0, victim)!
  rel.treaty = 'neutral'
  rel.opinion = -50
  rel.grievance = 40
  for (const a of strong.armies.filter((a) => a.nation === victim)) a.morale = 0.1
  for (const army of strong.armies.filter((a) => a.nation === 0)) army.region = border.id
  const cautious = structuredClone(strong),
    d = cautious.nations[0].character!.leader.politics!.drives
  d.ambition = d.dominance = d.opportunism = d.riskTolerance = 0
  relation(cautious, 0, victim)!.opinion = 0
  relation(cautious, 0, victim)!.grievance = 0
  for (let i = 0; i < 48; i++) {
    advanceGeopolitics(strong)
    advanceGeopolitics(cautious)
    if (relation(strong, 0, victim)!.treaty === 'war') break
    strong.month++
    cautious.month++
  }
  assert.equal(relation(strong, 0, victim)!.treaty, 'war')
  assert.equal(relation(cautious, 0, victim)!.treaty, 'neutral')
  assert.equal(relation(strong, 0, victim)!.aggressor, 0)
})

test('ungarrisoned conquest preserves local allegiances and raises resistance rather than instantly integrating residents', () => {
  const w = ready('occupation-resistance'),
    r = w.regions.find((r) => r.nation !== 0)!,
    old = r.nation
  ensureGeopolitics(w)
  r.nation = 0
  markOccupation(w, r.id, old)
  for (const a of w.armies) if (a.region === r.id) a.region = w.nations[a.nation].capital
  const identities = r.communities!.map((g) => g.allegiance),
    before = r.occupation!.resistance,
    cash = w.nations[0].treasury
  advanceGeopolitics(w)
  assert(r.occupation!.resistance > before)
  assert(r.unrest >= 65)
  assert.deepEqual(
    r.communities!.map((g) => g.allegiance),
    identities,
  )
  assert(w.nations[0].treasury < cash)
  r.nation = old
  markOccupation(w, r.id, 0)
  assert.equal(r.occupation, undefined)
})

test('exposed small AI states form a multilateral defense league without manufacturing a human government’s consent', () => {
  // This seed has the three exposed neighbors required by the coalition fixture.
  const w = ready('survival-league-0', 16)
  const exposure = (nation: number) => [
    ...new Set(
      w.regions
        .filter((r) => r.nation === nation)
        .flatMap((r) => r.neighbors.map((id) => w.regions[id].nation))
        .filter((id) => id !== nation),
    ),
  ]
  const attacker = [...w.nations].sort((a, b) => exposure(b.id).length - exposure(a.id).length)[0],
    exposed = exposure(attacker.id),
    victim = exposed[0]
  assert(exposed.length >= 3)
  for (const n of w.nations) n.ai = n.id !== attacker.id
  for (const a of w.armies) if (a.nation !== attacker.id) a.morale = 0.1
  const war = relation(w, attacker.id, victim)!
  war.treaty = 'war'
  war.aggressor = attacker.id
  war.since = w.month
  // Coalitions respond to received reports, not unobserved foreign facts.
  for (const id of exposed) {
    const service = intelligenceService(w, id),
      dossier = service.dossiers.find((d) => d.nation === attacker.id)!
    dossier.military!.values.effectivePower = { estimate: 3000, low: 1500, high: 4500 }
    if (id !== victim)
      service.relations.push({
        a: war.a,
        b: war.b,
        treaty: 'war',
        since: w.month,
        aggressor: attacker.id,
        month: w.month,
      })
  }
  advanceGeopolitics(w)
  const proposed = w.statecraft!.offers.find((o) => o.terms.some((t) => t.kind === 'institution'))!
  assert(proposed)
  assert(
    !w.statecraft!.offers.some((o) => o.terms.some((t) => t.kind === 'alliance')),
    'shared defense should consolidate bilateral paperwork',
  )
  w.month = proposed.notBefore ?? w.month
  settleConventionalOffers(w)
  const league = w.institutions?.organizations.find(
    (o) => o.status === 'active' && o.members.length >= 3 && o.charter.powers.includes('defense'),
  )
  assert(league)
  assert(!league.members.includes(attacker.id))
  assert(!w.statecraft!.offers.some((o) => o.signatures.some((s) => s.nation === attacker.id)))
  summarize(w, false)
  validateWorld(w)
})

test('frontier cabinets do not treat unclaimed neighboring land as a foreign state', () => {
  const w = generateWorld('frontier-cabinets', 3, 4, undefined, 'regional', 'frontier')
  ensureStatecraft(w)
  const politics = ensureGeopolitics(w)
  w.month = 24
  for (const c of politics.countries) c.lastInitiative = -24
  assert(w.regions.some((r) => r.nation < 0))
  assert.doesNotThrow(() => advanceGeopolitics(w))
})

test('native cabinets negotiate exhausted wars even after diplomacy records exist, preserving human consent', () => {
  const w = ready('native-peace')
  w.nations[0].ai = w.nations[1].ai = true
  const rel = relation(w, 0, 1)!
  rel.treaty = 'war'
  rel.warExhaustion = 100
  rel.since = 0
  const controlled = structuredClone(w)
  controlled.nations[1].ai = false
  for (let i = 0; i < 4; i++) {
    advanceNativeAccords(w)
    advanceNativeAccords(controlled)
    w.month += 6
    controlled.month += 6
  }
  assert.equal(relation(w, 0, 1)!.treaty, 'truce')
  assert.equal(relation(controlled, 0, 1)!.treaty, 'war')
  assert(!controlled.statecraft!.offers.some((o) => o.signatures.some((s) => s.nation === 1)))
})

test('native commerce continues after a diplomatic record is initialized', () => {
  const w = ready('native-commerce')
  w.nations[0].ai = w.nations[1].ai = true
  relation(w, 0, 1)!.treaty = 'neutral'
  relation(w, 0, 1)!.opinion = 90
  for (let i = 0; i < 48; i++) {
    withSimulationPeriod(6, () => advanceNativeAccords(w))
    w.month += 6
  }
  assert(['trade', 'alliance'].includes(relation(w, 0, 1)!.treaty))
})

test('Max speed reviews cabinets in every quarterly offset instead of permanently skipping two thirds', () => {
  for (const offset of [0, 1, 2]) {
    const w = ready('survival-league-0', 16)
    const actor = w.nations.find(
      (n) =>
        n.id % 3 === offset &&
        w.regions.some((r) => r.nation === n.id && r.neighbors.some((id) => w.regions[id].nation !== n.id)),
    )!.id
    const border = w.regions.find(
      (r) => r.nation === actor && r.neighbors.some((id) => w.regions[id].nation !== actor),
    )!
    const victim = w.regions[border.neighbors.find((id) => w.regions[id].nation !== actor)!].nation
    w.nations[actor].ai = true
    const drives = w.nations[actor].character!.leader.politics!.drives
    drives.ambition = drives.dominance = drives.opportunism = drives.riskTolerance = 1
    for (const rel of w.relations) if ([rel.a, rel.b].includes(actor)) rel.treaty = 'alliance'
    const rel = relation(w, actor, victim)!
    rel.treaty = 'neutral'
    rel.opinion = -75
    rel.grievance = 60
    for (const a of w.armies) if (a.nation === victim) a.morale = 0.1
    // This fixture tests quarterly review scheduling, so supply the assembled frontier force.
    for (const army of w.armies.filter((a) => a.nation === actor)) army.region = border.id
    // Native-only worlds have never enabled optional model deliberation.
    delete w.statecraft
    for (let i = 0; i < 40 && relation(w, actor, victim)!.treaty !== 'war'; i++) {
      w.month += 6
      withSimulationPeriod(6, () => advanceGeopolitics(w))
    }
    assert.equal(
      relation(w, actor, victim)!.treaty,
      'war',
      `cabinet ${actor} must receive a strategic review`,
    )
  }
})
