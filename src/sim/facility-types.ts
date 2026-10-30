/** Facility identities are structural save/command contracts. Construction
 * recipes and economic coefficients live in the world configuration. */
import type { Good, Research } from './types'

export const FACILITY_KINDS = [
  'farm-estate',
  'timber-yard',
  'quarry',
  'iron-mine',
  'coal-mine',
  'tool-industry',
  'textile-industry',
  'arms-industry',
  'market',
] as const
export type FacilityKind = (typeof FACILITY_KINDS)[number]
export const FACILITY_DEFINITIONS = {
  'farm-estate': { name: 'Agricultural estate', sector: 'food', research: 'agriculture' },
  'timber-yard': { name: 'Timber yard', sector: 'timber', research: 'industry' },
  quarry: { name: 'Stone quarry', sector: 'stone', research: 'industry' },
  'iron-mine': { name: 'Iron mine', sector: 'iron', research: 'industry' },
  'coal-mine': { name: 'Coal mine', sector: 'coal', research: 'industry' },
  'tool-industry': { name: 'Tool works', sector: 'tools', research: 'industry' },
  'textile-industry': { name: 'Textile mill', sector: 'textiles', research: 'industry' },
  'arms-industry': { name: 'Arms works', sector: 'arms', research: 'industry' },
  market: { name: 'Market and warehouses', sector: 'market', research: 'logistics' },
} as const satisfies Record<FacilityKind, { name: string; sector: Good | 'market'; research: Research }>
/** Invert the canonical definitions once; a second handwritten sector map
 * would let production drift away from the construction catalogue. */
export const GOOD_FACILITY = Object.freeze(
  Object.fromEntries(
    FACILITY_KINDS.filter((kind) => kind !== 'market').map((kind) => [
      FACILITY_DEFINITIONS[kind].sector,
      kind,
    ]),
  ) as Record<Good, FacilityKind>,
)
export const isFacilityKind = (value: string): value is FacilityKind =>
  Object.hasOwn(FACILITY_DEFINITIONS, value)
/** Shared physical capacity prevents every activity being maximized on one tile. */
export const MAX_FACILITY_LEVELS = 6
export type FacilityLevels = Partial<Record<FacilityKind, number>>
export interface FacilityProject {
  nation: number
  cell: number
  kind: FacilityKind
  level: number
  funded: number
  completes: number
  cost: number
}
export interface FacilitySystem {
  sites: Record<number, FacilityLevels>
  projects: FacilityProject[]
}
