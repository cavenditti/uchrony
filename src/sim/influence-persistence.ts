import type { World } from './types'
export function validateInfluence(w: World) {
  const s = w.influence
  if (s === undefined) return
  const integer = (v: unknown, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
  const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
  const fail = (): never => {
    throw new Error('Invalid cultural or military influence in this save.')
  }
  if (
    !s ||
    !integer(s.updated, w.month) ||
    !integer(s.tradeUpdated, w.month) ||
    !Array.isArray(s.trade) ||
    s.trade.length > w.regions.length * 8 ||
    !Array.isArray(s.local) ||
    s.local.length > w.regions.length * 8 ||
    !Array.isArray(s.military) ||
    s.military.length > w.nations.length * (w.nations.length - 1)
  )
    fail()
  const keys = new Set<string>(),
    counts = new Map<string, number>()
  for (const e of s.trade) {
    if (
      !e ||
      !integer(e.from, w.regions.length - 1) ||
      !integer(e.to, w.regions.length - 1) ||
      e.from === e.to ||
      !unit(e.strength)
    )
      fail()
    const key = `t:${e.from}:${e.to}`,
      group = `t:${e.from}`
    if (keys.has(key) || (counts.get(group) ?? 0) >= 8) fail()
    keys.add(key)
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  for (const e of s.military) {
    if (
      !e ||
      !integer(e.actor, w.nations.length - 1) ||
      !integer(e.observer, w.nations.length - 1) ||
      e.actor === e.observer ||
      !unit(e.fear) ||
      !unit(e.opposition)
    )
      fail()
    const key = `m:${e.observer}:${e.actor}`
    if (keys.has(key)) fail()
    keys.add(key)
  }
  for (const e of s.local) {
    if (
      !e ||
      !integer(e.actor, w.nations.length - 1) ||
      !integer(e.region, w.regions.length - 1) ||
      !unit(e.fear) ||
      !unit(e.opposition)
    )
      fail()
    const key = `l:${e.region}:${e.actor}`,
      group = `l:${e.region}`
    if (keys.has(key) || (counts.get(group) ?? 0) >= 8) fail()
    keys.add(key)
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
}
