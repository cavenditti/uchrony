import type { ModifierStat } from './history-types'

export const CHARACTER_AXES = [
  'assertiveness',
  'openness',
  'solidarity',
  'centralization',
  'commercialism',
  'patience',
] as const
export type CharacterAxis = (typeof CHARACTER_AXES)[number]
export type Attitudes = Record<CharacterAxis, number>
export const LEADER_SKILLS = ['administration', 'diplomacy', 'logistics', 'scholarship', 'command'] as const
export type LeaderSkill = (typeof LEADER_SKILLS)[number]
export interface LeaderCharacter {
  name: string
  since: number
  generation: number
  attitudes: Attitudes
  skills: Record<LeaderSkill, number>
  perks: string[]
}
export interface StateCharacter {
  version: 1
  updated: number
  government: string
  popular: Attitudes
  institutions: Attitudes
  effective: Attitudes
  influence: { people: number; institutions: number; leader: number }
  leader: LeaderCharacter
  mandateGap: number
  title: string
  description: string
  priorities: string[]
  modifiers: Partial<Record<ModifierStat, number>>
}
