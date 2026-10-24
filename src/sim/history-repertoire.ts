import { HISTORY_CATEGORIES, MODIFIER_STATS, type HistoryCategory, type ModifierStat } from './history-types'

/** Model-authored mechanisms are declarative, portable seeds, never executable event handlers. */
export interface HistoryPattern {
  category: HistoryCategory
  name: string
  development: string
  gain: ModifierStat
  friction: ModifierStat
  model: string
}
export const HISTORY_PATTERNS_SCHEMA = {
  type: 'array',
  maxItems: 3,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      category: { type: 'string', enum: HISTORY_CATEGORIES },
      name: { type: 'string', minLength: 1, maxLength: 90 },
      development: { type: 'string', minLength: 1, maxLength: 220 },
      gain: {
        type: 'string',
        enum: MODIFIER_STATS.filter((stat) => stat !== 'mortality' && stat !== 'birthRate'),
      },
      friction: { type: 'string', enum: MODIFIER_STATS.filter((stat) => stat !== 'birthRate') },
    },
    required: ['category', 'name', 'development', 'gain', 'friction'],
  },
}
export function parseHistoryPatterns(value: unknown, model: string, max = 3): HistoryPattern[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid historical repertoire.')
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !HISTORY_CATEGORIES.includes(entry.category) ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      entry.name.length > 90 ||
      typeof entry.development !== 'string' ||
      !entry.development.trim() ||
      entry.development.length > 220 ||
      !MODIFIER_STATS.includes(entry.gain) ||
      ['mortality', 'birthRate'].includes(entry.gain) ||
      !MODIFIER_STATS.includes(entry.friction) ||
      entry.friction === 'birthRate'
    )
      throw new Error(
        'Invalid historical pattern. Use short portable descriptions and supported modifier stats.',
      )
    return {
      category: entry.category,
      name: entry.name.trim(),
      development: entry.development.trim(),
      gain: entry.gain,
      friction: entry.friction,
      model: model.slice(0, 160),
    }
  })
}
