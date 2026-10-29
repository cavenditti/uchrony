import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from './configuration-defaults'

/**
 * Ambient configuration context for synchronous simulation execution.
 *
 * Why dynamic scoping instead of passing `ConfigurationValues` to every function:
 * Low-level simulation formulas (demography, firm pricing, household demand,
 * route costs, settlement geometry) are called deep inside ticks, fast-forward
 * steps, save validation, and UI projections. Threading a configuration object
 * through every pure helper would clutter hundreds of call sites, whereas static
 * globals would let one world's parameters leak into another world or test.
 *
 * Binding `active` around synchronous entry points (`withWorldConfiguration` in
 * `tick`, `prepareSpatialWorld`, `validateWorld`, `generateWorld`) gives every
 * world isolated parameters without changing function signatures.
 */
let active: Readonly<ConfigurationValues> = DEFAULT_CONFIGURATION_VALUES
export const configurationValues = (): Readonly<ConfigurationValues> => active

/** Synchronous dynamic scope, like simulation-period. A complete tick, command,
 * initialization or projection uses one configuration; finally restores nested
 * experiment scopes even after an error. Never await inside this boundary. */
export function withConfigurationValues<T>(values: Readonly<ConfigurationValues>, run: () => T): T {
  const previous = active
  active = values
  try {
    return run()
  } finally {
    active = previous
  }
}

/**
 * Creates an isolated synchronous experiment scope for a single parameter group
 * (such as `decisionPolicy` or `expansionParameters`).
 *
 * Why this is separate from `active`:
 * Offline evaluation and policy-search scripts wrap an entire multi-month run
 * inside `withDecisionPolicy(...)` or `withExpansionParameters(...)`, and then
 * call `tick(world)` in a loop. Because each `tick(world)` enters
 * `withWorldConfiguration(world, ...)`, storing experiment overrides on `active`
 * directly would cause `withWorldConfiguration` to overwrite the experiment's
 * policy on the first tick. Keeping `override` in its own slot (`override ?? select(active)`)
 * lets outer experiment scopes take precedence across inner world ticks while
 * still unwinding cleanly in `finally`.
 */
export function createGroupScope<T>(
  select: (values: Readonly<ConfigurationValues>) => T,
  validate?: (value: Readonly<T>) => void,
) {
  let override: Readonly<T> | undefined
  return {
    get: (): Readonly<T> => override ?? select(active),
    withScope<R>(value: Readonly<T>, run: () => R): R {
      validate?.(value)
      const previous = override
      override = value
      try {
        return run()
      } finally {
        override = previous
      }
    },
  }
}

/**
 * Live read-only proxy view of a top-level configuration group (e.g. `MODEL_PARAMETERS`,
 * `SETTLEMENT`, `BASE_PRICE`).
 *
 * Why every property access goes through a `Proxy` trap:
 * Calculation modules import these group objects once at module load time, so
 * the exported reference itself must remain stable while reading from whatever
 * `active` world configuration is currently in scope. Consumers must not cache
 * or destructure primitive properties at module initialization time, or they
 * will capture the default value instead of the active world's value.
 *
 * Why the proxy target is `{ ...DEFAULT_CONFIGURATION_VALUES[group] }` (an
 * unfrozen shallow clone) rather than `DEFAULT_CONFIGURATION_VALUES[group]`:
 * `DEFAULT_CONFIGURATION_VALUES` is deeply `Object.freeze`d. In ECMAScript, a
 * frozen object's properties are `writable: false, configurable: false`, and the
 * runtime enforces a Proxy invariant that throws a `TypeError` if a `get` trap
 * returns any value different from the frozen target's own property value.
 * Using an unfrozen shallow copy as the backing target keeps its property
 * descriptors configurable so `get` can return customized values from `active`,
 * while the `set` trap still forbids mutation.
 */
export function parameterGroup<K extends keyof ConfigurationValues>(group: K): ConfigurationValues[K] {
  return new Proxy(
    { ...DEFAULT_CONFIGURATION_VALUES[group] },
    {
      get: (_target, key) => Reflect.get(active[group], key),
      set: () => {
        throw new Error('Use the configuration handler to change simulation parameters.')
      },
    },
  )
}
