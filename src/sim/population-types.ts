import type { IdentityPolicy } from './identity-policy'
import type { EconomicStratum } from './economic-types'
/** [absolute birth month, female people, male people]. Sparse, exact birthdays. */
export type BirthCohort = [number, number, number]
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
  /** Resident district; independent of political and cultural identity. */
  locality?: number
  stratum?: EconomicStratum
  ageCohorts?: BirthCohort[]
  ageMonth?: number
  /** Political attitudes are learned conditions, never ethnic traits. Optional for old saves. */
  pluralism?: number
  groupIdentification?: number
  authority?: number
  localAutonomy?: number
  publicReligion?: number
  governmentSupport?: number
  languageTransmission?: number
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
  /** Gradual, locally funded implementation, independent of declared targets. */
  appliedIdentityPolicy?: IdentityPolicy
  identityPolicyMonth?: number
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
