import { apportion } from './allocation'
import { random } from './random'
import { MODEL_PARAMETERS as P } from './model-parameters'
import type { AgeCohort, BirthCohort, Cohorts, PopulationCommunity } from './population-types'
const ageNames: AgeCohort[] = ['children', 'adults', 'elders']
export const ageClass = (born: number, month: number): AgeCohort =>
  month - born < P.adultAgeMonths ? 'children' : month - born < P.retirementAgeMonths ? 'adults' : 'elders'
export function ageTotals(cohorts: BirthCohort[], month: number): Cohorts {
  const totals = { children: 0, adults: 0, elders: 0 }
  for (const [born, female, male] of cohorts) totals[ageClass(born, month)] += female + male
  return totals
}
export function refreshAges(group: PopulationCommunity, month = group.ageMonth ?? 0) {
  if (!group.ageCohorts) return
  group.ageMonth = month
  const totals = { children: 0, adults: 0, elders: 0 }
  let write = 0
  for (const c of group.ageCohorts)
    if (c[1] + c[2] > 0) {
      group.ageCohorts[write++] = c
      totals[ageClass(c[0], month)] += c[1] + c[2]
    }
  group.ageCohorts.length = write
  group.population = totals
}
/** Legacy broad ages are distributed deterministically, without changing a census total. */
export function ensureAges(group: PopulationCommunity, month: number) {
  if (group.ageCohorts) {
    if (group.ageMonth !== month) refreshAges(group, month)
    return
  }
  const bins: BirthCohort[] = []
  for (const age of ageNames) {
    const first = age === 'children' ? 0 : age === 'adults' ? 18 : 65
    const last = age === 'children' ? 17 : age === 'adults' ? 64 : 95
    const weights = Array.from({ length: last - first + 1 }, (_, i) =>
      age === 'elders' ? Math.exp(-i / 10) : 1,
    )
    const counts = apportion(group.population[age], weights)
    counts.forEach((count, i) => {
      if (!count) return
      const female = Math.round(count * P.femaleBirthShare)
      bins.push([
        month - (first + i) * 12 - ((first + i * 7 + group.culture * 5 + group.language) % 12),
        female,
        count - female,
      ])
    })
  }
  group.ageCohorts = bins
  group.ageMonth = month
}
export function mergeAges(target: PopulationCommunity, incoming: PopulationCommunity) {
  if (!target.ageCohorts && !incoming.ageCohorts) return
  const month = Math.max(target.ageMonth ?? 0, incoming.ageMonth ?? 0)
  ensureAges(target, month)
  ensureAges(incoming, month)
  const bins: BirthCohort[] = []
  const combined = [...target.ageCohorts!, ...incoming.ageCohorts!].sort((a, b) => a[0] - b[0])
  for (const c of combined) {
    const old = bins.at(-1)
    if (old?.[0] === c[0]) {
      old[1] += c[1]
      old[2] += c[2]
    } else bins.push([...c])
  }
  target.ageCohorts = bins
  refreshAges(target, month)
}
/** Removes and returns exactly the requested broad-age counts, retaining birthdays and sex. */
export function extractAges(group: PopulationCommunity, requested: Cohorts): PopulationCommunity {
  const month = group.ageMonth ?? 0
  ensureAges(group, month)
  if (!requested.children && !requested.adults && !requested.elders)
    return { ...group, population: { children: 0, adults: 0, elders: 0 }, ageCohorts: [] }
  const taken: BirthCohort[] = []
  for (const age of ageNames) {
    if (requested[age] <= 0) continue
    const bins = group.ageCohorts!.filter((c) => ageClass(c[0], month) === age)
    const amounts = apportion(
      requested[age],
      bins.map((c) => c[1] + c[2]),
      bins.map((c) => c[1] + c[2]),
    )
    bins.forEach((c, i) => {
      if (!amounts[i]) return
      const sex = apportion(amounts[i], [c[1], c[2]], [c[1], c[2]])
      c[1] -= sex[0]
      c[2] -= sex[1]
      taken.push([c[0], sex[0], sex[1]])
    })
  }
  const result = { ...group, population: ageTotals(taken, month), ageCohorts: taken }
  refreshAges(group, month)
  return result
}
export function annualMortality(age: number, health: number, shortage: number, multiplier = 1) {
  const baseline =
    age < 1
      ? P.infantHazardAnnual
      : age < 15
        ? P.childHazardAnnual
        : P.adultHazardAnnual + P.ageingHazardScale * Math.exp(P.ageingHazardSlope * Math.max(0, age - 30))
  return Math.max(
    0,
    (baseline * (1.5 - health) + shortage * (age < 5 ? 0.18 : age >= 65 ? 0.22 : 0.1)) * multiplier,
  )
}
export const expectedInteger = (rng: { rng: number }, expected: number) => {
  const value = Math.max(0, expected),
    whole = Math.floor(value)
  return whole + (random(rng) < value - whole ? 1 : 0)
}
export function cohortDeaths(
  group: PopulationCommunity,
  month: number,
  rng: { rng: number },
  shortage: number,
  multiplier = 1,
) {
  ensureAges(group, month)
  let deaths = 0
  for (const c of group.ageCohorts!) {
    const age = (month - c[0]) / 12,
      probability =
        month - c[0] >= P.maximumAgeMonths
          ? 1
          : -Math.expm1(-annualMortality(age, group.health, shortage, multiplier) / 12)
    for (const sex of [1, 2] as const) {
      const dead = Math.min(c[sex], expectedInteger(rng, c[sex] * probability))
      c[sex] -= dead
      deaths += dead
    }
  }
  refreshAges(group, month)
  return deaths
}
export function cohortBirths(
  group: PopulationCommunity,
  month: number,
  rng: { rng: number },
  shortage: number,
  multiplier = 1,
) {
  ensureAges(group, month)
  let expected = 0
  for (const [born, female] of group.ageCohorts!) {
    const age = (month - born) / 12
    if (age >= 15 && age < 50) expected += (female * P.fertilityAnnual[Math.floor((age - 15) / 5)]) / 12
  }
  const modifier = (1 - group.literacy * 0.5) * (1 - group.urban * 0.2) * (1 - shortage * 0.8) * multiplier
  const births = expectedInteger(rng, expected * Math.max(0, modifier))
  if (births) {
    const female = expectedInteger(rng, births * P.femaleBirthShare)
    const existing = group.ageCohorts!.find((c) => c[0] === month)
    if (existing) {
      existing[1] += female
      existing[2] += births - female
    } else group.ageCohorts!.push([month, female, births - female])
  }
  refreshAges(group, month)
  return births
}
export function participatingLabor(group: PopulationCommunity) {
  if (!group.ageCohorts) return group.population.adults * 0.65
  let result = 0
  for (const [born, female, male] of group.ageCohorts) {
    const age = ((group.ageMonth ?? 0) - born) / 12
    const participation = age < 18 || age >= 70 ? 0 : age < 25 ? 0.6 : age < 60 ? 0.78 : age < 65 ? 0.5 : 0.15
    result += (female + male) * participation
  }
  return result * (0.6 + group.health * 0.4)
}
