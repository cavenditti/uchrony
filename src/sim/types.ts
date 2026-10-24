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
export type Layer = 'political' | 'terrain' | 'population' | 'prosperity' | 'food' | 'trade' | 'military'

export interface Cell {
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
  id: number
  name: string
  nation: number
  culture: number
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
  consumption: Inventory
  prices: Inventory
  foodCoverage: number
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
}
export interface Nation {
  id: number
  name: string
  shortName: string
  color: string
  capital: number
  government: string
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
  a: number
  b: number
  opinion: number
  treaty: 'neutral' | 'trade' | 'alliance' | 'war' | 'truce'
  since: number
  warExhaustion: number
  grievance: number
}
export interface Army {
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
}
export interface RouteLeg {
  mode: 'land' | 'sea'
  cells: number[]
}
export interface Route {
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
export interface SimEvent {
  id: number
  month: number
  type: 'war' | 'peace' | 'economy' | 'population' | 'research' | 'diplomacy' | 'world'
  title: string
  detail: string
  nation?: number
  region?: number
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
  version: 1
  generatorVersion?: number
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
  | { type: 'policy'; nation: number; key: keyof Policies; value: Policies[keyof Policies] }
  | { type: 'research'; nation: number; field: Research }
  | {
      type: 'diplomacy'
      nation: number
      target: number
      action: 'improve' | 'trade' | 'alliance' | 'war' | 'peace' | 'embargo'
    }
  | { type: 'recruit'; nation: number; region: number }
  | { type: 'move'; army: number; target: number }
  | { type: 'build'; region: number; building: 'farm' | 'industry' | 'road' | 'school' }
  | { type: 'control'; nation: number | null }
  | { type: 'disaster'; region: number; disaster: 'drought' | 'epidemic' | 'abundance' }
export type WorkerRequest =
  | { type: 'generate'; seed: string; continents?: number; nations?: number }
  | { type: 'step'; count: number }
  | { type: 'command'; command: Command }
  | { type: 'load'; world: unknown }
export type WorkerResponse =
  { type: 'world'; world: World; message?: string } | { type: 'error'; message: string }

export const inventory = (value = 0): Inventory =>
  Object.fromEntries(GOODS.map((g) => [g, value])) as Inventory
export const population = (r: Region) => r.population.children + r.population.adults + r.population.elders
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))
export const relation = (world: World, a: number, b: number) =>
  world.relations.find((r) => r.a === Math.min(a, b) && r.b === Math.max(a, b))
export const dateLabel = (world: Pick<World, 'month' | 'startYear'>) =>
  `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][world.month % 12]} ${world.startYear + Math.floor(world.month / 12)}`
