/** Scoped model calibration; defaults and validation belong to the configuration registry. */
import { parameterGroup } from './configuration-context'
export { DEFAULT_MODEL_PARAMETERS } from './configuration-defaults'
export type { ModelParameters } from './configuration-defaults'
export const MODEL_PARAMETERS = parameterGroup('model')
