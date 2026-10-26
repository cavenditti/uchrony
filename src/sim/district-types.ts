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
export interface City {
  id: number
  name: string
  aliases: string[]
  founded: number
  nucleus: number
  cells: number[]
  population: number
  kind: 'village' | 'town' | 'city'
  parents: number[]
  absorbedBy?: number
  lastNameChange: number
  /** Occupied physical parcels; several independent settlements may share one terrain sample. */
  sites?: string[]
  nucleusSite?: string
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
