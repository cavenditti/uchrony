import { parameterGroup } from './configuration-context'
import { traversableLegs } from './transport'
import { simulationMonths } from './simulation-period'
import type { World } from './types'

/** Trade terminals have a durable history; this is activity memory, not new
 * construction, cargo, transport capacity or a naval facility. */
export const HARBOR_INERTIA = parameterGroup('harbors')

export function advanceHarbors(w: World) {
  const activity = new Map<number, number>()
  for (const route of w.routes) {
    if (!route.legs || route.volume <= 0 || !traversableLegs(w, route.legs)) continue
    for (const leg of route.legs)
      if (leg.mode === 'sea')
        for (const cell of [leg.cells[0], leg.cells.at(-1)!])
          activity.set(cell, (activity.get(cell) ?? 0) + route.volume / simulationMonths())
  }
  const old = new Map((w.harbors ?? []).map((p) => [p.cell, p]))
  const next: NonNullable<World['harbors']> = []
  for (const cell of new Set([...old.keys(), ...activity.keys()])) {
    const prior = old.get(cell),
      volume = activity.get(cell) ?? 0
    const elapsed = prior ? Math.max(0, w.month - prior.updated) : simulationMonths()
    if (prior && !elapsed) {
      next.push(prior)
      continue
    }
    const lastActive = volume > 0 ? w.month : prior!.lastActive
    if (w.month - lastActive >= HARBOR_INERTIA.idleMonths) continue
    const throughput =
      volume > 0
        ? (prior?.throughput ?? 0) +
          (volume - (prior?.throughput ?? 0)) * (1 - (1 - HARBOR_INERTIA.adjustment) ** elapsed)
        : prior!.throughput * 2 ** (-elapsed / HARBOR_INERTIA.halfLifeMonths)
    next.push({ cell, since: prior?.since ?? w.month, updated: w.month, lastActive, throughput })
  }
  w.harbors = next.sort((a, b) => a.cell - b.cell)
}

export function harborVisibility(w: World, harbor: NonNullable<World['harbors']>[number]) {
  const idle = Math.max(0, w.month - harbor.lastActive)
  // Three years without flicker, then two years of gradual abandonment.
  return Math.max(0, Math.min(1, (HARBOR_INERTIA.idleMonths - idle) / 24))
}
