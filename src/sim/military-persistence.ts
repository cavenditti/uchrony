import { neighbors } from './hex'
import type { World, RouteLeg } from './types'

export function validateWarfare(
  w: World,
  validateLegs: (from: number, to: number, legs: RouteLeg[]) => void,
) {
  const s = w.warfare,
    fail = (): never => {
      throw new Error('Invalid military, fleet, or supply-line state in this save.')
    }
  const object = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  const number = (v: unknown, max = 1e10) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
  const integer = (v: unknown, max = 1e10) => number(v, max) && Number.isInteger(v)
  const region = (id: number) => integer(id, w.regions.length - 1)
  const water = (id: number) => integer(id, w.cells.length - 1) && w.cells[id].terrain === 'water'
  if (!s) {
    if (w.armies.some((a) => a.operations !== undefined)) fail()
    return
  }
  if (
    !object(s) ||
    s.version !== 1 ||
    !integer(s.revision) ||
    !Array.isArray(s.fleets) ||
    s.fleets.length > 512 ||
    !Array.isArray(s.deliveries) ||
    s.deliveries.length > 20000
  )
    fail()
  const ids = new Set(w.armies.map((a) => a.id))
  for (const f of s.fleets) {
    if (
      !object(f) ||
      !integer(f.id, w.nextArmy - 1) ||
      ids.has(f.id) ||
      typeof f.name !== 'string' ||
      f.name.length > 180 ||
      !integer(f.nation, w.nations.length - 1) ||
      !region(f.region) ||
      !region(f.home) ||
      !water(f.cell) ||
      !(f.target === null || region(f.target)) ||
      !integer(f.soldiers) ||
      !integer(f.casualties) ||
      !number(f.morale, 1) ||
      !number(f.supply, 1) ||
      !number(f.experience, 1) ||
      !number(f.hull, 1) ||
      !integer(f.warships, 12) ||
      !integer(f.transports, 12) ||
      f.warships + f.transports < 1 ||
      !number(f.food) ||
      !number(f.arms) ||
      !['patrol', 'escort', 'blockade', 'transport', 'return'].includes(f.mission) ||
      !Array.isArray(f.course) ||
      f.course.length > w.cells.length ||
      !Array.isArray(f.embarked) ||
      f.embarked.length > 500 ||
      new Set(f.embarked).size !== f.embarked.length
    )
      fail()
    ids.add(f.id)
    let at = f.cell
    for (const next of f.course) {
      if (!water(next) || !neighbors(at, w.width, w.height).includes(next)) fail()
      at = next
    }
    for (const id of f.embarked)
      if (!w.armies.some((a) => a.id === id && a.nation === f.nation && a.operations?.embarkedOn === f.id))
        fail()
  }
  for (const a of w.armies) {
    const o = a.operations
    if (
      o?.march !== undefined &&
      (!Array.isArray(o.march) ||
        o.march.length > w.cells.length * 3 ||
        o.march.some((id) => !integer(id, w.cells.length - 1) || w.cells[id].terrain === 'water'))
    )
      fail()
    if (
      !object(o) ||
      !o ||
      !number(o.food) ||
      !number(o.arms) ||
      !number(o.progress) ||
      !['fatigue', 'cohesion', 'loyalty', 'entrenchment'].every((key) => number(o[key as 'fatigue'], 1)) ||
      !integer(o.isolated) ||
      !integer(o.disorder) ||
      !['march', 'hold', 'entrench'].includes(o.stance) ||
      !['restrained', 'requisition'].includes(o.conduct) ||
      !(o.source === null || region(o.source)) ||
      !Array.isArray(o.line) ||
      o.line.length > w.regions.length ||
      o.line.some((id) => !region(id)) ||
      !(
        o.embarkedOn === null ||
        s.fleets.some((f) => f.id === o.embarkedOn && f.nation === a.nation && f.embarked.includes(a.id))
      )
    )
      fail()
  }
  for (const d of s.deliveries) {
    if (
      !object(d) ||
      !integer(d.army, w.nextArmy - 1) ||
      !region(d.from) ||
      !integer(d.month, w.month) ||
      !number(d.food) ||
      !number(d.arms) ||
      !Array.isArray(d.path) ||
      !d.path.length ||
      d.path.length > w.regions.length ||
      d.path.some((id) => !region(id)) ||
      d.path[0] !== d.from ||
      !Array.isArray(d.legs)
    )
      fail()
    if (d.path.length === 1) {
      if (d.legs.length) fail()
    } else validateLegs(d.from, d.path.at(-1)!, d.legs)
  }
}
