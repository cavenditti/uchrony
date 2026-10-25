import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { produce } from '../src/sim/economy'
import { applyCommand } from '../src/sim/engine'
import { ensureStatecraft, settleConventionalOffers, submitStandingOffer } from '../src/sim/statecraft'
import {
  advanceInstitutions,
  allocateProvincialTaxes,
  foreignPolicyMandate,
  institutionalFunds,
  sharedInstitution,
  transferInstitutionMembership,
  type Charter,
} from '../src/sim/institutions'
import { diplomaticAccess, preferentialTrade } from '../src/sim/agreements'
import { transportGraph } from '../src/sim/economy'
import { restoreWorld, validateWorld } from '../src/sim/persistence'
import { relation, type World } from '../src/sim/types'

const charter: Charter = {
  operation: 'found',
  id: 0,
  form: 'confederation',
  powers: ['defense', 'trade', 'research', 'foreignPolicy'],
  rule: 'majority',
  contribution: 0.05,
  exit: 'notice',
}
const funds = (w: World) => institutionalFunds(w) + w.nations.reduce((s, n) => s + n.treasury, 0)
function propose(w: World, powers = charter.powers, members = [0, 1, 2]) {
  ensureStatecraft(w)
  applyCommand(w, {
    type: 'charter-proposal',
    nation: members[0],
    members,
    name: 'Three Rivers Compact',
    charter: { ...charter, powers },
  })
  return w.statecraft!.offers.at(-1)!
}
function found(w: World, powers = charter.powers, members = [0, 1, 2]) {
  const offer = propose(w, powers, members)
  for (const nation of members.slice(1))
    offer.signatures.push({ nation, digest: offer.digest, month: w.month })
  w.month = Math.max(w.month, offer.notBefore ?? w.month)
  settleConventionalOffers(w)
  assert.equal(offer.status, 'ratified', offer.ruling)
  return w.institutions!.organizations.at(-1)!
}

test('a multilateral charter needs each exact signature and grants real access and trade rights', () => {
  const w = generateWorld('charter-consent'),
    offer = propose(w)
  settleConventionalOffers(w)
  assert.equal(w.institutions?.organizations.length ?? 0, 0)
  offer.signatures.push(
    { nation: 1, digest: 'wrong-text', month: 0 },
    { nation: 2, digest: offer.digest, month: 0 },
  )
  settleConventionalOffers(w)
  assert.equal(w.institutions?.organizations.length ?? 0, 0)
  offer.signatures = offer.signatures.filter((s) => s.digest === offer.digest)
  offer.signatures.push({ nation: 1, digest: offer.digest, month: 0 })
  w.month = Math.max(w.month, offer.notBefore ?? w.month)
  settleConventionalOffers(w)
  assert.equal(offer.status, 'ratified', offer.ruling)
  assert.deepEqual(w.institutions!.organizations[0].members, [0, 1, 2])
  assert(diplomaticAccess(w, 0, 1) && preferentialTrade(w, 0, 2))
  assert(!diplomaticAccess(w, 0, 3))
  validateWorld(w)
})

test('delegated foreign policy needs the charter majority, with a specific common-defense exception', () => {
  const w = generateWorld('charter-voting')
  found(w)
  assert(!foreignPolicyMandate(w, 0, [0]))
  assert(foreignPolicyMandate(w, 0, [0, 1]))
  assert.match(applyCommand(w, { type: 'diplomacy', nation: 0, target: 3, action: 'war' }), /authorization/)
  const rel = relation(w, 1, 3)!
  rel.treaty = 'war'
  rel.aggressor = 3
  const offer = submitStandingOffer(w, 0, {
    title: 'Defend our member',
    parties: [0],
    visibility: 'public',
    duration: 12,
    supersedes: 0,
    terms: [
      {
        kind: 'war',
        from: 0,
        to: 3,
        amount: 0,
        good: '',
        field: '',
        regions: [],
        duration: 0,
        text: 'Invoke common defense.',
      },
    ],
  })
  settleConventionalOffers(w)
  assert.equal(offer.status, 'ratified', offer.ruling)
  assert.equal(relation(w, 0, 3)!.treaty, 'war')
  assert.throws(
    () =>
      submitStandingOffer(w, 0, {
        title: 'Unrelated offensive',
        parties: [0],
        visibility: 'public',
        duration: 12,
        supersedes: 0,
        terms: [
          {
            kind: 'war',
            from: 0,
            to: 4,
            amount: 0,
            good: '',
            field: '',
            regions: [],
            duration: 0,
            text: 'An unrelated offensive.',
          },
        ],
      }),
    /member authorization/,
  )
})

test('common defense opens the actual army transport graph through member territory', () => {
  const w = generateWorld('charter-access')
  const border = w.regions.find((r) => r.neighbors.some((id) => w.regions[id].nation !== r.nation))!,
    neighbor = w.regions[border.neighbors.find((id) => w.regions[id].nation !== border.nation)!],
    from = border.nation,
    to = neighbor.nation
  relation(w, from, to)!.treaty = 'neutral'
  assert(!transportGraph(w, from)[border.id].some((e) => e.to === neighbor.id))
  found(w, ['defense'], [from, to])
  assert(transportGraph(w, from)[border.id].some((e) => e.to === neighbor.id))
})

test('shared contributions and defense grants conserve all public funds, including extinct-member estates', () => {
  const w = generateWorld('charter-funds'),
    o = found(w)
  for (const n of w.nations) n.income = 100
  relation(w, 0, 3)!.treaty = 'war'
  const before = funds(w)
  advanceInstitutions(w)
  assert(o.income > 0 && o.grants > 0)
  assert(Math.abs(funds(w) - before) < 1e-8)
  for (const r of w.regions) if (o.members.includes(r.nation)) r.nation = 3
  const estate = funds(w)
  advanceInstitutions(w)
  assert.equal(o.status, 'dissolved')
  assert.equal(o.treasury, 0)
  assert(Math.abs(funds(w) - estate) < 1e-8)
})

test('provincial charters retain only their tax share, fund services and cannot seize another state’s province', () => {
  const w = generateWorld('provincial-charter'),
    r = w.regions[w.nations[0].capital]
  ensureStatecraft(w)
  beginEconomyMonth(w)
  produce(w)
  applyCommand(w, {
    type: 'devolution',
    nation: 0,
    regions: [r.id],
    autonomy: 0.6,
    powers: ['taxation', 'policing', 'education'],
  })
  assert(r.id >= 0)
  const province = w.regions[r.id],
    d = province.delegation!
  for (const own of w.regions.filter((r) => r.nation === 0)) own.gdp = 100
  assert.equal(d.autonomy, 0.6)
  const gross = 1000,
    income = allocateProvincialTaxes(w, 0, gross)
  assert(income > 0 && income <= gross)
  assert.equal(d.treasury, income)
  const unrest = province.unrest
  advanceInstitutions(w)
  assert(d.budget > 0 && d.treasury < income)
  assert.equal(d.treasury + d.budget, income)
  assert(province.unrest <= unrest)
  const foreign = w.regions.find((r) => r.nation !== 0)!
  assert.throws(
    () =>
      applyCommand(w, {
        type: 'devolution',
        nation: 0,
        regions: [foreign.id],
        autonomy: 0.5,
        powers: ['taxation'],
      }),
    /owned provinces/,
  )
  validateWorld(w)
})

test('institutional membership deduplicates on union and survives exact save continuation', () => {
  const w = generateWorld('charter-continuation'),
    o = found(w)
  transferInstitutionMembership(w, 0, 1)
  assert.deepEqual(o.members, [1, 2])
  assert(sharedInstitution(w, 1, 2, 'defense'))
  const copy = restoreWorld(JSON.parse(JSON.stringify(w)))
  advanceInstitutions(w)
  advanceInstitutions(copy)
  assert.deepEqual(copy, w)
  const bad = structuredClone(w)
  bad.institutions!.organizations[0].members = [1, 1]
  assert.throws(() => validateWorld(bad), /charter/)
})
