import {
  integerValidator,
  numberValidator,
  validationFailure,
  worldValidators,
} from './persistence-primitives'
import type { World } from './types'
import { validateCabinet } from './cabinet-persistence'

export function validateGeopolitics(w: World) {
  const integer = integerValidator(0, Infinity, false)
  const unit = numberValidator(0, 1)
  const nation = worldValidators(w).nationId
  const fail = validationFailure('Invalid strategic or occupation state in this save.')
  for (const r of w.regions) {
    const c = r.control
    if (
      c !== undefined &&
      (!c ||
        !nation(c.nation) ||
        c.nation === r.nation ||
        !integer(c.since, 0, w.month) ||
        !integer(c.lastPillage, -1, w.month) ||
        typeof c.spoils !== 'number' ||
        !Number.isFinite(c.spoils) ||
        c.spoils < 0)
    )
      fail()
    const raid = c?.destruction
    if (
      raid !== undefined &&
      (!raid ||
        !integer(raid.month, 0, w.month) ||
        ['housing', 'capital', 'buildings', 'roads'].some((key) => {
          const value = raid[key as 'housing']
          return typeof value !== 'number' || !Number.isFinite(value) || value < 0
        }) ||
        !integer(raid.buildings) ||
        !integer(raid.roads))
    )
      fail()
    const o = r.occupation
    if (
      o !== undefined &&
      (!o ||
        !nation(o.former) ||
        o.former === r.nation ||
        !integer(o.since, 0, w.month) ||
        !unit(o.resistance) ||
        !integer(o.settled, 0, w.month))
    )
      fail()
  }
  for (const n of w.nations) {
    validateCabinet(w, n)
    const p = n.development
    if (
      p !== undefined &&
      (!p ||
        !['agriculture', 'industry', 'logistics', 'medicine', 'military', 'governance'].includes(p.focus) ||
        !integer(p.started, 0, w.month) ||
        p.review !== p.started + 60 ||
        ['baselineOutput', 'targetOutput', 'currentOutput', 'revenue', 'appropriation', 'borrowed'].some(
          (k) => {
            const v = p[k as keyof typeof p]
            return typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e14
          },
        ))
    )
      fail()
  }
  const s = w.geopolitics
  if (s === undefined) return
  if (
    !s ||
    !integer(s.rng, 0, 4294967295) ||
    !Array.isArray(s.owners) ||
    s.owners.length !== w.regions.length ||
    s.owners.some((id) => id !== -1 && !nation(id)) ||
    !Array.isArray(s.countries) ||
    s.countries.length > w.nations.length ||
    !Array.isArray(s.observedWars) ||
    s.observedWars.length > 512 ||
    s.observedWars.some((key) => typeof key !== 'string' || !/^\d+:\d+:\d+$/.test(key) || key.length > 40)
  )
    fail()
  const ids = new Set<number>()
  for (const c of s.countries) {
    if (
      !c ||
      !nation(c.nation) ||
      ids.has(c.nation) ||
      !integer(c.lastInitiative, -120, w.month) ||
      !integer(c.lastMobilized, -120, w.month) ||
      !unit(c.threat) ||
      !integer(c.initialTerritory, 0, w.regions.length) ||
      !integer(c.lastTerritory, 0, w.regions.length) ||
      typeof c.expansion !== 'number' ||
      !Number.isFinite(c.expansion) ||
      c.expansion < 0 ||
      c.expansion > 1e10
    )
      fail()
    ids.add(c.nation)
  }
}
