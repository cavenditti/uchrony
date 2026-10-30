import { FIELDS, type Nation, type World } from './types'

export const UNCLAIMED = -1
const localRules = new WeakMap<World, Nation>()

/** Read-only rules where there is no state. This is not a nation, owns no land,
 * levies no tax, has no treasury/account, and never participates in diplomacy. */
export function governance(world: World, owner: number): Nation {
  if (owner !== UNCLAIMED) {
    const state = world.nations[owner]
    if (!state) throw new Error(`Unknown governing state ${owner}`)
    return state
  }
  const prior = localRules.get(world)
  if (prior) return prior
  const rules: Nation = {
    id: -1,
    name: 'Independent communities',
    shortName: 'Unclaimed',
    color: '#8a927f',
    capital: -1,
    government: 'None',
    treasury: 0,
    debt: 0,
    stability: 50,
    legitimacy: 50,
    ai: false,
    policies: {
      tax: 0,
      welfare: 0,
      education: 0,
      military: 0,
      research: 0,
      tariff: 0,
      conscription: 0,
      migration: 'open',
      priority: 'balanced',
      citizenship: 'pluralist',
      languagePolicy: 'local',
      beliefPolicy: 'protected',
    },
    technologies: Object.fromEntries(FIELDS.map((field) => [field, 0])) as Nation['technologies'],
    researchProgress: Object.fromEntries(FIELDS.map((field) => [field, 0])) as Nation['researchProgress'],
    researchFocus: 'agriculture',
    income: 0,
    spending: 0,
    gdp: 0,
    population: 0,
    foodCoverage: 1,
    manpower: 0,
    casualties: 0,
    budget: { welfare: 0, education: 0, military: 0, research: 0, administration: 0, infrastructure: 0 },
    identity: {
      culture: world.demography?.identities.find((entry) => entry.kind === 'culture')?.id ?? 0,
      language: world.demography?.identities.find((entry) => entry.kind === 'language')?.id ?? 0,
      belief: world.demography?.identities.find((entry) => entry.kind === 'belief')?.id ?? 0,
    },
  }
  Object.freeze(rules.policies)
  Object.freeze(rules.technologies)
  Object.freeze(rules)
  localRules.set(world, rules)
  return rules
}
