export type AgeCohort = 'children' | 'adults' | 'elders'
export type Cohorts = Record<AgeCohort, number>
export type IdentityAxis = 'culture' | 'language' | 'belief' | 'movement'
export interface IdentityDefinition {
  id: number
  kind: IdentityAxis
  name: string
  parents: number[]
  origin: number
  formed: number
  language: number
  orientation: 'neutral' | 'reform' | 'local' | 'institutional' | 'commerce' | 'communal'
  momentum: number
}
/** A joint identity/age population, with changing social conditions rather than innate traits. */
export interface PopulationCommunity {
  culture: number
  language: number
  belief: number
  movement: number
  allegiance: number
  host: number
  population: Cohorts
  health: number
  literacy: number
  wealth: number
  urban: number
  contentment: number
  loyalty: number
  grievance: number
  rootedness: number
  displacement: number
  knownLanguage: number
  fluency: number
}
export interface PopulationDynamics {
  immigrants: number
  emigrants: number
  refugees: number
  culturalChanges: number
  languageChanges: number
  beliefChanges: number
  politicalChanges: number
  diversity: number
  cohesion: number
  discrimination: number
  mixing: number
  isolation: number
  lastCulture: number
  lastLanguage: number
}
export interface PopulationSystem {
  version: 1
  rng: number
  identities: IdentityDefinition[]
  lastEvolution: number
}
export interface NationalIdentity {
  culture: number
  language: number
  belief: number
}
