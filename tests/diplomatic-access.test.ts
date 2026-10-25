import test from 'node:test'
import assert from 'node:assert/strict'
import { diplomaticAccess, diplomaticAccessView } from '../src/sim/agreements'
import type { World } from '../src/sim/types'
import type { DiplomaticClause, DiplomaticOffer } from '../src/sim/statecraft-types'

test('phase access index preserves direction, expiration, alliances and institutional rights', () => {
  const terms = (kind: DiplomaticClause['kind'], from: number, to: number, duration = 0) =>
    ({ kind, from, to, duration }) as DiplomaticClause
  const offer = (resolved: DiplomaticClause[], extra: Partial<DiplomaticOffer> = {}) =>
    ({ status: 'ratified', activated: 2, ends: 0, resolved, ...extra }) as DiplomaticOffer
  const world = {
    month: 5,
    statecraft: {
      offers: [
        offer([terms('access', 0, 1)]),
        offer([terms('alliance', 2, 3, 5)]),
        offer([terms('access', 3, 4)], { ends: 5 }),
        offer([terms('alliance', 4, 5)], { status: 'proposed' }),
        offer([terms('trade', 0, 5)]),
        offer([terms('access', 5, 0, 3)]),
      ],
    },
    institutions: {
      organizations: [
        { status: 'active', members: [1, 4, 5], charter: { powers: ['defense'] } },
        { status: 'dissolved', members: [0, 3], charter: { powers: ['defense'] } },
        { status: 'active', members: [0, 4], charter: { powers: ['trade'] } },
      ],
    },
  } as World
  const compare = () => {
    const indexed = diplomaticAccessView(world)
    for (let traveler = 0; traveler < 6; traveler++)
      for (let host = 0; host < 6; host++)
        assert.equal(indexed(traveler, host), diplomaticAccess(world, traveler, host), `${traveler}:${host}`)
    return indexed
  }
  const initial = compare()
  assert.equal(initial(1, 0), true)
  assert.equal(initial(0, 1), false)
  assert.equal(initial(2, 3), true)
  world.month = 7
  assert.equal(compare()(2, 3), false)
  world.institutions!.organizations[0].status = 'dissolved'
  assert.equal(compare()(1, 5), false)
})
