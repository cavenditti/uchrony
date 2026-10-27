/** Model assignments belong to the local service, never to an imported world. */
export const MODEL_TASKS = {
  naming: {
    label: 'Place and actor names',
    description: 'Cities, rivers, peaks, routes, people and organizations.',
    tokens: 1800,
    group: 'World writing',
  },
  culture: {
    label: 'Naming traditions',
    description: 'Reusable roots and naming conventions for each language.',
    tokens: 1200,
    group: 'World writing',
  },
  description: {
    label: 'Place descriptions',
    description: 'Geography, livelihoods and neighboring places.',
    tokens: 1000,
    group: 'World writing',
  },
  biography: {
    label: 'Local histories',
    description: 'Dated accounts drawn from a place’s permanent records.',
    tokens: 1600,
    group: 'World writing',
  },
  tradition: {
    label: 'Traditions and local voices',
    description: 'Attributed legends, sayings and ceremonies; never historical evidence.',
    tokens: 1000,
    group: 'World writing',
  },
  chronicle: {
    label: 'Local reports',
    description: 'Short accounts of recorded everyday developments.',
    tokens: 1200,
    group: 'World writing',
  },
  historian: {
    label: 'Ask a historian',
    description: 'Answers supported by the selected place’s records.',
    tokens: 1600,
    group: 'World writing',
  },
  details: {
    label: 'Expanded event accounts',
    description: 'More detail about an event that has already occurred.',
    tokens: 800,
    group: 'World writing',
  },
  history: {
    label: 'Historical developments',
    description: 'Proposes events, responses and bounded consequences.',
    tokens: 4000,
    group: 'Simulation',
  },
  decision: {
    label: 'Routine government decisions',
    description: 'Frequent, compact assessments of state policy.',
    tokens: 1600,
    group: 'Simulation',
  },
  strategy: {
    label: 'Strategic reviews',
    description: 'Longer assessments of competing priorities.',
    tokens: 5000,
    group: 'Simulation',
  },
  referee: {
    label: 'Diplomatic settlements',
    description: 'Reviews consent, commitments and unusual agreements.',
    tokens: 6500,
    group: 'Simulation',
  },
} as const
export type ModelTask = keyof typeof MODEL_TASKS
export type WritingTask =
  'naming' | 'culture' | 'description' | 'biography' | 'tradition' | 'chronicle' | 'historian'
export const WRITING_TASKS: WritingTask[] = [
  'naming',
  'culture',
  'description',
  'biography',
  'tradition',
  'chronicle',
  'historian',
]
export const isModelTask = (x: string): x is ModelTask => Object.hasOwn(MODEL_TASKS, x)
export const isWritingTask = (x: string): x is WritingTask => WRITING_TASKS.includes(x as WritingTask)
export interface ModelAssignment {
  model: string
  preference: 'price' | 'latency' | 'throughput'
}
export interface ModelSettings {
  version: 1
  assignments: Record<ModelTask, ModelAssignment>
  backgroundWriting: boolean
  backgroundInterval: number
  sessionCallLimit: number
}
export interface ModelOption {
  id: string
  name: string
  context: number
  inputPrice: number | null
  outputPrice: number | null
  structured: boolean
  json: boolean
  outputLimit?: number
}
export interface ModelMeasurement {
  calls: number
  failures: number
  elapsedMs: number
  outputTokens: number
  cost: number
  costKnown: boolean
}
export interface ModelServiceSnapshot {
  settings: ModelSettings
  models: ModelOption[]
  measurements: Record<string, ModelMeasurement>
  calls: number
  catalogError: string
}
export function defaultModelSettings(env: Record<string, string | undefined> = {}): ModelSettings {
  const history = env.OPENROUTER_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash'
  const writing = env.OPENROUTER_WRITING_MODEL?.trim() || 'mistralai/ministral-8b-2512'
  const strategy = env.OPENROUTER_STRATEGY_MODEL?.trim() || history
  return {
    version: 1,
    backgroundWriting: true,
    backgroundInterval: 90,
    sessionCallLimit: 300,
    assignments: Object.fromEntries(
      Object.keys(MODEL_TASKS).map((task) => [
        task,
        {
          model:
            task === 'history'
              ? history
              : task === 'strategy'
                ? strategy
                : task === 'referee'
                  ? env.OPENROUTER_REFEREE_MODEL?.trim() || strategy
                  : task === 'decision'
                    ? env.OPENROUTER_DECISION_MODEL?.trim() || writing
                    : writing,
          preference: task === 'decision' || task === 'historian' ? 'latency' : 'price',
        },
      ]),
    ) as ModelSettings['assignments'],
  }
}
export function validateModelSettings(value: unknown): ModelSettings {
  const s = value as ModelSettings
  if (
    !s ||
    s.version !== 1 ||
    typeof s.backgroundWriting !== 'boolean' ||
    !Number.isInteger(s.backgroundInterval) ||
    s.backgroundInterval < 30 ||
    s.backgroundInterval > 3600 ||
    !Number.isInteger(s.sessionCallLimit) ||
    s.sessionCallLimit < 0 ||
    s.sessionCallLimit > 10000
  )
    throw new Error('Invalid model settings. Use 30–3600 seconds and 0–10000 calls.')
  const assignments = {} as ModelSettings['assignments']
  for (const task of Object.keys(MODEL_TASKS) as ModelTask[]) {
    const a = s.assignments?.[task]
    if (
      !a ||
      typeof a.model !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,159}$/.test(a.model) ||
      !['price', 'latency', 'throughput'].includes(a.preference)
    )
      throw new Error(`Choose a valid model for ${MODEL_TASKS[task].label}.`)
    assignments[task] = { model: a.model, preference: a.preference }
  }
  return {
    version: 1,
    assignments,
    backgroundWriting: s.backgroundWriting,
    backgroundInterval: s.backgroundInterval,
    sessionCallLimit: s.sessionCallLimit,
  }
}
