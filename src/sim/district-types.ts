import type { Region, Inventory, RouteLeg } from './types'

export type DistrictActivity = 'agricultural' | 'mining' | 'industrial' | 'urban' | 'mixed' | 'wilderness'
export interface DistrictUnit extends Region {
  province: number
  node: string
  span: number
  /** Fixed opening scale converts legacy capital indices to equipment per resident. */
  capitalReference: number
  activity: DistrictActivity
  founded: number
  retired?: number
  predecessors: number[]
  residents: Record<number, number>
}
export interface DistrictShipment {
  from: number
  to: number
  good: keyof Inventory
  quantity: number
  value: number
  freight: number
  tariff: number
  cells: number[]
  legs: RouteLeg[]
}
/** A place: the administrative identity of one prominent mode of the settlement
 * field (see `places.ts`). Saved as `cities` for save compatibility; it holds no
 * assets, residents or accounts of its own, only who it administers. */
export interface City {
  id: number
  name: string
  aliases: string[]
  founded: number
  /** Terrain sample of the nucleus home (the administrative seat). */
  nucleus: number
  /** Terrain samples containing administered homes. */
  cells: number[]
  /** Occupants of the administered homes, hinterland included. */
  population: number
  /** Size class of the developed core, not of the administered census. */
  kind: 'village' | 'town' | 'city'
  parents: number[]
  absorbedBy?: number
  abandoned?: number
  lastNameChange: number
  /** Administered physical homes (occupied or vacant); several places may share one terrain sample. */
  sites?: string[]
  /** The occupied home nearest the place's density peak; anchors identity between refreshes. */
  nucleusSite?: string
  /** Descriptive field topology: developed residents within reach of the peak,
   * prominence (0–1), developed residents administered (the urban core that sets
   * `kind`), and the centre of mass of that core in metres. */
  field?: { reach: number; prominence: number; developed: number; x: number; y: number }
  /** @deprecated Prestige/wealth indicators of the retired integration rule; dropped on refresh. */
  standing?: { prestige: number; wealthPerResident: number }
  /** Link to, or incorporation as a quarter of, the place `centre` that administers it. */
  metropolis?: {
    centre: number
    /** Month the link began. */
    since: number
    /** Month it became a quarter of `centre`; absent while incorporation is still pending. */
    incorporated?: number
    /** Month the pending incorporation or release condition began. */
    pending?: number
    /** @deprecated Retired dominance timers; dropped on refresh. */
    dominantSince?: number
    /** @deprecated Retired dominance timers; dropped on refresh. */
    overwhelmingSince?: number
  }
  history?: {
    month: number
    kind: 'linked' | 'separated' | 'incorporated' | 'released' | 'merged'
    with: number
  }[]
}
export interface DistrictEconomy {
  version: 1
  initialized: number
  nextId: number
  active: number[]
  units: Record<number, DistrictUnit>
  /** Empty retired jurisdictions retain lineage, without live account machinery. */
  archive?: Record<
    number,
    { province: number; name: string; founded: number; retired: number; predecessors: number[] }
  >
  built: Record<number, number>
  /** Natural endowments, before extraction into owned inventories. */
  reserves: Record<number, { timber: number; stone: number; iron: number; coal: number }>
  cities: City[]
  nextCity: number
  shipments: DistrictShipment[]
  /** Exact UI-only throughput; canonical shipment paths remain in the simulation and saves. */
  shipmentTotals?: Record<number, { arriving: number; leaving: number }>
  revision: number
  lastRemesh: number
  provinceSignals?: Record<
    number,
    { infrastructure: number; fertility: number; devastation: number; unrest: number }
  >
  reorganizations: number
}
