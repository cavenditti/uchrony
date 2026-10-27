import {
  foreignIntelligence,
  perceivedPower,
  knownMap,
  domesticAuthority,
  intelligenceService,
} from './intelligence'
import { frontierValue } from './territorial-expansion'
import { hashSeed, random } from './random'
import { clamp, type Nation, type World } from './types'
import { simulationSettings } from './settings'

export const DRIVE_AXES = [
  'ambition',
  'riskTolerance',
  'dominance',
  'opportunism',
  'vengefulness',
  'dogmatism',
  'empathy',
  'vanity',
] as const
export type PoliticalDrives = Record<(typeof DRIVE_AXES)[number], number>
export interface PoliticalAmbition {
  archetype: string
  drives: PoliticalDrives
  ambition: string
  redLine: string
  blindSpot: string
}
const profiles = [
  {
    name: 'Territorial hegemon',
    values: [0.95, 0.78, 0.95, 0.65, 0.5, 0.55, 0.15, 0.85],
    aim: 'Turn neighboring states into dependent clients and secure strategically valuable territory.',
    red: 'A rival dictating security arrangements near the homeland.',
    flaw: 'Overestimates how readily occupied populations will accept foreign rule.',
  },
  {
    name: 'Revanchist',
    values: [0.8, 0.7, 0.8, 0.4, 0.98, 0.8, 0.2, 0.7],
    aim: 'Recover influence after humiliations, punish rivals and compel public recognition of the state’s standing.',
    red: 'Accepting an uncompensated humiliation or abandoning a declared claim.',
    flaw: 'Can spend more on revenge than the original dispute was worth.',
  },
  {
    name: 'Predatory oligarch',
    values: [0.9, 0.6, 0.7, 0.98, 0.45, 0.2, 0.05, 0.8],
    aim: 'Enrich the governing coalition through exclusive concessions, unequal bargains and control of scarce supplies.',
    red: 'Reforms that threaten the coalition’s wealth and privileged access.',
    flaw: 'Underestimates resentment among exploited households and foreign dependents.',
  },
  {
    name: 'Revolutionary reformer',
    values: [0.95, 0.85, 0.75, 0.5, 0.55, 0.95, 0.65, 0.7],
    aim: 'Transform domestic institutions and support compatible movements abroad, even at substantial political risk.',
    red: 'A settlement that permanently blocks the founding reform project.',
    flaw: 'Confuses principled conviction with evidence that the public will accept disruption.',
  },
  {
    name: 'Doctrinal guardian',
    values: [0.65, 0.6, 0.85, 0.25, 0.7, 0.98, 0.15, 0.6],
    aim: 'Defend inherited authority and suppress institutions perceived as threats to the governing doctrine.',
    red: 'Recognition of institutions that openly repudiate the state’s declared foundations.',
    flaw: 'Treats negotiable disagreements as existential tests of loyalty.',
  },
  {
    name: 'Mercantile opportunist',
    values: [0.85, 0.65, 0.6, 0.98, 0.25, 0.15, 0.35, 0.55],
    aim: 'Capture profitable corridors, monopolize bottlenecks and trade concessions while rivals are distracted.',
    red: 'Permanent exclusion from indispensable markets or transit routes.',
    flaw: 'Underestimates how quickly opportunistic partners may organize against it.',
  },
  {
    name: 'Encirclement obsessive',
    values: [0.7, 0.55, 0.8, 0.45, 0.85, 0.8, 0.25, 0.45],
    aim: 'Build a defensible sphere and pre-empt perceived encirclement through buffers, coercion or alliances.',
    red: 'An unfriendly military foothold on a vulnerable frontier.',
    flaw: 'Often interprets a rival’s defensive preparations as offensive intent.',
  },
  {
    name: 'Glory-seeking adventurer',
    values: [0.98, 0.98, 0.9, 0.8, 0.6, 0.35, 0.1, 0.99],
    aim: 'Achieve a dramatic personal legacy through daring campaigns, spectacular bargains or rapid state expansion.',
    red: 'Being publicly dismissed as weak or irrelevant.',
    flaw: 'Overestimates its own command skill and discounts the costs of failure.',
  },
  {
    name: 'Constitutional steward',
    values: [0.45, 0.15, 0.2, 0.35, 0.25, 0.4, 0.65, 0.25],
    aim: 'Build durable institutions and secure favorable agreements without exhausting the governing mandate.',
    red: 'Irreversible commitments made without institutional consent.',
    flaw: 'May delay while faster rivals change the facts on the ground.',
  },
  {
    name: 'Civic solidarist',
    values: [0.65, 0.5, 0.25, 0.35, 0.35, 0.7, 0.98, 0.35],
    aim: 'Protect ordinary households and extend civic inclusion, accepting confrontation with entrenched privileges.',
    red: 'Sacrificing a vulnerable constituency solely for elite advantage.',
    flaw: 'May overestimate fiscal capacity and underestimate organized resistance.',
  },
] as const

/** Personal motives are private and persistent; upgrading an old leader does not replace their traits. */
export function ensureAmbition(world: World, nation: Nation, align = false) {
  const leader = nation.character?.leader
  if (!leader || leader.politics) return
  const rng = { rng: hashSeed(`${world.seed}:${nation.id}:${leader.generation}:${leader.name}:ambitions`) },
    profile = profiles[Math.floor(random(rng) * profiles.length)],
    intensity = simulationSettings(world).extremity
  const drives = Object.fromEntries(
    DRIVE_AXES.map((axis, index) => {
      const center = 0.5 + (profile.values[index] - 0.5) * (0.45 + intensity * 0.45)
      return [axis, clamp(center + (random(rng) - 0.5) * 0.22)]
    }),
  ) as PoliticalDrives
  leader.politics = {
    archetype: profile.name,
    drives,
    ambition: profile.aim,
    redLine: profile.red,
    blindSpot: profile.flaw,
  }
  if (align) {
    const a = leader.attitudes
    a.assertiveness = clamp(a.assertiveness * 0.35 + drives.dominance * 0.4 + drives.riskTolerance * 0.25)
    a.solidarity = clamp(a.solidarity * 0.3 + drives.empathy * 0.7)
    a.centralization = clamp(a.centralization * 0.4 + drives.dominance * 0.6)
    a.patience = clamp(a.patience * 0.35 + (1 - drives.riskTolerance) * 0.65)
    if (profile.name === 'Revolutionary reformer')
      a.openness = Math.max(Math.min(0.98, 0.6 + intensity * 0.2), a.openness)
    if (profile.name === 'Doctrinal guardian')
      a.openness = Math.min(Math.max(0.02, 0.4 - intensity * 0.22), a.openness)
    if (['Mercantile opportunist', 'Predatory oligarch'].includes(profile.name))
      a.commercialism = Math.max(Math.min(0.98, 0.6 + intensity * 0.2), a.commercialism)
  }
}

/** Strategic incentives use received reports, never hidden foreign accounts. */
export function reportedExpansionInterests(world: World, nation: Nation, other: number) {
  const report = intelligenceService(world, nation.id).dossiers.find((d) => d.nation === other)
  const cultural =
    (report?.politics?.culture !== undefined && report.politics.culture === nation.identity?.culture
      ? 0.6
      : 0) +
    (report?.politics?.language !== undefined && report.politics.language === nation.identity?.language
      ? 0.4
      : 0)
  const own = world.regions.filter((r) => r.nation === nation.id)
  const resources = (['iron', 'coal', 'timber'] as const).map((good) => {
    const supply = own.reduce((sum, r) => sum + r.production[good], 0)
    const foreign = report?.economy?.values[good]?.estimate ?? 0
    return clamp(foreign / Math.max(1, supply) - 0.5)
  })
  const food = nation.foodCoverage < 1 && (report?.economy?.values.food?.estimate ?? 0) >= 1 ? 1 : 0
  const output = clamp(((report?.economy?.values.output?.estimate ?? 0) / Math.max(1, nation.gdp)) * 0.5)
  return { cultural, economic: clamp(Math.max(...resources, food) * 0.7 + output * 0.3) }
}

export function strategicPressures(world: World, nation: Nation) {
  const own = world.regions.filter((r) => r.nation === nation.id),
    power = perceivedPower(world, nation.id, nation.id),
    neighbors = new Set(
      knownMap(world, nation.id)
        .filter((r) => r.nation === nation.id)
        .flatMap((r) => r.neighbors),
    ),
    drives = nation.character?.leader.politics?.drives
  return {
    frontierOpportunities: knownMap(world, nation.id)
      .filter((r) => r.nation === -1 && neighbors.has(r.id))
      .map((r) => ({
        region: r.id,
        ...frontierValue(world, nation, world.regions[r.id]),
        influence:
          world.sovereignty?.frontiers?.find((p) => p.region === r.id && p.nation === nation.id)?.influence ??
          0,
      }))
      .sort((a, b) => b.score - a.score || a.region - b.region)
      .slice(0, 8),
    authority: domesticAuthority(world, nation.id),
    doctrine: nation.character?.leader.politics,
    constraints: {
      food: nation.foodCoverage,
      stability: nation.stability,
      treasury: nation.treasury,
      suppliedLandPower: Math.round(power),
    },
    rivals: foreignIntelligence(world, nation.id).map((other) => {
      const force = perceivedPower(world, nation.id, other.id),
        border = knownMap(world, nation.id).some((r) => r.nation === other.id && neighbors.has(r.id)),
        resources = (['iron', 'coal', 'timber'] as const).flatMap((good) => {
          const estimated = other.economy?.values[good],
            ownSupply = own.reduce((s, r) => s + r.production[good], 0)
          return estimated && estimated.estimate > Math.max(1, ownSupply) * 1.8
            ? [{ good, ownSupply, reportedForeignSupply: estimated }]
            : []
        })
      return {
        nation: other.id,
        expansionInterests: reportedExpansionInterests(world, nation, other.id),
        bordering: border,
        treaty: other.relation?.treaty,
        opinion: other.relation?.opinion,
        reportedLandPower: other.military?.values.effectivePower ?? null,
        ownRelativePowerEstimate: +(power / Math.max(500, force)).toFixed(2),
        resourceLeverage: resources,
        possibleAim: !border
          ? 'Overseas and commercial initiatives need contacts, charts and real naval reach.'
          : power > force * 1.35 && nation.foodCoverage > 0.88 && (drives?.dominance ?? 0) > 0.65
            ? 'Reports suggest a coercive opportunity. Their age, uncertainty, unobserved reserves and unknown alliances could make this assessment wrong.'
            : 'Compare negotiation, reconnaissance and action using available reports; uncertainty is not proof of weakness.',
      }
    }),
    disputes:
      world.pressures?.incidents.filter((i) => i.nations.includes(nation.id) && i.expires > world.month) ??
      [],
  }
}
