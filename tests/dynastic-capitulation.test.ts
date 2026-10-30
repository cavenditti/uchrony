import { expeditionPeople } from '../src/sim/overseas-types'
import { sovereignFixture as fixture } from './fixtures/sovereign-world'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SovereignRelations } from '../src/components/SovereignRelations'
import { replaceStateLeader } from '../src/sim/character'
import {
  advanceDynasties,
  applyRoyalAgreement,
  crownOf,
  ensureDynasties,
  formPersonalUnion,
  marriageOf,
} from '../src/sim/dynasties'
import { capitulationObstacle, imposeCapitulation, type CapitulationOutcome } from '../src/sim/capitulation'
import { applyCommand } from '../src/sim/commands'
import {
  advanceDependencies,
  dependencyOf,
  diplomaticInfluence,
  establishDependency,
} from '../src/sim/state-dependencies'
import {
  advanceCapitulations,
  advanceRoyalDiplomacy,
  proposeRoyalAgreement,
} from '../src/sim/royal-diplomacy'
import { admitDiplomaticConsent, settleConventionalOffers, submitStandingOffer } from '../src/sim/statecraft'
import { foreignPolicyMandate } from '../src/sim/institutions'
import { diplomaticAccess, diplomaticAccessView } from '../src/sim/agreements'
import { allForces } from '../src/sim/forces'
import { population, relation, type World } from '../src/sim/types'
import { balances, borrow, auditLedger } from '../src/sim/ledger'
import { auditBanks } from '../src/sim/banking'
import { physicalStocks, auditGoods } from '../src/sim/goods-accounting'
import { reconcileGDP } from '../src/sim/national-accounts'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { validateDynasticState } from '../src/sim/dynastic-persistence'
import { commissionFleet, waterPath } from '../src/sim/navy'
import { transportNetwork } from '../src/sim/transport'
import { transferSovereignty } from '../src/sim/military-control'
import { rebaseEndowments } from './fixtures/endowment'
import { beginEconomyMonth } from '../src/sim/macroeconomy'

const totalPeople = (w: World) =>
  w.regions.reduce((s, r) => s + population(r), 0) +
  allForces(w).reduce((s, a) => s + a.soldiers, 0) +
  expeditionPeople(w)
const totalCash = (w: World) => Object.values(balances(w)).reduce((s, value) => s + value, 0)
function audit(w: World) {
  reconcileGDP(w)
  auditGoods(w)
  auditLedger(w)
  auditBanks(w)
  validateWorld(w)
}

test('a victor imposes annexation without consent and inherits cash, liabilities and public equity', () => {
  const { w, last } = fixture(true)
  borrow(w, 'government:1', 100, 100)
  const firm = w.economy!.firms![0]
  firm.owners = { 'government:1': 0.4, 'household:0:owner': 0.6 }
  const cash = totalCash(w),
    goods = physicalStocks(w),
    people = totalPeople(w),
    treasury = w.nations[1].treasury
  assert.equal(capitulationObstacle(w, 0, 1), '')
  applyCommand(w, { type: 'capitulate', nation: 0, target: 1, outcome: 'annex', indemnity: 0 })
  assert.equal(w.regions[last.id].nation, 0)
  assert.equal(w.nations[1].treasury, 0)
  assert(w.nations[0].treasury > treasury)
  assert.equal(w.nations[1].debt, 0)
  assert.equal(w.economy!.credit.loans.find((l) => l.principal === 100)!.borrower, 'government:0')
  assert.equal(w.economy!.firms![0].owners!['government:0'], 0.4)
  assert.equal(w.economy!.firms![0].owners!['household:0:owner'], 0.6)
  assert.equal(w.nations[1].extinct, w.month)
  assert(!allForces(w).some((a) => a.nation === 1))
  assert.equal(totalPeople(w), people)
  assert(Math.abs(totalCash(w) - cash) < 1e-8)
  assert.deepEqual(physicalStocks(w), goods)
  audit(w)
})

for (const outcome of ['subject', 'personal-union', 'independence'] as const)
  test(`imposed ${outcome} preserves territory and conserves indemnity, goods and people`, () => {
    const { w, last } = fixture(true)
    const cash = totalCash(w),
      goods = physicalStocks(w),
      people = totalPeople(w),
      treasury = w.nations[1].treasury
    applyCommand(w, { type: 'capitulate', nation: 0, target: 1, outcome, indemnity: 0.75 })
    assert.equal(w.regions[last.id].nation, 1)
    assert.equal(w.nations[1].treasury, treasury * 0.25)
    assert.equal(relation(w, 0, 1)!.treaty, 'truce')
    assert.equal(w.regions[last.id].control, undefined)
    assert.equal(dependencyOf(w, 1)?.kind, outcome === 'independence' ? undefined : outcome)
    assert.equal(totalPeople(w), people)
    assert(Math.abs(totalCash(w) - cash) < 1e-8)
    assert.deepEqual(physicalStocks(w), goods)
    if (outcome === 'personal-union') {
      assert.equal(w.nations[0].character!.leader.name, w.nations[1].character!.leader.name)
      assert(allForces(w).some((a) => a.nation === 1))
    } else assert(!allForces(w).some((a) => a.nation === 1))
    if (outcome === 'independence') {
      const withdrawing = w.armies.find((a) => a.nation === 0)!
      assert.equal(withdrawing.region, last.id, 'a settlement cannot teleport the occupying army')
      assert.equal(withdrawing.target, w.nations[0].capital)
      assert.equal(withdrawing.operations!.stance, 'march')
    }
    audit(w)
  })

test('capitulation rejects absent control, a viable field army, invalid outcomes and unaffordable annexation without mutation', () => {
  const { w, army, enemy, last } = fixture(true)
  for (const alter of [
    () => {
      army.region = w.nations[0].capital
    },
    () => {
      army.region = last.id
      enemy.region = w.nations[0].capital
      enemy.morale = enemy.supply = 1
      army.morale = 0.3
    },
    () => {
      enemy.morale = enemy.supply = 0.3
      army.morale = 1
      w.nations[0].treasury = 0
    },
  ]) {
    alter()
    const before = JSON.stringify(w)
    assert.throws(() => imposeCapitulation(w, 0, 1, 'annex'))
    assert.equal(JSON.stringify(w), before)
  }
  assert.throws(() => imposeCapitulation(w, 0, 1, 'invented' as CapitulationOutcome), /supported settlement/)
  assert.throws(() => imposeCapitulation(w, 0, 1, 'subject', NaN), /indemnity/)
})

test('a final ordinary annexation also settles the defeated estate and disbands surviving forces', () => {
  const { w, last } = fixture(true)
  borrow(w, 'government:1', 100, 100)
  w.month = 6
  const cash = totalCash(w),
    people = totalPeople(w)
  assert.match(applyCommand(w, { type: 'annex', nation: 0, region: last.id }), /annexed/)
  assert.equal(w.nations[1].treasury, 0)
  assert.equal(w.nations[1].debt, 0)
  assert.equal(w.nations[1].extinct, 6)
  assert(!allForces(w).some((a) => a.nation === 1))
  assert.equal(totalPeople(w), people)
  assert(Math.abs(totalCash(w) - cash) < 1e-8)
  audit(w)
})

test('royal marriages need both signatures and execute natively after preparation', () => {
  const { w } = fixture()
  const offer = proposeRoyalAgreement(w, 0, 1, 'royal-marriage', true)!
  w.month = offer.notBefore!
  settleConventionalOffers(w)
  assert.equal(marriageOf(w, 0, 1), undefined)
  assert(admitDiplomaticConsent(w, 1, offer))
  settleConventionalOffers(w)
  assert.equal(offer.status, 'ratified', offer.ruling)
  assert(marriageOf(w, 0, 1))
  assert(diplomaticInfluence(w, 0, 1) >= 25)
  assert.equal(dependencyOf(w, 1), undefined, 'marriage alone does not subordinate a state')
  audit(w)
})

test('personal unions require a mature marriage and preserve separate balances and military ownership', () => {
  const { w } = fixture()
  assert.throws(() => applyRoyalAgreement(w, 'personal-union', 0, 1), /one year/)
  applyRoyalAgreement(w, 'royal-marriage', 0, 1)
  assert.throws(() => applyRoyalAgreement(w, 'personal-union', 0, 1), /one year/)
  w.month = 12
  const cash = balances(w),
    troops = w.armies.map((a) => a.nation)
  applyRoyalAgreement(w, 'personal-union', 0, 1)
  assert.deepEqual(balances(w), cash)
  assert.deepEqual(
    w.armies.map((a) => a.nation),
    troops,
  )
  assert.equal(w.nations[1].character!.leader.name, w.nations[0].character!.leader.name)
  assert(!foreignPolicyMandate(w, 1, [1]))
  assert(foreignPolicyMandate(w, 1, [0, 1]))
  assert(diplomaticAccess(w, 0, 1) && diplomaticAccessView(w)(1, 0))
  assert.match(applyCommand(w, { type: 'diplomacy', nation: 1, target: 2, action: 'war' }), /delegated/)
  audit(w)
})

test('an heirless married crown passes into a personal union while a direct heir succeeds locally', () => {
  for (const heirless of [false, true]) {
    const { w } = fixture()
    applyRoyalAgreement(w, 'royal-marriage', 0, 1)
    const crown = crownOf(w, 1)!
    crown.heir = heirless ? null : 'A named local heir'
    crown.succession = 12
    w.month = 12
    advanceDynasties(w)
    assert.equal(dependencyOf(w, 1)?.senior, heirless ? 0 : undefined)
    assert.equal(
      w.nations[1].character!.leader.name,
      heirless ? w.nations[0].character!.leader.name : 'A named local heir',
    )
    const before = JSON.stringify(w.dynasties)
    advanceDynasties(w)
    assert.equal(JSON.stringify(w.dynasties), before, 'same-month evaluation cannot reroll succession')
    audit(w)
  }
})

test('union rulers remain synchronized through succession and a republic ends the union', () => {
  const { w } = fixture()
  formPersonalUnion(w, 0, 1, true)
  replaceStateLeader(w, 0, 'New sovereign')
  w.month++
  advanceDynasties(w)
  assert.equal(w.nations[1].character!.leader.name, 'New sovereign')
  w.nations[1].government = 'Republic'
  w.month++
  advanceDynasties(w)
  assert.equal(dependencyOf(w, 1), undefined)
})

test('subjects pay funded revenue tribute and cannot create chains or independent offensive wars', () => {
  const { w } = fixture()
  establishDependency(w, 0, 1, 'subject', true)
  w.nations[1].income = 10
  const cash = totalCash(w),
    treasury = w.nations[1].treasury
  advanceDependencies(w)
  assert.equal(w.nations[1].treasury, treasury - 1.5)
  assert.equal(dependencyOf(w, 1)!.paid, 1.5)
  assert(Math.abs(totalCash(w) - cash) < 1e-8)
  assert.throws(() => establishDependency(w, 1, 2, 'subject', true), /subordinate/)
  assert.throws(() => establishDependency(w, 1, 0, 'subject', true), /subordinate/)
  assert(!foreignPolicyMandate(w, 1, [1]))
  audit(w)
})

test('native victors choose capitulation while human victors and royal signatories retain their choice', () => {
  const { w } = fixture(true)
  advanceCapitulations(w)
  assert.equal(relation(w, 0, 1)!.treaty, 'war')
  w.nations[0].ai = true
  advanceCapitulations(w)
  assert.notEqual(relation(w, 0, 1)!.treaty, 'war')
  const peaceful = fixture().w
  proposeRoyalAgreement(peaceful, 0, 1, 'royal-marriage', true)
  peaceful.month = 12
  advanceRoyalDiplomacy(peaceful)
  assert.equal(marriageOf(peaceful, 0, 1), undefined)
})

test('dynastic saves retain claims and dependencies and reject cycles, duplicate marriages and invalid references', () => {
  const { w } = fixture()
  applyRoyalAgreement(w, 'royal-marriage', 0, 1)
  formPersonalUnion(w, 0, 1)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  assert.deepEqual(restored.dynasties, w.dynasties)
  assert.deepEqual(restored.dependencies, w.dependencies)
  for (const alter of [
    (x: World) => x.dependencies!.push({ ...x.dependencies![0], senior: 1, junior: 0 }),
    (x: World) => x.dynasties!.marriages.push({ ...x.dynasties!.marriages[0] }),
    (x: World) => {
      x.dynasties!.crowns[0].nation = 999
    },
    (x: World) => {
      x.dependencies![0].tribute = NaN
    },
  ]) {
    const bad = structuredClone(w)
    alter(bad)
    assert.throws(() => validateDynasticState(bad), /dynastic save/)
  }
})

test('bilateral controls expose conqueror outcomes at war and signed royal proposals at peace', () => {
  const { w } = fixture(true)
  const render = () =>
    renderToStaticMarkup(
      createElement(SovereignRelations, { world: w, nation: 0, target: 1, command: () => {} }),
    )
  const war = render()
  assert.match(war, /Dictate capitulation/)
  assert.match(war, /Establish a subject state/)
  assert.match(war, /Impose a personal union/)
  assert.match(war, /Disarm and restore independence/)
  relation(w, 0, 1)!.treaty = 'neutral'
  const peace = render()
  assert.match(peace, /Propose a royal marriage/)
  assert.match(peace, /Propose a personal union/)
  assert.doesNotMatch(peace, /Impose settlement/)
})

test('a later failed royal clause rolls back earlier cash, marriage and leadership changes', () => {
  const { w } = fixture()
  const royal = {
    kind: 'royal-marriage' as const,
    from: 0,
    to: 1,
    amount: 0,
    good: '' as const,
    field: '' as const,
    regions: [],
    duration: 0,
    text: 'Marriage',
  }
  const offer = submitStandingOffer(
    w,
    0,
    {
      title: 'Conflicting marriage terms',
      parties: [0, 1],
      visibility: 'public',
      duration: 24,
      supersedes: 0,
      terms: [royal, { ...royal }],
    },
    true,
  )
  assert(admitDiplomaticConsent(w, 1, offer))
  w.month = offer.notBefore!
  const before = JSON.stringify({
    dynasties: w.dynasties,
    dependencies: w.dependencies,
    cash: balances(w),
    leaders: w.nations.map((n) => n.character!.leader),
  })
  settleConventionalOffers(w)
  assert.equal(offer.status, 'proposed')
  assert.match(offer.ruling, /already joined/)
  assert.equal(
    JSON.stringify({
      dynasties: w.dynasties,
      dependencies: w.dependencies,
      cash: balances(w),
      leaders: w.nations.map((n) => n.character!.leader),
    }),
    before,
  )
})

test('marriage representatives are distinct and hostile or nonmonarchical proposals cannot create a claim', () => {
  const { w } = fixture()
  applyRoyalAgreement(w, 'royal-marriage', 0, 1)
  applyRoyalAgreement(w, 'royal-marriage', 0, 2)
  assert.notEqual(marriageOf(w, 0, 1)!.royalA, marriageOf(w, 0, 2)!.royalA)
  relation(w, 0, 3)!.treaty = 'war'
  assert.throws(() => applyRoyalAgreement(w, 'royal-marriage', 0, 3), /End the war/)
  relation(w, 0, 3)!.treaty = 'neutral'
  w.nations[3].government = 'Republic'
  assert.throws(() => applyRoyalAgreement(w, 'royal-marriage', 0, 3), /monarchies/)
  w.month++
  relation(w, 0, 1)!.treaty = 'war'
  advanceDynasties(w)
  assert.equal(marriageOf(w, 0, 1), undefined)
  validateDynasticState(w)
})

test('a conqueror can replace an earlier overlord or restore genuine independence', () => {
  for (const outcome of ['subject', 'personal-union', 'independence'] as const) {
    const { w } = fixture(true)
    establishDependency(w, 2, 1, 'subject', true)
    assert.throws(() => establishDependency(w, 0, 1, 'subject', false), /already has a superior/)
    imposeCapitulation(w, 0, 1, outcome, 0)
    assert.equal(dependencyOf(w, 1)?.senior, outcome === 'independence' ? undefined : 0)
    assert.equal(dependencyOf(w, 1)?.kind, outcome === 'independence' ? undefined : outcome)
    audit(w)
  }
})

test('refreshing crowns after constitutional change removes claims to the abolished crown', () => {
  const { w } = fixture()
  applyRoyalAgreement(w, 'royal-marriage', 0, 1)
  w.nations[1].government = 'Republic'
  ensureDynasties(w)
  assert.equal(crownOf(w, 1), undefined)
  assert.equal(marriageOf(w, 0, 1), undefined)
  validateDynasticState(w)
})

test('a negotiated final cession transfers the public estate and preserves civilian and military resources', () => {
  const { w, last } = fixture(true)
  borrow(w, 'government:1', 100, 100)
  const people = totalPeople(w),
    goods = physicalStocks(w),
    cash = totalCash(w)
  const clause = { from: 1, to: 0, amount: 0, good: '' as const, field: '' as const, duration: 0, text: '' }
  const offer = submitStandingOffer(
    w,
    1,
    {
      title: 'Final territorial settlement',
      parties: [0, 1],
      visibility: 'public',
      duration: 24,
      supersedes: 0,
      terms: [
        { ...clause, kind: 'peace', regions: [] },
        { ...clause, kind: 'cede', regions: [last.id] },
      ],
    },
    true,
  )
  assert(admitDiplomaticConsent(w, 0, offer))
  w.month = offer.notBefore!
  settleConventionalOffers(w)
  assert.equal(offer.status, 'ratified', offer.ruling)
  assert.equal(w.nations[1].extinct, w.month)
  assert.equal(w.nations[1].treasury, 0)
  assert.equal(w.nations[1].debt, 0)
  assert(!allForces(w).some((a) => a.nation === 1))
  assert.equal(totalPeople(w), people)
  assert.deepEqual(physicalStocks(w), goods)
  assert(Math.abs(totalCash(w) - cash) < 1e-8)
  audit(w)
})

test('independence withdraws fleets along a sea route without moving ships to an inland capital', () => {
  const { w, last } = fixture(true)
  const ports = transportNetwork(w).harbors
  const coast = ports.find((h) => h.region === last.id)!
  const home = ports.find(
    (h) => w.regions[h.region].nation === -1 && waterPath(w, coast.water, h.water).length > 1,
  )!
  transferSovereignty(w, home.region, 0)
  for (const good of ['timber', 'iron', 'arms', 'tools', 'food'] as const) last.stocks[good] = 100000
  rebaseEndowments(w)
  beginEconomyMonth(w)
  // This fleet predates the occupation; shipbuilding under enemy control is illegal.
  const occupation = last.control
  delete last.control
  commissionFleet(w, 1, last.id, 1, 1)
  last.control = occupation
  const fleet = w.warfare!.fleets.at(-1)!
  fleet.nation = 0
  fleet.mission = 'blockade'
  fleet.target = last.id
  // Commissioning belongs to setup; audit withdrawal against its own opening inventories.
  beginEconomyMonth(w)
  const before = { cell: fleet.cell, region: fleet.region, people: totalPeople(w), goods: physicalStocks(w) }
  imposeCapitulation(w, 0, 1, 'independence', 0)
  const withdrawing = w.warfare!.fleets.find((f) => f.id === fleet.id)!
  assert.equal(withdrawing.cell, before.cell)
  assert.equal(withdrawing.region, before.region)
  assert.equal(withdrawing.mission, 'return')
  assert.equal(withdrawing.target, home.region)
  assert(withdrawing.course.length > 0)
  assert.equal(totalPeople(w), before.people)
  assert.deepEqual(physicalStocks(w), before.goods)
  audit(w)
})
