import { movementNeighbors, stepDistance } from './grid'
import { MAX_ARMIES } from './military-limits'
import { integerAtMost, numberAtMost, recordValue, validationFailure } from './persistence-primitives'
import { GOODS, type RouteLeg, type World } from './types'

export function validateWarfare(
  w: World,
  validateLegs: (from: number, to: number, legs: RouteLeg[]) => void,
) {
  const s = w.warfare,
    fail = validationFailure(
      'Invalid military, fleet, or supply-line state in this save: ',
      '.',
      'unrecognized military record',
    )
  const object = recordValue
  const number = numberAtMost(1e10)
  const integer = integerAtMost(1e10, false)
  const region = (id: number) => integer(id, w.regions.length - 1)
  const water = (id: number) => integer(id, w.cells.length - 1) && w.cells[id].terrain === 'water'
  const visit = (value: { host: number; months: number } | undefined) =>
    value === undefined ||
    (object(value) && integer(value.host, w.nations.length - 1) && integer(value.months))
  if (!s) {
    if (w.armies.some((a) => a.operations !== undefined)) fail('missing warfare ledger')
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
      !['patrol', 'escort', 'blockade', 'raid', 'transport', 'return'].includes(f.mission) ||
      !visit(f.foreignStay) ||
      !Array.isArray(f.course) ||
      f.course.length > w.cells.length ||
      !Array.isArray(f.embarked) ||
      f.embarked.length > MAX_ARMIES ||
      new Set(f.embarked).size !== f.embarked.length
    )
      fail(`fleet ${f.id} profile (crew=${f.soldiers}, food=${f.food}, arms=${f.arms}, hull=${f.hull})`)
    ids.add(f.id)
    let at = f.cell
    for (const next of f.course) {
      if (!water(next) || !movementNeighbors(w.cells, at, w.width, w.height).includes(next))
        fail(`fleet ${f.id} has a noncontiguous course at ${at}→${next}`)
      at = next
    }
    if (
      f.sailingProgress !== undefined &&
      (!number(f.sailingProgress, Math.SQRT2) ||
        (!f.course.length && f.sailingProgress !== 0) ||
        (f.course.length && f.sailingProgress >= stepDistance(w.cells[f.cell], w.cells[f.course[0]])))
    )
      fail(`fleet ${f.id} has invalid sailing progress`)
    for (const id of f.embarked)
      if (!w.armies.some((a) => a.id === id && a.nation === f.nation && a.operations?.embarkedOn === f.id))
        fail(`fleet ${f.id} passenger ${id} disagrees with its embarkation record`)
  }
  const reservations = new Set<number>()
  for (const a of w.armies) {
    if (
      (a.establishment !== undefined && (!integer(a.establishment, 1e7) || a.establishment < 1)) ||
      (a.replacements !== undefined && !integer(a.replacements, 1e7))
    )
      fail(`army ${a.id} establishment or replacement count`)
    const o = a.operations
    const j = o?.journey
    if (j !== undefined) {
      if (
        !object(j) ||
        !region(j.destination) ||
        !region(j.departure) ||
        !region(j.arrival) ||
        !integer(j.started, w.month) ||
        !['assembling', 'boarding', 'sailing', 'landing', 'inland', 'waiting'].includes(j.stage) ||
        typeof j.obstacle !== 'string' ||
        j.obstacle.length > 1000 ||
        !(
          j.fleet === null ||
          (integer(j.fleet, w.nextArmy - 1) &&
            !reservations.has(j.fleet) &&
            s.fleets.some((f) => f.id === j.fleet && f.nation === a.nation))
        )
      )
        fail(`army ${a.id} sea journey`)
      if (j.fleet !== null) reservations.add(j.fleet)
    }
    if (!object(o)) fail(`army ${a.id} is missing its operations record`)
    if (
      o?.march !== undefined &&
      (!Array.isArray(o.march) ||
        o.march.length > w.cells.length * 3 ||
        o.march.some((id) => !integer(id, w.cells.length - 1) || w.cells[id].terrain === 'water'))
    )
      fail(`army ${a.id} march geometry`)
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
      !['restrained', 'requisition', 'pillage', 'raid', 'raze'].includes(o.conduct) ||
      !visit(o.foreignStay) ||
      !(o.source === null || region(o.source)) ||
      !Array.isArray(o.line) ||
      o.line.length > w.regions.length ||
      o.line.some((id) => !region(id)) ||
      !(
        o.embarkedOn === null ||
        s.fleets.some((f) => f.id === o.embarkedOn && f.nation === a.nation && f.embarked.includes(a.id))
      )
    )
      fail(
        `army ${a.id} operations (food=${o?.food}, arms=${o?.arms}, progress=${o?.progress}, fatigue=${o?.fatigue}, cohesion=${o?.cohesion}, loyalty=${o?.loyalty}, entrenchment=${o?.entrenchment}, embarked=${o?.embarkedOn}, source=${o?.source}, line=${o?.line?.length})`,
      )
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
      fail(`delivery to army ${d.army} from ${d.from}: food=${d.food}, arms=${d.arms}, path=${d.path}`)
    if (d.path.length === 1) {
      if (d.legs.length) fail()
    } else validateLegs(d.from, d.path.at(-1)!, d.legs)
  }
  if (s.raids !== undefined) {
    if (!Array.isArray(s.raids) || s.raids.length > 50000) fail('route raids')
    for (const raid of s.raids)
      if (
        !object(raid) ||
        !integer(raid.month, w.month) ||
        !integer(raid.force, w.nextArmy - 1) ||
        !integer(raid.nation, w.nations.length - 1) ||
        !integer(raid.victim, w.nations.length - 1) ||
        !integer(raid.from) ||
        !integer(raid.to) ||
        !GOODS.includes(raid.good) ||
        !number(raid.captured) ||
        !number(raid.destroyed)
      )
        fail('route raid quantities')
  }
}
