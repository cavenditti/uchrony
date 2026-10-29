import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { prepareSpatialWorld, summarize, tick } from '../src/sim/engine'
import {
  acceptStatePlan,
  ensureStatecraft,
  stateAgentContext,
  settleConventionalOffers,
} from '../src/sim/statecraft'
import { statecraftAffordances } from '../src/sim/statecraft-affordances'
import { recruitmentQuote, recruit } from '../src/sim/recruitment'
import { foundingOptions } from '../src/sim/founding'
import {
  cabinetResearchFocus,
  cabinetPolicyTargets,
  advanceCabinet,
  respondToSovereignty,
  cabinetWorks,
} from '../src/sim/cabinet-ai'
import {
  ensureCabinet,
  setCabinetAgenda,
  reserveCabinetOrder,
  cabinetOrderReserved,
} from '../src/sim/cabinet-state'
import {
  advanceCampaignPreparation,
  campaignReadiness,
  directTheaters,
  hasCampaignCause,
  rememberWars,
} from '../src/sim/campaign-ai'
import { advanceDomesticPolicy, nativeDomesticControl } from '../src/sim/domestic-policy'
import { advanceDevelopment } from '../src/sim/development'
import { advanceGeopolitics } from '../src/sim/geopolitics'
import { advancePeaceNegotiations } from '../src/sim/peace'
import { buildPublicWork, publicWorkQuote } from '../src/sim/public-works'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { validateCabinet } from '../src/sim/cabinet-persistence'
import { validateStatecraft } from '../src/sim/statecraft-persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { intelligenceService } from '../src/sim/intelligence'
import { balances, auditLedger } from '../src/sim/ledger'
import { aggregateDistricts, linkDistrictPeople } from '../src/sim/districts'
import { allForces } from '../src/sim/forces'
import { FIELDS, population, relation, type World } from '../src/sim/types'
import { withDecisionPolicy, DECISION_POLICIES } from '../src/sim/decision-policy'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { targetInventoryMonths } from '../src/sim/strategic-reserves'
import { characterPolicyTargets } from '../src/sim/character'
import type { DomesticOrder, StateAgentPlan } from '../src/sim/statecraft-types'
import type { ProvincialAuthority } from '../src/sim/sovereignty'
import { endowTreasury, rebaseEndowments } from './fixtures/endowment'

const initial = generateWorld('native-opportunist', 3, 8, undefined, 'regional')
const frontierInitial = generateWorld('Frontier probe', 3, 8, undefined, 'regional', 'frontier')
prepareSpatialWorld(frontierInitial)
const fixture = (frontier = false) => structuredClone(frontier ? frontierInitial : initial)
const people = (w: World) =>
  w.regions.reduce((sum, r) => sum + population(r), 0) + allForces(w).reduce((sum, a) => sum + a.soldiers, 0)
const money = (w: World) => Object.values(balances(w)).reduce((sum, value) => sum + value, 0)
const plan = (orders: DomesticOrder[] = []): StateAgentPlan => ({
  assessment: 'Material choices.',
  strategy: 'Build capacity.',
  memory: '',
  goals: [],
  escalate: false,
  reason: '',
  orders,
  offers: [],
  messages: [],
  answers: [],
})
const order = (kind: DomesticOrder['kind'], target = -1, key = '', value = 0, text = '') => ({
  kind,
  target,
  key,
  value,
  text,
})
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(a), Math.abs(b)))
function crisis(w: World, region: number) {
  const report: ProvincialAuthority = {
    region,
    nation: w.regions[region].nation,
    since: 0,
    protection: 0.2,
    neglect: 8,
    contested: 3,
    movement: w.regions[region].communities![0].movement,
    organization: 0.8,
    support: 0.7,
    mobilizable: 200,
    loyalStrength: 0,
    stage: 'contested',
    warned: 0,
  }
  w.sovereignty = { provinces: [report], successors: [] }
  return report
}
function borderPair(w: World) {
  const home = w.regions.find((r) => r.nation === 0 && r.neighbors.some((id) => w.regions[id].nation > 0))!
  const enemy = w.regions[home.neighbors.find((id) => w.regions[id].nation > 0)!]
  return { home, enemy, rival: enemy.nation, rel: relation(w, 0, enemy.nation)! }
}

test('frontier recruitment previews actual costs, conserves adults/money, and rejects occupied or unaffordable orders', () => {
  const w = fixture(true),
    n = w.nations[0],
    r = w.regions[n.capital]
  n.policies.conscription = 2
  r.stocks.arms = 100
  const q = recruitmentQuote(w, n, r)
  assert(!q.obstacle)
  assert(q.soldiers >= 50 && q.soldiers < 500)
  const beforePeople = people(w),
    beforeMoney = money(w),
    cash = n.treasury,
    arms = r.stocks.arms
  assert.match(recruit(w, n, r), /Recruited/)
  assert.equal(people(w), beforePeople)
  near(money(w), beforeMoney)
  near(n.treasury, cash - q.cost)
  near(r.stocks.arms, arms - q.soldiers * 0.012)
  auditLedger(w)
  r.control = { nation: 1, since: 0, lastPillage: -1, spoils: 0 }
  const adults = r.population.adults
  assert.match(recruit(w, n, r), /controlled/)
  assert.equal(r.population.adults, adults)
  delete r.control
  n.treasury = 0
  assert.match(recruit(w, n, r), /treasury/)
  assert.equal(r.population.adults, adults)
  withDecisionPolicy(DECISION_POLICIES.legacy, () =>
    assert.match(recruitmentQuote(w, n, r).obstacle, /adult recruits/),
  )
})

test('an LLM directs only named settings; routine cabinet decisions continue and overrides expire', () => {
  const w = fixture(),
    n = w.nations[0]
  w.month = 6
  n.foodCoverage = 0.6
  acceptStatePlan(
    w,
    0,
    plan([order('policy', -1, 'tax', 9), order('research', -1, '', 0, 'medicine')]),
    true,
    'fixture',
    w.month,
  )
  assert(nativeDomesticControl(w, n))
  assert(n.ai)
  advanceCabinet(w)
  advanceDomesticPolicy(w)
  advanceDevelopment(w)
  assert.equal(n.policies.tax, 9)
  assert.equal(n.researchFocus, 'medicine')
  assert.equal(n.policies.priority, 'agriculture')
  assert(n.development)
  assert.equal(w.statecraft!.agents[0].orderResults?.length, 2)
  w.month = 12
  advanceDomesticPolicy(w)
  advanceDevelopment(w)
  assert(n.policies.tax > 9)
  assert.equal(n.researchFocus, 'agriculture')
  n.ai = false
  const before = structuredClone(n)
  advanceCabinet(w)
  advanceDomesticPolicy(w)
  advanceDevelopment(w)
  assert.deepEqual(n, before)
})

test('model action menus expose real cell IDs and founding transfers people and funds through the ordinary command', () => {
  const w = fixture(true),
    n = w.nations[0],
    menu = statecraftAffordances(w, 0)
  const target = menu.canFoundTargets[0]
  assert(target, 'the supplied frontier fixture has a reachable founding site')
  assert.equal(w.cells[target.cell].region, target.province)
  const count = people(w),
    funds = money(w),
    cash = n.treasury
  acceptStatePlan(w, 0, plan([order('found', target.cell)]), false, 'fixture', 0)
  assert.equal(w.regions[target.province].nation, 0)
  assert.equal(people(w), count)
  near(money(w), funds)
  near(n.treasury, cash - target.cost)
  assert.match(w.statecraft!.agents[0].orderResults![0].result, /Founded/)
  assert.equal(w.statecraft!.audit.length, 0)
  const context = stateAgentContext(w, 0, false)
  assert(context.affordances.canRecruitIn.every((r) => w.regions[r.id].nation === 0))
  validateStatecraft(w)
})

test('resource failures are visible to the model and do not manufacture armies or revoke cabinet competence', () => {
  const w = fixture(true),
    n = w.nations[0]
  n.policies.conscription = 2
  n.treasury = 0
  rebaseEndowments(w)
  const count = people(w)
  acceptStatePlan(w, 0, plan([order('recruit', n.capital)]), false, 'fixture', 0)
  assert.equal(w.armies.length, 0)
  assert.equal(people(w), count)
  assert.match(w.statecraft!.agents[0].orderResults![0].result, /treasury/)
  assert.equal(w.statecraft!.audit.length, 0)
  assert(nativeDomesticControl(w, n))
  const target = foundingOptions(fixture(true), 0)[0]
  acceptStatePlan(w, 0, plan([order('found', target.cell)]), false, 'fixture', 0)
  assert.equal(w.statecraft!.audit.length, 0)
  assert.match(w.statecraft!.agents[0].orderResults!.at(-1)!.result, /treasury/)
})

test('research scores can select every incomplete field, prioritize famine, and discount already advanced fields', () => {
  const w = fixture(),
    n = w.nations[0],
    own = w.regions.filter((r) => r.nation === 0)
  n.foodCoverage = 1
  n.researchFocus = 'industry'
  for (const r of own)
    Object.assign(r, { health: 0.99, literacy: 0.99, materialCoverage: 1, infrastructure: 1.4, unrest: 0 })
  for (const field of FIELDS) {
    for (const f of FIELDS) n.technologies[f] = 5
    n.technologies[field] = 0
    assert.equal(cabinetResearchFocus(w, n, own), field)
  }
  n.foodCoverage = 0.4
  n.technologies.agriculture = 2
  assert.equal(cabinetResearchFocus(w, n, own), 'agriculture')
  n.technologies.agriculture = 6
  assert.notEqual(cabinetResearchFocus(w, n, own), 'agriculture')
})

test('fiscal targets respond to actual runway, scarcity and crisis, not only leader averages', () => {
  const w = fixture(),
    n = w.nations[0],
    base = characterPolicyTargets(n)
  n.spending = 100
  n.income = 20
  n.treasury = 80
  n.foodCoverage = 0.8
  const tight = cabinetPolicyTargets(w, n, base)
  n.treasury = 100000
  const rich = cabinetPolicyTargets(w, n, base)
  assert(tight.tax > rich.tax)
  assert(tight.tariff <= 5)
  assert(tight.research <= 18)
  setCabinetAgenda(w, n, 'pacify-crisis', n.capital)
  const crisis = cabinetPolicyTargets(w, n, base)
  assert(crisis.tax < rich.tax)
  assert(crisis.welfare >= base.welfare)
})

test('native public works pay real accounts and survive district aggregation without spending the runway reserve', () => {
  const w = fixture(),
    n = w.nations[0],
    r = w.regions[n.capital]
  endowTreasury(w, 0, 100000)
  n.spending = 20
  n.income = 20
  r.stocks.timber = 10000
  r.stocks.stone = 10000
  r.infrastructure = 0.2
  r.literacy = 0.3
  const q = publicWorkQuote(w, r.id, 'road'),
    funds = money(w),
    cash = n.treasury
  assert(!q.obstacle)
  const localInfrastructure =
    w.localEconomy?.active
      .filter((id) => w.localEconomy!.units[id].province === r.id)
      .map((id) => [id, w.localEconomy!.units[id].infrastructure] as const) ?? []
  assert.match(buildPublicWork(w, r.id, 'road'), /completed/)
  near(n.treasury, cash - q.cost)
  near(money(w), funds)
  linkDistrictPeople(w)
  for (const [id, value] of localInfrastructure)
    near(w.localEconomy!.units[id].infrastructure, Math.min(1.5, value + 0.2))
  aggregateDistricts(w)
  assert(r.publicWorks?.road)
  assert(r.infrastructure > 0.2)
  assert(cabinetWorks(w, n, [r]).length)
  n.treasury = 120
  assert.equal(cabinetWorks(w, n, [r]).length, 0)
  r.control = { nation: 1, since: 0, lastPillage: -1, spoils: 0 }
  assert.match(publicWorkQuote(w, r.id, 'school').obstacle, /controlled/)
})

test('sovereignty responder sends an available garrison, relieves tax pressure, and respects model army orders', () => {
  const w = fixture(),
    n = w.nations[0],
    target = w.regions.find((r) => r.nation === 0 && r.id !== n.capital)!
  const hadInstitutions = Object.hasOwn(w, 'institutions')
  crisis(w, target.id)
  n.policies.tax = 45
  for (const a of w.armies.filter((a) => a.nation === 0)) {
    a.region = n.capital
    a.supply = 1
  }
  respondToSovereignty(w, n)
  assert(w.armies.some((a) => a.nation === 0 && a.target === target.id))
  assert(n.policies.tax < 45)
  for (const a of w.armies.filter((a) => a.nation === 0)) {
    a.target = null
    reserveCabinetOrder(w, n, `army:${a.id}`)
  }
  respondToSovereignty(w, n)
  assert(w.armies.filter((a) => a.nation === 0).every((a) => a.target === null))
  assert(
    w.statecraft?.offers.some((o) =>
      o.terms.some((t) => t.kind === 'devolution' && t.regions.includes(target.id)),
    ),
  )
  settleConventionalOffers(w)
  assert(w.regions[target.id].delegation)
  assert.equal(Object.hasOwn(w, 'institutions'), hadInstitutions)
})

test('equal opponents converge on a shared front objective rather than entrenching every army', () => {
  const w = fixture(),
    n = w.nations[0],
    { home, rival, rel } = borderPair(w)
  rel.treaty = 'war'
  const army = w.armies.find((a) => a.nation === 0)!
  army.region = home.id
  army.supply = army.morale = 1
  w.armies.push({ ...structuredClone(army), id: w.nextArmy++ })
  directTheaters(w, n, new Set([rival]))
  const own = w.armies.filter((a) => a.nation === 0)
  assert(own.every((a) => a.target !== null && a.operations!.stance === 'march'))
  assert.equal(new Set(own.map((a) => a.target)).size, 1)
  const target = own[0].target
  w.month = 1
  directTheaters(w, n, new Set([rival]))
  assert.equal(own[0].target, target)
  reserveCabinetOrder(w, n, `army:${army.id}`)
  army.target = null
  army.operations!.stance = 'hold'
  directTheaters(w, n, new Set([rival]))
  assert.equal(army.target, null)
  assert.equal(army.operations!.stance, 'hold')
})

test('a prepared campaign needs deployed supplied troops, and an unready mandate aborts without war', () => {
  const w = fixture(),
    n = w.nations[0],
    { home, rival, rel } = borderPair(w)
  rel.treaty = 'neutral'
  rel.opinion = -70
  rel.grievance = 40
  n.foodCoverage = 1
  n.stability = 80
  const dossier = intelligenceService(w, 0).dossiers.find((d) => d.nation === rival)!
  dossier.military!.values.effectivePower = { estimate: 30, low: 20, high: 40 }
  for (const a of w.armies.filter((a) => a.nation === 0)) {
    a.region = home.id
    a.morale = a.supply = 1
    a.operations!.cohesion = 1
  }
  setCabinetAgenda(w, n, 'prepare-war', rival, 'model')
  assert(campaignReadiness(w, n, rival).ready)
  advanceCampaignPreparation(w, n)
  settleConventionalOffers(w)
  assert.equal(rel.treaty, 'neutral')
  w.month = 3
  advanceCampaignPreparation(w, n)
  settleConventionalOffers(w)
  assert.equal(relation(w, 0, rival)!.treaty, 'war')
  const cold = fixture(),
    pair = borderPair(cold)
  pair.rel.treaty = 'neutral'
  setCabinetAgenda(cold, cold.nations[0], 'prepare-war', pair.rival, 'model')
  for (const a of cold.armies.filter((a) => a.nation === 0)) a.supply = 0.1
  cold.month = 18
  advanceCampaignPreparation(cold, cold.nations[0])
  assert.equal(pair.rel.treaty, 'neutral')
  assert.equal(cold.nations[0].cabinet!.posture, 'consolidate')
})

test('peace memory blocks the same war after a truce without fresh friction or a decisive balance change', () => {
  const w = fixture(),
    n = w.nations[0],
    { rival, rel } = borderPair(w)
  rel.treaty = 'war'
  rel.grievance = 40
  rel.opinion = -70
  rememberWars(w, n)
  w.month = 40
  rel.treaty = 'truce'
  rel.since = 40
  rememberWars(w, n)
  w.month = 101
  rel.treaty = 'neutral'
  assert(!hasCampaignCause(w, n, rival))
  rel.grievance += 16
  assert(hasCampaignCause(w, n, rival))
  const copy = restoreWorld(packWorldSave(w))
  assert.deepEqual(copy.nations[0].cabinet, w.nations[0].cabinet)
  assert(hasCampaignCause(copy, copy.nations[0], rival))
})

test('winning native cabinets demand occupied land while preserving human and model consent', () => {
  const w = fixture(),
    { rival, rel } = borderPair(w)
  for (const n of w.nations) n.ai = n.id === 0
  rel.treaty = 'war'
  rel.warExhaustion = 35
  const land = w.regions.find((r) => r.nation === rival && r.id !== w.nations[rival].capital)!
  land.control = { nation: 0, since: 0, lastPillage: -1, spoils: 0 }
  advancePeaceNegotiations(w)
  const offer = w.statecraft!.offers.find((o) => o.terms.some((t) => t.kind === 'peace'))!
  assert(
    offer.terms.some(
      (t) => t.kind === 'cede' && t.from === rival && t.to === 0 && t.regions.includes(land.id),
    ),
  )
  assert(!offer.signatures.some((s) => s.nation === rival))
  assert.equal(rel.treaty, 'war')
})

test('cabinet saves reject forged targets, duplicate memories and unsupported overrides; legacy saves upgrade lazily', () => {
  const w = fixture(),
    n = w.nations[0]
  validateCabinet(w, n)
  ensureCabinet(w, n)
  validateCabinet(w, n)
  const valid = structuredClone(n.cabinet)
  for (const corrupt of [
    () => (n.cabinet!.posture = 'magic' as never),
    () => (n.cabinet!.review = Infinity),
    () => (n.cabinet!.overrides = [{ key: 'policy:magic', until: 3 }]),
    () => Object.assign(n.cabinet!, { posture: 'prepare-war', target: 0 }),
    () =>
      (n.cabinet!.wars = [
        { rival: 1, active: false, peace: 0, grievance: 0, balance: 1 },
        { rival: 1, active: false, peace: 0, grievance: 0, balance: 1 },
      ]),
  ]) {
    n.cabinet = structuredClone(valid)
    corrupt()
    assert.throws(() => validateCabinet(w, n), /cabinet/)
  }
})

test('preparation raises finite food and arms targets at monthly and coarse cadence without creating stocks', () => {
  const w = fixture(),
    n = w.nations[0],
    r = w.regions[n.capital],
    stocks = { ...r.stocks }
  const baseline = targetInventoryMonths(w, r, 'arms')
  setCabinetAgenda(w, n, 'prepare-war', borderPair(w).rival)
  assert(targetInventoryMonths(w, r, 'arms') > baseline)
  assert(targetInventoryMonths(w, r, 'food') >= 6)
  withSimulationPeriod(6, () => assert(Number.isFinite(targetInventoryMonths(w, r, 'food'))))
  assert.deepEqual(r.stocks, stocks)
})

test('new monthly planning is deterministic and surviving model directives remain valid across saves', () => {
  const a = fixture(true),
    b = fixture(true)
  for (const w of [a, b]) {
    acceptStatePlan(w, 0, plan([order('strategy', -1, 'industrialize')]), true, 'fixture', 0)
    tick(w)
    summarize(w, false)
    validateWorld(w)
  }
  assert.deepEqual(a.nations, b.nations)
  assert.equal(a.nations[0].cabinet!.posture, 'industrialize')
  const copy = restoreWorld(packWorldSave(a))
  assert.deepEqual(copy.nations[0].cabinet, a.nations[0].cabinet)
  assert(!cabinetOrderReserved(copy, copy.nations[0], 'research'))
  // A recent model's benign strategy cannot trigger an unrelated native offensive.
  advanceGeopolitics(copy)
  assert(!copy.statecraft!.offers.some((o) => o.author === 0 && o.terms.some((t) => t.kind === 'war')))
})

test('stale model frontier quotes request a fresh plan without penalizing a legal original order', () => {
  const w = fixture(true),
    site = statecraftAffordances(w, 0).canFoundTargets[0]
  w.regions[site.province].nation = 1
  acceptStatePlan(w, 0, plan([order('found', site.cell)]), false, 'fixture', 0, {
    owners: { [site.province]: -1 },
    armies: [],
  })
  assert.equal(w.statecraft!.audit.length, 0)
  assert.match(w.statecraft!.agents[0].escalation, /changed/)
  assert.equal(w.regions[site.province].nation, 1)
})

test('an arrived model-ordered formation is not automatically retargeted during its reservation', async () => {
  const { advanceArmies } = await import('../src/sim/military')
  const w = fixture(),
    n = w.nations[0],
    { home, rival, rel } = borderPair(w)
  rel.treaty = 'war'
  const army = w.armies.find((a) => a.nation === 0)!
  army.region = home.id
  army.target = null
  army.operations!.stance = 'march'
  reserveCabinetOrder(w, n, `army:${army.id}`)
  advanceArmies(w)
  assert.equal(army.target, null)
  assert.equal(army.region, home.id)
  assert.equal(relation(w, 0, rival)!.treaty, 'war')
})

test('cabinet domestic indexing is linear in provinces across a 32-state continental partition', () => {
  const w = fixture()
  w.month = 1
  w.relations = []
  w.armies = []
  delete w.statecraft
  delete w.sovereignty
  w.nations = Array.from({ length: 32 }, (_, id) => ({
    ...structuredClone(w.nations[0]),
    id,
    capital: id,
    treasury: 1,
  }))
  let ownershipReads = 0
  const base = w.regions[0]
  w.regions = Array.from(
    { length: 2048 },
    (_, id) =>
      new Proxy(
        { ...base, id, nation: id % 32, neighbors: [] },
        {
          get(target, key, receiver) {
            if (key === 'nation') ownershipReads++
            return Reflect.get(target, key, receiver)
          },
        },
      ),
  )
  advanceCabinet(w)
  assert(
    ownershipReads <= w.regions.length * 2,
    `domestic planning must group ownership once instead of scanning all provinces for each state: ${ownershipReads}`,
  )
  assert(w.nations.every((n) => n.cabinet && n.treasury === 1))
})
