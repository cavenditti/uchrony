/** Compatibility names; all defaults and validation now live in configuration. */
import { parameterGroup } from './configuration-context'
export { DEFAULT_MODEL_PARAMETERS } from './configuration-defaults'
export type { ModelParameters } from './configuration-defaults'
export const MODEL_PARAMETERS = parameterGroup('model')
