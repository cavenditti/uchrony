/** Small predicates shared by untrusted save readers. Bounds belong to each domain:
 * money, IDs and unit shares deliberately do not inherit one universal ceiling.
 * Predicates never coerce strings or repair state; callers retain cross-field invariants. */
import { GOODS, type Inventory, type World } from './types'

/** Plain record shape (class instances are treated as data, matching legacy saves). */
export const recordValue = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
/** Finite numeric interval, inclusive at both boundaries. */
export const finiteNumber = (value: unknown, min = 0, max = Infinity): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
/** Retain integer versus safe-integer requirements explicitly at each boundary. */
export const integerNumber = (value: unknown, min = 0, max = Infinity, safe = false): value is number =>
  finiteNumber(value, min, max) && (safe ? Number.isSafeInteger(value) : Number.isInteger(value))
/** Bind a domain's defaults while allowing narrower field-specific ranges. */
export const numberValidator =
  (low = 0, high = Infinity) =>
  (value: unknown, min = low, max = high): value is number =>
    finiteNumber(value, min, max)
/** Bind domain defaults for integer identifiers, counters and dates. */
export const integerValidator =
  (low = 0, high = Infinity, safe = false) =>
  (value: unknown, min = low, max = high): value is number =>
    integerNumber(value, min, max, safe)
/** Max-only forms retain historical validator call signatures. */
export const numberAtMost =
  (high = Infinity) =>
  (value: unknown, max = high): value is number =>
    finiteNumber(value, 0, max)
/** Max-only integer bounds, optionally restricted to exactly representable IDs. */
export const integerAtMost =
  (high = Infinity, safe = false) =>
  (value: unknown, max = high): value is number =>
    integerNumber(value, 0, max, safe)
/** Empty narrative text is allowed only when the owning domain permits it. */
export const textValidator =
  (high = Infinity, min = 0) =>
  (value: unknown, max = high): value is string =>
    typeof value === 'string' && value.length >= min && value.length <= max
/** Preserve domain-specific errors without duplicating throw implementations. */
export const validationFailure =
  (prefix: string, suffix = '', defaultDetail = '') =>
  (detail = defaultDetail): never => {
    throw new Error(prefix + detail + suffix)
  }

/** World-scoped references are checked against current registries, never cached lengths. */
export function worldValidators(world: World) {
  return {
    nationId: (value: unknown) => integerNumber(value, 0, world.nations.length - 1),
    regionId: (value: unknown) => integerNumber(value, 0, world.regions.length - 1),
    cellId: (value: unknown) => integerNumber(value, 0, world.cells.length - 1, true),
    unit: (value: unknown) => finiteNumber(value, 0, 1),
    inventory: (value: unknown, max = 1e16): value is Inventory =>
      recordValue(value) && GOODS.every((good) => finiteNumber(value[good], 0, max)),
  }
}
