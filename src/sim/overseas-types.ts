/** Civilian expeditions retain dated families, their property and physical cargo
 * while travelling. A foothold records sponsorship, never provincial sovereignty. */
import type { EconomicStratum } from './economic-types'
import type { PopulationCommunity } from './population-types'
import type { Inventory, World } from './types'

export const EXPEDITION_STAGES = [
  'assembling',
  'sailing',
  'returning',
  'settled',
  'returned',
  'lost',
] as const
export type ExpeditionStage = (typeof EXPEDITION_STAGES)[number]
/** One funded voyage retains its households and accounts until a physical arrival or loss. */
export interface OverseasExpedition {
  id: number
  nation: number
  cell: number
  source: number
  departure: number
  arrival: number
  /** A recall can use another home coast if the departure port has been lost. */
  returnPort?: number
  fleet: number | null
  /** Actual household movements keep monthly migration distinct from deaths at sea. */
  departed?: { month: number; people: number }
  arrived?: { month: number; people: number }
  started: number
  updated: number
  stage: ExpeditionStage
  obstacle: string
  people: number
  communities: PopulationCommunity[]
  goods: Inventory
  accounts: Record<EconomicStratum | 'construction', { cash: number }>
  settlers: number
  wages: number
}
/** Durable expedition history and the latest sponsorship of each physical foothold. */
export interface OverseasState {
  nextId: number
  expeditions: OverseasExpedition[]
  footholds: { nation: number; cell: number; since: number; expedition: number }[]
}
/** Completed projects keep empty accounts so old ledger references remain valid. */
export const activeExpedition = (e: OverseasExpedition) =>
  ['assembling', 'sailing', 'returning'].includes(e.stage)
/** Stable account addresses preserve loans and ownership through arrival and succession. */
export const expeditionAccount = (id: number, stratum: EconomicStratum | 'construction') =>
  `expedition:${id}:${stratum}`
/** Cargo has its own physical store while detached from any resident market. */
export const expeditionStore = (id: number) => `expedition:${id}`
/** National and world population totals include living passengers outside resident markets. */
export const expeditionPeople = (w: World, nation?: number) =>
  (w.overseas?.expeditions ?? []).reduce(
    (sum, e) => sum + (nation === undefined || e.nation === nation ? e.people : 0),
    0,
  )
/** Save validators accept only known expedition accounts, including completed estates. */
export function expeditionOwner(w: World, account: string) {
  const match = /^expedition:(\d+):(smallholder|laborer|artisan|professional|owner|construction)$/.exec(
    account,
  )
  return !!match && !!w.overseas?.expeditions.some((e) => e.id === +match[1])
}

/** Net emigration into the mobile census during this month, excluding mortality. */
export const expeditionMigration = (w: World) =>
  (w.overseas?.expeditions ?? []).reduce(
    (sum, e) =>
      sum +
      (e.departed?.month === w.month ? e.departed.people : 0) -
      (e.arrived?.month === w.month ? e.arrived.people : 0),
    0,
  )
