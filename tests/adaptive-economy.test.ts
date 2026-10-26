import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick } from '../src/sim/engine'
import { ensureAdaptiveWorld } from '../src/sim/adaptive-world'
import { ensureFirms } from '../src/sim/firms'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { advanceLandUse } from '../src/sim/land-use'
import { matchCommuters } from '../src/sim/commuting'
import { commuteFlows } from '../src/sim/commute-ledger'
import { balances, auditLedger } from '../src/sim/ledger'
import { physicalStocks } from '../src/sim/goods-accounting'
import { rebaseEndowments } from './fixtures/endowment'

const cash = (w: ReturnType<typeof generateWorld>) => Object.values(balances(w)).reduce((s, x) => s + x, 0)

test('housing requires paid labor and real materials, and capacity appears only on completion', () => {
  const w = generateWorld('Funded housing capacity')
  ensureFirms(w)
  ensureAdaptiveWorld(w)
  beginEconomyMonth(w)
  const home = Object.values(w.adaptive!.sites).find(
      (s) => s.kind === 'residential' && w.localEconomy!.units[s.pool].residents[s.cell] > 1000,
    )!,
    r = w.localEconomy!.units[home.pool],
    sponsor = w.economy!.producers[home.pool],
    household = w.economy!.households[home.pool].laborer
  home.capacity = r.residents[home.cell] * 1.15 - 10
  household.laborForce = 1000
  household.employed = 0
  for (const producer of Object.values(w.economy!.producers)) producer.cash = 0
  r.stocks.timber = r.stocks.stone = 100
  rebaseEndowments(w)
  const capacity = home.capacity,
    goods = physicalStocks(w)
  advanceLandUse(w)
  assert.equal(w.adaptive!.construction!.length, 0, 'unfunded demand cannot create a building')
  assert.equal(home.capacity, capacity)
  assert.deepEqual(physicalStocks(w), goods)
  sponsor.cash = 1
  rebaseEndowments(w)
  const money = cash(w),
    income = household.income
  advanceLandUse(w)
  const project = w.adaptive!.construction!.find((p) => p.site === home.id)!
  assert(project && Math.abs(project.capacity - 10) < 1e-8)
  assert(household.income > income && household.employed > 0)
  assert(Math.abs(cash(w) - money) < 1e-7)
  assert(auditLedger(w) < 1e-7)
  assert(Math.abs(goods.timber - physicalStocks(w).timber - 0.8) < 1e-7)
  assert(Math.abs(goods.stone - physicalStocks(w).stone - 0.5) < 1e-7)
  assert.equal(home.capacity, capacity)
  advanceLandUse(w)
  advanceLandUse(w)
  assert.equal(home.capacity, capacity)
  advanceLandUse(w)
  assert.equal(home.capacity, capacity + project.capacity)
  assert(!w.adaptive!.construction!.some((p) => p.site === home.id))
})

test('a physically inaccessible workplace loses commuter hiring and payroll without losing household funds', () => {
  const source = generateWorld('Commuter accounting')
  tick(source)
  const flow = [...commuteFlows(source)].find((f) => {
    const firm = source.economy!.firms!.find((x) => `firm:${x.id}` === f.workplace)!
    return firm.active && source.localEconomy!.units[f.residence].province !== firm.region
  })!
  assert(flow, 'fixture needs a real commute across geographical regions')
  const chosen = source.economy!.firms!.find((f) => `firm:${f.id}` === flow.workplace)!
  for (const f of source.economy!.firms!) if (f.labor) f.labor.unfilled = f.id === chosen.id ? 50 : 0
  chosen.cash = 100
  rebaseEndowments(source)
  source.adaptive!.commuting = []
  source.adaptive!.commutingRows = []
  source.adaptive!.commuteRoutes = {}
  const open = structuredClone(source),
    closed = structuredClone(source)
  closed.regions[chosen.region].devastation = 1
  const opening = cash(source),
    payroll = chosen.payroll
  matchCommuters(open)
  matchCommuters(closed)
  const openFirm = open.economy!.firms!.find((f) => f.id === chosen.id)!,
    closedFirm = closed.economy!.firms!.find((f) => f.id === chosen.id)!
  assert(openFirm.payroll > payroll)
  assert.equal(closedFirm.payroll, payroll)
  assert.equal([...commuteFlows(closed)].length, 0)
  assert(Math.abs(cash(open) - opening) < 1e-7)
  assert(Math.abs(cash(closed) - opening) < 1e-7)
  assert(auditLedger(open) < 1e-7 && auditLedger(closed) < 1e-7)
})
