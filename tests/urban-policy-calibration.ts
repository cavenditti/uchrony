/** Sensitivity experiment: only controlled wealth/population paths, no economy. */
import { writeFileSync } from 'node:fs'
import { PAIR_SCENARIOS, runUrbanPair } from './fixtures/urban-pairs'
import { URBAN_INTEGRATION } from '../src/sim/urban-centres'

const baseline = { ...URBAN_INTEGRATION }
// Keep the original policy explicit so reruns after tuning still compare it.
const initial = {
  incorporationMonths: 60,
  mergerMonths: 180,
  prestigeRatio: 1.5,
  wealthRatio: 1.25,
  mergerPrestigeRatio: 3,
  mergerWealthRatio: 2,
}
const candidates = [
  { name: 'initial', values: initial },
  { name: 'lower prestige only', values: { ...initial, mergerPrestigeRatio: 2 } },
  { name: 'lower merger barrier', values: { ...initial, mergerPrestigeRatio: 2, mergerWealthRatio: 1.75 } },
  {
    name: 'persistent dominance',
    values: {
      ...initial,
      incorporationMonths: 120,
      mergerMonths: 240,
      mergerPrestigeRatio: 2,
      mergerWealthRatio: 1.75,
    },
  },
  {
    name: 'longer merger delay',
    values: {
      ...initial,
      incorporationMonths: 120,
      mergerMonths: 360,
      mergerPrestigeRatio: 2,
      mergerWealthRatio: 1.75,
    },
  },
  {
    name: 'looser incorporation',
    values: {
      ...initial,
      incorporationMonths: 120,
      mergerMonths: 240,
      prestigeRatio: 1.35,
      wealthRatio: 1.15,
      mergerPrestigeRatio: 2,
      mergerWealthRatio: 1.75,
    },
  },
]
try {
  const results = candidates.map((candidate) => {
    Object.assign(URBAN_INTEGRATION, candidate.values)
    const scenarios = PAIR_SCENARIOS.map((spec) => runUrbanPair(spec))
    console.log(
      JSON.stringify({
        candidate: candidate.name,
        scenarios: scenarios.map((s) => ({
          name: s.name,
          events: s.events.filter((e) => e.kind !== 'linked'),
        })),
      }),
    )
    return { ...candidate, scenarios }
  })
  writeFileSync(
    process.argv[2] ?? '/tmp/urban-policy-calibration.json',
    JSON.stringify(
      { kind: 'controlled monthly identity scenarios; not full economic trajectories', results },
      null,
      2,
    ),
  )
} finally {
  Object.assign(URBAN_INTEGRATION, baseline)
}
