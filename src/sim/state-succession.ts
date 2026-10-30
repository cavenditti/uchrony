/** One legal estate handover for mergers and complete conquest. Private property
 * remains private; the successor inherits public cash, claims and obligations together. */
import { allForces } from './forces'
import { transferInstitutionMembership } from './institutions'
import { governmentAccount, publicTransfer, transferDebt } from './ledger'
import { economicRegions, provinceId } from './local-units'
import { returnArmyPeople } from './population'
import { dependencyOf } from './state-dependencies'
import { isMonarchy, synchronizeUnionRulers } from './dynasties'
import type { World } from './types'

/** Remove military formations only after returning their people and goods to their actual location. */
export function demobilizeState(w: World, nation: number) {
  for (const force of allForces(w))
    if (force.nation === nation) returnArmyPeople(w, force, w.regions[force.region])
  w.armies = w.armies.filter((a) => a.soldiers > 0)
  if (w.warfare) {
    w.warfare.fleets = w.warfare.fleets.filter((f) => f.soldiers > 0)
    const armies = new Set(w.armies.map((a) => a.id))
    for (const f of w.warfare.fleets) f.embarked = f.embarked.filter((id) => armies.has(id))
    w.warfare.revision++
  }
}

/** Transfer every public asset after the predecessor's final province has changed hands. */
export function settleStateEstate(w: World, from: number, to: number, forces: 'inherit' | 'demobilize') {
  if (from === to || !w.nations[to] || w.regions.some((r) => r.nation === from))
    throw new Error('A successor can settle only a state that has lost all territory.')
  if (forces === 'inherit') {
    for (const force of allForces(w)) if (force.nation === from) force.nation = to
  } else demobilizeState(w, from)
  publicTransfer(w, from, to, w.nations[from].treasury, 'state succession')
  transferDebt(w, from, to)
  const source = governmentAccount(from),
    target = governmentAccount(to)
  const owners = [
    ...(w.economy?.firms ?? []).flatMap((f) => (f.owners ? [f.owners] : [])),
    ...(w.economy?.banking?.banks ?? []).map((b) => b.owners),
  ]
  for (const shares of owners)
    if (Object.hasOwn(shares, source)) {
      shares[target] = (shares[target] ?? 0) + shares[source]
      delete shares[source]
    }
  transferInstitutionMembership(w, from, to)
  // Preserve the flat chain of authority even when a subject conquers a superior.
  // Personal crowns cannot pass to a republic through an ordinary public estate.
  if (w.dependencies) {
    w.dependencies = w.dependencies.filter(
      (d) => d.junior !== from && !(d.senior === from && d.junior === to),
    )
    const senior = dependencyOf(w, to)?.senior ?? to
    w.dependencies = w.dependencies
      .map((d) => (d.senior === from ? { ...d, senior } : d))
      .filter((d) => d.senior !== d.junior && (d.kind !== 'personal-union' || isMonarchy(w, d.senior)))
  }
  if (w.dynasties) {
    w.dynasties.crowns = w.dynasties.crowns.filter((c) => c.nation !== from)
    w.dynasties.marriages = w.dynasties.marriages.filter((m) => m.a !== from && m.b !== from)
  }
  synchronizeUnionRulers(w)
  const former = w.nations[from]
  former.extinct = w.month
  former.ai = false
  former.population = former.manpower = 0
  for (const key of Object.keys(former.budget) as (keyof typeof former.budget)[]) former.budget[key] = 0
  for (const rel of w.relations)
    if (rel.a === from || rel.b === from) {
      rel.treaty = 'neutral'
      rel.warExhaustion = 0
      rel.since = w.month
    }
}

/** Batch legal transfer without rebuilding the jurisdiction mesh once per province. */
export function transferStateTerritory(w: World, from: number, to: number, conquered: boolean) {
  const ids = new Set(w.regions.filter((r) => r.nation === from).map((r) => r.id))
  for (const r of w.regions)
    if (ids.has(r.id)) {
      r.nation = to
      delete r.control
      if (conquered) {
        r.occupation = { former: from, since: w.month, resistance: 0.75, settled: 0 }
        r.unrest = Math.max(65, r.unrest)
      } else delete r.occupation
      for (const group of r.communities ?? []) group.host = to
    }
  for (const unit of economicRegions(w))
    if (ids.has(provinceId(unit))) {
      unit.nation = to
      for (const group of unit.communities ?? []) group.host = to
    }
}
