import { ensureAmbition } from './ambitions'
import { simulationSettings } from './settings'
import {
  CHARACTER_AXES,
  LEADER_SKILLS,
  type Attitudes,
  type CharacterAxis,
  type LeaderCharacter,
  type LeaderSkill,
  type StateCharacter,
} from './character-types'
import type { ModifierStat } from './history-types'
import { allForces } from './forces'
import { hashSeed, random } from './random'
import { clamp, FIELDS, population, type Nation, type Policies, type Research, type World } from './types'

const attitudes = (values: number[]): Attitudes =>
  Object.fromEntries(CHARACTER_AXES.map((axis, i) => [axis, values[i]])) as Attitudes
export const CHARACTER_LABELS: Record<CharacterAxis, [string, string]> = {
  assertiveness: ['Conciliatory', 'Assertive'],
  openness: ['Traditional', 'Reform-minded'],
  solidarity: ['Elite interests', 'Public welfare'],
  centralization: ['Local autonomy', 'Central authority'],
  commercialism: ['Self-reliance', 'Commercial exchange'],
  patience: ['Impulsive', 'Deliberate'],
}
interface LeaderPerk {
  name: string
  description: string
  strength: boolean
  skill: LeaderSkill
  attitude: Partial<Attitudes>
  modifiers: Partial<Record<ModifierStat, number>>
}
export const LEADER_PERKS: Record<string, LeaderPerk> = {
  connections: {
    name: 'Commercial connections',
    description: 'Merchant and port contacts reduce coordination friction in existing trade.',
    strength: true,
    skill: 'diplomacy',
    attitude: { commercialism: 0.12 },
    modifiers: { tradeCost: -0.025 },
  },
  administrator: {
    name: 'Methodical administrator',
    description: 'Clear procedures and oversight improve collection of taxes already owed.',
    strength: true,
    skill: 'administration',
    attitude: { patience: 0.1, centralization: 0.05 },
    modifiers: { taxIncome: 0.035 },
  },
  patron: {
    name: 'Patron of learning',
    description: 'Scholarly networks help funded schools and research institutions work together.',
    strength: true,
    skill: 'scholarship',
    attitude: { openness: 0.12 },
    modifiers: { research: 0.04, education: 0.025 },
  },
  organizer: {
    name: 'Able organizer',
    description: 'Practical coordination makes better use of existing transport capacity.',
    strength: true,
    skill: 'logistics',
    attitude: { patience: 0.1 },
    modifiers: { tradeCapacity: 0.035 },
  },
  commander: {
    name: 'Respected commander',
    description: 'Confidence in command improves the morale of supplied troops.',
    strength: true,
    skill: 'command',
    attitude: { assertiveness: 0.12 },
    modifiers: { armyMorale: 0.035 },
  },
  mediator: {
    name: 'Skilled mediator',
    description: 'Experience with local disputes helps institutions contain social tensions.',
    strength: true,
    skill: 'diplomacy',
    attitude: { assertiveness: -0.1, solidarity: 0.06 },
    modifiers: { cohesion: 0.025 },
  },
  impulsive: {
    name: 'Impulsive',
    description: 'Hasty operational changes undermine military coordination.',
    strength: false,
    skill: 'command',
    attitude: { patience: -0.18, assertiveness: 0.1 },
    modifiers: { militaryPower: -0.025 },
  },
  patronage: {
    name: 'Dependent on patronage',
    description: 'Obligations to court or party clients permit leakage from tax receipts.',
    strength: false,
    skill: 'administration',
    attitude: { solidarity: -0.12, centralization: 0.08 },
    modifiers: { taxIncome: -0.035 },
  },
  dogmatic: {
    name: 'Doctrinaire',
    description: 'Rigid commitments make institutions slower to examine unfamiliar findings.',
    strength: false,
    skill: 'scholarship',
    attitude: { openness: -0.18 },
    modifiers: { research: -0.03 },
  },
  aloof: {
    name: 'Detached from local life',
    description: 'Poor understanding of local concerns makes social mediation less effective.',
    strength: false,
    skill: 'diplomacy',
    attitude: { solidarity: -0.12 },
    modifiers: { cohesion: -0.03 },
  },
  hesitant: {
    name: 'Hesitant under pressure',
    description: 'Unclear decisions reduce confidence in military leadership.',
    strength: false,
    skill: 'command',
    attitude: { assertiveness: -0.14, patience: 0.08 },
    modifiers: { armyMorale: -0.025 },
  },
  suspicious: {
    name: 'Distrustful',
    description: 'Repeated checks and suspicion of intermediaries add trade coordination costs.',
    strength: false,
    skill: 'logistics',
    attitude: { commercialism: -0.12, assertiveness: 0.05 },
    modifiers: { tradeCost: 0.025 },
  },
}

function governmentProfile(government: string) {
  if (/federation|confeder|league/i.test(government))
    return {
      values: [0.35, 0.66, 0.58, 0.2, 0.67, 0.7],
      influence: { people: 0.5, institutions: 0.32, leader: 0.18 },
      explanation: 'Negotiation between regional institutions limits executive power.',
    }
  if (/commonwealth|commune|assembly/i.test(government))
    return {
      values: [0.32, 0.59, 0.75, 0.3, 0.4, 0.65],
      influence: { people: 0.55, institutions: 0.25, leader: 0.2 },
      explanation: 'Local assemblies and public needs carry substantial weight.',
    }
  if (/republic|democra/i.test(government))
    return {
      values: [0.4, 0.7, 0.58, 0.42, 0.68, 0.58],
      influence: { people: 0.48, institutions: 0.29, leader: 0.23 },
      explanation: 'Public constituencies and established offices constrain the executive.',
    }
  if (/empire|dictat|junta|autocra/i.test(government))
    return {
      values: [0.78, 0.28, 0.3, 0.88, 0.44, 0.43],
      influence: { people: 0.16, institutions: 0.3, leader: 0.54 },
      explanation: 'Central offices and personal executive authority dominate state decisions.',
    }
  if (/monarch|kingdom|crown/i.test(government))
    return {
      values: [0.55, 0.3, 0.42, 0.74, 0.44, 0.65],
      influence: { people: 0.23, institutions: 0.3, leader: 0.47 },
      explanation: 'Dynastic authority works through inherited offices and local obligations.',
    }
  return {
    values: [0.45, 0.5, 0.5, 0.5, 0.5, 0.55],
    influence: { people: 0.35, institutions: 0.35, leader: 0.3 },
    explanation: 'Executive authority shares influence with the public and existing institutions.',
  }
}

export function generatedLeaderName(world: World, nation: Nation, generation = 0) {
  const rng = { rng: hashSeed(`${world.seed}:${nation.id}:head:${generation}`) }
  const names = [
    'Mira',
    'Aren',
    'Selene',
    'Oren',
    'Talia',
    'Ilyan',
    'Neris',
    'Maren',
    'Cassian',
    'Vela',
    'Soren',
    'Anja',
    'Leont',
    'Elin',
    'Tarin',
    'Rhea',
  ]
  const surnames = [
    'Valen',
    'Deyr',
    'Caelen',
    'Moras',
    'Seln',
    'Orreth',
    'Verran',
    'Iskar',
    'Leth',
    'Aster',
    'Roven',
    'Keral',
  ]
  const title = /monarch|empire/i.test(nation.government)
    ? 'Sovereign'
    : /federation|commonwealth/i.test(nation.government)
      ? 'First Speaker'
      : /republic/i.test(nation.government)
        ? 'President'
        : 'Chancellor'
  return `${title} ${names[Math.floor(random(rng) * names.length)]} ${surnames[Math.floor(random(rng) * surnames.length)]}`
}

function popularAttitudes(world: World, nation: Nation) {
  const regions = world.regions.filter((r) => r.nation === nation.id)
  const groups = [
    ...regions.flatMap((r) => r.communities ?? []),
    ...allForces(world)
      .filter((a) => a.nation === nation.id)
      .flatMap((a) => a.communities ?? []),
  ]
  const moods = { literacy: 0, wealth: 0, urban: 0, grievance: 0, loyalty: 0, rootedness: 0, displacement: 0 }
  const movements = { reform: 0, local: 0, institutional: 0, commerce: 0, communal: 0, neutral: 0 }
  let total = 0
  for (const group of groups) {
    // Adults and elders contribute to political opinion; identity names confer no innate attitudes.
    const weight = group.population.adults + group.population.elders * 0.8
    total += weight
    for (const key of Object.keys(moods) as (keyof typeof moods)[]) moods[key] += weight * group[key]
    const orientation = world.demography?.identities[group.movement]?.orientation ?? 'neutral'
    movements[orientation] += weight
  }
  for (const key of Object.keys(moods) as (keyof typeof moods)[]) moods[key] /= Math.max(1, total)
  for (const key of Object.keys(movements) as (keyof typeof movements)[]) movements[key] /= Math.max(1, total)
  const wars = world.relations.filter((r) => r.treaty === 'war' && [r.a, r.b].includes(nation.id))
  const exhaustion = Math.min(1, wars.reduce((sum, r) => sum + r.warExhaustion, 0) / 80)
  const people = regions.reduce((sum, r) => sum + population(r), 0)
  const trade = Math.min(
    1,
    world.routes
      .filter((r) => world.regions[r.from].nation === nation.id || world.regions[r.to].nation === nation.id)
      .reduce((sum, r) => sum + r.volume, 0) / Math.max(1, people * 0.03),
  )
  return attitudes([
    clamp(
      0.26 +
        moods.grievance * 0.35 +
        (wars.length ? 0.18 : 0) -
        exhaustion * 0.22 -
        moods.displacement * 0.12,
    ),
    clamp(
      0.24 +
        movements.reform * 0.4 +
        moods.literacy * 0.28 +
        movements.commerce * 0.1 -
        movements.institutional * 0.12,
    ),
    clamp(0.24 + movements.communal * 0.48 + (1 - moods.wealth) * 0.25 + moods.displacement * 0.12),
    clamp(0.38 + movements.institutional * 0.36 - movements.local * 0.38 + moods.loyalty * 0.12),
    clamp(0.22 + movements.commerce * 0.48 + moods.urban * 0.25 + trade * 0.12),
    clamp(0.43 + moods.rootedness * 0.3 - moods.grievance * 0.2 - exhaustion * 0.1),
  ])
}

function makeLeader(
  world: World,
  nation: Nation,
  name: string,
  since: number,
  generation: number,
  popular: Attitudes,
): LeaderCharacter {
  const rng = { rng: hashSeed(`${world.seed}:${nation.id}:${since}:${generation}:${name}`) }
  const profile = governmentProfile(nation.government)
  const temperament = attitudes(
    CHARACTER_AXES.map((axis, i) =>
      clamp(
        0.5 +
          (random(rng) ** (random(rng) < 0.5 ? 0.35 : 2.8) - 0.5) *
            (0.45 + simulationSettings(world).extremity * 0.65) +
          (popular[axis] - 0.5) * 0.1 +
          (profile.values[i] - 0.5) * 0.1,
      ),
    ),
  )
  const skills = Object.fromEntries(LEADER_SKILLS.map((skill) => [skill, 0.2 + random(rng) * 0.6])) as Record<
    LeaderSkill,
    number
  >
  const strengths = Object.keys(LEADER_PERKS).filter((key) => LEADER_PERKS[key].strength)
  const weaknesses = Object.keys(LEADER_PERKS).filter((key) => !LEADER_PERKS[key].strength)
  const pick = (keys: string[]) => keys.splice(Math.floor(random(rng) * keys.length), 1)[0]
  const perks = [pick(strengths), pick(strengths), pick(weaknesses)]
  for (const key of perks) {
    const perk = LEADER_PERKS[key]
    skills[perk.skill] = clamp(skills[perk.skill] + (perk.strength ? 0.12 : -0.1))
    for (const axis of CHARACTER_AXES)
      temperament[axis] = clamp(temperament[axis] + (perk.attitude[axis] ?? 0))
  }
  return { name, since, generation, attitudes: temperament, skills, perks }
}

function derive(character: StateCharacter) {
  const a = character.effective,
    l = character.leader
  const styles = [
    { score: a.assertiveness, name: 'assertive', aim: 'Maintain credible force and bargaining power' },
    { score: 1 - a.assertiveness, name: 'conciliatory', aim: 'Settle disputes before escalating them' },
    { score: a.openness, name: 'reform-minded', aim: 'Invest in learning and institutional reform' },
    { score: 1 - a.openness, name: 'traditional', aim: 'Protect inherited institutions and customs' },
    { score: a.solidarity, name: 'social-minded', aim: 'Protect livelihoods and public services' },
    {
      score: 1 - a.solidarity,
      name: 'elite-led',
      aim: 'Preserve governing coalitions and established privileges',
    },
    {
      score: a.centralization,
      name: 'centralizing',
      aim: 'Strengthen common institutions and central coordination',
    },
    {
      score: 1 - a.centralization,
      name: 'decentralist',
      aim: 'Protect local autonomy and negotiated authority',
    },
    {
      score: a.commercialism,
      name: 'commercial',
      aim: 'Keep markets, routes and external exchange accessible',
    },
    {
      score: 1 - a.commercialism,
      name: 'self-reliant',
      aim: 'Reduce dependence on foreign supply and intermediaries',
    },
    { score: a.patience, name: 'deliberate', aim: 'Favor durable commitments and preparation' },
    { score: 1 - a.patience, name: 'impetuous', aim: 'Seize opportunities before rivals can respond' },
  ].sort((x, y) => y.score - x.score)
  character.title = `${styles[0].name[0].toUpperCase()}${styles[0].name.slice(1)} · ${styles[1].name}`
  character.priorities = [
    l.politics?.ambition ?? styles[0].aim,
    ...styles.slice(0, 2).map((style) => style.aim),
  ]
  const popularStyle = CHARACTER_AXES.map((axis) => ({
    axis,
    distance: Math.abs(character.popular[axis] - 0.5),
  })).sort((a, b) => b.distance - a.distance)[0].axis
  const mood = CHARACTER_LABELS[popularStyle][character.popular[popularStyle] >= 0.5 ? 1 : 0].toLowerCase()
  character.mandateGap =
    CHARACTER_AXES.reduce((sum, axis) => sum + Math.abs(character.popular[axis] - l.attitudes[axis]), 0) /
    CHARACTER_AXES.length
  character.description = `Public opinion leans toward ${mood}. ${governmentProfile(character.government).explanation} ${character.mandateGap > 0.3 ? 'The leadership is substantially at odds with public attitudes.' : 'The leadership works within this inherited political setting.'}`
  const raw: Partial<Record<ModifierStat, number>> = {
    taxIncome: (l.skills.administration - 0.5) * 0.06,
    research: (l.skills.scholarship - 0.5) * 0.06,
    education: (l.skills.scholarship - 0.5) * 0.04,
    tradeCost: (0.5 - l.skills.diplomacy) * 0.04,
    tradeCapacity: (l.skills.logistics - 0.5) * 0.06,
    militaryPower: (l.skills.command - 0.5) * 0.06,
    armyMorale: (l.skills.command - 0.5) * 0.035,
    cohesion: (l.skills.diplomacy - 0.5) * 0.025 - character.mandateGap * 0.03,
  }
  for (const key of l.perks)
    for (const [stat, amount] of Object.entries(LEADER_PERKS[key].modifiers))
      raw[stat as ModifierStat] = (raw[stat as ModifierStat] ?? 0) + amount
  const authority = character.influence.leader * 1.5
  character.modifiers = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, clamp(value * authority, -0.09, 0.09)]),
  )
}

function target(character: StateCharacter, extremity = 1.2) {
  const weights = character.influence
  return attitudes(
    CHARACTER_AXES.map((axis) => {
      const blended =
          character.popular[axis] * weights.people +
          character.institutions[axis] * weights.institutions +
          character.leader.attitudes[axis] * weights.leader,
        conviction = character.leader.politics?.drives.dogmatism ?? 0.5
      return clamp(0.5 + (blended - 0.5) * (1 + extremity * (0.35 + conviction * 0.4)))
    }),
  )
}

/** Idempotent legacy upgrade. No policies or population counts change here. */
export function ensureCharacters(world: World) {
  for (const nation of world.nations) {
    if (nation.character) {
      ensureAmbition(world, nation)
      continue
    }
    const society = world.historical?.societies.find((s) => s.nation === nation.id)
    const profile = governmentProfile(nation.government),
      popular = popularAttitudes(world, nation)
    const leader = makeLeader(
      world,
      nation,
      society?.leader ?? generatedLeaderName(world, nation),
      society?.since ?? world.month,
      0,
      popular,
    )
    const character: StateCharacter = {
      version: 1,
      updated: world.month,
      government: nation.government,
      popular,
      institutions: attitudes(profile.values),
      effective: attitudes(profile.values),
      influence: { ...profile.influence },
      leader,
      mandateGap: 0,
      title: '',
      description: '',
      priorities: [],
      modifiers: {},
    }
    nation.character = character
    ensureAmbition(world, nation, true)
    character.effective = target(character, simulationSettings(world).extremity)
    derive(character)
  }
}

export function advanceCharacters(world: World) {
  ensureCharacters(world)
  for (const nation of world.nations) {
    const character = nation.character!
    if (character.updated === world.month || !world.regions.some((r) => r.nation === nation.id)) continue
    const elapsed = Math.min(120, world.month - character.updated),
      profile = governmentProfile(nation.government),
      mood = popularAttitudes(world, nation)
    character.government = nation.government
    character.influence = { ...profile.influence }
    for (const [i, axis] of CHARACTER_AXES.entries()) {
      character.popular[axis] += (mood[axis] - character.popular[axis]) * (1 - 0.975 ** elapsed)
      character.institutions[axis] +=
        (profile.values[i] - character.institutions[axis]) * (1 - 0.992 ** elapsed)
    }
    const goals = target(character, simulationSettings(world).extremity)
    for (const axis of CHARACTER_AXES)
      character.effective[axis] += (goals[axis] - character.effective[axis]) * (1 - 0.88 ** elapsed)
    character.updated = world.month
    derive(character)
  }
}

export function replaceStateLeader(world: World, nationId: number, name: string) {
  ensureCharacters(world)
  const nation = world.nations[nationId],
    character = nation.character!
  character.leader = makeLeader(
    world,
    nation,
    name,
    world.month,
    character.leader.generation + 1,
    character.popular,
  )
  ensureAmbition(world, nation, true)
  const goals = target(character, simulationSettings(world).extremity)
  for (const axis of CHARACTER_AXES)
    character.effective[axis] += (goals[axis] - character.effective[axis]) * 0.45
  derive(character)
  const society = world.historical?.societies.find((s) => s.nation === nationId)
  if (society) {
    society.leader = name
    society.since = world.month
  }
  const agent = world.statecraft?.agents.find((a) => a.nation === nationId)
  if (agent) {
    agent.escalation = `Strategic review requested: new leadership under ${name}. Reassess inherited policies and pending negotiations; existing state commitments remain binding.`
    agent.nextDecision = world.month
    agent.nextStrategy = world.month
  }
}

export function characterPolicyTargets(nation: Nation): Policies {
  const a = nation.character!.effective,
    drives = nation.character!.leader.politics?.drives
  return {
    ...nation.policies,
    tax: Math.round(16 + a.solidarity * 12 + a.centralization * 5),
    welfare: Math.round(8 + a.solidarity * 35),
    education: Math.round(8 + a.openness * 28),
    military: Math.round(5 + a.assertiveness * 42 + (drives?.dominance ?? 0.5) * 12),
    research: Math.round(6 + a.openness * 26),
    tariff: Math.round(3 + (1 - a.commercialism) * 20),
    conscription: Number((0.1 + a.assertiveness * 3.1 + (drives?.riskTolerance ?? 0.5) * 0.6).toFixed(1)),
    migration: a.commercialism > 0.55 && a.openness > 0.45 ? 'open' : 'controlled',
    citizenship:
      a.openness > 0.6 && a.solidarity > 0.5
        ? 'pluralist'
        : a.centralization > 0.65 && a.openness < 0.4
          ? 'heritage'
          : 'civic',
    languagePolicy: a.centralization > 0.64 ? 'common' : a.centralization < 0.34 ? 'local' : 'multilingual',
    beliefPolicy: a.openness < 0.38 && a.centralization > 0.58 ? 'favored' : 'protected',
  }
}

export function characterResearch(nation: Nation): Research {
  const a = nation.character!.effective,
    s = nation.character!.leader.skills
  const scores: Record<Research, number> = {
    agriculture: (1 - nation.foodCoverage) * 3 + a.solidarity * 0.3 + (1 - a.commercialism) * 0.3,
    industry: a.commercialism * 0.45 + a.openness * 0.25 + s.administration * 0.3,
    medicine: a.solidarity * 0.55 + a.openness * 0.3 + s.scholarship * 0.25,
    logistics: a.commercialism * 0.5 + a.patience * 0.2 + s.logistics * 0.4,
    military: a.assertiveness * 0.75 + a.centralization * 0.1 + s.command * 0.3,
    governance: a.centralization * 0.25 + a.patience * 0.3 + s.administration * 0.4,
  }
  return (
    [...FIELDS].filter((field) => nation.technologies[field] < 6).sort((a, b) => scores[b] - scores[a])[0] ??
    nation.researchFocus
  )
}

export function characterContext(nation: Nation, publicOnly = false) {
  const c = nation.character
  if (!c) return null
  if (publicOnly)
    return {
      title: c.title,
      government: c.government,
      leader: { name: c.leader.name, since: c.leader.since, generation: c.leader.generation },
      posture: c.effective,
    }
  return {
    ...c,
    leader: {
      ...c.leader,
      perks: c.leader.perks.map((id) => ({
        id,
        name: LEADER_PERKS[id].name,
        description: LEADER_PERKS[id].description,
      })),
    },
  }
}
