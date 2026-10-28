import type { PointMeters, SpatialBounds } from './adaptive-types'

export const URBAN_USES = ['housing', 'production', 'market', 'logistics', 'civic'] as const
export type UrbanUse = (typeof URBAN_USES)[number]
export type FloorUses = Record<UrbanUse, number>
export interface UrbanBuilding {
  floorArea: number
  uses: FloorUses
  condition: number
  built: number
  altered: number
  survey: 'recorded' | 'aggregate'
  /** Durable identity links, never a second population or financial account. */
  predecessors: string[]
  successors: string[]
  occupants: string[]
}
export interface UrbanShape {
  site: string
  point: PointMeters
  cell: number
  parcel: SpatialBounds
  building: PointMeters[]
  capacity: number
  fabric: UrbanBuilding
}
export type UrbanProjectKind =
  'repair' | 'extend' | 'convert' | 'replace' | 'consolidate' | 'connect' | 'widen' | 'realign'
export interface UrbanProject {
  id: number
  kind: UrbanProjectKind
  status: 'proposed' | 'funded' | 'clearing' | 'construction' | 'occupied' | 'cancelled'
  proposed: number
  started?: number
  completed?: number
  sponsor: string
  pool: number
  host: number
  sites: string[]
  reason: string
  benefit: number
  cost: number
  inputs: { timber: number; stone: number; labor: number }
  duration: number
  before: UrbanShape[]
  after: UrbanShape[]
  displaced: { from: string; to: string; people: number }[]
  lane?: { id?: string; width: number; points: PointMeters[]; before?: PointMeters[] }
}
export interface UrbanEvent {
  month: number
  project: number
  kind: UrbanProjectKind
  sites: string[]
  reason: string
}
export interface UrbanEvolution {
  version: 1
  enabled: boolean
  initialized: number
  lastMonth: number
  nextProject: number
  nextLane: number
  streetRevision: number
  projects: UrbanProject[]
  history: UrbanEvent[]
  /** Persistent evidence; opportunities depend on elapsed time, not number of ticks. */
  pressure: Record<string, { use: UrbanUse; since: number; reviewed: number; score: number }>
}
