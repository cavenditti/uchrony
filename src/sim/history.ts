import { recordWorldEvent } from './event-memory'
import { transfer, governmentAccount, householdAccount, producerAccount } from './ledger'
import { simulationSettings } from './settings'
import { parseHistoryPatterns } from './history-repertoire'
import { introduceCulturalLegacy, populationIdentitySummary } from './identities'
import { proceduralEvent } from './history-procedural'
import { ensureCharacters, replaceStateLeader, characterContext } from './character'
import { hashSeed, random } from './random'
import { clamp, dateLabel, population, relation, type World, type SimEvent } from './types'
import {
  HISTORY_CATEGORIES,
  type HistoricalEffect,
  type HistoricalOpportunity,
  type HistoricalRecord,
  type HistoricalResponse,
  type HistoricalState,
  type HistoryCondition,
  type HistoryCategory,
} from './history-types'
import { validateHistoricalProposal } from './history-schema'

export function ensureHistory(world: World): HistoricalState {
  ensureCharacters(world)
  if (!world.historical) {
    const state: HistoricalState = {
      rng: hashSeed(`${world.seed}:historical-forces`),
      nextRoll: world.month + 2,
      nextId: 1,
      opportunity: null,
      effects: [],
      scheduled: [],
      societies: [],
      legacies: [],
    }
    world.historical = state
  }
  const state = world.historical
  state.prepared ??= []
  for (const nation of world.nations)
    if (!state.societies.some((society) => society.nation === nation.id)) {
      state.societies.push({
        nation: nation.id,
        leader: nation.character!.leader.name,
        since: nation.character!.leader.since,
        tradition: 'Inherited local traditions',
        prestige: 25,
        pluralism: nation.government === 'Republic' ? 55 : 35,
      })
    }
  return state
}
function regionsOf(world: World, nation: number) {
  return world.regions.filter((region) => region.nation === nation)
}
function mean(world: World, nation: number, metric: 'literacy' | 'unrest' | 'health' | 'happiness') {
  const regions = regionsOf(world, nation),
    total = regions.reduce((sum, region) => sum + population(region), 0)
  return regions.reduce((sum, region) => sum + region[metric] * population(region), 0) / Math.max(1, total)
}
function metric(world: World, nationId: number, key: HistoryCondition['metric']) {
  const nation = world.nations[nationId],
    society = world.historical!.societies.find((entry) => entry.nation === nationId)!
  if (key === 'literacy' || key === 'unrest') return mean(world, nationId, key)
  if (key === 'tax') return nation.policies.tax
  if (key === 'wars')
    return world.relations.filter((rel) => [rel.a, rel.b].includes(nationId) && rel.treaty === 'war').length
  if (key === 'pluralism' || key === 'prestige') return society[key]
  return nation[key]
}
function meets(world: World, nation: number, conditions: HistoryCondition[]) {
  return conditions.every((condition) =>
    condition.comparison === 'above'
      ? metric(world, nation, condition.metric) > condition.value
      : metric(world, nation, condition.metric) < condition.value,
  )
}
function weighted<T>(state: { rng: number }, items: T[], weight: (item: T) => number): T {
  let remaining = random(state) * items.reduce((sum, item) => sum + Math.max(0.001, weight(item)), 0)
  for (const item of items) {
    remaining -= Math.max(0.001, weight(item))
    if (remaining <= 0) return item
  }
  return items[items.length - 1]
}
function responseWeight(world: World, nationId: number, response: HistoricalResponse) {
  const nation = world.nations[nationId],
    policies = nation.policies,
    affinity =
      response.affinity === 'reform'
        ? 0.3 + policies.education / 25 + nation.character!.effective.openness * 1.5
        : response.affinity === 'coercion'
          ? 0.2 +
            nation.character!.effective.assertiveness +
            nation.character!.effective.centralization +
            policies.military / 50 +
            (nation.legitimacy < 35 ? 1 : 0)
          : response.affinity === 'patronage'
            ? 0.4 + policies.research / 25 + nation.character!.leader.skills.scholarship
            : response.affinity === 'commerce'
              ? 0.3 + (100 - policies.tariff) / 100 + nation.character!.effective.commercialism * 1.5
              : response.affinity === 'relief'
                ? 0.3 +
                  policies.welfare / 35 +
                  nation.character!.effective.solidarity * 1.5 +
                  (1 - nation.foodCoverage) * 3
                : 1
  return response.weight * Math.max(0.1, affinity)
}

function applyChange(
  world: World,
  effect: HistoricalEffect,
  event: number,
  regionId: number,
  contextEffects: HistoricalEffect[] = [],
) {
  const state = ensureHistory(world),
    nation = world.nations[effect.target],
    society = state.societies.find((entry) => entry.nation === effect.target)
  if (effect.kind === 'leadership') {
    replaceStateLeader(world, effect.target, effect.text)
    return
  }
  if (effect.kind === 'legacy') {
    if (effect.stat === 'belief' && society) society.tradition = effect.text
    state.legacies.unshift({
      event,
      nation: effect.target,
      region: regionId,
      month: world.month,
      kind: effect.stat as 'literature' | 'belief' | 'institution',
      name: effect.text,
    })
    state.legacies = state.legacies.slice(0, 120)
    introduceCulturalLegacy(
      world,
      effect.target,
      regionId,
      effect.stat as 'literature' | 'belief' | 'institution',
      effect.text,
      contextEffects,
    )
    return
  }
  if (effect.scope === 'relation') {
    const rel = relation(world, effect.target, effect.other)
    if (rel) rel.opinion = clamp(rel.opinion + effect.amount, -100, 100)
    return
  }
  if (effect.scope === 'nation') {
    if (effect.stat === 'stability' || effect.stat === 'legitimacy') {
      nation[effect.stat] = clamp(
        nation[effect.stat] + effect.amount,
        effect.stat === 'stability' ? 5 : 0,
        100,
      )
      return
    }
    if (effect.stat === 'treasury') {
      const amount = Math.abs(nation.treasury * effect.amount)
      if (effect.amount >= 0)
        transfer(
          world,
          producerAccount(nation.capital),
          governmentAccount(nation.id),
          amount,
          'historical domestic transfer',
        )
      else
        transfer(
          world,
          governmentAccount(nation.id),
          householdAccount(nation.capital, 'laborer'),
          Math.min(nation.treasury, amount),
          'historical compensation',
        )
      return
    }
    if (effect.stat === 'researchProgress' && effect.field) {
      nation.researchProgress[effect.field] = Math.max(
        0,
        nation.researchProgress[effect.field] + effect.amount,
      )
      return
    }
    if ((effect.stat === 'prestige' || effect.stat === 'pluralism') && society) {
      society[effect.stat] = clamp(society[effect.stat] + effect.amount, 0, 100)
      return
    }
  }
  const regions =
    effect.scope === 'region'
      ? [world.regions[effect.target]]
      : effect.scope === 'world'
        ? world.regions
        : regionsOf(world, effect.target)
  for (const region of regions) {
    const stat = effect.stat
    if (stat === 'unrest') region.unrest = clamp(region.unrest + effect.amount, 0, 100)
    else if (
      stat === 'literacy' ||
      stat === 'health' ||
      stat === 'happiness' ||
      stat === 'devastation' ||
      stat === 'infrastructure'
    ) {
      region[stat] = clamp(region[stat] + effect.amount, 0, stat === 'infrastructure' ? 1.5 : 1)
      if (stat === 'health' || stat === 'literacy' || stat === 'happiness')
        for (const group of region.communities ?? []) {
          const field = stat === 'happiness' ? 'contentment' : stat
          group[field] = clamp(group[field] + effect.amount)
        }
    }
  }
}
function installEffects(
  world: World,
  event: number,
  title: string,
  region: number,
  effects: HistoricalEffect[],
  nextMonth = false,
) {
  const state = ensureHistory(world)
  for (const effect of effects) {
    if (effect.kind !== 'modifier' && effect.delay === 0) applyChange(world, effect, event, region, effects)
    else {
      const start = world.month + Math.max(effect.delay, effect.kind === 'modifier' && nextMonth ? 1 : 0)
      state.effects.push({
        id: state.nextId++,
        event,
        title,
        region,
        start,
        end: start + (effect.kind === 'modifier' ? effect.duration : 1),
        effect,
      })
    }
  }
  // A fresh array also invalidates the derived modifier cache in the current month.
  state.effects = [...state.effects]
}
function record(
  world: World,
  title: string,
  detail: string,
  nation: number,
  region: number,
  historical: HistoricalRecord,
  effectsToInstall = historical.effects,
) {
  const type: SimEvent['type'] =
      historical.category === 'discovery'
        ? 'research'
        : historical.category === 'diplomacy'
          ? 'diplomacy'
          : historical.category === 'commerce'
            ? 'economy'
            : 'world',
    id = world.nextEvent++
  recordWorldEvent(world, { id, month: world.month, type, title, detail, nation, region, historical })

  installEffects(world, id, title, region, effectsToInstall, historical.source === 'openrouter')
  return id
}
export function recordLocalDevelopment(
  world: World,
  category: HistoryCategory,
  title: string,
  detail: string,
  nation: number,
  region: number,
  effects: HistoricalEffect[],
) {
  return record(world, title, detail, nation, region, {
    category,
    source: 'procedural',
    model: 'structural-pressures',
    causeEvent: 0,
    response: '',
    rationale: '',
    effects,
  })
}
export function applyRefereeEffects(
  world: World,
  effects: HistoricalEffect[],
  title: string,
  detail: string,
  nation: number,
  secret: boolean,
) {
  const id = world.nextEvent++
  if (!secret) {
    recordWorldEvent(world, { id, month: world.month, type: 'diplomacy', title, detail, nation })
  }
  installEffects(
    world,
    id,
    secret ? 'Undisclosed diplomatic development' : title,
    world.nations[nation].capital,
    effects,
    true,
  )
}
export function acceptHistoricalEvent(
  world: World,
  opportunityId: number,
  input: unknown,
  model: string,
  source: 'openrouter' | 'procedural' = 'openrouter',
) {
  if (typeof model !== 'string' || !model.trim() || model.length > 160)
    throw new Error('The event is missing its model provenance.')
  const state = ensureHistory(world),
    opportunity = state.opportunity
  if (!opportunity || opportunity.id !== opportunityId)
    throw new Error('That historical moment has already passed.')
  const proposal = validateHistoricalProposal(world, input)
  if (
    proposal.nation !== opportunity.nation ||
    proposal.region !== opportunity.region ||
    proposal.category !== opportunity.category
  )
    throw new Error('The generated event does not match its historical context.')
  // Governments respond to the situation after the initial shock. The entire
  // proposal was validated before any world state was changed.
  installEffects(
    world,
    world.nextEvent,
    proposal.title,
    proposal.region,
    proposal.effects,
    source === 'openrouter',
  )
  const responses = proposal.responses.filter((response) =>
      meets(world, proposal.nation, response.conditions),
    ),
    response = responses.length
      ? weighted(state, responses, (entry) => responseWeight(world, proposal.nation, entry))
      : undefined,
    effects = [...proposal.effects, ...(response?.effects ?? [])]
  const id = record(
    world,
    proposal.title,
    proposal.description,
    proposal.nation,
    proposal.region,
    {
      category: proposal.category,
      source,
      model,
      causeEvent: proposal.causeEvent,
      response: response?.name ?? '',
      rationale: response?.rationale ?? '',
      effects,
    },
    response?.effects ?? [],
  )
  for (const followUp of proposal.followUps)
    state.scheduled.push({
      event: id,
      nation: proposal.nation,
      region: proposal.region,
      category: proposal.category,
      model,
      due: world.month + followUp.afterMonths,
      expires: world.month + followUp.afterMonths + followUp.withinMonths,
      chance: random(state) < followUp.probability,
      followUp,
    })
  state.opportunity = null
  // Nonperiodic arrival times. Wars and institutional weakness increase the hazard.
  const pressure = (100 - world.nations[proposal.nation].stability) / 100 + world.totals.wars * 0.1
  state.nextRoll =
    world.month +
    Math.max(2, Math.min(18, Math.ceil(-Math.log(Math.max(0.001, 1 - random(state))) * (6 / (1 + pressure)))))
  return id
}

export function advanceHistory(world: World) {
  const state = ensureHistory(world)
  const remaining = [] as typeof state.effects
  for (const active of state.effects) {
    if (active.effect.kind !== 'modifier' && active.start <= world.month)
      applyChange(world, active.effect, active.event, active.region)
    else if (active.end > world.month) remaining.push(active)
  }
  state.effects = remaining
  const scheduled = state.scheduled
  state.scheduled = []
  for (const entry of scheduled) {
    if (!entry.chance || entry.expires < world.month || !regionsOf(world, entry.nation).length) continue
    if (entry.due > world.month || !meets(world, entry.nation, entry.followUp.conditions)) {
      state.scheduled.push(entry)
      continue
    }
    record(world, entry.followUp.title, entry.followUp.description, entry.nation, entry.region, {
      category: entry.category,
      source: 'consequence',
      model: entry.model,
      causeEvent: entry.event,
      response: '',
      rationale: '',
      effects: entry.followUp.effects,
    })
  }
  if (world.month >= state.nextRoll) {
    const pending = state.opportunity
    state.prepared = state.prepared!.filter(
      (entry) =>
        entry.received >= world.month - 120 &&
        world.regions[entry.proposal.region]?.nation === entry.proposal.nation &&
        (!entry.proposal.effects.some((effect) => effect.kind === 'leadership') ||
          (state.societies.find((society) => society.nation === entry.proposal.nation)?.since ?? 0) <=
            entry.requested),
    )
    const index = state.prepared.findIndex(
      (entry) =>
        meets(world, entry.proposal.nation, entry.proposal.conditions) &&
        (!entry.proposal.effects.some((effect) => effect.kind === 'leadership') ||
          (state.societies.find((society) => society.nation === entry.proposal.nation)?.since ?? 0) <=
            entry.requested),
    )
    if (index >= 0) {
      const entry = state.prepared.splice(index, 1)[0],
        proposal = entry.proposal
      state.opportunity = {
        id: state.nextId++,
        month: world.month,
        nation: proposal.nation,
        region: proposal.region,
        category: proposal.category,
        seed: 0,
      }
      acceptHistoricalEvent(world, state.opportunity.id, proposal, entry.model)
    } else {
      const opportunity = chooseOpportunity(world)
      if (opportunity) {
        state.opportunity = opportunity
        const proposal = proceduralEvent(world, opportunity)
        acceptHistoricalEvent(
          world,
          opportunity.id,
          proposal,
          proposal.patternModel
            ? `local adaptation: ${proposal.patternModel}`.slice(0, 160)
            : 'local-history',
          'procedural',
        )
      }
    }
    state.opportunity = pending
  }
  if (!state.opportunity && state.prepared!.length < 3) state.opportunity = chooseOpportunity(world)
}

export function receiveHistoricalEvent(world: World, id: number, input: unknown, model: string) {
  const state = ensureHistory(world),
    opportunity = state.opportunity
  if (!opportunity || opportunity.id !== id) return false
  if (world.regions[opportunity.region]?.nation !== opportunity.nation) {
    state.opportunity = null
    return false
  }
  const bundle = input as { event?: unknown; patterns?: unknown },
    patterns = bundle?.event ? parseHistoryPatterns(bundle.patterns, model) : [],
    proposal = validateHistoricalProposal(world, bundle?.event ?? input)
  if (
    proposal.nation !== opportunity.nation ||
    proposal.region !== opportunity.region ||
    proposal.category !== opportunity.category
  )
    throw new Error('The generated event does not match its requested context.')
  const repertoire = new Map((state.repertoire ?? []).map((pattern) => [pattern.name, pattern]))
  for (const pattern of patterns) {
    repertoire.delete(pattern.name)
    repertoire.set(pattern.name, pattern)
  }
  state.repertoire = [...repertoire.values()].slice(-64)
  state.prepared!.push({ proposal, model, received: world.month, requested: opportunity.month })
  state.prepared = state.prepared!.slice(-3)
  state.opportunity = null
  return true
}

function chooseOpportunity(world: World): HistoricalOpportunity | null {
  const state = ensureHistory(world)
  const nations = world.nations.filter((nation) => regionsOf(world, nation.id).length)
  if (!nations.length) return null
  const nation = weighted(
      state,
      nations,
      (entry) => 1 + (100 - entry.stability) / 70 + Math.log10(Math.max(10, entry.population)) / 8,
    ),
    regions = regionsOf(world, nation.id),
    region = weighted(
      state,
      regions,
      (entry) => 1 + entry.unrest / 50 + entry.literacy + (entry.id === nation.capital ? 2 : 0),
    ),
    society = state.societies.find((entry) => entry.nation === nation.id)!,
    weights: Record<HistoryCategory, number> = {
      succession: 0.3 + (world.month - society.since) / 180 + (100 - nation.legitimacy) / 50,
      discovery: 0.4 + region.literacy * 2 + nation.policies.research / 30,
      literature: 0.3 + region.literacy * 3,
      belief: 0.5 + region.unrest / 45 + (100 - society.pluralism) / 100,
      institutions: 0.4 + nation.policies.education / 40,
      social: 0.3 + region.unrest / 30,
      commerce:
        0.5 + world.routes.filter((route) => route.from === region.id || route.to === region.id).length / 5,
      disaster: 0.15 + (1 - region.health) + (1 - region.foodCoverage) * 2,
      diplomacy: 0.4 + world.totals.wars / 4,
    },
    category = weighted(state, [...HISTORY_CATEGORIES], (entry) => weights[entry])
  return {
    id: state.nextId++,
    month: world.month,
    nation: nation.id,
    region: region.id,
    category,
    seed: Math.floor(random(state) * 0xffffffff),
  }
}

export function historicalContext(world: World) {
  const state = ensureHistory(world),
    opportunity = state.opportunity
  if (!opportunity) throw new Error('No historical moment is awaiting generation.')
  const nation = world.nations[opportunity.nation],
    region = world.regions[opportunity.region]
  return {
    date: dateLabel(world),
    month: world.month,
    seed: world.seed,
    opportunity,
    actor: {
      id: nation.id,
      name: nation.name,
      government: nation.government,
      character: characterContext(nation),
      society: state.societies.find((entry) => entry.nation === nation.id),
      population: nation.population,
      stability: nation.stability,
      legitimacy: nation.legitimacy,
      treasury: nation.treasury,
      debt: nation.debt,
      foodCoverage: nation.foodCoverage,
      policies: nation.policies,
      technologies: nation.technologies,
      researchFocus: nation.researchFocus,
      identities: populationIdentitySummary(world, nation.id),
      literacy: mean(world, nation.id, 'literacy'),
      unrest: mean(world, nation.id, 'unrest'),
    },
    location: {
      id: region.id,
      name: region.name,
      population: population(region),
      terrain: region.terrain,
      literacy: region.literacy,
      health: region.health,
      happiness: region.happiness,
      unrest: region.unrest,
      foodCoverage: region.foodCoverage,
      materialCoverage: region.materialCoverage ?? 1,
      deposits: region.deposits,
      infrastructure: region.infrastructure,
      devastation: region.devastation,
      identities: populationIdentitySummary(world, nation.id, region.id),
      production: region.production,
      stocks: region.stocks,
    },
    provinces: regionsOf(world, nation.id).map((entry) => ({
      id: entry.id,
      name: entry.name,
      literacy: entry.literacy,
      unrest: entry.unrest,
    })),
    foreignRelations: world.relations
      .filter((rel) => [rel.a, rel.b].includes(nation.id))
      .map((rel) => ({
        nation: rel.a === nation.id ? rel.b : rel.a,
        name: world.nations[rel.a === nation.id ? rel.b : rel.a].name,
        treaty: rel.treaty,
        opinion: rel.opinion,
      })),
    simulationConditions: simulationSettings(world),
    currentPressures:
      world.pressures?.incidents.filter(
        (incident) => incident.nations.includes(nation.id) && incident.expires > world.month,
      ) ?? [],
    repertoireVersion: 1,
    existingPatterns: (state.repertoire ?? []).map((pattern) => pattern.name),
    recentHistory: world.events
      .filter((entry) => entry.nation === nation.id || entry.historical)
      .slice(0, 12)
      .map((entry) => ({
        id: entry.id,
        month: entry.month,
        title: entry.title,
        detail: entry.detail,
        response: entry.historical?.response,
      })),
    ongoingEffects: state.effects
      .filter(
        (entry) =>
          entry.effect.scope === 'world' ||
          (entry.effect.scope === 'nation' && entry.effect.target === nation.id) ||
          (entry.effect.scope === 'region' && world.regions[entry.effect.target].nation === nation.id),
      )
      .slice(0, 24),
    culturalMemory: state.legacies
      .filter(
        (legacy) => legacy.nation === nation.id || world.events.some((event) => event.id === legacy.event),
      )
      .slice(0, 12),
  }
}
