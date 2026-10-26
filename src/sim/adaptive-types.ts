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
export interface PhysicalSite extends PointMeters {
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
}
export interface Jurisdiction {
  id: string
  level: 'municipality' | 'province'
  name: string
  nation: number
  seat: number
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
  version: 1
  initialized: number
  revision: number
  /** The existing map's neighboring cell centers are 1 km apart. Explicit synthetic scale. */
  metersPerMapUnit: number
  minimumSpan: number
  mode: 'adaptive' | 'coarse' | 'fine'
  tree: { leaves: string[]; changed: Record<string, number>; month: number }
  sites: Record<string, PhysicalSite>
  jurisdictions: Record<string, Jurisdiction>
  nextJurisdiction: number
  boundaries: BoundaryRecord[]
  names: { id: string; name: string; cell: number; since: number; aliases: string[] }[]
  commuting: CommuteFlow[]
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
  construction?: { site: string; capacity: number; cost: number; remaining: number }[]
  migration: { source: 'legacy'; month: number; assumptions: string[] }
  reviewMonth: number
}
export interface SpatialFragment {
  cell: number
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
  indicator: number
}
export interface SpatialInterface {
  id: string
  a: string
  b: string
  length: number
}
export interface AdaptiveMesh {
  leaves: AdaptiveNode[]
  interfaces: SpatialInterface[]
  revision: number
}
