/** Local masonry choice changes real purchases, not the amount of finished
 * construction. Existing stone designs remain usable without a brick industry. */
import type { Good, Region } from './types'
export function constructionMaterials(
  r: Region,
  recipe: Readonly<Partial<Record<Good, number>>>,
): Partial<Record<Good, number>> {
  const stone = recipe.stone ?? 0
  if (stone <= 0 || r.stocks.bricks <= 0) return recipe
  // Foundations retain at least 30% stone. Brick masonry uses a declared 0.65
  // tonnes per displaced tonne of this recipe's generic stone requirement.
  const cheaper = r.prices.bricks * 0.65 < r.prices.stone
  const replace = Math.min(
    stone * 0.7,
    r.stocks.bricks / 0.65,
    cheaper ? stone : Math.max(0, stone - r.stocks.stone),
  )
  return replace > 0
    ? { ...recipe, stone: stone - replace, bricks: (recipe.bricks ?? 0) + replace * 0.65 }
    : recipe
}
