import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from './configuration-defaults'

let active: Readonly<ConfigurationValues> = DEFAULT_CONFIGURATION_VALUES
export const configurationValues = () => active

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

/** Stable compatibility view for existing calculation modules. Each property is
 * resolved at use time, so loading a second world cannot retain the first one's
 * coefficients. Consumers must not cache these values at module initialization. */
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
