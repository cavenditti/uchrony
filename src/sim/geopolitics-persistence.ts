import type { World } from './types'

export function validateGeopolitics(w: World) {
  const integer = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
  const nation = (v: unknown) => integer(v, 0, w.nations.length - 1)
  const fail = (): never => {
    throw new Error('Invalid strategic or occupation state in this save.')
  }
  for (const r of w.regions) {
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
