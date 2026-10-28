import { urbanStreetRoute } from '../src/sim/urban-streets'
import { fundUrbanProject } from '../src/sim/urban-projects'
import { surveyBuildingPlots } from '../src/sim/urban-growth'
/** Prescribed local treatments: these are not autonomous macroeconomic forecasts. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { fundedUrbanFixture } from './fixtures/funded-urban-evolution'
import { urbanMetrics } from '../src/sim/urban-metrics'
import { advanceUrbanRenewal } from '../src/sim/urban-renewal'
import { advanceUrbanConstruction } from '../src/sim/urban-construction'
import { planUrbanStreetWork, advanceUrbanStreets } from '../src/sim/urban-street-works'
import { urbanLocationSnapshot } from '../src/sim/urban-location'
import { withSimulationPeriod } from '../src/sim/simulation-period'
import { ensureUrbanFabric, validateUrbanFabric } from '../src/sim/urban-fabric'
import { balances } from '../src/sim/ledger'
import { inventory, type World } from '../src/sim/types'
import type { CompetitiveFirm } from '../src/sim/economic-types'

const metric = (w: World) => {
  const { geometry, ...data } = urbanMetrics(w)
  const live = Object.values(w.adaptive!.sites).filter((s) => s.retired === undefined)
  const buildings = live.filter((s) => s.building && s.fabric)
  return {
    ...data,
    geometryHash: createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),
    olderBuildings: buildings.filter((s) => w.month - s.fabric!.built >= 120).length,
    averageCondition:
      Math.round(
        (buildings.reduce((n, s) => n + s.fabric!.condition, 0) / Math.max(1, buildings.length)) * 1e9,
      ) / 1e9,
    uses: live.reduce(
      (r, s) => {
        if (s.building && s.fabric)
          for (const k of Object.keys(r) as (keyof typeof r)[]) r[k] += s.fabric.uses[k]
        return r
      },
      { housing: 0, production: 0, market: 0, logistics: 0, civic: 0 },
    ),
    projects: w.adaptive!.urban!.projects.map((p) => ({
      kind: p.kind,
      status: p.status,
      sites: p.sites,
      displaced: p.displaced.reduce((n, d) => n + d.people, 0),
    })),
  }
}
const runs: object[] = []
for (const scenario of ['fixed market', 'freight specialization', 'decline and recovery'] as const) {
  const { w, sites } = fundedUrbanFixture()
  for (const f of w.economy!.firms ?? []) f.active = false
  const firm = { id: 0, cash: 0, wage: 1, stocks: inventory(), laborMix: inventory() } as CompetitiveFirm
  w.economy!.firms = [firm]
  firm.active = true
  firm.locality = 0
  firm.region = 0
  firm.specialization = 'industrial'
  firm.employment = 80
  firm.desiredEmployment = 80
  firm.laborMix = {
    food: 0,
    timber: 0,
    stone: 0,
    ore: 0,
    metal: 0,
    cloth: 0,
    tools: 1,
  } as typeof firm.laborMix
  w.adaptive!.sites['firm:0'] = {
    id: 'firm:0',
    kind: 'establishment',
    entity: 'firm:0',
    pool: 0,
    cell: 0,
    x: 900,
    y: 430,
    founded: 0,
    capacity: 80,
    openingCapacity: 80,
    capitalReference: 0,
  }
  w.economy!.producers[0].sales = 50
  if (scenario !== 'fixed market') w.corridors = [{ a: 0, b: 1, traffic: 2000 }] as World['corridors']
  if (scenario === 'decline and recovery') {
    for (const s of sites.slice(0, 4)) s.fabric!.condition = 0.58
  }
  ensureUrbanFabric(w)
  const opening = metric(w),
    population = opening.residents
  for (const enabled of [false, true])
    for (const step of [1, 6]) {
      const world = structuredClone(w)
      world.adaptive!.urban!.enabled = enabled
      const money = Object.values(balances(world)).reduce((a, b) => a + b, 0),
        beforeStocks = { ...world.localEconomy!.units[0].stocks }
      const began = performance.now()
      for (let month = 0; month < 48; month += step)
        withSimulationPeriod(step, () => {
          world.month += step
          world.economy!.producers[0].sales = 50 * step
          for (const corridor of world.corridors ?? []) corridor.traffic = 2000 * step
          // Prescribed steady labour supply. The loop does not manufacture funds or materials.
          for (const h of Object.values(world.economy!.households[0])) h.employed = 0
          if (scenario === 'decline and recovery') world.economy!.firms![0].active = month >= 24
          advanceUrbanConstruction(world)
          advanceUrbanRenewal(world)
          advanceUrbanStreets(world)
          assert.equal(urbanMetrics(world).residents, population)
          validateUrbanFabric(world)
        })
      assert.ok(Math.abs(Object.values(balances(world)).reduce((a, b) => a + b, 0) - money) < 1e-6)
      const spent = world.adaptive!.urban!.projects.reduce((n, p) => n + p.inputs.timber, 0)
      assert.ok(Math.abs(beforeStocks.timber - world.localEconomy!.units[0].stocks.timber - spent) < 1e-6)
      const stone = world.adaptive!.urban!.projects.reduce((n, p) => n + p.inputs.stone, 0)
      assert.ok(Math.abs(beforeStocks.stone - world.localEconomy!.units[0].stocks.stone - stone) < 1e-6)
      const ending = metric(world)
      assert.equal(ending.employment, opening.employment)
      assert.ok(
        Math.abs(
          Object.values(ending.uses).reduce((a, b) => a + b, 0) -
            Object.values(opening.uses).reduce((a, b) => a + b, 0),
        ) < 1e-6,
      )
      if (!enabled) {
        assert.equal(ending.buildings, opening.buildings)
        assert.equal(ending.geometryHash, opening.geometryHash)
        assert.equal(ending.projects.length, 0)
        assert.deepEqual(ending.uses, opening.uses)
      } else {
        assert.ok(ending.projects.length > 0)
        if (scenario === 'fixed market') assert.ok(ending.buildings < opening.buildings)
        else assert.ok(ending.uses.logistics + ending.uses.production > 0)
        if (scenario === 'decline and recovery') assert.ok(ending.projects.some((p) => p.kind === 'replace'))
      }
      runs.push({
        scenario,
        enabled,
        step,
        elapsedMs: performance.now() - began,
        opening,
        ending,
        score: urbanLocationSnapshot(world)(sites[3]),
      })
    }
}
// Every prescribed trajectory must agree across integration step lengths.
for (let i = 0; i < runs.length; i += 2) {
  const [a, b] = runs.slice(i, i + 2) as { ending: unknown }[]
  assert.deepEqual(a.ending, b.ending)
}
const accessExperiments: object[] = []
{
  const { w } = fundedUrbanFixture('bridge'),
    lane = w.adaptive!.lanes![0]
  const a = lane.points[0],
    b = lane.points.at(-1)!
  const before = urbanStreetRoute(w, a, b)!.minutes
  const project = planUrbanStreetWork(w, lane, 'realign', [a, b])!
  assert.ok(fundUrbanProject(w, project, 1))
  const during = urbanStreetRoute(w, a, b)!.minutes
  assert.equal(during, before)
  w.month += project.duration
  advanceUrbanConstruction(w)
  const after = urbanStreetRoute(w, a, b)!.minutes
  assert.ok(after < before * 0.6)
  accessExperiments.push({
    scenario: 'detoured approach to a crossing (prescribed abstraction)',
    beforeMinutes: before,
    duringMinutes: during,
    afterMinutes: after,
    paidCost: project.cost,
    materials: project.inputs,
  })
}
{
  const { w, sites } = fundedUrbanFixture('boundary')
  const plots = surveyBuildingPlots(w, sites[3], 24, true, sites, false).plots
  const crossing = plots.filter((p) => p.pool === 1)
  assert.ok(crossing.length)
  const baseline = urbanStreetRoute(w, { x: 900, y: 430 }, { x: 1150, y: 430 })!.minutes
  for (const unit of w.localEconomy!.units ? Object.values(w.localEconomy!.units) : [])
    unit.name = 'Renamed accounting area'
  const renamed = urbanStreetRoute(w, { x: 900, y: 430 }, { x: 1150, y: 430 })!.minutes
  assert.equal(renamed, baseline)
  accessExperiments.push({
    scenario: 'internal accounting boundary',
    surveyedPlots: plots.length,
    plotsInNeighbouringPool: crossing.length,
    routeMinutes: baseline,
    renamingChangedAccess: false,
  })
}
const sourceHash = createHash('sha256')
for (const file of readdirSync('src/sim')
  .filter((p) => p.endsWith('.ts'))
  .sort())
  sourceHash.update(file).update(readFileSync(`src/sim/${file}`))
writeFileSync(
  process.argv[2] ?? '/tmp/urban-controlled-qualification.json',
  JSON.stringify(
    {
      kind: 'prescribed steady population and labour, existing finite funds/materials, 48-month treatments',
      sourceHash: sourceHash.digest('hex'),
      checks: [
        'constant population and employment',
        'money, timber and stone conservation',
        'floor area conservation',
        'disabled controls unchanged',
        'physical treatment effects',
        'equal monthly and six-month physical outcomes',
      ],
      runs,
      accessExperiments,
    },
    null,
    2,
  ) + '\n',
)
console.log(
  JSON.stringify(
    runs.map((r: any) => ({
      scenario: r.scenario,
      enabled: r.enabled,
      step: r.step,
      buildings: r.ending.buildings,
      projects: r.ending.projects.length,
      types: [...new Set(r.ending.projects.map((p: any) => p.kind))],
      floorUses: r.ending.uses,
      elapsedMs: r.elapsedMs,
    })),
    null,
    2,
  ),
)
