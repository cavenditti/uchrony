/** Persistent intent is separate from operational execution. Old saves acquire a
 * cabinet lazily; explicit directions expire without shutting down other desks. */
import type { Nation, World } from './types'

export const STRATEGIC_POSTURES = [
  'consolidate',
  'colonize',
  'industrialize',
  'prepare-war',
  'wage-war',
  'pacify-crisis',
] as const
export type StrategicPosture = (typeof STRATEGIC_POSTURES)[number]
export interface CabinetState {
  posture: StrategicPosture
  source: 'native' | 'model'
  started: number
  review: number
  /** Rival for military agendas, province for colonization/security, otherwise null. */
  target: number | null
  overrides: { key: string; until: number }[]
  wars: { rival: number; active: boolean; peace: number; grievance: number; balance: number }[]
  objectives?: { rival: number; province: number; review: number }[]
}

/** Cabinet bookkeeping never creates authority for a manually governed state. */
export function ensureCabinet(w: World, n: Nation): CabinetState {
  return (n.cabinet ??= {
    posture: 'consolidate',
    source: 'native',
    started: w.month,
    review: w.month,
    target: null,
    overrides: [],
    wars: [],
  })
}

/** A mandate lasts long enough to execute, but cannot permanently freeze policy. */
export function setCabinetAgenda(
  w: World,
  n: Nation,
  posture: StrategicPosture,
  target: number | null = null,
  source: CabinetState['source'] = 'native',
) {
  const cabinet = ensureCabinet(w, n)
  Object.assign(cabinet, {
    posture,
    target,
    source,
    started: w.month,
    review: w.month + (posture === 'prepare-war' ? 18 : 24),
  })
}

/** Only the named policy/research field/formation is reserved for the sovereign. */
export function reserveCabinetOrder(w: World, n: Nation, key: string) {
  const c = ensureCabinet(w, n)
  c.overrides = c.overrides.filter((entry) => entry.until > w.month && entry.key !== key)
  c.overrides.push({ key, until: w.month + 6 })
  c.overrides = c.overrides.slice(-64)
}
/** Expiry is exclusive, so a six-month-old override cannot lock the next review. */
export const cabinetOrderReserved = (w: World, n: Nation, key: string) =>
  n.cabinet?.overrides.some((entry) => entry.key === key && entry.until > w.month) ?? false

/** Foreign policy stays with an active model sovereign unless it delegates a
 * preparation campaign. Emergency peace is evaluated separately by the cabinet. */
export function nativeStrategicControl(w: World, n: Nation) {
  const agent = w.statecraft?.agents.find((a) => a.nation === n.id)
  return n.ai && n.extinct === undefined && !(agent?.lastModel && w.month - agent.lastDecision < 6)
}
