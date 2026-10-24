import { DRIVE_AXES } from './ambitions'
import type { World } from './types'
import { CHARACTER_AXES, LEADER_SKILLS, type Attitudes } from './character-types'
import { LEADER_PERKS } from './character'

export function validateCharacters(world: World) {
  const fail = (): never => {
    throw new Error('Invalid state character or leadership profile in this save.')
  }
  const object = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  const number = (v: unknown, low = 0, high = 1) =>
    typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high
  const integer = (v: unknown, max: number) => number(v, 0, max) && Number.isInteger(v)
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
  const attitudes = (v: Attitudes) => object(v) && CHARACTER_AXES.every((key) => number(v[key]))
  const supported = [
    'taxIncome',
    'research',
    'education',
    'tradeCost',
    'tradeCapacity',
    'militaryPower',
    'armyMorale',
    'cohesion',
  ]
  for (const nation of world.nations) {
    const c = nation.character
    if (c === undefined) continue // Older worlds acquire a profile without changing their policies.
    if (
      !object(c) ||
      c.version !== 1 ||
      !integer(c.updated, world.month) ||
      !text(c.government, 300) ||
      !attitudes(c.popular) ||
      !attitudes(c.institutions) ||
      !attitudes(c.effective) ||
      !object(c.influence) ||
      !['people', 'institutions', 'leader'].every((key) =>
        number(c.influence[key as keyof typeof c.influence]),
      ) ||
      Math.abs(c.influence.people + c.influence.institutions + c.influence.leader - 1) > 1e-9 ||
      !number(c.mandateGap) ||
      !text(c.title, 160) ||
      !text(c.description, 900) ||
      !Array.isArray(c.priorities) ||
      c.priorities.length !== 3 ||
      c.priorities.some((p) => !text(p, 200)) ||
      !object(c.modifiers) ||
      Object.entries(c.modifiers).some(
        ([key, value]) => !supported.includes(key) || !number(value, -0.09, 0.09),
      ) ||
      !object(c.leader)
    )
      fail()
    const leader = c.leader
    if (
      !text(leader.name, 180) ||
      !integer(leader.since, world.month) ||
      !integer(leader.generation, 1e6) ||
      !attitudes(leader.attitudes) ||
      !object(leader.skills) ||
      !LEADER_SKILLS.every((key) => number(leader.skills[key])) ||
      !Array.isArray(leader.perks) ||
      leader.perks.length !== 3 ||
      new Set(leader.perks).size !== 3 ||
      leader.perks.some((key) => typeof key !== 'string' || !Object.hasOwn(LEADER_PERKS, key)) ||
      leader.perks.filter((key) => LEADER_PERKS[key].strength).length !== 2
    )
      fail()
    const politics = leader.politics
    if (
      politics !== undefined &&
      (!object(politics) ||
        !text(politics.archetype, 100) ||
        !object(politics.drives) ||
        !DRIVE_AXES.every((key) => number(politics.drives[key])) ||
        !text(politics.ambition, 500) ||
        !text(politics.redLine, 500) ||
        !text(politics.blindSpot, 500))
    )
      fail()
    const society = world.historical?.societies.find((s) => s.nation === nation.id)
    if (society && (society.leader !== leader.name || society.since !== leader.since)) fail()
  }
}
