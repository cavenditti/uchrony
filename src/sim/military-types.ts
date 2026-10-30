import type { Army, RouteLeg } from './types'

/** One retained destination coordinates land marches and a reserved sea passage. */
export interface ArmyJourney {
  destination: number
  departure: number
  arrival: number
  fleet: number | null
  started: number
  stage: 'assembling' | 'boarding' | 'sailing' | 'landing' | 'inland' | 'waiting'
  obstacle: string
}

export interface ArmyOperations {
  journey?: ArmyJourney
  food: number
  arms: number
  fatigue: number
  cohesion: number
  loyalty: number
  entrenchment: number
  progress: number
  stance: 'march' | 'hold' | 'entrench'
  conduct: 'restrained' | 'requisition' | 'pillage' | 'raid' | 'raze'
  /** Temporary access permits a three-month visit, not an indefinite garrison. */
  foreignStay?: { host: number; months: number }
  isolated: number
  disorder: number
  embarkedOn: number | null
  source: number | null
  line: number[]
  march: number[]
}
/** Fleet crew uses the same identity-preserving people ledger as army soldiers. */
export interface Fleet extends Army {
  home: number
  cell: number
  warships: number
  transports: number
  hull: number
  food: number
  arms: number
  mission: 'patrol' | 'escort' | 'blockade' | 'raid' | 'transport' | 'return'
  foreignStay?: { host: number; months: number }
  course: number[]
  /** Distance already travelled toward the next waypoint, in terrain-sample spans. */
  sailingProgress?: number
  embarked: number[]
}
export interface Warfare {
  raids?: import('./trade-raids').TradeRaid[]
  version: 1
  revision: number
  fleets: Fleet[]
  deliveries: {
    army: number
    from: number
    month: number
    food: number
    arms: number
    path: number[]
    legs: RouteLeg[]
  }[]
}
