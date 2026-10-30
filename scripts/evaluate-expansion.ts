import { DECISION_POLICIES, withDecisionPolicy, type DecisionPolicy } from '../src/sim/decision-policy'
import { dynamicsDiagnostics } from './dynamics-diagnostics'
import { simulationSettings } from '../src/sim/settings'
import { configurationDraft, applyConfiguration } from '../src/sim/configuration'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { generateWorld } from '../src/sim/generate'
import { fastForwardStep } from '../src/sim/fast-forward'
import { tick } from '../src/sim/engine'
import { population, type World } from '../src/sim/types'
import { validateWorld, restoreWorld } from '../src/sim/persistence'
import { packWorldSave } from '../src/sim/save-codec'
import { auditLedger } from '../src/sim/ledger'
import { auditGoods } from '../src/sim/goods-accounting'
import { auditBanks } from '../src/sim/banking'
import {
  EXPANSION_PROFILES,
  withExpansionParameters,
  type ExpansionProfile,
} from '../src/sim/expansion-parameters'
import { competitivePressure } from '../src/sim/competitive-pressure'
import { foundingPlan, pioneerExpedition } from '../src/sim/founding'
import assert from 'node:assert/strict'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? fallback : args[index + 1]
}
const profile = option('profile', 'baseline') as ExpansionProfile
const seed = option('seed', 'Gino')
const months = Number(option('months', '600'))
const mode = option('mode', 'coarse')
const start = option('start', 'frontier') as 'frontier' | 'settled'
const scale = option('scale', 'regional') as 'regional' | 'continental' | 'world'
const output = option('output', '/tmp/uchrony-expansion-run.json')
const snapshot = option('snapshot', '')
const resume = option('resume', '')
const abundance = option('abundance', '')
const policyFile = option('policy', '')
const decision = policyFile ? 'custom' : option('decision', 'legacy')
const policy: DecisionPolicy = policyFile
  ? JSON.parse(readFileSync(policyFile, 'utf8'))
  : DECISION_POLICIES[decision]
if (!policy) throw new Error('Unknown decision policy')
const diagnostics: ReturnType<typeof dynamicsDiagnostics>[] = []
if (
  !EXPANSION_PROFILES[profile] ||
  !Number.isInteger(months) ||
  months < 12 ||
  months % 6 ||
  !['monthly', 'coarse'].includes(mode) ||
  !['frontier', 'settled'].includes(start) ||
  !['regional', 'continental', 'world'].includes(scale)
)
  throw new Error('Invalid expansion experiment arguments')
const hash = createHash('sha256')
for (const name of readdirSync(new URL('../src/sim', import.meta.url))
  .filter((n) => n.endsWith('.ts'))
  .sort()) {
  hash.update(name)
  hash.update(readFileSync(new URL('../src/sim/' + name, import.meta.url)))
}
const revision = hash.digest('hex'),
  started = performance.now()
const w = resume
  ? restoreWorld(JSON.parse(readFileSync(resume, 'utf8')))
  : generateWorld(seed, 3, 8, undefined, scale, start)
if (abundance) {
  const values = configurationDraft(w)
  values.conditions.abundance = Number(abundance)
  applyConfiguration(w, values, w.configuration.revision)
}
const startMonth = w.month,
  duration = months - startMonth,
  initialStates = w.nations.length
if (duration <= 0) throw new Error('End month must follow the checkpoint')
const initialPopulation = w.totals.population,
  initialClaims = w.regions.filter((r) => r.nation >= 0).length
const seenEvents = new Set(w.events.map((e) => e.id))
const counts = {
  developmentPrograms: 0,
  productiveProjects: 0,
  pillages: 0,
  annexations: 0,
  farmProjects: 0,
  founding: 0,
  accessions: 0,
  charters: 0,
  conquests: 0,
  warStarts: 0,
  peace: 0,
  tradeAccords: 0,
  alliances: 0,
  secessions: 0,
}
let priorOwners = w.regions.map((r) => r.nation)
let priorWars = new Set(w.relations.filter((r) => r.treaty === 'war').map((r) => `${r.a}:${r.b}:${r.since}`))
let weightedFood = 0,
  weightedUnemployment = 0,
  warMonths = 0,
  populationMinimum = initialPopulation
const annual: Record<string, unknown>[] = []
const charters: { month: number; name: string; nation: number | undefined }[] = []
const delays: Record<string, number> = {}
function sample(world: World) {
  const living = world.nations.filter((n) => world.regions.some((r) => r.nation === n.id) && n.population > 0)
  const claims = world.regions.filter((r) => r.nation >= 0).length
  const holdings = living.map((n) => world.regions.filter((r) => r.nation === n.id).length)
  const food =
    world.regions.reduce((s, r) => s + r.foodCoverage * population(r), 0) /
    Math.max(
      1,
      world.regions.reduce((s, r) => s + population(r), 0),
    )
  return {
    month: world.month,
    population: world.totals.population,
    populationRatio: world.totals.population / initialPopulation,
    claimed: claims,
    claimedShare: claims / world.regions.length,
    livingStates: living.length,
    createdStates: world.nations.length - initialStates,
    largestLandShare: Math.max(0, ...holdings) / Math.max(1, claims),
    effectiveStates:
      1 /
      Math.max(
        1e-9,
        holdings.reduce((sum, v) => sum + (v / Math.max(1, claims)) ** 2, 0),
      ),
    food,
    unemployment: world.economy?.totals.unemployment ?? 0,
    realOutputPerPersonMonth: (world.economy?.totals.realOutput ?? 0) / Math.max(1, world.totals.population),
    monthlyTrade: world.routes.reduce((s, r) => s + r.volume, 0) / (world.economy?.periodMonths ?? 1),
    fundedFarmProjects: world.farmProjects?.length ?? 0,
    meanAgricultureTechnology:
      living.reduce((sum, n) => sum + n.technologies.agriculture, 0) / Math.max(1, living.length),
    meanTechnology:
      living.reduce((sum, n) => sum + Object.values(n.technologies).reduce((s, v) => s + v, 0), 0) /
      Math.max(1, living.length),
    treasury: living.reduce((sum, n) => sum + n.treasury, 0),
    publicDebt: living.reduce((sum, n) => sum + n.debt, 0),
    stateFinances: living.map((n) => ({
      id: n.id,
      treasury: n.treasury,
      debt: n.debt,
      revenue: n.income,
      spending: n.spending,
      investment: n.capitalSpending ?? 0,
      dividends: n.enterpriseIncome ?? 0,
      budget: n.budget,
      appropriation: n.development?.appropriation,
      programRevenue: n.development?.revenue,
      unemployment: world.economy?.national[n.id]?.unemployment,
      valueAdded: n.gdp,
    })),
    fiscalBalance: living.reduce((sum, n) => sum + n.income - n.spending, 0),
    occupations: world.regions.filter((r) => r.control).length,
    activePrograms: living.filter((n) => n.development).length,
    wars: world.relations.filter((r) => r.treaty === 'war').length,
    meanStability: living.reduce((s, n) => s + n.stability, 0) / Math.max(1, living.length),
    meanPeerPressure:
      living.reduce((s, n) => s + competitivePressure(world, n).peer, 0) / Math.max(1, living.length),
  }
}
const initial = sample(w)
withExpansionParameters(EXPANSION_PROFILES[profile], () =>
  withDecisionPolicy(policy, () => {
    try {
      while (w.month < months) {
        const before = w.totals.population
        if (mode === 'coarse') fastForwardStep(w)
        else tick(w)
        assert.equal(
          w.totals.population,
          before + w.totals.births - w.totals.deaths,
          'population conservation',
        )
        for (const e of w.events) {
          if (seenEvents.has(e.id)) continue
          seenEvents.add(e.id)
          if (/funds (farm equipment|tool workshops|textile workshops)/.test(e.title))
            counts.productiveProjects++
          if (e.title.startsWith('A settlement is founded')) counts.founding++
          if (e.title.includes(' joins ')) counts.accessions++
          if (e.title.includes('establishes an independent state')) {
            counts.charters++
            charters.push({ month: e.month, name: e.title, nation: e.nation })
          }
          if (e.title.includes('trade accord')) counts.tradeAccords++
          if (e.title.includes('form an alliance')) counts.alliances++
          if (e.title.includes('secedes')) counts.secessions++
          if (e.title.includes('funds farmland improvements')) counts.farmProjects++
          if (e.title.includes('adopts a five-year')) counts.developmentPrograms++
          if (e.title.includes(' pillages ')) counts.pillages++
          if (e.title.includes(' annexes ')) counts.annexations++
        }
        w.regions.forEach((r, i) => {
          if (r.nation >= 0 && priorOwners[i] >= 0 && r.nation !== priorOwners[i]) counts.conquests++
        })
        priorOwners = w.regions.map((r) => r.nation)
        const wars = new Set(
          w.relations.filter((r) => r.treaty === 'war').map((r) => `${r.a}:${r.b}:${r.since}`),
        )
        for (const key of wars) if (!priorWars.has(key)) counts.warStarts++
        for (const rel of w.relations)
          if (rel.treaty === 'truce' && [...priorWars].some((key) => key.startsWith(`${rel.a}:${rel.b}:`)))
            counts.peace++
        priorWars = wars
        const dt = mode === 'coarse' ? 6 : 1
        const now = sample(w)
        weightedFood += now.food * dt
        weightedUnemployment += now.unemployment * dt
        warMonths += wars.size > 0 ? dt : 0
        populationMinimum = Math.min(populationMinimum, w.totals.population)
        if (w.month % 12 === 0) {
          validateWorld(w)
          auditLedger(w)
          auditGoods(w)
          auditBanks(w)
          annual.push({ ...now, ...counts })
        }
        if (w.month % 120 === 0) {
          for (const n of w.nations) {
            const target = w.regions.find(
              (r) => r.nation === -1 && r.neighbors.some((id) => w.regions[id].nation === n.id),
            )
            if (!target) continue
            try {
              foundingPlan(w, n.id, target.center, pioneerExpedition(w, n.id))
            } catch (error) {
              const message = (error as Error).message
              const reason = message.includes('retain')
                ? 'settlers'
                : message.includes('departing')
                  ? 'supplies'
                  : message.includes('treasury')
                    ? 'funds'
                    : message.includes('homes')
                      ? 'occupied site'
                      : 'terrain or reach'
              delays[reason] = (delays[reason] ?? 0) + 1
            }
          }
          diagnostics.push(dynamicsDiagnostics(w))
          if (snapshot) writeFileSync(snapshot + '.checkpoint', JSON.stringify(packWorldSave(w)))
          console.log(JSON.stringify({ profile, decision, seed: w.seed, mode, start, ...now, ...counts }))
        }
      }
      const final = sample(w)
      if (snapshot) writeFileSync(snapshot, JSON.stringify(packWorldSave(w)))
      // Verify resume semantics under the same coefficient set, not an in-memory-only trajectory.
      const restored = restoreWorld(JSON.parse(JSON.stringify(packWorldSave(w))))
      if (mode === 'coarse') {
        fastForwardStep(w)
        fastForwardStep(restored)
      } else {
        tick(w)
        tick(restored)
      }
      // Compare persisted meaning, not gzip bytes or object insertion order.
      // World records are plain data. Comparing them directly avoids retaining
      // two additional full census copies in a dense late-game qualification.
      const original = w,
        resumed = restored
      function difference(a: any, b: any, path = 'world'): string | null {
        if (a === b) return null
        if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object')
          return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
        if (Array.isArray(a) && (!Array.isArray(b) || a.length !== b.length))
          return `${path}: array length differs`
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
          const mismatch = difference(a[key], b[key], `${path}.${key}`)
          if (mismatch) return mismatch
        }
        return null
      }
      const mismatch = difference(original, resumed)
      if (mismatch) {
        writeFileSync(output + '.original.json', JSON.stringify(packWorldSave(w)))
        writeFileSync(output + '.resumed.json', JSON.stringify(packWorldSave(restored)))
        throw new Error(`Save continuation differs: ${mismatch}`)
      }
      validateWorld(w)
      auditLedger(w)
      auditGoods(w)
      auditBanks(w)
      const result = {
        profile,
        parameters: EXPANSION_PROFILES[profile],
        decision,
        policy,
        simulation: simulationSettings(w),
        startMonth,
        diagnostics,
        measurementVersion: 2, // realOutput is already monthly in national accounts
        seed: w.seed,
        mode,
        start,
        scale,
        months,
        revision,
        initialPopulation,
        initialClaims,
        initial,
        provinceCount: w.regions.length,
        final,
        counts,
        ownershipTransfers: counts.conquests,
        charters,
        delays,
        annual,
        meanFood: weightedFood / duration,
        meanUnemployment: weightedUnemployment / duration,
        warFraction: warMonths / duration,
        minimumPopulationRatio: populationMinimum / initialPopulation,
        validation: { population: true, annualAccounting: true, saveContinuation: true },
        elapsedSeconds: (performance.now() - started) / 1000,
      }
      writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
      console.log(JSON.stringify({ completed: output, ...final, elapsedSeconds: result.elapsedSeconds }))
    } catch (error) {
      writeFileSync(
        output,
        JSON.stringify(
          {
            profile,
            seed,
            mode,
            start,
            scale,
            months,
            revision,
            failedAt: w.month,
            error: (error as Error).stack?.slice(0, 4000),
            annual,
          },
          null,
          2,
        ) + '\n',
      )
      throw error
    }
  }),
)
