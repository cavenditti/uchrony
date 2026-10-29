import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import {
  recordWorldArchive,
  queryWorldArchive,
  validateWorldArchive,
  archiveFrameIndex,
} from '../src/sim/world-archive'
import { applyInstitutionTerm, validateInstitutions } from '../src/sim/institutions'
import { cloneInstitutions } from '../src/sim/institution-lifecycle'
import { historicalMapColors, historicalMapScale, institutionProposal } from '../src/sim/archive-presentation'
import { viewSnapshot } from '../src/sim/view-snapshot'
import { restoreWorld } from '../src/sim/persistence'
import type { DiplomaticClause, DiplomaticOffer } from '../src/sim/statecraft-types'
import { CLAUSE_SCHEMA, checkSchema } from '../src/sim/statecraft-schema'
const founding: DiplomaticClause = {
  kind: 'institution',
  from: 0,
  to: -1,
  amount: 0,
  good: '',
  field: '',
  regions: [],
  duration: 0,
  text: 'Old League',
  charter: {
    operation: 'found',
    id: 0,
    form: 'defense-league',
    powers: ['defense'],
    rule: 'majority',
    contribution: 0.02,
    exit: 'free',
  },
}
const offer = { id: 1, parties: [0, 1, 2], visibility: 'public' } as DiplomaticOffer

test('historical ownership, state identity and institution revisions never leak future changes', () => {
  const w = generateWorld('historical-atlas')
  applyInstitutionTerm(w, founding, offer)
  recordWorldArchive(w)
  const first = queryWorldArchive(w, { id: 1, month: 0, institution: 1 })
  const region = w.regions[0],
    original = region.nation
  w.month = 1
  region.nation = (original + 1) % w.nations.length
  w.nations[0].name = 'New State Name'
  applyInstitutionTerm(
    w,
    { ...founding, text: 'New League', charter: { ...founding.charter!, id: 1, operation: 'rename' } },
    offer,
  )
  recordWorldArchive(w)
  assert.equal(queryWorldArchive(w, { id: 2, month: 0, institution: 1 }).selected!.name, 'Old League')
  assert.equal(queryWorldArchive(w, { id: 3, month: 0 }).provinces[0].nation, original)
  assert.deepEqual(queryWorldArchive(w, { id: 4, month: 0 }).nations, first.nations)
  assert.equal(queryWorldArchive(w, { id: 5, month: 1, institution: 1 }).selected!.name, 'New League')
  assert.equal(w.archive!.frames[1].provinces.length, 1)
  validateWorldArchive(w)
})
test('same-month replacements retain all ownership changes against the preceding checkpoint', () => {
  const w = generateWorld('archive-replace')
  recordWorldArchive(w)
  w.month = 1
  w.regions[0].nation = 1
  recordWorldArchive(w)
  w.regions[1].nation = 2
  recordWorldArchive(w)
  assert.equal(w.archive!.frames.length, 2)
  const result = queryWorldArchive(w, { id: 1, month: 1 })
  assert.equal(result.provinces[0].nation, 1)
  assert.equal(result.provinces[1].nation, 2)
  w.month = 120
  recordWorldArchive(w)
  assert(w.archive!.frames[2].checkpoint)
  const copy = JSON.parse(JSON.stringify(w))
  copy.month = 121
  copy.regions[2].nation = 3
  recordWorldArchive(copy)
  assert.equal(queryWorldArchive(copy, { id: 2, month: 121 }).provinces[0].nation, 1)
  validateWorldArchive(copy)
})
test('old saves get a truthful baseline and coarse dates use the preceding recorded observation', () => {
  const w = generateWorld('archive-baseline')
  w.month = 60
  recordWorldArchive(w)
  assert.throws(() => queryWorldArchive(w, { id: 1, month: 0 }), /unknown/)
  w.month = 66
  w.fastForward = { months: 6, lastMonth: 66, phase: 0 }
  recordWorldArchive(w)
  const gap = queryWorldArchive(w, { id: 2, month: 65 })
  assert.equal(gap.month, 60)
  assert(queryWorldArchive(w, { id: 3, month: 66 }).approximate)
  assert.equal(archiveFrameIndex(w.archive!.frames, 59), -1)
  assert.equal(archiveFrameIndex(w.archive!.frames, 65), 0)
})
test('confidential histories are opt-in and archive data is absent from recurring UI snapshots', () => {
  const w = generateWorld('archive-confidential')
  applyInstitutionTerm(w, founding, { ...offer, visibility: 'secret' })
  recordWorldArchive(w)
  assert.equal(queryWorldArchive(w, { id: 1, month: 0, institution: 1 }).selected, undefined)
  assert(queryWorldArchive(w, { id: 2, month: 0, institution: 1, confidential: true }).selected)
  const snapshot = viewSnapshot(w)
  assert.equal(snapshot.archive, undefined)
  assert.equal(snapshot.institutions!.organizations[0].events, undefined)
  assert(w.institutions!.organizations[0].events!.length > 0)
})
test('archived records survive exact save continuation and invalid identities are rejected', () => {
  const w = generateWorld('archive-save')
  applyInstitutionTerm(w, founding, offer)
  recordWorldArchive(w)
  const copy = restoreWorld(JSON.parse(JSON.stringify(w)))
  assert.deepEqual(copy, w)
  w.month = 1
  copy.month = 1
  recordWorldArchive(w)
  recordWorldArchive(copy)
  assert.deepEqual(copy, w)
  const bad = structuredClone(w)
  bad.archive!.frames[0].provinces[0].nation = 999
  assert.throws(() => validateWorldArchive(bad), /archive/)
  const bad2 = structuredClone(w)
  bad2.archive!.frames[0].month = 2
  assert.throws(() => validateWorldArchive(bad2), /archive/)
})
test('institution trial records share immutable past payloads and isolate new decisions', () => {
  const w = generateWorld('archive-trial')
  applyInstitutionTerm(w, founding, offer)
  const copy = cloneInstitutions(w.institutions)!
  assert.equal(copy.organizations[0].events![0], w.institutions!.organizations[0].events![0])
  const trial = { ...w, institutions: copy }
  applyInstitutionTerm(
    trial,
    { ...founding, text: 'Trial Name', charter: { ...founding.charter!, id: 1, operation: 'rename' } },
    offer,
  )
  assert.equal(w.institutions!.organizations[0].name, 'Old League')
  assert.equal(w.institutions!.organizations[0].events!.length, 1)
  validateInstitutions(trial)
})
test('map layers and institutional proposals use dated data and explicit voters', () => {
  const w = generateWorld('archive-presentation')
  applyInstitutionTerm(w, founding, offer)
  recordWorldArchive(w)
  const result = queryWorldArchive(w, { id: 1, month: 0, institution: 1 }),
    o = result.selected!,
    p = result.provinces.find((p) => p.nation === 0)!
  assert.equal(historicalMapColors(result, 'political')[p.id], result.nations[0].color)
  assert.match(historicalMapColors(result, 'population')[p.id], /^hsl/)
  assert.match(historicalMapColors(result, 'economy')[p.id], /^hsl/)
  assert.equal(historicalMapColors(result, 'wars')[p.id], '#526a70')
  const changed = { ...result, wars: [{ a: 0, b: 1, since: 0 }] }
  assert.equal(historicalMapColors(changed, 'wars')[p.id], '#b7776d')
  assert.equal(
    historicalMapColors({ ...result, provinces: [{ ...p, nation: -1 }] }, 'political')[0],
    '#5b6560',
  )
  const scale = historicalMapScale(result, 'population')!
  assert.equal(scale.unit, 'people')
  assert.equal(scale.ticks.at(-1)!.value, Math.max(...result.nations.map((n) => n.population)))
  assert.equal(historicalMapScale(result, 'economy')!.unit, 'thousand crowns / month')
  assert.equal(historicalMapScale(result, 'political'), undefined)
  assert.deepEqual(historicalMapScale({ ...result, nations: [] }, 'population')!.ticks, [])
  for (const population of [0, 24]) {
    const equal = { ...result, nations: result.nations.map((n) => ({ ...n, population })) }
    const constant = historicalMapScale(equal, 'population')!
    assert(constant.constant)
    assert.deepEqual(
      constant.ticks.map((t) => t.value),
      [population],
    )
    assert.equal(historicalMapColors(equal, 'population')[p.id], constant.ticks[0].color)
  }
  const proposal = institutionProposal(
    o,
    0,
    'amend',
    'Revised',
    -1,
    { ...o.charter, defense: 'military', responseMonths: 3 },
    [0, 1],
  )
  assert.equal(proposal.type, 'charter-proposal')
  if (proposal.type !== 'charter-proposal') return
  assert.deepEqual(proposal.members, [0, 1])
  checkSchema(CLAUSE_SCHEMA, { ...founding, text: proposal.name, charter: proposal.charter })
})

test('compressed archives preserve constitutional journals and reject corrupt blocks', async () => {
  const { packWorldSave } = await import('../src/sim/save-codec')
  const w = generateWorld('compressed-history')
  applyInstitutionTerm(w, founding, offer)
  recordWorldArchive(w)
  for (let month = 1; month <= 250; month++) {
    w.month = month
    if (month % 30 === 0) w.regions[0].nation = (w.regions[0].nation + 1) % w.nations.length
    recordWorldArchive(w)
  }
  const packed = packWorldSave(w) as { archive: { fields: { frames: { blocks: { data: string }[] } } } }
  assert.equal(packed.archive.fields.frames.blocks.length, 3)
  assert.deepEqual(restoreWorld(JSON.parse(JSON.stringify(packed))), w)
  packed.archive.fields.frames.blocks[0].data = 'AAAA'
  assert.throws(() => restoreWorld(packed), /Compressed|compressed/)
})

test('repeated memberships and decisions are dated independently of journal pagination', async () => {
  const { institutionMemberships } = await import('../src/sim/world-archive')
  const w = generateWorld('membership-episodes')
  applyInstitutionTerm(w, founding, offer)
  w.month = 1
  applyInstitutionTerm(
    w,
    { ...founding, charter: { ...founding.charter!, id: 1, operation: 'withdraw' } },
    offer,
  )
  w.month = 2
  applyInstitutionTerm(w, { ...founding, charter: { ...founding.charter!, id: 1, operation: 'join' } }, offer)
  const episodes = institutionMemberships(w.institutions!.organizations[0].events!)
  assert.deepEqual(
    episodes.filter((m) => m.nation === 0).map(({ since, until }) => ({ since, until })),
    [
      { since: 0, until: 1 },
      { since: 2, until: undefined },
    ],
  )
  recordWorldArchive(w)
  const current = queryWorldArchive(w, { id: 1, month: 2, institution: 1 })
  assert.equal(current.selected!.memberships.length, 4)
  assert.equal(current.selected!.finances[0].month, 2)
})
