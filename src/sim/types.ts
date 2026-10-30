import type { OverseasQuote } from './overseas'
import type { PopulationCensus } from './view-snapshot'
import type { EconomicSystem } from './economic-types'
import type { WorldScale } from './scale'
import type { InstitutionalState, ProvincialDelegation, Charter } from './institutions'
import type { IntelligenceState, IntelligencePriority } from './intelligence'
import type { ForeignOffices } from './diplomatic-friction'
import type { Geopolitics, Occupation } from './geopolitics'
import type { SovereigntyState } from './sovereignty'
import type { SimulationSettings } from './settings'
import type { PressureState } from './pressures'
import type { HistoricalRecord, HistoricalState, StorytellerStatus } from './history-types'
import type { Statecraft, AgentServiceStatus } from './statecraft-types'
import type { StateCharacter } from './character-types'
import type { ArmyOperations, Warfare } from './military-types'
import type {
  PopulationCommunity,
  PopulationDynamics,
  PopulationSystem,
  NationalIdentity,
} from './population-types'

export { MAX_STATE_IDENTITIES } from './simulation-invariants'
export const GOODS = ['food', 'timber', 'stone', 'iron', 'coal', 'tools', 'textiles', 'arms'] as const
export type Good = (typeof GOODS)[number]
export type Inventory = Record<Good, number>
export type Terrain = 'water' | 'plains' | 'forest' | 'hills' | 'mountains' | 'desert' | 'tundra'
export type Research = 'agriculture' | 'industry' | 'medicine' | 'logistics' | 'military' | 'governance'
export const FIELDS: Research[] = [
  'agriculture',
  'industry',
  'medicine',
  'logistics',
  'military',
  'governance',
]
export type Layer =
  | 'political'
  | 'terrain'
  | 'population'
  | 'culture'
  | 'language'
  | 'belief'
  | 'prosperity'
  | 'food'
  | 'trade'
  | 'military'

export interface Cell {
  landscape?: import('./landscape').Landscape
  id: number
  q: number
  r: number
  x: number
  y: number
  elevation: number
  moisture: number
  terrain: Terrain
  region: number
  river: boolean
  downstream?: number
  riverFlow?: number
}
export interface Region {
  publicWorks?: import('./transport-development').PublicWorks
  /** Present only on a local simulation district. */
  province?: number
  capitalReference?: number
  delegation?: ProvincialDelegation
  occupation?: Occupation
  control?: import('./military-control').MilitaryControl
  id: number
  name: string
  /** -1 means land outside any state's sovereignty. */
  nation: number
  culture: number
  census?: PopulationCensus
  /** UI-only local-market breakdown; full identity/age censuses are published by geographical region. */
  strataCounts?: Partial<Record<import('./economic-types').EconomicStratum, number>>
  communities?: PopulationCommunity[]
  populationDynamics?: PopulationDynamics
  center: number
  cells: number[]
  neighbors: number[]
  coastal: boolean
  terrain: Terrain
  fertility: number
  deposits: { timber: number; stone: number; iron: number; coal: number }
  population: { children: number; adults: number; elders: number }
  urban: number
  literacy: number
  health: number
  happiness: number
  infrastructure: number
  industry: number
  stocks: Inventory
  production: Inventory
  plannedProduction?: Inventory
  consumption: Inventory
  prices: Inventory
  foodCoverage: number
  materialCoverage?: number
  migration: number
  births: number
  deaths: number
  employed: number
  unrest: number
  devastation: number
  gdp: number
}
export interface Policies {
  tax: number
  welfare: number
  education: number
  military: number
  research: number
  tariff: number
  conscription: number
  migration: 'open' | 'controlled' | 'closed'
  priority: 'balanced' | 'agriculture' | 'industry' | 'military'
  citizenship?: 'civic' | 'pluralist' | 'heritage'
  languagePolicy?: 'local' | 'common' | 'multilingual'
  beliefPolicy?: 'protected' | 'favored' | 'restricted'
}
export interface Nation {
  id: number
  cabinet?: import('./cabinet-state').CabinetState
  development?: import('./development').DevelopmentPlan
  /** Historical identity remains addressable after the last resident dies. */
  extinct?: number
  name: string
  shortName: string
  color: string
  capital: number
  government: string
  identity?: NationalIdentity
  character?: StateCharacter
  personality: 'mercantile' | 'expansionist' | 'scholarly' | 'agrarian'
  treasury: number
  debt: number
  stability: number
  legitimacy: number
  policies: Policies
  technologies: Record<Research, number>
  researchProgress: Record<Research, number>
  researchFocus: Research
  income: number
  spending: number
  capitalSpending?: number
  enterpriseIncome?: number
  gdp: number
  population: number
  foodCoverage: number
  manpower: number
  casualties: number
  budget: {
    welfare: number
    education: number
    military: number
    research: number
    administration: number
    infrastructure: number
  }
  ai: boolean
}
export interface Relation {
  aPolicy?: import('./border-policy').BorderPolicy
  bPolicy?: import('./border-policy').BorderPolicy
  /** An intervention supports this original victim; it must not manufacture another defense call. */
  defenseOf?: number
  aggressor?: number
  a: number
  b: number
  opinion: number
  treaty: 'neutral' | 'trade' | 'alliance' | 'war' | 'truce'
  since: number
  warExhaustion: number
  grievance: number
}
export interface Army {
  establishment?: number
  replacements?: number
  operations?: ArmyOperations
  id: number
  nation: number
  name: string
  region: number
  target: number | null
  soldiers: number
  morale: number
  supply: number
  experience: number
  casualties: number
  census?: PopulationCensus
  communities?: PopulationCommunity[]
}
export interface RouteLeg {
  mode: 'land' | 'sea'
  cells: number[]
}
export interface Route {
  fromDistrict?: number
  toDistrict?: number
  id: string
  from: number
  to: number
  path: number[]
  /** Physical freight path. Older saves acquire this on the next monthly tick. */
  legs?: RouteLeg[]
  sea: boolean
  goods: Inventory
  volume: number
  value: number
  capacity: number
  international: boolean
}
export interface TradeLane {
  from: number
  to: number
  path: number[]
  /** Recent monthly cargo volumes, decayed during inactive months. Not stock or freight in transit. */
  flow: Inventory
  lastActive: number
}
export interface CorridorTrace {
  /** An undirected, adjacent tile pair, stored with a < b. */
  a: number
  b: number
  familiarity: number
  traffic: number
}
export interface CorridorPlan {
  month: number
  /** Persist physical paths so loading a save cannot trigger an early replan. */
  links: { from: number; to: number; legs: RouteLeg[]; changedAt: number }[]
}
export interface SimEvent {
  id: number
  month: number
  type: 'war' | 'peace' | 'economy' | 'population' | 'research' | 'diplomacy' | 'world'
  title: string
  detail: string
  nation?: number
  region?: number
  expandedAccount?: string
  historical?: HistoricalRecord
}
export interface HistoryPoint {
  month: number
  population: number
  gdp: number
  trade: number
  wars: number
  food: number
  nations: { id: number; population: number; gdp: number; territory: number; treasury: number }[]
}
export interface World {
  dependencies?: import('./state-dependencies').StateDependency[]
  dynasties?: import('./dynasties').DynasticState
  archive?: import('./world-archive').WorldArchive
  influence?: import('./influence').InfluenceState
  /** Persistent provenance; coarse history remains approximate after returning to monthly play. */
  fastForward?: { months: number; lastMonth: number; phase: number }
  almanac?: import('./almanac-types').Almanac
  viewPlaces?: import('./almanac-types').PlaceLabel[]
  adaptive?: import('./adaptive-types').AdaptiveWorld
  modelProvenance?: import('./llm-policy').ModelProvenance
  localEconomy?: import('./district-types').DistrictEconomy
  spatial?: import('./spatial').SpatialState
  viewOnly?: true
  /** UI subscription only. Undefined publishes all details; null publishes summaries. */
  viewNation?: number | null
  /** Worker-computed quotes need the complete household and housing records. */
  viewOverseas?: { nation: number; options: OverseasQuote[] }
  viewBankLoans?: Record<number, number>
  /** Read-only economic tile projection shared by every observer. */
  viewLandscape?: import('./economic-landscape').EconomicLandscape
  /** Exact adaptive cells for the map, without simulation-owned polygons or accounts. */
  viewMesh?: import('./map-snapshot').MapMesh
  viewUrbanBlocks?: import('./urban-blocks').UrbanBlock[]
  /** Compact display records; avoids cloning a giant string-keyed site registry. */
  viewHomes?: {
    id: string
    cell: number
    pool: number
    capacity: number
    residents?: number
    x?: number
    y?: number
    parcel?: import('./adaptive-types').SpatialBounds
    building?: import('./adaptive-types').PointMeters[]
    fabric?: Pick<
      import('./urban-types').UrbanBuilding,
      'floorArea' | 'uses' | 'condition' | 'built' | 'altered'
    >
    works?: { stage: string; progress: number; disruptive: boolean }
    developed?: boolean
    construction?: number
  }[]
  economy?: EconomicSystem
  version: 1
  configuration?: import('./configuration').WorldConfiguration
  simulation?: SimulationSettings
  institutions?: InstitutionalState
  intelligence?: IntelligenceState
  foreignOffices?: ForeignOffices
  geopolitics?: Geopolitics
  sovereignty?: SovereigntyState
  pressures?: PressureState
  generatorVersion?: number
  settlementStart?: 'frontier'
  gridTopology?: 'square-v1'
  seed: string
  rng: number
  month: number
  startYear: number
  width: number
  height: number
  cells: Cell[]
  regions: Region[]
  nations: Nation[]
  relations: Relation[]
  armies: Army[]
  routes: Route[]
  tradeLanes?: TradeLane[]
  harbors?: { cell: number; since: number; updated: number; lastActive: number; throughput: number }[]
  farmProjects?: import('./agriculture').FarmProject[]
  corridors?: CorridorTrace[]
  corridorPlan?: CorridorPlan
  historical?: HistoricalState
  statecraft?: Statecraft
  demography?: PopulationSystem
  warfare?: Warfare
  overseas?: import('./overseas-types').OverseasState
  events: SimEvent[]
  history: HistoryPoint[]
  nextEvent: number
  nextArmy: number
  climate: number
  totals: {
    population: number
    gdp: number
    trade: number
    wars: number
    births: number
    deaths: number
    migration: number
  }
}
export type Command =
  | {
      type: 'capitulate'
      nation: number
      target: number
      outcome: import('./capitulation').CapitulationOutcome
      indemnity: number
    }
  | { type: 'royal-proposal'; nation: number; target: number; kind: import('./dynasties').RoyalAgreement }
  | { type: 'royal-answer'; nation: number; offer: number; accept: boolean }
  | { type: 'annex'; nation: number; region: number }
  | { type: 'peace-proposal'; nation: number; target: number; payer: number; payment: number; cede: number[] }
  | { type: 'peace-answer'; nation: number; offer: number; accept: boolean }
  | { type: 'found-settlement'; nation: number; cell: number; pioneer?: boolean }
  | { type: 'found-overseas'; nation: number; cell: number }
  | { type: 'cancel-expedition'; nation: number; expedition: number }
  | {
      type: 'intelligence'
      nation: number
      budgetShare: number
      priority: IntelligencePriority
      focus: number | null
    }
  | {
      type: 'charter-proposal'
      nation: number
      members: number[]
      name: string
      charter: Charter
      target?: number
    }
  | { type: 'institution-answer'; nation: number; offer: number; accept: boolean }
  | {
      type: 'institution-defense'
      nation: number
      institution: number
      call: string
      response: 'aid' | 'refuse'
    }
  | {
      type: 'devolution'
      nation: number
      regions: number[]
      autonomy: number
      powers: ProvincialDelegation['powers']
    }
  | { type: 'conditions'; settings: SimulationSettings }
  | {
      type: 'configuration'
      values: import('./configuration-defaults').ConfigurationValues
      revision: number
    }
  | { type: 'policy'; nation: number; key: keyof Policies; value: Policies[keyof Policies] }
  | { type: 'identity-policy'; nation: number; key: 'culture' | 'language' | 'belief'; identity: number }
  | { type: 'research'; nation: number; field: Research }
  | { type: 'border-policy'; nation: number; target: number; policy: import('./border-policy').BorderPolicy }
  | {
      type: 'access-proposal'
      nation: number
      target: number
      kind: 'transit' | 'access' | 'basing' | 'preferential-trade'
      duration: number
      regions: number[]
    }
  | { type: 'access-answer'; nation: number; offer: number; accept: boolean }
  | {
      type: 'diplomacy'
      nation: number
      target: number
      action: 'improve' | 'trade' | 'alliance' | 'war' | 'peace' | 'embargo'
    }
  | { type: 'recruit'; nation: number; region: number }
  | { type: 'move'; army: number; target: number }
  | {
      type: 'army-orders'
      army: number
      stance: 'march' | 'hold' | 'entrench'
      conduct: ArmyOperations['conduct']
    }
  | { type: 'commission'; nation: number; region: number; warships: number; transports: number }
  | {
      type: 'fleet-order'
      fleet: number
      target: number
      mission: import('./military-types').Fleet['mission']
    }
  | { type: 'embark'; army: number; fleet: number }
  | {
      type: 'build'
      region: number
      building:
        | 'farm'
        | 'food-works'
        | 'textile-works'
        | 'industry'
        | 'road'
        | 'school'
        | import('./public-works').TransportProject
    }
  | { type: 'control'; nation: number | null }
  | { type: 'disaster'; region: number; disaster: 'drought' | 'epidemic' | 'abundance' }
export type WorkerRequest =
  | { type: 'archive'; query: import('./world-archive').ArchiveQuery }
  | { type: 'places'; query: import('./almanac-types').PlaceQuery }
  | { type: 'world-writing'; request: import('./almanac-types').WritingRequest }
  | { type: 'models-changed' }
  | { type: 'view-focus'; nation: number | null }
  | { type: 'inspect'; request: import('./inspection').InspectionRequest }
  | { type: 'llm-policy'; enabled: boolean }
  | {
      type: 'generate'
      seed: string
      continents?: number
      nations?: number
      settings?: SimulationSettings
      configuration?: import('./configuration-defaults').ConfigurationValues
      start?: 'settled' | 'frontier'
      scale?: WorldScale
    }
  | { type: 'step'; count: number }
  | { type: 'playback'; running: boolean; speed: import('./playback').PlaybackSpeed }
  | { type: 'command'; command: Command }
  | { type: 'load'; world: unknown }
  | { type: 'restore'; legacy: string | null }
  | { type: 'import'; file: Blob }
  | { type: 'export' }
  | { type: 'save'; force?: boolean }
  | { type: 'storage-port'; port: MessagePort }
  | { type: 'storage-error'; message?: string }
  | { type: 'snapshot-ack'; mapKey: string }
  | { type: 'retry-history' }
  | { type: 'advise'; nation: number; text: string }
  | { type: 'withdraw-advice'; nation: number; advice: number }
  | { type: 'agent-strategy'; nation: number }
  | { type: 'event-details'; event: number }
export type WorkerResponse =
  | { type: 'archive'; result: import('./world-archive').ArchiveResult; mapKey: string }
  | { type: 'archive-error'; request: number; message: string }
  | { type: 'places'; result: import('./almanac-types').PlaceResult }
  | { type: 'world-writing'; id: string; state: 'loading' | 'done' | 'error'; message?: string }
  | { type: 'inspection'; snapshot: import('./inspection').InspectionSnapshot }
  | { type: 'inspection-error'; request: number; message: string }
  | { type: 'llm-policy'; policy: import('./llm-policy').LlmPolicySnapshot }
  | {
      type: 'storage'
      state: 'saving' | 'saved' | 'error' | 'restored'
      month?: number
      startYear?: number
      source?: string
      message?: string
      bytes?: number
      replicas?: string[]
    }
  | { type: 'startup-error'; message: string }
  | { type: 'exported'; blob: Blob; filename: string }
  | {
      type: 'world'
      world: Omit<World, 'cells'> & { cells?: Cell[] }
      mapKey: string
      message?: string
      acknowledgement?: boolean
    }
  | { type: 'error'; message: string; recoverable?: boolean }
  | { type: 'storyteller'; status: StorytellerStatus }
  | { type: 'agents'; status: AgentServiceStatus }
  | { type: 'event-detail'; event: number; state: 'loading' | 'done' | 'error'; message?: string }

export const inventory = (value = 0): Inventory =>
  Object.fromEntries(GOODS.map((g) => [g, value])) as Inventory
export const population = (r: Region) => r.population.children + r.population.adults + r.population.elders
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))
const relationIndices = new WeakMap<Relation[], { length: number; pairs: Map<string, number> }>()
/** Cache positions, not objects: treaty edits and replacement records remain immediately visible. */
export function relation(world: World, a: number, b: number) {
  const low = Math.min(a, b),
    high = Math.max(a, b),
    records = world.relations
  let index = relationIndices.get(records)
  if (!index || records.length < index.length) {
    index = { length: 0, pairs: new Map() }
    relationIndices.set(records, index)
  }
  for (let i = index.length; i < records.length; i++) {
    const r = records[i],
      key = `${r.a}:${r.b}`
    if (!index.pairs.has(key)) index.pairs.set(key, i)
  }
  index.length = records.length
  const key = `${low}:${high}`,
    position = index.pairs.get(key)
  const found = position === undefined ? undefined : records[position]
  if (found?.a === low && found.b === high) return found
  // Imports replace the array; this fallback also tolerates in-place sorting or changed endpoints.
  const refreshed = records.findIndex((r) => r.a === low && r.b === high)
  if (refreshed < 0) {
    index.pairs.delete(key)
    return undefined
  }
  index.pairs.set(key, refreshed)
  return records[refreshed]
}
export const dateLabel = (world: Pick<World, 'month' | 'startYear'>) =>
  `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][world.month % 12]} ${world.startYear + Math.floor(world.month / 12)}`
