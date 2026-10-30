/** Physical production contracts shared by procurement, firms and geography.
 * A geographic iron deposit contains ore; refined iron is never mined directly. */
import { configurationValues } from './configuration-context'
import { COMMODITIES, EXTENDED_GOODS } from './commodity-catalog'
import type { NaturalResource } from './landscape'
import type { Good, Inventory, Region } from './types'

export const EXTRACTIVE_OUTPUTS: Readonly<Partial<Record<Good, NaturalResource>>> = {
  timber: 'timber',
  stone: 'stone',
  ironOre: 'iron',
  coal: 'coal',
}
export const WORKSHOP_GOODS: readonly Good[] = [
  'iron',
  'charcoal',
  'tools',
  'textiles',
  'arms',
  ...EXTENDED_GOODS.filter((good) => COMMODITIES[good].sector === 'workshop'),
]
/** Workshop jobs plus mineral jobs retain the spatial model's industrial scope. */
export function industrialLaborShare(mix: Inventory | undefined): number {
  if (!mix) return 0
  let share = mix.ironOre + mix.coal + mix.clay + mix.salt + mix.preciousOre
  for (const good of WORKSHOP_GOODS) share += mix[good]
  return share
}
type Recipe = Readonly<Partial<Inventory>>
type Recipes = Readonly<Partial<Record<Good, Recipe>>>
const reverseRecipes = new WeakMap<Recipes, Readonly<Partial<Record<Good, readonly [Good, number][]>>>>()
const NO_CONSUMERS: readonly [Good, number][] = []

/** Compile the reverse bill of materials once per immutable configuration.
 * Reserve queries are hot: each lookup visits only outputs consuming this input,
 * with no fresh arrays or full goods-by-goods scan on every region and trade quote. */
export function plannedInputDemand(plan: Inventory, input: Good, region?: Region): number {
  const recipes: Recipes = configurationValues().recipes
  let index = reverseRecipes.get(recipes)
  if (!index) {
    const compiled: Partial<Record<Good, [Good, number][]>> = {}
    for (const [output, recipe] of Object.entries(recipes))
      for (const [good, rate] of Object.entries(recipe))
        (compiled[good as Good] ??= []).push([output as Good, rate])
    index = compiled
    reverseRecipes.set(recipes, index)
  }
  let demand = 0
  for (const [output, rate] of index[input] ?? NO_CONSUMERS) demand += plan[output] * rate
  if (region?.productionTechniques)
    for (const output of ['textiles', 'tools', 'arms'] as const)
      if (region.productionTechniques[output])
        demand +=
          plan[output] * ((productionRecipe(region, output)[input] ?? 0) - (recipes[output]?.[input] ?? 0))
  return demand
}

const variantCache = new WeakMap<Recipes, Map<string, Recipe>>()
/** Alternative fibres and forged steel are compatible material techniques, not
 * free output multipliers. Input yields and research requirements are explicit. */
export function productionRecipe(region: Region, output: Good): Recipe {
  const recipes: Recipes = configurationValues().recipes
  const base = recipes[output] ?? EMPTY_RECIPE
  const choice =
    output === 'textiles' || output === 'tools' || output === 'arms'
      ? region.productionTechniques?.[output]
      : undefined
  if (!choice) return base
  let cache = variantCache.get(recipes)
  if (!cache) variantCache.set(recipes, (cache = new Map()))
  const key = `${output}:${choice}`
  let recipe = cache.get(key)
  if (!recipe) {
    const next = { ...base }
    if (output === 'textiles' && (choice === 'flax' || choice === 'cotton')) {
      delete next.wool
      next[choice] = (base.wool ?? 1.15) * (choice === 'flax' ? 1.1 : 0.9)
    } else if ((output === 'tools' || output === 'arms') && choice === 'steel') {
      delete next.iron
      next.steel = (base.iron ?? 1) * 0.75
    }
    recipe = next
    cache.set(key, recipe)
  }
  return recipe
}
const EMPTY_RECIPE: Recipe = Object.freeze({})
/** Select once per local hiring round using posted delivered quotes. Available
 * input lots win over an impossible cheap recipe; empty markets retain orders. */
export function selectProductionTechniques(region: Region, industry: number) {
  region.productionTechniques ??= {}
  for (const output of ['textiles', 'tools', 'arms'] as const) {
    const choices =
      output === 'textiles'
        ? ['', 'flax', ...(industry >= 1 ? ['cotton'] : [])]
        : ['', ...(industry >= 2 ? ['steel'] : [])]
    let best = '',
      bestScore = Infinity
    for (const choice of choices) {
      if (choice) region.productionTechniques[output] = choice
      else delete region.productionTechniques[output]
      const recipe = productionRecipe(region, output)
      let cost = 0,
        available = true
      for (const [name, rate] of Object.entries(recipe)) {
        const good = name as Good
        cost += region.prices[good] * rate
        if (region.stocks[good] <= 1e-9) available = false
      }
      const score = cost + (available ? 0 : 1e12)
      if (score < bestScore) {
        best = choice
        bestScore = score
      }
    }
    if (best) region.productionTechniques[output] = best
    else delete region.productionTechniques[output]
  }
}

/** Saved choices name supported material techniques; unknown identifiers must
 * fail rather than silently turn a saved plant into a different input recipe. */
export function validateProductionTechniques(region: Region) {
  const choices = region.productionTechniques
  if (choices === undefined) return
  if (
    !choices ||
    typeof choices !== 'object' ||
    Array.isArray(choices) ||
    Object.entries(choices).some(([output, choice]) =>
      output === 'textiles'
        ? choice !== 'flax' && choice !== 'cotton'
        : (output !== 'tools' && output !== 'arms') || choice !== 'steel',
    )
  )
    throw new Error('Invalid production technique')
}
