import type { Army, RouteLeg } from './types'

export interface ArmyOperations {
  food: number
  arms: number
  fatigue: number
  cohesion: number
  loyalty: number
  entrenchment: number
  progress: number
  stance: 'march' | 'hold' | 'entrench'
  conduct: 'restrained' | 'requisition' | 'pillage'
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
  mission: 'patrol' | 'escort' | 'blockade' | 'transport' | 'return'
  course: number[]
  /** Distance already travelled toward the next waypoint, in terrain-sample spans. */
  sailingProgress?: number
  embarked: number[]
}
export interface Warfare {
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
