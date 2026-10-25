import test from 'node:test'
import assert from 'node:assert/strict'
import { shippingBackbone, SHIPPING_BACKBONE } from '../src/sim/shipping-backbone'
import { corridorGeography, corridorProfile, corridorUsage } from '../src/sim/corridors'
import { transportNetwork } from '../src/sim/transport'
import { independentHarbors, parallelHarbors } from './fixtures/corridors'
import type { RouteLeg, World } from '../src/sim/types'

function stats(w: World, links: { legs: RouteLeg[] }[]) {
  const geo = corridorGeography(w),
    edges = new Set<number>()
  let cost = 0
  for (const link of links)
    for (const leg of link.legs)
      if (leg.mode === 'sea')
        for (let i = 2; i < leg.cells.length - 1; i++) {
          const edge = geo.index(leg.cells[i - 1], leg.cells[i])
          edges.add(edge)
          cost += geo.segments[edge].effort
        }
  return { edges, cost }
}

test('shipping joins at sea with fixed port branches, navigable steps and bounded sailing detours', () => {
  const w = independentHarbors({ gap: 14, width: 40 }),
    before = w.corridorPlan!.links,
    saved = JSON.stringify(before),
    after = shippingBackbone(w, before),
    geo = corridorGeography(w)
  assert(stats(w, after).edges.size < stats(w, before).edges.size * 0.85)
  assert.equal(after.length, before.length)
  for (let i = 0; i < after.length; i++) {
    assert.deepEqual([after[i].from, after[i].to], [before[i].from, before[i].to])
    assert.equal(after[i].legs.length, before[i].legs.length, 'no intermediate port calls')
    for (let j = 0; j < after[i].legs.length; j++) {
      const a = before[i].legs[j],
        b = after[i].legs[j]
      if (a.mode === 'land') {
        assert.equal(b, a)
        continue
      }
      assert.deepEqual(
        [b.cells[0], b.cells[1], b.cells.at(-2), b.cells.at(-1)],
        [a.cells[0], a.cells[1], a.cells.at(-2), a.cells.at(-1)],
      )
      assert.equal(new Set(b.cells).size, b.cells.length)
      for (let k = 1; k < b.cells.length; k++) {
        assert(geo.adjacent[b.cells[k - 1]].includes(b.cells[k]))
        if (k < b.cells.length - 1) assert.equal(w.cells[b.cells[k]].terrain, 'water')
      }
      assert(
        stats(w, [{ legs: [b] }]).cost <=
          stats(w, [{ legs: [a] }]).cost * SHIPPING_BACKBONE.maximumDetour + 1e-9,
      )
    }
  }
  assert.deepEqual(shippingBackbone(w, [...before].reverse()).reverse(), after)
  assert.equal(JSON.stringify(before), saved)
})

test('developed, busy ports can add direct crossings; inland traffic alone cannot', () => {
  const w = independentHarbors({ gap: 14, width: 40 }),
    before = w.corridorPlan!.links,
    early = shippingBackbone(w, before),
    geo = corridorGeography(w)
  w.regions.forEach((r) => (r.infrastructure = 0.9))
  w.nations[0].technologies.logistics = 7
  assert.deepEqual(shippingBackbone(w, before), early)
  w.corridors = geo.segments
    .filter((s) => s.mode === 'port')
    .map((s) => ({ a: s.a, b: s.b, familiarity: 0.8, traffic: 500 }))
  assert.deepEqual(shippingBackbone(w, before), early, 'port access activity is not established sea traffic')
  w.corridors = [...stats(w, early).edges].map((e) => ({
    a: geo.segments[e].a,
    b: geo.segments[e].b,
    familiarity: 0.8,
    traffic: 500,
  }))
  const mature = shippingBackbone(w, before)
  assert(stats(w, mature).cost < stats(w, early).cost)
  assert(stats(w, mature).edges.size > stats(w, early).edges.size)
})

test('young saved paths stay fixed and fresh worlds already share their initial shipping corridor', () => {
  const w = independentHarbors(),
    links = w.corridorPlan!.links
  assert.deepEqual(
    shippingBackbone(w, links, () => false),
    links,
  )
  const partial = shippingBackbone(w, links, (l) => l !== links[0])
  assert.equal(partial[0], links[0])
  const fresh = parallelHarbors(),
    network = transportNetwork(fresh),
    profile = corridorProfile(fresh),
    a = network.links.find((l) => l.from === 0 && l.to === 1)!,
    b = network.links.find((l) => l.from === 2 && l.to === 3)!,
    used = corridorUsage(profile, a.legs)
  assert([...corridorUsage(profile, b.legs).keys()].filter((e) => used.has(e)).length > 20)
})
