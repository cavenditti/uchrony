/** Offline (1+lambda) evolutionary search of an interpretable policy. It is not
 * an LLM fine-tune, online learning, or permission to relax physical constraints.
 * Every child runs the full simulator, accounting audits and save/resume check. */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { DECISION_POLICIES, type DecisionPolicy } from '../src/sim/decision-policy'

const args = process.argv.slice(2)
const option = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i < 0 ? fallback : args[i + 1]
}
const resume = option('resume'),
  months = Number(option('months', '2640'))
const directory = resolve(option('output', '/tmp/uchrony-policy-search'))
const rounds = Number(option('rounds', '2')),
  offspring = Number(option('offspring', '3'))
if (
  !resume ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 10 ||
  !Number.isInteger(offspring) ||
  offspring < 1 ||
  offspring > 12
)
  throw Error('Supply --resume and bounded search dimensions')
mkdirSync(directory, { recursive: true })
let state = 27102026
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return state / 2 ** 32
}
const ranges = {
  merchantRelease: [0.003, 0.04],
  workDisutility: [0.4, 0.7],
  investmentShare: [0.2, 0.6],
  investmentAdjustment: [0.015, 0.08],
} as const
const candidates: {
  id: number
  policy: DecisionPolicy
  score: number | null
  feasible: boolean
  metrics: unknown
  revision: string
}[] = []
let next = 0
async function evaluate(policy: DecisionPolicy) {
  const id = next++,
    base = `${directory}/candidate-${id}`
  writeFileSync(`${base}.policy.json`, JSON.stringify(policy, null, 2))
  const fd = openSync(`${base}.log`, 'w')
  try {
    await new Promise<void>((done, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/evaluate-expansion.ts',
          '--profile',
          'expansionist',
          '--policy',
          `${base}.policy.json`,
          '--resume',
          resolve(resume),
          '--months',
          String(months),
          '--output',
          `${base}.json`,
        ],
        { stdio: ['ignore', fd, fd] },
      )
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0 ? done() : reject(Error(`Candidate ${id} failed (${code}); see ${base}.log`)),
      )
    })
  } finally {
    closeSync(fd)
  }
  const run = JSON.parse(readFileSync(`${base}.json`, 'utf8'))
  if (run.startMonth < 12 || run.initial.realOutputPerPersonMonth <= 0)
    throw Error('Training needs a mature economic checkpoint')
  const outputGrowth =
    (run.final.realOutputPerPersonMonth * run.final.population) /
    (run.initial.realOutputPerPersonMonth * run.initial.population)
  const feasible = run.minimumPopulationRatio >= 0.97 && run.meanFood >= 0.85 && run.final.livingStates >= 2
  const score = feasible
    ? 2 * Math.log(run.final.populationRatio) +
      Math.log(Math.max(1e-9, outputGrowth)) +
      0.3 * Math.log(Math.max(1, run.final.claimed) / Math.max(1, run.initialClaims)) -
      0.8 * run.meanUnemployment -
      5 * Math.max(0, 0.9 - run.meanFood)
    : null
  const result = {
    id,
    policy,
    score,
    feasible,
    revision: run.revision,
    metrics: {
      ...run.final,
      meanFood: run.meanFood,
      meanUnemployment: run.meanUnemployment,
      outputGrowth,
      minimumPopulationRatio: run.minimumPopulationRatio,
      warStarts: run.counts.warStarts,
    },
  }
  candidates.push(result)
  console.log(JSON.stringify(result))
  return result
}
let best = await evaluate({ ...DECISION_POLICIES.renewal })
for (let round = 0; round < rounds; round++) {
  const batch: DecisionPolicy[] = []
  for (let i = 0; i < offspring; i++) {
    const policy = { ...best.policy }
    for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
      const [low, high] = ranges[key]
      policy[key] = Number(
        Math.max(low, Math.min(high, policy[key] + ((random() - 0.5) * (high - low)) / (round + 1))).toFixed(
          5,
        ),
      )
    }
    batch.push(policy)
  }
  // At most two workers; no simulator-global policy scopes overlap in one process.
  for (let i = 0; i < batch.length; i += 2) {
    for (const candidate of await Promise.all(batch.slice(i, i + 2).map(evaluate))) {
      if (candidate.feasible && (!best.feasible || candidate.score! > best.score!)) best = candidate
    }
  }
}
if (new Set(candidates.map((c) => c.revision)).size !== 1)
  throw Error('Simulator changed during training; rerun on one revision')
writeFileSync(
  `${directory}/search.json`,
  JSON.stringify(
    {
      algorithm: '(1+lambda) bounded evolutionary search',
      seed: 27102026,
      resume: resolve(resume),
      months,
      rounds,
      offspring,
      ranges,
      guards: { minimumPopulationRatio: 0.97, meanFood: 0.85, minimumLivingStates: 2 },
      reward:
        '2 log(population growth) + log(real output growth) + .3 log(territory growth) - .8 mean unemployment - 5 max(0,.9-mean food); no reward for wars',
      best,
      candidates,
    },
    null,
    2,
  ),
)
if (!best.feasible) throw Error('No candidate passed welfare constraints; no policy selected')
writeFileSync(`${directory}/selected-policy.json`, JSON.stringify(best.policy, null, 2))
console.log(JSON.stringify({ selected: best.id, score: best.score, policy: best.policy }))
