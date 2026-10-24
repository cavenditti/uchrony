import type { Region, World } from './types'
import { generatedLeaderName } from './character'
import { hashSeed, random } from './random'
import type {
  HistoricalEffect,
  HistoricalOpportunity,
  HistoricalProposal,
  HistoryCategory,
  ModifierStat,
} from './history-types'

interface Mechanism {
  name: string
  development: string
  gain: ModifierStat
  friction: ModifierStat
  weight?: (region: Region) => number
}
// Independent material mechanisms, rather than one crisis with many interchangeable titles.
const mechanisms: Record<HistoryCategory, Mechanism[]> = {
  succession: [
    {
      name: 'A negotiated succession',
      development: 'leading households negotiate a transfer of executive authority',
      gain: 'cohesion',
      friction: 'taxIncome',
    },
    {
      name: 'An institutional succession',
      development: 'administrators secure continuity through an agreed appointment procedure',
      gain: 'taxIncome',
      friction: 'cohesion',
    },
    {
      name: 'A disputed succession',
      development: 'rival claimants mobilize supporters before accepting a compromise',
      gain: 'armyMorale',
      friction: 'cohesion',
      weight: (r) => 1 + r.unrest / 20,
    },
    {
      name: 'A generational transition',
      development: 'a younger circle replaces the retiring leadership and reopens settled priorities',
      gain: 'research',
      friction: 'taxIncome',
    },
    {
      name: 'A provincial compromise',
      development: 'provincial representatives secure concessions during a leadership transition',
      gain: 'cohesion',
      friction: 'taxIncome',
    },
  ],
  discovery: [
    {
      name: 'Field trials',
      development: 'cultivators compare cultivation methods across neighboring plots',
      gain: 'harvest',
      friction: 'extraction',
    },
    {
      name: 'Workshop experiments',
      development: 'craft workers circulate a more reliable production method',
      gain: 'manufacturing',
      friction: 'tradeCapacity',
      weight: (r) => 0.2 + r.industry,
    },
    {
      name: 'A study of illness',
      development: 'caregivers compare household records to identify preventable causes of illness',
      gain: 'healthcare',
      friction: 'taxIncome',
    },
    {
      name: 'Surveyors exchange findings',
      development: 'surveyors compile practical observations about carriage and gradients',
      gain: 'tradeCost',
      friction: 'extraction',
    },
    {
      name: 'A new method of instruction',
      development: 'teachers compare ways of transmitting difficult practical knowledge',
      gain: 'education',
      friction: 'taxIncome',
      weight: (r) => 0.1 + r.literacy,
    },
    {
      name: 'An administrative discovery',
      development: 'clerks reconcile incompatible records and discover a repeatable accounting method',
      gain: 'taxIncome',
      friction: 'research',
    },
  ],
  literature: [
    {
      name: 'Household chronicles',
      development: 'a collection of ordinary household histories reaches a wider audience',
      gain: 'education',
      friction: 'cohesion',
    },
    {
      name: 'A cycle of public recitations',
      development: 'performers adapt local memories into a cycle of recitations',
      gain: 'cohesion',
      friction: 'taxIncome',
    },
    {
      name: 'Letters on authority',
      development: 'circulated letters question how officials justify their decisions',
      gain: 'research',
      friction: 'cohesion',
      weight: (r) => 0.2 + r.literacy,
    },
    {
      name: 'A practical compendium',
      development: 'a compiler assembles scattered craft knowledge into an accessible collection',
      gain: 'manufacturing',
      friction: 'research',
    },
    {
      name: 'A borderland translation',
      development: 'translators make a neighboring community’s stories accessible to local audiences',
      gain: 'education',
      friction: 'cohesion',
      weight: (r) => 0.2 + (r.communities?.length ?? 0) / 30,
    },
  ],
  belief: [
    {
      name: 'A fellowship of mutual aid',
      development: 'households organize shared care around a new interpretation of inherited observances',
      gain: 'healthcare',
      friction: 'cohesion',
    },
    {
      name: 'A dispute over observance',
      development: 'local interpreters challenge established forms of public observance',
      gain: 'research',
      friction: 'cohesion',
    },
    {
      name: 'An itinerant teaching',
      development: 'traveling teachers connect otherwise isolated circles of believers',
      gain: 'migrationAttraction',
      friction: 'taxIncome',
    },
    {
      name: 'A reconciliation of traditions',
      development: 'mediators develop shared ceremonies across different inherited traditions',
      gain: 'cohesion',
      friction: 'research',
    },
    {
      name: 'A discipline of service',
      development: 'a new circle ties spiritual standing to practical service in its community',
      gain: 'education',
      friction: 'extraction',
    },
  ],
  institutions: [
    {
      name: 'A common register',
      development: 'clerks reconcile competing records of public obligations',
      gain: 'taxIncome',
      friction: 'cohesion',
    },
    {
      name: 'A local arbitration chamber',
      development: 'residents establish regular mediation for recurring household and property disputes',
      gain: 'cohesion',
      friction: 'taxIncome',
    },
    {
      name: 'A public granary compact',
      development: 'households and administrators formalize storage and release responsibilities',
      gain: 'harvest',
      friction: 'taxIncome',
      weight: (r) => 0.3 + (1 - r.foodCoverage) * 3,
    },
    {
      name: 'An audit of offices',
      development: 'an inquiry exposes overlapping responsibilities and inconsistent collections',
      gain: 'taxIncome',
      friction: 'armyMorale',
    },
    {
      name: 'A network of local schools',
      development: 'teachers agree on shared materials and responsibilities for instruction',
      gain: 'education',
      friction: 'taxIncome',
    },
  ],
  social: [
    {
      name: 'Petitions over public burdens',
      development: 'residents coordinate petitions about how public burdens are distributed',
      gain: 'cohesion',
      friction: 'taxIncome',
      weight: (r) => 0.3 + r.unrest / 20,
    },
    {
      name: 'A dispute over customary access',
      development: 'households contest competing claims to customary land and resource access',
      gain: 'extraction',
      friction: 'cohesion',
    },
    {
      name: 'A mutual-care association',
      development: 'neighbors pool contributions to care for vulnerable households',
      gain: 'healthcare',
      friction: 'extraction',
    },
    {
      name: 'A craft association',
      development: 'craft workers organize standards of training and mutual support',
      gain: 'manufacturing',
      friction: 'tradeCost',
    },
    {
      name: 'Newcomers seek recognition',
      development: 'settled newcomers seek access to local institutions and public responsibilities',
      gain: 'migrationAttraction',
      friction: 'cohesion',
      weight: (r) => 0.1 + (r.communities?.length ?? 0) / 20,
    },
  ],
  commerce: [
    {
      name: 'A warehouse compact',
      development: 'merchants pool storage and losses along existing trade connections',
      gain: 'tradeCapacity',
      friction: 'taxIncome',
    },
    {
      name: 'A common system of measures',
      development: 'traders agree on common measures to reduce disputes over shipments',
      gain: 'tradeCost',
      friction: 'extraction',
    },
    {
      name: 'A carrier association',
      development: 'carriers coordinate departures and share the upkeep of established routes',
      gain: 'tradeCapacity',
      friction: 'taxIncome',
    },
    {
      name: 'A credit clearing circle',
      development: 'merchant households offset mutual obligations to reduce settlement delays',
      gain: 'manufacturing',
      friction: 'cohesion',
    },
    {
      name: 'A dispute over passage charges',
      development: 'carriers contest inconsistent charges along a familiar corridor',
      gain: 'tradeCost',
      friction: 'taxIncome',
    },
    {
      name: 'A market information network',
      development: 'traders circulate regular reports of local shortages and surpluses',
      gain: 'tradeCapacity',
      friction: 'research',
    },
  ],
  disaster: [
    {
      name: 'An outbreak of illness',
      development: 'an outbreak interrupts household work and strains local care',
      gain: 'healthcare',
      friction: 'mortality',
      weight: (r) => 0.2 + (1 - r.health) * 2,
    },
    {
      name: 'A storage failure',
      development: 'poorly maintained storage fails and disrupts access to provisions',
      gain: 'tradeCapacity',
      friction: 'harvest',
    },
    {
      name: 'A settlement fire',
      development: 'a fire damages workshops and prompts a dispute over rebuilding responsibilities',
      gain: 'manufacturing',
      friction: 'extraction',
    },
    {
      name: 'A carriage disruption',
      development: 'weather damages a route and isolates some regular suppliers',
      gain: 'tradeCapacity',
      friction: 'tradeCost',
    },
    {
      name: 'A contaminated water source',
      development: 'illness is traced to a shared water source and forces households to seek alternatives',
      gain: 'healthcare',
      friction: 'mortality',
    },
  ],
  diplomacy: [
    {
      name: 'An exchange of observers',
      development: 'officials invite foreign observers to explain unfamiliar administrative practices',
      gain: 'research',
      friction: 'taxIncome',
    },
    {
      name: 'A dispute over correspondence',
      development: 'inconsistent diplomatic correspondence exposes a disagreement between officials',
      gain: 'education',
      friction: 'cohesion',
    },
    {
      name: 'A circle of interpreters',
      development: 'interpreters establish shared conventions for handling diplomatic messages',
      gain: 'research',
      friction: 'taxIncome',
    },
    {
      name: 'A public statement of intentions',
      development: 'envoys publish an explanation of the government’s intentions for its neighbors',
      gain: 'cohesion',
      friction: 'research',
    },
    {
      name: 'A protocol dispute',
      development: 'officials contest the precedence and obligations attached to diplomatic visits',
      gain: 'education',
      friction: 'cohesion',
    },
  ],
}
const cheaper = (stat: ModifierStat, amount: number) => (stat === 'tradeCost' ? -amount : amount)

/** Seeded composition binds mechanisms, agents, intensity, responses and conditional aftermath locally. */
export function proceduralEvent(
  world: World,
  opportunity: HistoricalOpportunity,
): HistoricalProposal & { patternModel?: string } {
  const n = world.nations[opportunity.nation],
    r = world.regions[opportunity.region],
    rng = { rng: hashSeed(`${opportunity.seed}:${opportunity.id}:${world.seed}:${world.month}`) },
    choose = <T>(items: readonly T[]): T => items[Math.floor(random(rng) * items.length)],
    recent = new Set(
      world.events
        .filter((e) => e.nation === n.id)
        .slice(0, 12)
        .map((e) => e.title.split(' · ')[0]),
    ),
    learned = (world.historical?.repertoire ?? []).filter(
      (pattern) => pattern.category === opportunity.category,
    ),
    candidates: (Mechanism & { model?: string })[] = [...mechanisms[opportunity.category], ...learned],
    fresh = candidates.filter((m) => !recent.has(m.name)),
    pool = fresh.length ? fresh : candidates
  let roll = random(rng) * pool.reduce((sum, m) => sum + (m.weight?.(r) ?? 1), 0)
  const mechanism = pool.find((m) => (roll -= m.weight?.(r) ?? 1) <= 0) ?? pool[pool.length - 1],
    intensity = choose([0.025, 0.04, 0.06, 0.08]),
    duration = choose([6, 12, 18, 24, 36]),
    effect = (
      stat: HistoricalEffect['stat'],
      amount: number,
      kind: HistoricalEffect['kind'] = 'modifier',
      text = '',
    ): HistoricalEffect => ({
      kind,
      stat,
      amount,
      text,
      duration: kind === 'modifier' ? duration : 0,
      scope: kind === 'modifier' ? 'region' : 'nation',
      target: kind === 'modifier' ? r.id : n.id,
      other: -1,
      delay: 0,
      curve: kind === 'modifier' ? choose(['steady', 'fade', 'grow'] as const) : 'steady',
      field: '',
    }),
    helpful = effect(mechanism.gain, cheaper(mechanism.gain, intensity)),
    friction = effect(
      mechanism.friction,
      mechanism.friction === 'mortality' || mechanism.friction === 'tradeCost' ? intensity : -intensity,
    ),
    response =
      opportunity.category === 'disaster'
        ? 'relief'
        : opportunity.category === 'commerce'
          ? 'commerce'
          : opportunity.category === 'belief'
            ? 'reform'
            : 'patronage',
    institution = `${choose(['Circle', 'House', 'Assembly', 'Fellowship', 'Society', 'School'])} of ${choose(['Common Endeavor', 'the Open Hand', 'the Long Memory', 'the New Accord', 'Shared Inquiry', 'the Returning Light'])} in ${r.name}`,
    conditions =
      r.foodCoverage < 0.95
        ? 'Food shortages sharpen the debate over its consequences.'
        : r.unrest > 45
          ? 'Existing grievances make the distribution of its costs contentious.'
          : r.literacy > 0.5
            ? 'Written accounts carry the debate beyond its original participants.'
            : 'Household networks carry news of the development to neighboring settlements.',
    proposal: HistoricalProposal = {
      category: opportunity.category,
      nation: n.id,
      region: r.id,
      causeEvent: 0,
      conditions: [],
      title: `${mechanism.name} · ${r.name}`,
      description: `In ${r.name}, ${mechanism.development}. ${conditions}`,
      effects: [friction],
      responses: [
        {
          name: 'Organize a public response',
          rationale:
            'Officials commit existing institutions to the development, accepting the costs of coordination.',
          affinity: response,
          weight: 1,
          conditions: [],
          effects: [helpful, effect('treasury', -intensity * 0.3, 'change')],
        },
        {
          name: 'Leave the initiative to local networks',
          rationale:
            'Households and associations bear the costs and determine how far the initiative spreads.',
          affinity: 'neutral',
          weight: 1,
          conditions: [],
          effects: [{ ...helpful, amount: helpful.amount * 0.45 }],
        },
      ],
      followUps: [
        {
          afterMonths: Math.max(3, Math.floor(duration / 2)),
          withinMonths: 12,
          probability: 0.65,
          conditions: [{ metric: 'stability', comparison: 'above', value: 40 }],
          title: `${mechanism.name}: practices spread`,
          description: `Local networks in ${r.name} adapt the earlier initiative to their everyday work. Its lasting influence depends on maintaining the institutions that support it.`,
          effects: [{ ...helpful, amount: helpful.amount * 0.5, curve: 'fade' }],
        },
        {
          afterMonths: duration,
          withinMonths: 12,
          probability: 0.4,
          conditions: [{ metric: 'unrest', comparison: 'above', value: 45 }],
          title: `${mechanism.name}: unresolved grievances`,
          description: `In ${r.name}, disputes over who bore the costs of the earlier development resurface. Local mediators try to contain the disagreement.`,
          effects: [effect('cohesion', -intensity * 0.5)],
        },
      ],
    }
  if (opportunity.category === 'succession') {
    const leader = generatedLeaderName(world, n, (n.character?.leader.generation ?? 0) + 1)
    proposal.effects.push(effect('leader', 0, 'leadership', leader))
    proposal.description = `${leader} assumes authority as ${mechanism.development}. ${conditions}`
  }
  if (
    opportunity.category === 'belief' ||
    opportunity.category === 'literature' ||
    opportunity.category === 'institutions'
  ) {
    const stat = opportunity.category === 'institutions' ? 'institution' : opportunity.category
    proposal.effects.push(effect(stat, 0, 'legacy', institution.slice(0, 180)))
  }
  if (opportunity.category === 'discovery') {
    const progress = effect('researchProgress', intensity * 200, 'change')
    progress.field =
      mechanism.gain === 'harvest'
        ? 'agriculture'
        : mechanism.gain === 'manufacturing'
          ? 'industry'
          : mechanism.gain === 'healthcare'
            ? 'medicine'
            : mechanism.gain === 'tradeCost'
              ? 'logistics'
              : 'governance'
    proposal.effects.push(progress)
  }
  return { ...proposal, ...(mechanism.model ? { patternModel: mechanism.model } : {}) }
}
