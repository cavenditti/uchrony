import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OverseasSettlements } from '../src/components/OverseasSettlements'
import { ArmyLogistics } from '../src/components/MilitaryOperations'
import { generateWorld } from '../src/sim/generate'
import { inventory, type World } from '../src/sim/types'
import { viewSnapshot } from '../src/sim/view-snapshot'
import { STRATA } from '../src/sim/economic-types'

function fixture() {
  const full = generateWorld('Maritime UI', 3, 8, undefined, 'regional', 'settled')
  const world: World = { ...viewSnapshot(full, 0), cells: full.cells }
  return { world, nation: 0, command: () => {} }
}

test('the dossier uses authoritative worker quotes and labels cost and a singular month', () => {
  const props = fixture(),
    home = props.world.nations[0].capital
  props.world.viewOverseas = {
    nation: 0,
    options: [
      {
        cell: 1,
        province: 1,
        name: 'Overseas coast',
        source: home,
        departure: home,
        fleet: 1,
        people: 120,
        months: 1,
        wages: 20,
        cost: 25,
        goods: { ...inventory(), food: 40 },
      },
    ],
  }
  const html = renderToStaticMarkup(createElement(OverseasSettlements, props))
  assert.match(html, /Fund expedition · 25.0k crowns/)
  assert.match(html, /about 1 month at sea/)
  assert.match(html, /provincial ownership changes through local accession/)
  props.world.viewOverseas.nation = 1
  assert.doesNotMatch(renderToStaticMarkup(createElement(OverseasSettlements, props)), /Fund expedition/)
})

test('active records expose recall and journey obstacles without passenger census data', () => {
  const props = fixture(),
    home = props.world.nations[0].capital
  props.world.overseas = {
    nextId: 2,
    footholds: [],
    expeditions: [
      {
        id: 1,
        nation: 0,
        cell: 1,
        source: home,
        departure: home,
        arrival: 1,
        fleet: null,
        started: 0,
        updated: 0,
        stage: 'returning',
        obstacle: 'Awaiting safe access.',
        people: 120,
        communities: [],
        goods: inventory(),
        settlers: 120,
        wages: 20,
        accounts: Object.fromEntries([...STRATA, 'construction'].map((s) => [s, { cash: 0 }])) as never,
      },
    ],
  }
  const html = renderToStaticMarkup(createElement(OverseasSettlements, props))
  assert.match(html, /120 settlers aboard/)
  assert.match(html, /Awaiting safe access/)
  assert.match(html, /disabled=""[^>]*>Returning home/)
  const army = props.world.armies.find((a) => a.nation === 0)!
  army.operations!.journey = {
    destination: 1,
    departure: home,
    arrival: 1,
    fleet: null,
    started: 0,
    stage: 'waiting',
    obstacle: 'Waiting for transport berths.',
  }
  assert.match(
    renderToStaticMarkup(createElement(ArmyLogistics, { ...props, army })),
    /Waiting for transport berths/,
  )
})
