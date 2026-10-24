export const HISTORY_CATEGORIES = [
  'succession',
  'discovery',
  'literature',
  'belief',
  'institutions',
  'social',
  'commerce',
  'disaster',
  'diplomacy',
] as const
export type HistoryCategory = (typeof HISTORY_CATEGORIES)[number]
export const MODIFIER_STATS = [
  'harvest',
  'extraction',
  'manufacturing',
  'tradeCost',
  'tradeCapacity',
  'taxIncome',
  'research',
  'education',
  'healthcare',
  'birthRate',
  'mortality',
  'migrationAttraction',
  'cohesion',
  'militaryPower',
  'armyMorale',
] as const
export type ModifierStat = (typeof MODIFIER_STATS)[number]
export const CHANGE_STATS = [
  'stability',
  'legitimacy',
  'treasury',
  'opinion',
  'unrest',
  'literacy',
  'health',
  'happiness',
  'devastation',
  'infrastructure',
  'researchProgress',
  'prestige',
  'pluralism',
] as const
export type ChangeStat = (typeof CHANGE_STATS)[number]
export type HistoryScope = 'world' | 'nation' | 'region' | 'relation'

/** A data-only instruction. Models cannot provide executable code or arbitrary property paths. */
export interface HistoricalEffect {
  kind: 'modifier' | 'change' | 'leadership' | 'legacy'
  scope: HistoryScope
  target: number
  other: number
  stat: ModifierStat | ChangeStat | 'leader' | 'literature' | 'belief' | 'institution'
  amount: number
  duration: number
  delay: number
  curve: 'steady' | 'fade' | 'grow'
  field: '' | 'agriculture' | 'industry' | 'medicine' | 'logistics' | 'military' | 'governance'
  text: string
}
export interface HistoryCondition {
  metric:
    | 'stability'
    | 'legitimacy'
    | 'treasury'
    | 'literacy'
    | 'foodCoverage'
    | 'unrest'
    | 'pluralism'
    | 'prestige'
    | 'tax'
    | 'wars'
  comparison: 'above' | 'below'
  value: number
}
export interface HistoricalResponse {
  name: string
  rationale: string
  affinity: 'reform' | 'coercion' | 'patronage' | 'commerce' | 'relief' | 'neutral'
  weight: number
  conditions: HistoryCondition[]
  effects: HistoricalEffect[]
}
export interface HistoricalFollowUp {
  afterMonths: number
  withinMonths: number
  probability: number
  conditions: HistoryCondition[]
  title: string
  description: string
  effects: HistoricalEffect[]
}
export interface HistoricalProposal {
  category: HistoryCategory
  title: string
  description: string
  nation: number
  region: number
  causeEvent: number
  conditions: HistoryCondition[]
  effects: HistoricalEffect[]
  responses: HistoricalResponse[]
  followUps: HistoricalFollowUp[]
}
export interface HistoricalRecord {
  category: HistoryCategory
  source: 'openrouter' | 'procedural' | 'consequence'
  model: string
  causeEvent: number
  response: string
  rationale: string
  effects: HistoricalEffect[]
}
export interface ActiveHistoricalEffect {
  id: number
  event: number
  title: string
  region: number
  start: number
  end: number
  effect: HistoricalEffect
}
export interface HistoricalSociety {
  nation: number
  leader: string
  since: number
  tradition: string
  prestige: number
  pluralism: number
}
export interface HistoricalOpportunity {
  id: number
  month: number
  nation: number
  region: number
  category: HistoryCategory
  seed: number
}
export interface HistoricalState {
  rng: number
  nextRoll: number
  nextId: number
  opportunity: HistoricalOpportunity | null
  prepared?: { proposal: HistoricalProposal; model: string; received: number; requested: number }[]
  effects: ActiveHistoricalEffect[]
  scheduled: {
    event: number
    nation: number
    region: number
    category: HistoryCategory
    model: string
    due: number
    expires: number
    chance: boolean
    followUp: HistoricalFollowUp
  }[]
  societies: HistoricalSociety[]
  legacies: {
    event: number
    nation: number
    region: number
    month: number
    kind: 'literature' | 'belief' | 'institution'
    name: string
  }[]
}
export interface StorytellerStatus {
  state: 'connecting' | 'ready' | 'generating' | 'error'
  model: string
  message: string
}
