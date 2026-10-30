import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FacilityDevelopment } from '../src/components/FacilityDevelopment'
import { facilityFixture } from './fixtures/productive-facilities'
import { fundFacility } from '../src/sim/facility-investment'
import { completeFacilityProjects } from '../src/sim/productive-facilities'

test('district controls expose named facilities, construction requirements, completed tiers and pending work', () => {
  const { w, r, cell } = facilityFixture(),
    render = () =>
      renderToStaticMarkup(
        createElement(FacilityDevelopment, { world: w, province: r.id, command: () => {} }),
      )
  const opening = render()
  for (const name of [
    'Agricultural estate',
    'Timber yard',
    'Stone quarry',
    'Iron mine',
    'Coal mine',
    'Tool works',
    'Textile mill',
    'Arms works',
    'Market and warehouses',
  ])
    assert(opening.includes(name), name)
  assert(opening.includes('Investment location'))
  assert(opening.includes('Construction cost'))
  fundFacility(w, r, 'iron-mine', 1000, cell)
  assert(render().includes('months remaining'))
  w.month = 6
  completeFacilityProjects(w)
  const completed = render()
  assert(completed.includes('completed tier'))
  assert(completed.includes('mining'))
})

test('foreign detail loading and unavailable construction have explicit, non-executable states', () => {
  const { w, r } = facilityFixture()
  w.nations[r.nation].treasury = 0
  let html = renderToStaticMarkup(
    createElement(FacilityDevelopment, { world: w, province: r.id, command: () => {} }),
  )
  assert(html.includes('disabled=""'))
  assert(html.includes('Construction wages must be paid'))
  w.viewOnly = true
  w.viewNation = (r.nation + 1) % w.nations.length
  html = renderToStaticMarkup(
    createElement(FacilityDevelopment, { world: w, province: r.id, command: () => {} }),
  )
  assert(html.includes('Loading district investment conditions'))
  assert(!html.includes('Facility to build'))
})
