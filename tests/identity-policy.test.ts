import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { IdentityPolicyControls } from '../src/components/IdentityPolicyControls'
import { generateWorld } from '../src/sim/generate'
import { applyCommand, tick } from '../src/sim/engine'
import {
  IDENTITY_POLICY_KEYS,
  IDENTITY_PRESETS,
  applyIdentityPreset,
  identityPresetName,
  policyCapacityTargets,
  resolveIdentityPolicy,
} from '../src/sim/identity-policy'
import {
  COMMUNITY_POLITICAL_FIELDS,
  evaluateIdentityPolicy,
  evolveCommunityPolitics,
  identityStateAppeal,
  initializeCommunityPolitics,
  regionIdentityAppeal,
} from '../src/sim/identity-politics'
import {
  addCommunity,
  coalesceCommunities,
  communitySize,
  updateCommunityDemography,
} from '../src/sim/population'
import { evolveIdentities } from '../src/sim/identities'
import { policyCommandValue, validSavedPolicy } from '../src/sim/policy-rules'
import { validatePopulation } from '../src/sim/population-persistence'
import { restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { censusOf, mergeCensuses } from '../src/sim/view-snapshot'
import { advanceDomesticPolicy } from '../src/sim/domestic-policy'
import type { PopulationCommunity } from '../src/sim/population-types'
import type { Policies } from '../src/sim/types'

const world = generateWorld('Identity policy contracts', 3, 6, undefined, 'regional')
const fixture = () => structuredClone(world)
const policy = resolveIdentityPolicy({})
const zero = Object.fromEntries(IDENTITY_POLICY_KEYS.map((key) => [key, 0])) as typeof policy
const nation = world.nations[0]
const base: PopulationCommunity = {
  ...structuredClone(world.regions[nation.capital].communities![0]),
  ...nation.identity,
  pluralism: 0,
  groupIdentification: 1,
  authority: 1,
  localAutonomy: 0,
  publicReligion: 1,
}
const restrictive = {
  ...zero,
  culturalExclusion: 1,
  faithRestrictions: 1,
  languageExclusion: 1,
  culturalAssimilation: 1,
  stateFaithSupport: 1,
}

test('presets and continuous custom fields have a single source of truth', () => {
  const policies: Policies = { ...nation.policies }
  for (const axis of Object.keys(IDENTITY_PRESETS) as (keyof typeof IDENTITY_PRESETS)[]) {
    for (const name of Object.keys(IDENTITY_PRESETS[axis])) {
      Object.assign(policies, { [axis]: name })
      applyIdentityPreset(policies, axis)
      assert.equal(identityPresetName(policies, axis), name)
    }
  }
  policies.languageEducation = 0.413
  assert.equal(identityPresetName(policies, 'languagePolicy'), 'custom')
  const before = policies.languageEducation
  policies.beliefPolicy = 'protected'
  applyIdentityPreset(policies, 'beliefPolicy')
  assert.equal(policies.languageEducation, before)
})

test('legacy policy resolution and saved numeric bounds include every identity field', () => {
  const legacy = resolveIdentityPolicy({
    citizenship: 'heritage',
    languagePolicy: 'common',
    beliefPolicy: 'restricted',
  })
  assert.equal(legacy.culturalExclusion, 1)
  assert.equal(legacy.faithRestrictions, 1)
  for (const key of IDENTITY_POLICY_KEYS) {
    assert(validSavedPolicy(key, undefined))
    for (const value of [0, 0.37, 1]) assert(validSavedPolicy(key, value))
    for (const value of [NaN, Infinity, -1, 1.01, '0.5', null]) assert(!validSavedPolicy(key, value))
    assert.throws(() => policyCommandValue(key, NaN))
    assert.equal(policyCommandValue(key, 3), 1)
  }
})

test('aligned exclusion can win consent, but pluralist majorities object', () => {
  const aligned = evaluateIdentityPolicy(base, nation, restrictive)
  const pluralist = evaluateIdentityPolicy({ ...base, pluralism: 1 }, nation, restrictive)
  const minority = evaluateIdentityPolicy(
    { ...base, culture: -1, language: -1, belief: -1, knownLanguage: -1 },
    nation,
    restrictive,
  )
  assert(aligned.consent > 0)
  assert(pluralist.consent < aligned.consent)
  assert(pluralist.coercion < 0)
  assert(minority.consent < 0)
  assert(minority.exclusion > 0.6)
})

test('competence smoothly removes language exclusion while retaining a native language', () => {
  const g = { ...base, language: -1, knownLanguage: nation.identity!.language }
  const p = { ...zero, languageExclusion: 1 }
  const exclusion = (fluency: number) => evaluateIdentityPolicy({ ...g, fluency }, nation, p).exclusion
  assert(exclusion(0) > exclusion(0.25))
  assert(exclusion(0.25) > exclusion(0.49))
  assert.equal(exclusion(0.5), 0)
  assert.equal(exclusion(1), 0)
})

test('learning provision does not impose assimilation or exclusion; schools share capacity', () => {
  const funded = policyCapacityTargets({ ...zero, languageEducation: 1, localLanguageSupport: 1 }, 0.6, 0)
  assert.equal(funded.languageEducation + funded.localLanguageSupport, 0.6)
  assert.equal(funded.languageAssimilation, 0)
  assert.equal(evaluateIdentityPolicy(base, nation, funded).exclusion, 0)
  assert.deepEqual(policyCapacityTargets(restrictive, 0, 0), zero)
})

test('religious public life is independent from pluralism and ethnic allegiance', () => {
  const faith = { ...zero, stateFaithSupport: 1 }
  const religious = evaluateIdentityPolicy({ ...base, pluralism: 1, publicReligion: 1 }, nation, faith)
  const privateFaith = evaluateIdentityPolicy({ ...base, pluralism: 1, publicReligion: 0 }, nation, faith)
  assert(religious.recognition > privateFaith.recognition)
  assert.equal(religious.exclusion, 0)
})

test('foreign appeal weighs faith and rights as well as cultural affinity', () => {
  const tolerant = { ...nation, policies: { ...nation.policies, ...zero } }
  const hostile = {
    ...nation,
    identity: { ...nation.identity!, belief: -1 },
    policies: { ...nation.policies, ...restrictive },
  }
  const g = { ...base, pluralism: 1 }
  assert(identityStateAppeal(g, tolerant) > identityStateAppeal(g, hostile))
  const poor = { ...tolerant, stability: 0, legitimacy: 0 }
  assert.equal(identityStateAppeal(g, poor), 0)
  assert(Number.isFinite(regionIdentityAppeal(tolerant, world.regions[nation.capital])))
})

test('political changes are gradual, bounded, and do not infer pluralism from exclusion', () => {
  const g = { ...base, pluralism: 0.2, groupIdentification: 0.2 }
  evolveCommunityPolitics(g, 'local', 1, 0.001)
  assert(g.groupIdentification! > 0.2 && g.groupIdentification! < 0.21)
  assert(g.pluralism! < 0.21)
  const other = { ...g, culture: -1, belief: -1 }
  initializeCommunityPolitics(other, 'local')
  assert.equal(other.pluralism, g.pluralism)
})

test('merging census communities preserves weighted political conditions without fragmentation', () => {
  const a = {
    ...structuredClone(base),
    population: { children: 0, adults: 10, elders: 0 },
    ageCohorts: undefined,
    ageMonth: undefined,
    pluralism: 0,
  }
  const b = { ...a, population: { children: 0, adults: 30, elders: 0 }, pluralism: 1 }
  const groups = [structuredClone(a)]
  addCommunity(groups, b)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].pluralism, 0.75)
  assert.equal(communitySize(groups[0]), 40)
  assert.equal(coalesceCommunities([structuredClone(a), structuredClone(b)])[0].pluralism, 0.75)
  const merged = mergeCensuses([censusOf({ communities: [a] }, 0), censusOf({ communities: [b] }, 0)])
  assert.equal(merged.weighted.pluralism, 30)
})

test('commands apply presets and continuous values, reject invalid input, preserve other fields', () => {
  const w = fixture()
  applyCommand(w, { type: 'policy', nation: 0, key: 'languageEducation', value: 0.417 })
  assert.equal(w.nations[0].policies.languageEducation, 0.417)
  applyCommand(w, { type: 'policy', nation: 0, key: 'beliefPolicy', value: 'restricted' })
  assert.equal(w.nations[0].policies.faithRestrictions, 1)
  assert.equal(w.nations[0].policies.languageEducation, 0.417)
  assert.throws(() => applyCommand(w, { type: 'policy', nation: 0, key: 'faithRestrictions', value: NaN }))
})

test('local implementation changes gradually and cannot consume unbought school services', () => {
  const w = fixture(),
    r = w.regions[w.nations[0].capital]
  Object.assign(w.nations[0].policies, zero)
  updateCommunityDemography(w, r)
  const before = r.populationDynamics!.appliedIdentityPolicy!.languageEducation
  w.nations[0].policies.languageEducation = 1
  w.month++
  updateCommunityDemography(w, r)
  const applied = r.populationDynamics!.appliedIdentityPolicy!.languageEducation
  assert(applied >= before && applied < 0.1)
  const once = structuredClone(r.populationDynamics!.appliedIdentityPolicy)
  updateCommunityDemography(w, r)
  assert.deepEqual(r.populationDynamics!.appliedIdentityPolicy, once)
})

test('identity evolution preserves population and public fluency does not replace everyone’s native language', () => {
  const w = fixture()
  const before = w.regions.reduce(
    (sum, r) => sum + r.communities!.reduce((s, g) => s + communitySize(g), 0),
    0,
  )
  w.month++
  evolveIdentities(w)
  const after = w.regions.reduce(
    (sum, r) => sum + r.communities!.reduce((s, g) => s + communitySize(g), 0),
    0,
  )
  assert.equal(after, before)
  validatePopulation(w)
})

test('save round trips continuous policy, political attitudes, and local implementation', () => {
  const w = fixture(),
    r = w.regions[w.nations[0].capital]
  w.nations[0].policies.languageEducation = 0.432
  r.communities![0].pluralism = 0.123
  updateCommunityDemography(w, r)
  const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
  assert.equal(restored.nations[0].policies.languageEducation, 0.432)
  assert.equal(restored.regions[r.id].communities![0].pluralism, r.communities![0].pluralism)
  assert.deepEqual(
    restored.regions[r.id].populationDynamics!.appliedIdentityPolicy,
    r.populationDynamics!.appliedIdentityPolicy,
  )
})

test('legacy records omit new fields, while malformed political and implementation values fail validation', () => {
  const w = fixture()
  for (const r of w.regions)
    for (const g of r.communities!) for (const key of COMMUNITY_POLITICAL_FIELDS) delete g[key]
  validatePopulation(w)
  w.regions[0].communities![0].authority = NaN
  assert.throws(() => validatePopulation(w), /political orientation/)
  delete w.regions[0].communities![0].authority
  w.regions[0].populationDynamics!.appliedIdentityPolicy = { ...zero, languageEducation: 2 }
  assert.throws(() => validatePopulation(w), /applied identity/)
})

test('autonomous governments adjust continuous targets within bounded steps', () => {
  const w = fixture(),
    n = w.nations[0]
  n.ai = true
  w.month = 6
  const before = resolveIdentityPolicy(n.policies)
  advanceDomesticPolicy(w)
  for (const key of IDENTITY_POLICY_KEYS) assert(Math.abs(n.policies[key]! - before[key]) <= 0.040001)
})

test('policy controls expose all eight labeled dimensions and custom preset state', () => {
  const html = renderToStaticMarkup(
    createElement(IdentityPolicyControls, {
      policies: { ...nation.policies, languageEducation: 0.413 },
      onChange: () => {},
    }),
  )
  assert.equal((html.match(/type="range"/g) ?? []).length, 8)
  assert(html.includes('Custom policy'))
  assert(html.includes('Common-language teaching'))
})

test('funded common-language teaching increases bilingual fluency without mandatory native replacement', () => {
  const control = fixture(),
    teaching = fixture()
  const id = nation.capital
  const otherLanguage = world.demography!.identities.find(
    (d) => d.kind === 'language' && d.id !== nation.identity!.language,
  )!.id
  for (const w of [control, teaching]) {
    const r = w.regions[id]
    r.neighbors = []
    w.routes = []
    r.communities = [
      {
        ...structuredClone(base),
        language: otherLanguage,
        knownLanguage: nation.identity!.language,
        fluency: 0.1,
      },
    ]
    r.population = { ...base.population }
    r.populationDynamics!.appliedIdentityPolicy = {
      ...zero,
      languageEducation: Number(w === teaching),
      localLanguageSupport: 0.7,
    }
    w.month++
    evolveIdentities(w)
  }
  const native = (w: typeof world) => w.regions[id].communities!.filter((g) => g.language === otherLanguage)
  const mean = (w: typeof world) =>
    native(w).reduce((s, g) => s + communitySize(g) * g.fluency, 0) /
    native(w).reduce((s, g) => s + communitySize(g), 0)
  assert(mean(teaching) > mean(control))
  assert.equal(
    native(teaching).reduce((s, g) => s + communitySize(g), 0),
    communitySize(base),
  )
})

test('an explicit preset reserves every continuous setting on its axis', async () => {
  const { reserveCabinetOrder } = await import('../src/sim/cabinet-state')
  const w = fixture(),
    n = w.nations[0]
  n.ai = true
  w.month = 6
  Object.assign(n.policies, { languageEducation: 0.413, languageAssimilation: 0.723 })
  reserveCabinetOrder(w, n, 'policy:languagePolicy')
  advanceDomesticPolicy(w)
  assert.equal(n.policies.languageEducation, 0.413)
  assert.equal(n.policies.languageAssimilation, 0.723)
})

test('provincial implementation is a population-weighted rollup, not the declared target', async () => {
  const { provincialIdentityImplementation } = await import('../src/sim/identity-implementation')
  const w = fixture(),
    r = w.regions[0]
  r.populationDynamics!.appliedIdentityPolicy = { ...zero, languageEducation: 0.25 }
  const policies = provincialIdentityImplementation(w)
  assert.equal(policies[0].languageEducation, 0.25)
  assert.notEqual(policies[0], r.populationDynamics!.appliedIdentityPolicy)
  delete r.populationDynamics!.appliedIdentityPolicy
  assert.equal(provincialIdentityImplementation(w)[0].languageEducation, 0)
})
