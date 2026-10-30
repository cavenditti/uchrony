/** Edible products substitute for the same household ration. Grain and flour
 * are production intermediates here; they are never counted as a second meal. */
import type { Good, Inventory } from './types'
export const EDIBLE_GOODS = ['food', 'bread', 'fish', 'preservedFood'] as const
export type EdibleGood = (typeof EDIBLE_GOODS)[number]
const NUTRITION: Readonly<Partial<Record<Good, number>>> = { food: 1, bread: 1, fish: 1, preservedFood: 1 }
export const foodUnits = (good: Good): number => NUTRITION[good] ?? 0
export function foodEquivalentInventory(stock: Readonly<Inventory>): number {
  let total = 0
  for (const good of EDIBLE_GOODS) total += stock[good] * foodUnits(good)
  return total
}
