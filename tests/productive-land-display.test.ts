import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Inspector } from '../src/components/Inspector'
import { generateWorld } from '../src/sim/generate'
import { DEFAULT_CONFIGURATION_VALUES } from '../src/sim/configuration-defaults'
import { provinceLandDevelopment } from '../src/sim/productive-land'

test('province inspection exposes the paid refinement action, current ceiling and configured capacity gain', () => {
  const w = generateWorld('land development display', 3, 4),
    r = w.regions.find((p) => p.nation >= 0)!,
    values = structuredClone(DEFAULT_CONFIGURATION_VALUES)
  values.productiveLand.productivity *= 2
  w.configuration = { version: 1, revision: 1, values }
  w.productiveLand = { levels: { [r.cells[0]]: 1 }, projects: [] }
  const summary = provinceLandDevelopment(w, r)
  assert(
    Math.abs(summary.multiplier - (1 + (values.productiveLand.productivity * Math.log(2)) / r.cells.length)) <
      1e-12,
  )
  const noop = () => {}
  const html = renderToStaticMarkup(
    createElement(Inspector, {
      world: w,
      nationId: r.nation,
      regionId: r.id,
      tab: 'atlas',
      onTab: noop,
      onCommand: noop,
      agentStatus: { pending: 0, active: [], decisionModel: '', strategyModel: '', error: '' },
      onStrategy: noop,
      onEventDetails: noop,
      pendingDetails: [],
      onFocus: noop,
      onRegion: noop,
      onNation: noop,
      onArmy: noop,
      orderedArmy: null,
    }),
  )
  assert(html.includes('Refine productive land'))
  assert(html.includes('Average site refinement'))
  assert(html.includes('Output capacity from site works'))
  assert(html.includes(((summary.multiplier - 1) * 100).toFixed(1)))
  assert(html.includes('Fund farm equipment'), 'existing investment controls remain available')
})
