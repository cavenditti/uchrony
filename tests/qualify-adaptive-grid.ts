/** Offline, reproducible full-domain mesh qualification; no application saves or model calls. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { generateWorld } from '../src/sim/generate'
import { ensureAdaptiveWorld, rebuildAdaptiveMesh } from '../src/sim/adaptive-world'
import { queryAdaptiveSites, nearestAdaptiveSites, locateAdaptiveCell } from '../src/sim/adaptive-grid'
import { cellPolygon, polygonArea, cellPosition } from '../src/sim/physical-space'
import { WORLD_SCALES, type WorldScale } from '../src/sim/scale'

const results = []
for (const scale of ['regional', 'world'] as WorldScale[]) {
  const start = performance.now()
  const w = generateWorld(
    'Adaptive grid qualification 2026-10-26',
    3,
    WORLD_SCALES[scale].states,
    undefined,
    scale,
  )
  ensureAdaptiveWorld(w)
  const initializedMs = performance.now() - start
  const sites = Object.values(w.adaptive!.sites).filter((s) => s.retired === undefined)
  const exact = [0, 0]
  for (const c of w.cells) exact[Number(c.terrain === 'water')] += polygonArea(cellPolygon(w, c.id))
  const modes = []
  globalThis.gc?.()
  for (const mode of ['coarse', 'fine', 'adaptive'] as const) {
    globalThis.gc?.()
    const remeshStart = performance.now(),
      mesh = rebuildAdaptiveMesh(w, mode)
    const remeshMs = performance.now() - remeshStart
    const totals = mesh.leaves.reduce((sum, n) => [sum[0] + n.landArea, sum[1] + (n.waterArea ?? 0)], [0, 0])
    totals.forEach((total, i) => assert(Math.abs(total - exact[i]) < exact[i] * 1e-9))
    const queryStart = performance.now()
    let found = 0
    for (let i = 0; i < 40; i++) {
      const c = w.cells[Math.floor((i * w.cells.length) / 40)],
        center = cellPosition(w, c.id)
      assert.equal(locateAdaptiveCell(w, center)!.source.id, c.id)
      const actual = queryAdaptiveSites(w, center, 6000)
      const expected = sites
        .filter((s) => Math.hypot(s.x - center.x, s.y - center.y) <= 6000)
        .sort((a, b) => a.id.localeCompare(b.id))
      assert.deepEqual(
        actual.map((s) => s.id),
        expected.map((s) => s.id),
      )
      const closest = [...expected]
        .sort(
          (a, b) =>
            (a.x - center.x) ** 2 + (a.y - center.y) ** 2 - ((b.x - center.x) ** 2 + (b.y - center.y) ** 2) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, 8)
      assert.deepEqual(
        nearestAdaptiveSites(w, center, 8, undefined, 6000).map((s) => s.id),
        closest.map((s) => s.id),
      )
      found += actual.length
    }
    const queryMs = performance.now() - queryStart
    globalThis.gc?.()
    modes.push({
      mode,
      heapAfterGcMiB: globalThis.gc ? Math.round(process.memoryUsage().heapUsed / 1024 / 1024) : null,
      leaves: mesh.leaves.length,
      interfaces: mesh.interfaces.length,
      fragments: mesh.leaves.reduce((n, l) => n + l.fragments.length, 0),
      remeshMs: Math.round(remeshMs),
      fortyQueriesWithExhaustiveVerificationMs: Math.round(queryMs),
      found,
      landAreaM2: totals[0],
      waterAreaM2: totals[1],
    })
  }
  results.push({
    scale,
    sourceCells: w.cells.length,
    sites: sites.length,
    initializedMs: Math.round(initializedMs),
    sampledHeapMiB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    modes,
  })
  console.log(JSON.stringify(results.at(-1)))
}
const report = {
  date: '2026-10-26',
  topology: 'square-v1',
  sourceSpanMeters: 1024,
  minimumSpanMeters: 128,
  seed: 'Adaptive grid qualification 2026-10-26',
  command: 'node --expose-gc --import tsx tests/qualify-adaptive-grid.ts',
  scope:
    'Offline geometry, conservation and recursive search; timings include no rendering or long-run simulation. Per-mode heap is sampled after explicit GC when enabled, not peak browser memory.',
  results,
}
writeFileSync(
  process.argv[2] ?? 'docs/validation/square-grid-2026-10-26.json',
  JSON.stringify(report, null, 2) + '\n',
)
