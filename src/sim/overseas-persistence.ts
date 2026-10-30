/** Validate projects before account/census readers dereference their records. */
import { STRATA } from './economic-types'
import { activeExpedition, EXPEDITION_STAGES } from './overseas-types'
import { GOODS, type World } from './types'

export function validateOverseas(w: World) {
  const state = w.overseas
  if (state === undefined) return
  const fail = () => {
    throw new Error('Invalid overseas expedition state in this save.')
  }
  const integer = (n: unknown, max = 1e10) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max
  const money = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e14
  if (
    !state ||
    !integer(state.nextId) ||
    !Array.isArray(state.expeditions) ||
    state.expeditions.length > 2048 ||
    !Array.isArray(state.footholds) ||
    state.footholds.length > 2048
  )
    fail()
  const ids = new Set<number>(),
    ships = new Set<number>()
  for (const e of state.expeditions) {
    if (
      !e ||
      !integer(e.id, state.nextId - 1) ||
      ids.has(e.id) ||
      !integer(e.nation, w.nations.length - 1) ||
      !integer(e.cell, w.cells.length - 1) ||
      !integer(e.source) ||
      !w.localEconomy?.units[e.source] ||
      !integer(e.departure, w.regions.length - 1) ||
      !integer(e.arrival, w.regions.length - 1) ||
      (e.returnPort !== undefined && !integer(e.returnPort, w.regions.length - 1)) ||
      w.cells[e.cell].region !== e.arrival ||
      !integer(e.started, w.month) ||
      !Number.isSafeInteger(e.updated) ||
      e.updated < -1 ||
      e.updated > w.month ||
      !EXPEDITION_STAGES.includes(e.stage) ||
      typeof e.obstacle !== 'string' ||
      e.obstacle.length > 1000 ||
      !integer(e.people, 1e7) ||
      !integer(e.settlers, 1e7) ||
      e.people > e.settlers ||
      !money(e.wages) ||
      !Array.isArray(e.communities) ||
      !e.goods ||
      GOODS.some((g) => !money(e.goods[g])) ||
      !e.accounts ||
      [...STRATA, 'construction'].some((s) => !money(e.accounts[s as keyof typeof e.accounts]?.cash))
    )
      fail()
    for (const flow of [e.departed, e.arrived])
      if (
        flow !== undefined &&
        (!flow ||
          !integer(flow.month, w.month) ||
          flow.month < e.started ||
          !integer(flow.people, e.settlers))
      )
        fail()
    ids.add(e.id)
    if (e.fleet !== null) {
      if (
        !integer(e.fleet, w.nextArmy - 1) ||
        ships.has(e.fleet) ||
        !w.warfare?.fleets.some((f) => f.id === e.fleet && f.nation === e.nation) ||
        w.armies.some((a) => a.operations?.journey?.fleet === e.fleet)
      )
        fail()
      ships.add(e.fleet)
    }
    if (
      !activeExpedition(e) &&
      (e.people || e.fleet !== null || e.communities.length || GOODS.some((g) => e.goods[g] > 0))
    )
      fail()
    if (e.stage === 'assembling' && (e.people || e.communities.length || GOODS.some((g) => e.goods[g] > 0)))
      fail()
  }
  const sites = new Set<number>()
  for (const f of state.footholds) {
    if (
      !f ||
      !integer(f.nation, w.nations.length - 1) ||
      !integer(f.cell, w.cells.length - 1) ||
      !integer(f.since, w.month) ||
      !state.expeditions.some(
        (e) => e.id === f.expedition && e.cell === f.cell && e.nation === f.nation && e.stage === 'settled',
      ) ||
      sites.has(f.cell)
    )
      fail()
    sites.add(f.cell)
  }
}
