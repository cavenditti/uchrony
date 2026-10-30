import type { EconomicStratum } from './economic-types'

export interface PointMeters {
  x: number
  y: number
}
export interface SpatialBounds {
  x: number
  y: number
  size: number
}
export interface SettlementLane {
  id?: string
  load?: number
  upgraded?: number
  pool: number
  founded: number
  width: number
  points: PointMeters[]
  /** One deliberately surveyed bank-to-bank span, never ordinary frontage. */
  bridge?: true
}
export interface PhysicalSite extends PointMeters {
  fabric?: import('./urban-types').UrbanBuilding
  /** A firm's exact leased/owned physical premises; accounts remain with its economic entity. */
  premises?: string
  capitalOwner?: string
  id: string
  cell: number
  pool: number
  kind: 'residential' | 'establishment' | 'market' | 'civic'
  entity: string
  founded: number
  capacity: number
  openingCapacity: number
  openingBuilt?: number
  capitalReference: number
  retired?: number
  investedValue?: number
  /** Exact occupancy at a persistent physical parcel; independent of numerical leaves. */
  residents?: number
  /** Physical building plot in meters, retained through numerical split/merge. */
  parcel?: SpatialBounds
  /** Actual building footprint within this lot; economics remain in the parent pool. */
  building?: PointMeters[]
}
export interface Jurisdiction {
  id: string
  level: 'municipality' | 'province'
  name: string
  nation: number
  seat: number
  /** Local service offices can survive a legal merger; residents need not travel to one capital. */
  serviceSeats?: number[]
  cells: number[]
  founded: number
  revised: number
  retired?: number
  successors: string[]
  predecessors: string[]
  /** Public obligations remain with this permanent legal entity after retirement. */
  account: string
}
export interface BoundaryRecord {
  month: number
  level: Jurisdiction['level']
  from: string[]
  to: string[]
  assignments: [number, string][]
  reason: string
  cost: number
}
export interface CommuteFlow {
  residence: number
  workplace: string
  stratum: EconomicStratum
  workers: number
  wage: number
  minutes: number
  mode: 'walk' | 'rail' | 'road'
  route?: string
  cells?: number[]
}
export interface AdaptiveWorld {
  urban?: import('./urban-types').UrbanEvolution
  version: 1
  initialized: number
  revision: number
  /** Fixed conversion between render coordinates and physical metres. */
  metersPerMapUnit: number
  minimumSpan: number
  mode: 'adaptive' | 'coarse' | 'fine'
  tree: { leaves: string[]; changed: Record<string, number>; month: number; domain?: 'world' }
  sites: Record<string, PhysicalSite>
  jurisdictions: Record<string, Jurisdiction>
  nextJurisdiction: number
  boundaries: BoundaryRecord[]
  names: { id: string; name: string; cell: number; since: number; aliases: string[] }[]
  commutingRows?: import('./commute-ledger').CommuteRow[]
  commuteRoutes?: Record<string, { cells: number[]; minutes: number; mode: 'walk' | 'rail' | 'road' }>
  nextTransit?: number
  transit?: {
    id: number
    from: number
    to: number
    owner: string
    dispatched: number
    arrives: number
    goods: import('./types').Inventory
    legs: import('./types').RouteLeg[]
  }[]
  construction?: {
    site: string
    capacity: number
    cost: number
    remaining: number
    sponsor?: string
    host?: number
  }[]
  reviewMonth: number
  residentialVersion?: 1
  buildingVersion?: 1
  /** Surveyed local access paths; geometry persists independently of the mesh. */
  lanes?: SettlementLane[]
  nextResidence?: number
}
export interface SpatialFragment {
  /** Stable source geography, not the identity of the active numerical cell. */
  cell: number
  water?: boolean
  polygon: PointMeters[]
  area: number
}
export interface AdaptiveNode {
  id: string
  bounds: SpatialBounds
  fragments: SpatialFragment[]
  sites: string[]
  pools: number[]
  population: number
  jobs: number
  landArea: number
  waterArea?: number
  indicator: number
}
export interface SpatialInterface {
  id: string
  a: string
  b: string
  /** Actual shared domain boundary, excluding gaps outside the imported geography. */
  length: number
  landLength?: number
  waterLength?: number
  coastLength?: number
}
export interface AdaptiveMesh {
  leaves: AdaptiveNode[]
  interfaces: SpatialInterface[]
  revision: number
}
