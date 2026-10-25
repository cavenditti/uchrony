import { createHash } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld } from '../src/sim/generate'
import { tick, applyCommand } from '../src/sim/engine'
import {
  ensureDistrictEconomy,
  remeshDistricts,
  extractDistrictResource,
  refreshEndowment,
  archiveRetiredDistricts,
} from '../src/sim/districts'
import { evolveCities } from '../src/sim/cities'
import { buildSpatial, refreshSpatial, type SpatialDistrict } from '../src/sim/spatial'
import { GOODS, population, type World } from '../src/sim/types'
import { balances, borrow, householdAccount, producerAccount, auditLedger } from '../src/sim/ledger'
import { physicalStocks } from '../src/sim/goods-accounting'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { auditBanks } from '../src/sim/banking'
import { auditNationalAccounts } from '../src/sim/national-accounts'
import { tradeDistricts, districtNetwork } from '../src/sim/district-transport'
import { neighbors } from '../src/sim/hex'
import { ensureFirms, firmCapacity, regionalFirms } from '../src/sim/firms'
import { viewSnapshot } from '../src/sim/view-snapshot'
import { relocateHouseholdClaims } from '../src/sim/district-finance'
import { beginEconomyMonth } from '../src/sim/macroeconomy'
import { produce } from '../src/sim/economy'

const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const near = (a: number, b: number) =>
  assert(Math.abs(a - b) < 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} differs from ${b}`)
function assets(w: World) {
  const ages: Record<string, number> = {}
  for (const r of w.regions)
    for (const g of r.communities ?? [])
      for (const [born, f, m] of g.ageCohorts ?? []) {
        const key = `${g.culture}:${g.language}:${g.belief}:${g.movement}:${g.allegiance}:${g.stratum}:${born}`
        ages[key + ':f'] = (ages[key + ':f'] ?? 0) + f
        ages[key + ':m'] = (ages[key + ':m'] ?? 0) + m
      }
  const claims: Record<string, number> = {}
  for (const l of w.economy!.credit.loans) {
    const key = `${l.bank}:${l.originated}:${l.rate}:${l.arrears}`
    claims[key] = (claims[key] ?? 0) + l.principal
  }
  return {
    ages,
    claims,
    stocks: physicalStocks(w),
    money: Object.values(balances(w)).reduce((a, b) => a + b, 0),
    capital:
      Object.values(w.economy!.producers).reduce(
        (a, b) => a + b.capital + b.projects.reduce((s, p) => s + p.capital, 0),
        0,
      ) +
      (w.economy!.firms ?? []).reduce(
        (a, b) => a + b.capital + b.projects.reduce((s, p) => s + p.capital, 0),
        0,
      ),
    projectCost:
      Object.values(w.economy!.producers).reduce(
        (a, b) => a + b.projects.reduce((s, p) => s + p.cost, 0),
        0,
      ) + (w.economy!.firms ?? []).reduce((a, b) => a + b.projects.reduce((s, p) => s + p.cost, 0), 0),
    reserves: JSON.stringify(w.localEconomy?.reserves),
    firms: (w.economy!.firms ?? []).map((f) => ({
      id: f.id,
      cell: f.cell,
      cash: f.cash,
      stocks: { ...f.stocks },
      capital: f.capital,
      projects: structuredClone(f.projects),
    })),
    deposits: w.economy!.banking!.banks.reduce((s, b) => s + b.deposits, 0),
    equity: w.economy!.banking!.banks.reduce((s, b) => s + b.equity, 0),
    gdp: w.economy!.accounts?.world.productionGDP ?? 0,
    holdings: w.economy!.accounts?.world.holdingGains ?? 0,
  }
}
function conserved(a: ReturnType<typeof assets>, b: ReturnType<typeof assets>) {
  assert.equal(digest(Object.entries(b.ages).sort()), digest(Object.entries(a.ages).sort()))
  for (const key of new Set([...Object.keys(a.claims), ...Object.keys(b.claims)]))
    near(a.claims[key] ?? 0, b.claims[key] ?? 0)
  for (const g of GOODS) near(a.stocks[g], b.stocks[g])
  for (const key of ['money', 'capital', 'projectCost', 'deposits', 'equity', 'gdp', 'holdings'] as const)
    near(a[key], b[key])
  assert.equal(b.reserves, a.reserves)
  assert.deepEqual(b.firms, a.firms)
}
function coarse(w: World): SpatialDistrict[] {
  const span = 2 ** Math.ceil(Math.log2(Math.max(w.width, w.height)))
  return w.regions.map((r) => ({
    id: `coarse:${r.id}`,
    region: r.id,
    node: 'r',
    span,
    cells: [...r.cells],
    population: population(r),
    urbanPopulation: 0,
    industrialEmployment: 0,
    capital: r.industry,
  }))
}

test('district conversion preserves every dated sex cohort, deposit, debt and physical good', () => {
  const w = generateWorld('Local conversion')
  borrow(w, producerAccount(0), 17, 20)
  borrow(w, householdAccount(0, 'laborer'), 11, 20)
  const before = assets(w)
  ensureDistrictEconomy(w)
  evolveCities(w, true)
  refreshSpatial(w)
  const after = assets(w)
  // Resource stocks are newly described natural endowments, not manufactured goods.
  before.reserves = after.reserves
  conserved(before, after)
  assert(w.localEconomy!.active.length > w.regions.length)
  for (const r of w.regions)
    assert.equal(
      w
        .localEconomy!.active.filter((id) => w.localEconomy!.units[id].province === r.id)
        .reduce((sum, id) => sum + population(w.localEconomy!.units[id]), 0),
      population(r),
    )
  validateWorld(w)
  auditLedger(w)
  auditBanks(w)
})

test('repeated split/merge cycles preserve claims, equipment, goods, money and GDP with operating firms', () => {
  const w = generateWorld('Local remeshing')
  tick(w)
  const p = w.localEconomy!.active.find((id) => id >= w.regions.length)!
  borrow(w, producerAccount(p), 19, 1000)
  w.economy!.producers[p].projects.push({ remaining: 5, capital: 0.11, cost: 7 })
  const fine = buildSpatial(w).districts
  const before = assets(w)
  for (let i = 0; i < 3; i++) {
    remeshDistricts(w, coarse(w))
    refreshSpatial(w)
    conserved(before, assets(w))
    auditLedger(w)
    auditBanks(w)
    auditNationalAccounts(w)
    validateWorld(w)
    remeshDistricts(w, fine)
    ensureFirms(w)
    refreshSpatial(w)
    conserved(before, assets(w))
    auditLedger(w)
    auditBanks(w)
    auditNationalAccounts(w)
    validateWorld(w)
  }
})

test('local resource availability limits output and depletion survives remeshing', () => {
  const w = generateWorld('Local extraction')
  ensureDistrictEconomy(w)
  ensureFirms(w)
  const units = w.localEconomy!.active.map((id) => w.localEconomy!.units[id])
  const rich = units.find((u) => u.deposits.iron > 0)!,
    poor = units.find((u) => u.deposits.iron === 0)!
  const f = regionalFirms(w, rich.id)[0]
  f.employment = 1000
  const mix = { food: 0, timber: 0, stone: 0, iron: 1, coal: 0, tools: 0, textiles: 0, arms: 0 }
  assert(firmCapacity(w, rich, f, 1, mix).q.iron > 0)
  assert.equal(firmCapacity(w, poor, f, 1, mix).q.iron, 0)
  const stock = rich.cells.reduce((sum, c) => sum + w.localEconomy!.reserves[c].iron, 0)
  near(extractDistrictResource(w, rich, 'iron', stock * 2), stock)
  refreshEndowment(w, rich, false)
  assert.equal(firmCapacity(w, rich, f, 1, mix).q.iron, 0)
  const remaining = JSON.stringify(w.localEconomy!.reserves)
  remeshDistricts(w, coarse(w))
  assert.equal(JSON.stringify(w.localEconomy!.reserves), remaining)
})

test('district transport uses contiguous physical paths and conserves goods during real local trade', () => {
  const w = generateWorld('Local transport')
  ensureDistrictEconomy(w)
  evolveCities(w, true)
  w.month++
  beginEconomyMonth(w)
  produce(w)
  const network = districtNetwork(w),
    { graph, profile } = network
  const before = physicalStocks(w)
  tradeDistricts(w, network)
  const after = physicalStocks(w)
  for (const g of GOODS) near(before[g], after[g])
  assert([...graph.values()].some((links) => links.length > 1))
  assert(
    w.localEconomy!.shipments.some(
      (s) => w.localEconomy!.units[s.from].province === w.localEconomy!.units[s.to].province,
    ),
  )
  for (const s of w.localEconomy!.shipments) {
    assert(s.quantity > 0)
    assert(s.freight > 0)
    for (const leg of s.legs)
      for (let i = 1; i < leg.cells.length; i++)
        assert(neighbors(leg.cells[i - 1], w.width, w.height).includes(leg.cells[i]))
  }
  const usage = new Map<number, number>()
  for (const s of w.localEconomy!.shipments)
    for (const leg of s.legs)
      for (let i = 1; i < leg.cells.length; i++) {
        const id = profile.index(leg.cells[i - 1], leg.cells[i])
        usage.set(id, (usage.get(id) ?? 0) + s.quantity)
      }
  assert(usage.size > 0)
  for (const [edge, quantity] of usage)
    assert(quantity <= profile.capacity[edge] + 1e-7, `Shared segment ${edge} exceeded capacity`)
  auditLedger(w)
  auditBanks(w)
})

test('city footprints join across district borders without transferring people or assets, retaining names', () => {
  const w = generateWorld('Cities joining')
  ensureDistrictEconomy(w)
  const local = w.localEconomy!
  const a = local.active.map((id) => local.units[id]).find((u) => u.neighbors.length && population(u) > 2000)!
  const b = local.units[a.neighbors.find((id) => population(local.units[id]) > 2000) ?? a.neighbors[0]]
  const aCell = a.cells.find((c) => neighbors(c, w.width, w.height).some((n) => b.cells.includes(n)))!
  const bCell = neighbors(aCell, w.width, w.height).find((n) => b.cells.includes(n))!
  for (const u of [a, b]) for (const c of u.cells) u.residents[c] = 0
  a.residents[aCell] = population(a)
  b.residents[bCell] = population(b)
  for (const key of Object.keys(local.built)) local.built[+key] = 0
  local.built[aCell] = local.built[bCell] = 0.8
  local.cities = [
    {
      id: 0,
      name: 'Old Ford',
      aliases: [],
      founded: 0,
      nucleus: aCell,
      cells: [aCell],
      population: population(a),
      kind: 'town',
      parents: [],
      lastNameChange: 0,
    },
    {
      id: 1,
      name: 'New Bank',
      aliases: [],
      founded: 0,
      nucleus: bCell,
      cells: [bCell],
      population: population(b),
      kind: 'town',
      parents: [],
      lastNameChange: 0,
    },
  ]
  local.nextCity = 2
  const before = assets(w)
  evolveCities(w, true)
  const merged = local.cities.find(
    (c) => c.absorbedBy === undefined && c.cells.includes(aCell) && c.cells.includes(bCell),
  )!
  assert(merged)
  assert(merged.aliases.includes('New Bank') || merged.aliases.includes('Old Ford'))
  assert.equal(local.cities.filter((c) => c.absorbedBy !== undefined).length, 1)
  const identity = merged.id,
    name = merged.name
  merged.cells = []
  merged.population = 0
  evolveCities(w, true)
  assert.equal(local.cities.find((c) => c.absorbedBy === undefined && c.cells.includes(aCell))!.id, identity)
  assert.equal(local.cities.find((c) => c.id === identity)!.name, name)
  conserved(before, assets(w))
})

test('district state survives exact save/reload continuation and population accounting', () => {
  const w = generateWorld('Local continuation')
  for (let i = 0; i < 6; i++) {
    const before = w.totals.population
    tick(w)
    assert.equal(w.totals.population, before + w.totals.births - w.totals.deaths)
    assert.equal(
      w.regions.reduce((sum, r) => sum + r.migration, 0),
      0,
    )
    validateWorld(w)
  }
  const restored = restoreWorld(JSON.parse(JSON.stringify(w)))
  tick(w)
  tick(restored)
  assert.equal(digest(restored), digest(w))
  assert(viewSnapshot(w).localEconomy)
})

test('provincial interventions use the real depot and keep local populations synchronized', () => {
  const w = generateWorld('Local policy bridge')
  tick(w)
  const r = w.regions[0],
    local = w.localEconomy!,
    outlying = local.active.filter((id) => local.units[id].province === r.id && id !== r.id)
  const remote = outlying.map((id) => local.units[id].stocks.food)
  applyCommand(w, { type: 'disaster', region: 0, disaster: 'abundance' })
  assert.deepEqual(
    outlying.map((id) => local.units[id].stocks.food),
    remote,
  )
  assert.equal(r.stocks.food, local.units[0].stocks.food)
  validateWorld(w)
})

test('local save validation rejects duplicated people, stocks, geography, ownership and claims', () => {
  const w = generateWorld('Local corruption')
  tick(w)
  for (const mutate of [
    (x: World) => x.localEconomy!.units[x.localEconomy!.active[0]].population.adults++,
    (x: World) => {
      x.regions[0].communities![0].locality = 1e6
    },
    (x: World) => {
      x.localEconomy!.units[0].stocks.food = -1
    },
    (x: World) => {
      x.localEconomy!.units[0].residents[x.localEconomy!.units[0].cells[0]]++
    },
    (x: World) => {
      x.localEconomy!.active.push(x.localEconomy!.active[0])
    },
    (x: World) => {
      x.economy!.firms![0].cell = -1
    },
  ]) {
    const copy = structuredClone(w)
    mutate(copy)
    assert.throws(() => validateWorld(copy))
  }
  const before = JSON.stringify(w)
  validateWorld(w)
  assert.equal(JSON.stringify(w), before)
})

test('simultaneous migration carries original debts and beneficial ownership without migrating arrivals again', () => {
  const w = generateWorld('Mobile household claims')
  ensureDistrictEconomy(w)
  ensureFirms(w)
  const [a, b] = w.localEconomy!.active,
    from = householdAccount(a, 'owner'),
    to = householdAccount(b, 'owner')
  const loan = borrow(w, from, 20, 1000)
  assert(loan > 0)
  const e = w.economy!,
    original = e.credit.loans.find((l) => l.borrower === from)!
  const contract = original.contract ?? original.id,
    principal = original.principal
  const f = regionalFirms(w, a)[0]
  f.owners = { [from]: 1 }
  const before = Object.values(balances(w)).reduce((a, b) => a + b, 0)
  relocateHouseholdClaims(w, [
    { from, to, fraction: 0.4 },
    { from: to, to: from, fraction: 0.25 },
  ])
  const portions = e.credit.loans.filter((l) => (l.contract ?? l.id) === contract)
  near(
    portions.filter((l) => l.borrower === from).reduce((s, l) => s + l.principal, 0),
    principal * 0.6,
  )
  near(
    portions.filter((l) => l.borrower === to).reduce((s, l) => s + l.principal, 0),
    principal * 0.4,
  )
  for (const l of portions) assert.equal(l.rate, original.rate)
  near(f.owners[from], 0.6)
  near(f.owners[to], 0.4)
  near(
    Object.values(balances(w)).reduce((a, b) => a + b, 0),
    before,
  )
  auditBanks(w)
  auditLedger(w)
})

test('empty retired accounts archive only after every asset and claim has transferred', () => {
  const w = generateWorld('District archive')
  tick(w)
  remeshDistricts(w, coarse(w))
  const before = assets(w)
  archiveRetiredDistricts(w)
  assert(Object.keys(w.localEconomy!.archive ?? {}).length > 0)
  conserved(before, assets(w))
  auditLedger(w)
  auditBanks(w)
  for (const key of Object.keys(w.localEconomy!.archive!)) {
    assert.equal(w.economy!.producers[+key], undefined)
    assert.equal(w.economy!.households[+key], undefined)
  }
})

test('demobilization and recruitment conserve dated people across immediate district rollups', async () => {
  const { releaseSoldiers, returnArmyPeople, takeCivilianAdults, removeCivilianAdults, communitySize } =
    await import('../src/sim/population')
  const { allForces } = await import('../src/sim/forces')
  const { aggregateDistricts } = await import('../src/sim/districts')
  const w = generateWorld('district-demobilization')
  ensureDistrictEconomy(w)
  const army = w.armies[0],
    destination = w.regions.find((r) => r.nation !== army.nation)!
  const census = () => {
    const dated: Record<string, number> = {}
    for (const holder of [...w.regions, ...allForces(w)])
      for (const group of holder.communities!)
        for (const [born, female, male] of group.ageCohorts!) {
          dated[`${born}:f`] = (dated[`${born}:f`] ?? 0) + female
          dated[`${born}:m`] = (dated[`${born}:m`] ?? 0) + male
        }
    return dated
  }
  const before = census()
  // Returning to a foreign province creates new community records, rather than merging existing ones.
  releaseSoldiers(w, army, destination, 108)
  aggregateDistricts(w)
  assert.deepEqual(census(), before)
  returnArmyPeople(w, army, destination)
  aggregateDistricts(w)
  assert.deepEqual(census(), before)
  const recruits = takeCivilianAdults(w, destination, 108)
  army.communities = recruits
  army.soldiers = recruits.reduce((sum, group) => sum + communitySize(group), 0)
  aggregateDistricts(w)
  assert.deepEqual(census(), before)
  for (const province of w.regions)
    assert.equal(
      w
        .localEconomy!.active.filter((id) => w.localEconomy!.units[id].province === province.id)
        .reduce((sum, id) => sum + population(w.localEconomy!.units[id]), 0),
      population(province),
    )
  const deaths = destination.deaths,
    residents = population(destination)
  removeCivilianAdults(w, destination, 23)
  aggregateDistricts(w)
  assert.equal(population(destination), residents - 23)
  assert.equal(destination.deaths, deaths + 23)
})

test('blocked freight cannot originate loans for undeliverable goods', async () => {
  const { transfer, balance } = await import('../src/sim/ledger')
  const w = generateWorld('Blocked local freight')
  ensureDistrictEconomy(w)
  w.month++
  beginEconomyMonth(w)
  produce(w)
  for (const id of w.localEconomy!.active)
    transfer(
      w,
      producerAccount(id),
      householdAccount(id, 'owner'),
      balance(w, producerAccount(id)),
      'fixture withdrawal',
    )
  const network = districtNetwork(w)
  assert([...network.graph.values()].some((links) => links.length))
  network.profile.capacity.fill(0)
  const created = w.economy!.banking!.created,
    claims = JSON.stringify(w.economy!.credit.loans),
    stocks = physicalStocks(w)
  tradeDistricts(w, network)
  assert.equal(w.localEconomy!.shipments.length, 0)
  assert.equal(w.economy!.banking!.created, created)
  assert.equal(JSON.stringify(w.economy!.credit.loans), claims)
  for (const good of GOODS) near(physicalStocks(w)[good], stocks[good])
  auditLedger(w)
  auditBanks(w)
})

test('dispersed farming density stays rural while concentrated neighboring districts form a city', async () => {
  const { aggregateDistricts } = await import('../src/sim/districts')
  const w = generateWorld('Rural land use')
  ensureDistrictEconomy(w)
  remeshDistricts(
    w,
    coarse(w).flatMap((d) =>
      d.cells.map((cell) => ({
        ...d,
        id: `cell:${cell}`,
        node: `cell:${cell}`,
        span: 1,
        cells: [cell],
      })),
    ),
  )
  const local = w.localEconomy!
  local.cities = []
  w.economy!.firms = []
  for (const id of local.active) {
    const u = local.units[id]
    const template = u.communities![0] ?? w.regions[u.province].communities![0]
    u.communities = [
      {
        ...structuredClone(template),
        locality: id,
        population: { children: 750, adults: 1800, elders: 450 },
        ageCohorts: [
          [-120, 375, 375],
          [-360, 900, 900],
          [-900, 225, 225],
        ],
      },
    ]
    local.built[u.center] = 0
    u.residents = { [u.center]: 3000 }
  }
  aggregateDistricts(w)
  for (let month = 0; month < 120; month++) evolveCities(w)
  assert.equal(local.cities.filter((c) => c.population).length, 0)
  assert(Object.values(local.built).every((fraction) => fraction < 0.12))
  const a = local.units[local.active.find((id) => local.units[id].neighbors.length)!],
    b = local.units[a.neighbors[0]]
  for (const u of [a, b]) {
    u.communities![0].population = { children: 5000, adults: 12000, elders: 3000 }
    u.communities![0].ageCohorts = [
      [-120, 2500, 2500],
      [-360, 6000, 6000],
      [-900, 1500, 1500],
    ]
  }
  aggregateDistricts(w)
  const before = w.regions.reduce((sum, r) => sum + population(r), 0)
  for (let month = 0; month < 120; month++) evolveCities(w)
  const city = local.cities.find((c) => c.absorbedBy === undefined && c.cells.includes(a.center))!
  assert(city && city.cells.includes(b.center))
  assert.equal(city.population, 40000)
  assert.equal(city.kind, 'city')
  assert.equal(
    w.regions.reduce((sum, r) => sum + population(r), 0),
    before,
  )
})
