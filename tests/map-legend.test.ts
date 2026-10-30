/** The map key is persistent map context, including before any user interaction. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorldMap } from '../src/components/WorldMap'
import { generateWorld } from '../src/sim/generate'
import type { Layer } from '../src/sim/types'

test('every map layer renders its legend immediately without a disclosure button', (t) => {
  // A hidden document disables animation; raster buffers allow the real map
  // preparation to run without a browser. Effects/drawing are checked in-browser.
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalPath = Object.getOwnPropertyDescriptor(globalThis, 'Path2D')
  Object.defineProperty(globalThis, 'Path2D', {
    configurable: true,
    value: class {
      moveTo() {}
      lineTo() {}
      closePath() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      hidden: true,
      createElement: () => ({
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: () => {},
        }),
      }),
    },
  })
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (originalPath) Object.defineProperty(globalThis, 'Path2D', originalPath)
    else Reflect.deleteProperty(globalThis, 'Path2D')
  })
  const world = generateWorld('Persistent map legend', 3, 8)
  const expectations = {
    political: 'Sovereign borders',
    terrain: 'Occupied homes',
    resources: 'Remaining tonnes / terrain tile',
    population: 'Residents / km²',
    culture: 'Largest community in each province',
    language: 'Largest community in each province',
    belief: 'Largest community in each province',
    prosperity: 'Public contentment',
    food: 'Food needs met',
    trade: 'monthly tonnage',
    military: 'March order',
  } satisfies Record<Layer, string>
  const noop = () => {}
  for (const [layer, label] of Object.entries(expectations)) {
    const html = renderToStaticMarkup(
      createElement(WorldMap, {
        world,
        mapKey: 'legend-test',
        layer: layer as Layer,
        nation: 0,
        region: null,
        showRoutes: false,
        showArmies: false,
        running: false,
        focus: null,
        onSelect: noop,
        onLayer: noop,
        onInspect: noop,
        onClear: noop,
        onToggleRoutes: noop,
        onToggleArmies: noop,
        orderMode: false,
        showContext: false,
      }),
    )
    assert.match(html, /id="map-key" role="group" aria-label="Map legend"/, layer)
    assert.ok(html.includes(label), `${layer} explains its map symbols or scale on first render`)
    assert.doesNotMatch(html, /map-key-toggle|aria-controls="map-key"/, layer)
  }
})
