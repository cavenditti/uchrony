import type { Region, World } from './types'

/** Administrative provinces are summaries; these are the actual resident markets. */
export const economicRegions = (w: World): Region[] =>
  w.localEconomy ? w.localEconomy.active.map((id) => w.localEconomy!.units[id]) : w.regions
export const economicRegion = (w: World, id: number): Region => w.localEconomy?.units[id] ?? w.regions[id]
export const provinceId = (r: Region) => r.province ?? r.id
export const localFirmRegion = (f: { region: number; locality?: number }) => f.locality ?? f.region
