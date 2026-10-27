import {
  DEFAULT_MODELS,
  MODEL_TASKS,
  MODEL_TASK_TIERS,
  type ModelOption,
  type ModelSettings,
  type ModelTask,
  type ModelTier,
} from './model-tasks'

export const MODEL_TIERS = ['light', 'strong'] as const
export const MODEL_TIER_LABELS: Record<ModelTier, { label: string; description: string }> = {
  light: {
    label: 'Lightweight model',
    description: 'For names, descriptions, local color and routine decisions.',
  },
  strong: {
    label: 'Strong model',
    description: 'For histories, historian answers, strategy and diplomacy.',
  },
}

/** Curated for these workloads, checked against provider descriptions on 2026-10-27.
 * Availability and protocol compatibility are checked against the live catalog below.
 * These are recommendations, not measured quality or speed rankings. Keep each list <= 8.
 * See docs/WORLD_ATLAS.md for selection rationale and provider sources. */
export const RECOMMENDED_MODELS: Record<ModelTier, readonly string[]> = {
  light: [
    DEFAULT_MODELS.light,
    'mistralai/ministral-8b-2512',
    'mistralai/mistral-small-2603',
    'google/gemini-3.1-flash-lite',
    'qwen/qwen3.8-flash',
    'anthropic/claude-haiku-5.5',
    'openai/gpt-6-luna',
  ],
  strong: [
    DEFAULT_MODELS.strong,
    'deepseek/deepseek-v4.1-flash',
    'deepseek/deepseek-v4-pro',
    'mistralai/mistral-large-4-0',
    'openai/gpt-6.1-terra',
    'openai/gpt-6-sol',
    'anthropic/claude-sonnet-4.6',
  ],
}

export function tierTasks(tier: ModelTier): ModelTask[] {
  return (Object.keys(MODEL_TASKS) as ModelTask[]).filter((task) => MODEL_TASK_TIERS[task] === tier)
}

export function tierModel(settings: ModelSettings, tier: ModelTier): string {
  const models = new Set(tierTasks(tier).map((task) => settings.assignments[task].model))
  return models.size === 1 ? [...models][0] : ''
}

export function tierChoices(models: ModelOption[], tier: ModelTier): ModelOption[] {
  const output = Math.max(...tierTasks(tier).map((task) => MODEL_TASKS[task].tokens))
  return RECOMMENDED_MODELS[tier]
    .map((id) => models.find((model) => model.id === id))
    .filter(
      (model): model is ModelOption =>
        !!model &&
        (model.json || model.structured) &&
        model.context >= (tier === 'light' ? 32768 : 65536) &&
        (model.outputLimit ?? 0) >= output &&
        !model.reasoningRequired,
    )
    .slice(0, 8)
}

/** Group model edits leave provider priorities, limits and the other group untouched. */
export function assignTier(settings: ModelSettings, tier: ModelTier, model: string): ModelSettings {
  const assignments = { ...settings.assignments }
  for (const task of tierTasks(tier)) assignments[task] = { ...assignments[task], model }
  return { ...settings, assignments }
}
