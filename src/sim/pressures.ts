import { hashSeed, random } from './random'
import { simulationSettings } from './settings'
import { recordLocalDevelopment } from './history'
import { clamp, relation, type Good, type World } from './types'
import type { HistoricalEffect, HistoryCategory } from './history-types'

export interface PoliticalIncident {
  id: number
  month: number
  expires: number
  scope: 'province' | 'state' | 'regional' | 'international'
  kind: 'harvest' | 'extraction' | 'epidemic' | 'faction' | 'border' | 'concession' | 'transit'
  title: string
  detail: string
  nations: number[]
  regions: number[]
  severity: number
  good: '' | Good
}
export interface PressureState {
  rng: number
  nextAt: number
  nextId: number
  intensity: number
  incidents: PoliticalIncident[]
}
export function ensurePressures(world: World) {
  return (world.pressures ??= {
    rng: hashSeed(`${world.seed}:structural-pressures`),
    nextAt: world.month + 3,
    nextId: 1,
    intensity: simulationSettings(world).instability,
    incidents: [],
  })
}
/** These are reasons to act, not automatic wars or transfers of sovereignty. All effects resolve locally. */
export function advancePressures(world: World) {
  const state = ensurePressures(world),
    intensity = simulationSettings(world).instability
  if (intensity !== state.intensity) {
    if (intensity > state.intensity) state.nextAt = Math.min(state.nextAt, world.month + 1)
    state.intensity = intensity
  }
  if (intensity === 0 || world.month < state.nextAt) return
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random(state) * values.length)],
    origin = pick(world.regions.filter((r) => r.nation >= 0)),
    nation = world.nations[origin.nation],
    roll = random(state),
    scope: PoliticalIncident['scope'] =
      roll < 0.2 ? 'province' : roll < 0.38 ? 'state' : roll < 0.67 ? 'regional' : 'international',
    severity = 0.3 + random(state) * 0.7,
    duration = 6 + Math.floor(random(state) * 19),
    effects: HistoricalEffect[] = [],
    effect = (
      region: number,
      stat: HistoricalEffect['stat'],
      amount: number,
      kind: HistoricalEffect['kind'] = 'modifier',
    ) => {
      const targetScope = scope === 'state' ? 'nation' : 'region',
        target = scope === 'state' ? nation.id : region
      if (
        effects.some(
          (effect) => effect.scope === targetScope && effect.target === target && effect.stat === stat,
        )
      )
        return
      effects.push({
        kind,
        scope: targetScope,
        target,
        other: -1,
        stat,
        amount,
        duration: kind === 'modifier' ? duration : 0,
        curve: kind === 'modifier' ? 'fade' : 'steady',
        delay: 0,
        field: '',
        text: '',
      })
    }
  let affected = scope === 'state' ? world.regions.filter((region) => region.nation === nation.id) : [origin],
    kind: PoliticalIncident['kind'] = 'faction',
    category: HistoryCategory = 'social',
    good: PoliticalIncident['good'] = '',
    title = '',
    detail = ''
  if (scope === 'regional') {
    const ids = new Set([origin.id, ...origin.neighbors])
    for (const id of origin.neighbors)
      for (const next of world.regions[id].neighbors) if (random(state) < 0.4) ids.add(next)
    affected = [...ids].map((id) => world.regions[id])
  }
  if (scope === 'international') {
    const borders = world.regions.filter(
      (region) =>
        region.nation >= 0 &&
        region.neighbors.some(
          (id) => world.regions[id].nation >= 0 && world.regions[id].nation !== region.nation,
        ),
    )
    if (!borders.length) {
      state.nextAt = world.month + 3
      return
    }
    const border = pick(borders),
      foreign = pick(
        border.neighbors
          .map((id) => world.regions[id])
          .filter((region) => region.nation >= 0 && region.nation !== border.nation),
      ),
      a = world.nations[border.nation],
      b = world.nations[foreign.nation],
      rel = relation(world, a.id, b.id)!
    affected = [border, foreign]
    kind = pick(['border', 'concession', 'transit'] as const)
    category = 'diplomacy'
    if (kind === 'border') {
      title = `Competing frontier claims near ${foreign.name}`
      detail = `Political factions in ${a.shortName} challenge arrangements along the frontier with ${b.shortName}. Rival claims concern ${foreign.name}, but ownership and legal commitments have not changed.`
    } else if (kind === 'concession') {
      good = (['iron', 'coal', 'timber'] as const).reduce(
        (best, candidate) => (foreign.deposits[candidate] > foreign.deposits[best] ? candidate : best),
        'iron',
      )
      title = `${a.shortName}–${b.shortName} dispute over ${good} access`
      detail = `Rival commercial and political interests contest access to ${good} concessions around ${foreign.name}. Preferential access, compensation or a joint undertaking could settle the dispute; competing demands could deepen it.`
    } else {
      title = `Passage rights contested at ${border.name}`
      detail = `Local authorities and carriers dispute the charges and jurisdiction governing passage between ${a.shortName} and ${b.shortName}. Neither government has yet settled how the costs and access rights should be shared.`
      for (const region of affected) effect(region.id, 'tradeCost', 0.08 + severity * 0.15)
    }
    effects.push({
      kind: 'change',
      scope: 'relation',
      target: a.id,
      other: b.id,
      stat: 'opinion',
      amount: -(5 + severity * 14),
      duration: 0,
      curve: 'steady',
      delay: 0,
      field: '',
      text: '',
    })
    rel.grievance = clamp(rel.grievance + 6 + severity * 18, 0, 100)
  } else {
    kind = scope === 'state' ? 'faction' : pick(['harvest', 'extraction', 'epidemic', 'faction'] as const)
    const area =
      scope === 'state' ? nation.shortName : scope === 'regional' ? `the ${origin.name} region` : origin.name
    if (kind === 'harvest') {
      category = 'disaster'
      good = 'food'
      title = `Harvest failure in ${area}`
      detail = `Unfavorable growing conditions reduce harvests across ${area}. Existing reserves and accessible imports determine which households face shortages and which suppliers gain bargaining power.`
      for (const region of affected) effect(region.id, 'harvest', -(0.18 + severity * 0.35))
    } else if (kind === 'extraction') {
      category = 'commerce'
      good = pick(['iron', 'coal', 'timber'] as const)
      title = `Extraction interrupted in ${area}`
      detail = `A breakdown in maintenance and labor coordination interrupts extraction in ${area}. Workshops and carriers must seek alternative suppliers while repairs compete with other demands on public and private resources.`
      for (const region of affected) {
        effect(region.id, 'extraction', -(0.15 + severity * 0.35))
        effect(region.id, 'manufacturing', -severity * 0.12)
      }
    } else if (kind === 'epidemic') {
      category = 'disaster'
      title = `Illness spreads through ${area}`
      detail = `An outbreak strains care networks and interrupts work in ${area}. Food access, existing health and public provision will shape its demographic consequences.`
      for (const region of affected) {
        effect(region.id, 'mortality', 0.08 + severity * 0.25)
        effect(region.id, 'manufacturing', -severity * 0.18)
      }
    } else {
      title = `Competing factions mobilize in ${area}`
      detail = `Rival networks dispute the distribution of authority and public burdens in ${area}. Established loyalties divide over concessions, repression or a new institutional settlement.`
      for (const region of affected) {
        effect(region.id, 'cohesion', -(0.08 + severity * 0.22))
        effect(region.id, 'unrest', 3 + severity * 9, 'change')
      }
    }
  }
  const nations = [...new Set(affected.map((region) => region.nation).filter((id) => id >= 0))],
    regions = affected.map((region) => region.id),
    incident: PoliticalIncident = {
      id: state.nextId++,
      month: world.month,
      expires: world.month + duration,
      scope,
      kind,
      title,
      detail,
      nations,
      regions,
      severity,
      good,
    }
  state.incidents = [incident, ...state.incidents].slice(0, 64)
  recordLocalDevelopment(world, category, title, detail, affected[0].nation, affected[0].id, effects)
  for (const agent of world.statecraft?.agents ?? [])
    if (nations.includes(agent.nation)) {
      agent.escalation = `Strategic review requested: ${title}. Consider accommodation, exploitation, coercion or collective action according to your private motives and the material balance.`
      agent.nextDecision = Math.min(agent.nextDecision, world.month)
      agent.nextStrategy = Math.min(agent.nextStrategy, world.month)
    }
  // Calibrate the exponential scale for integer months: mean spacing is 6 / intensity.
  const arrivalScale = -1 / Math.log(1 - intensity / 6)
  state.nextAt =
    world.month +
    Math.max(1, Math.min(120, Math.ceil(-Math.log(Math.max(0.001, 1 - random(state))) * arrivalScale)))
}
