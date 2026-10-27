/** The mountain biome begins above the same relief threshold used by generation.
 * Hills and low passes remain usable; peaks are neither housing nor transport land.
 * Check elevation too so older biome labels cannot reopen a high ridge. */
export const MOUNTAIN_ELEVATION = 0.43

export function highMountain(cell: { terrain: string; elevation?: number }) {
  return cell.terrain === 'mountains' || (cell.elevation ?? -Infinity) > MOUNTAIN_ELEVATION
}

export function habitableLand(cell: { terrain: string; elevation?: number }) {
  return cell.terrain !== 'water' && !highMountain(cell)
}
