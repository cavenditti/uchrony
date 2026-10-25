import { clamp, population, type World } from './types'
import type { ActiveHistoricalEffect, HistoricalEffect, ModifierStat } from './history-types'

const cache = new WeakMap<
  World,
  { month: number; effects: ActiveHistoricalEffect[]; values: Map<string, number> }
>()
export function effectStrength(active: ActiveHistoricalEffect, month: number) {
  if (month < active.start || month >= active.end) return 0
  const elapsed = (month - active.start) / Math.max(1, active.end - active.start - 1)
  return (
    active.effect.amount *
    (active.effect.curve === 'fade' ? 1 - elapsed : active.effect.curve === 'grow' ? 0.2 + elapsed * 0.8 : 1)
  )
}
function historicalValue(world: World, stat: ModifierStat, nation?: number, region?: number) {
  const effects = world.historical?.effects
  if (!effects?.length) return 0
  let prepared = cache.get(world)
  if (!prepared || prepared.month !== world.month || prepared.effects !== effects) {
    const values = new Map<string, number>()
    for (const active of effects) {
      if (active.effect.kind !== 'modifier') continue
      const key = `${active.effect.scope}:${active.effect.target}:${active.effect.stat}`
      values.set(key, (values.get(key) ?? 0) + effectStrength(active, world.month))
    }
    prepared = { month: world.month, effects, values }
    cache.set(world, prepared)
  }
  let regional = region === undefined ? 0 : (prepared.values.get(`region:${region}:${stat}`) ?? 0)
  if (nation !== undefined && region === undefined) {
    let people = 0,
      total = 0
    for (const province of world.regions)
      if (province.nation === nation) {
        const size = population(province)
        people += size
        total += size * (prepared.values.get(`region:${province.id}:${stat}`) ?? 0)
      }
    regional = total / Math.max(1, people)
  }
  return (
    (prepared.values.get(`world:-1:${stat}`) ?? 0) +
    (nation === undefined ? 0 : (prepared.values.get(`nation:${nation}:${stat}`) ?? 0)) +
    regional
  )
}
export function effectValue(world: World, stat: ModifierStat, nation?: number, region?: number) {
  if (region !== undefined) region = world.localEconomy?.units[region]?.province ?? region
  const owner = nation ?? (region === undefined ? undefined : world.regions[region]?.nation)
  return (
    historicalValue(world, stat, nation, region) +
    (owner === undefined ? 0 : (world.nations[owner]?.character?.modifiers[stat] ?? 0))
  )
}
export function effectMultiplier(world: World, stat: ModifierStat, nation?: number, region?: number) {
  return clamp(1 + effectValue(world, stat, nation, region), 0.2, 2.5)
}
export const EFFECT_LABELS: Record<string, string> = {
  harvest: 'Harvest yield',
  extraction: 'Resource extraction',
  manufacturing: 'Manufacturing',
  tradeCost: 'Transport friction',
  tradeCapacity: 'Transport capacity',
  taxIncome: 'Tax receipts',
  research: 'Research activity',
  education: 'Education',
  healthcare: 'Healthcare',
  birthRate: 'Birth rate',
  mortality: 'Mortality',
  migrationAttraction: 'Migration appeal',
  cohesion: 'Social cohesion',
  militaryPower: 'Military effectiveness',
  armyMorale: 'Army morale',
  stability: 'Stability',
  legitimacy: 'Legitimacy',
  treasury: 'Treasury',
  opinion: 'Diplomatic relations',
  unrest: 'Unrest',
  literacy: 'Literacy',
  health: 'Health',
  happiness: 'Contentment',
  devastation: 'Devastation',
  infrastructure: 'Infrastructure',
  researchProgress: 'Research progress',
  prestige: 'Cultural prestige',
  pluralism: 'Religious and civic pluralism',
  leader: 'New leadership',
  literature: 'Published work',
  belief: 'Belief movement',
  institution: 'Institutional legacy',
}
export function describeEffect(effect: HistoricalEffect) {
  if (effect.kind === 'legacy' || effect.kind === 'leadership')
    return `${EFFECT_LABELS[effect.stat]}: ${effect.text}`
  const percent =
      effect.kind === 'modifier' ||
      ['treasury', 'literacy', 'health', 'happiness', 'devastation', 'infrastructure'].includes(effect.stat),
    amount = effect.amount * (percent ? 100 : 1)
  return `${EFFECT_LABELS[effect.stat]} ${amount >= 0 ? '+' : ''}${Number(amount.toFixed(1))}${percent ? '%' : ''}${effect.field ? ` (${effect.field})` : ''}${effect.kind === 'modifier' ? ` · ${effect.duration} months${effect.curve === 'steady' ? '' : ` · ${effect.curve === 'grow' ? 'building' : 'fading'}`}` : ''}${effect.delay ? ` · begins in ${effect.delay} months` : ''}`
}
