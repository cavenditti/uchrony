import type { WritingTask } from './model-tasks'
export const PLACE_KINDS = [
  'nation',
  'province',
  'city',
  'river',
  'peak',
  'range',
  'pass',
  'valley',
  'forest',
  'island',
  'continent',
  'sea',
  'bay',
  'strait',
  'port',
  'route',
  'person',
  'firm',
  'bank',
  'institution',
  'work',
  'belief',
  'battlefield',
  'memorial',
  'ruin',
] as const
export type PlaceKind = (typeof PLACE_KINDS)[number]
export interface PlaceName {
  name: string
  month: number
  language: number
  kind: 'former' | 'alternative'
  reason: string
}
export interface WorldFact {
  id: string
  month: number
  title: string
  detail: string
  places: string[]
  source: 'recorded' | 'initial' | 'legacy'
  event?: number
}
export interface PlaceAccount {
  task: WritingTask
  title: string
  text: string
  sources: string[]
  month: number
  asOf: number
  model: string
  question?: string
  status: 'interpretation' | 'tradition'
}
export interface AtlasEntry {
  id: string
  kind: PlaceKind
  name: string
  names: PlaceName[]
  cell: number
  located?: boolean
  regions: number[]
  language: number
  since: number
  related: string[]
  facts: string[]
  accounts: PlaceAccount[]
  milestones?: Record<string, string | number | boolean>
  attributes: Record<string, string | number | boolean>
  nameModel?: string
  naming: 'pending' | 'model' | 'established'
  revision: number
  /** Geography only; not transferred in regular UI snapshots. */
  geometry?: number[]
}
export interface NamingTradition {
  language: number
  roots: string[]
  endings: string[]
  convention: string
  demonym: string
  model: string
}
export interface Almanac {
  version: 1
  initialized: boolean
  since: number
  entries: Record<string, AtlasEntry>
  facts: Record<string, WorldFact>
  languages: Record<number, NamingTradition>
  lastMonth: number
  revision: number
}
export interface PlaceLabel {
  id: string
  name: string
  kind: PlaceKind
  cell: number
  importance: number
}
export interface PlaceQuery {
  id: number
  search?: string
  kind?: PlaceKind
  region?: number
  place?: string
  offset?: number
}
export interface PlaceResult {
  request: number
  month: number
  total: number
  offset: number
  entries: Omit<AtlasEntry, 'geometry'>[]
  selected?: Omit<AtlasEntry, 'geometry'>
  facts: WorldFact[]
  related: { id: string; name: string; kind: PlaceKind }[]
}
export interface WritingRequest {
  id: string
  task: WritingTask
  place: string
  question?: string
}
export interface WritingContext {
  task: WritingTask
  month: number
  revision: number
  place: Omit<AtlasEntry, 'geometry' | 'accounts' | 'facts'>
  facts: WorldFact[]
  neighbors: { id: string; name: string; kind: PlaceKind }[]
  tradition: NamingTradition
  question: string
  targets: { id: string; name: string; kind: PlaceKind; attributes: AtlasEntry['attributes'] }[]
}
