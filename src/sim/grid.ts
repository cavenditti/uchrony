import { highMountain } from './terrain-access'

/** One terrain sample occupies an aligned 1,024 m square. Numerical leaves may
 * aggregate samples or subdivide them; physical entities keep their own positions. */
export const CELL_SIZE = 12
export const CELL_METERS = 1024
export const GRID_TOPOLOGY = 'square-v1' as const

/** Clockwise face neighbours: north, east, south, west. Missing edges keep their slot. */
export function edgeNeighbors(id: number, width: number, height: number): number[] {
  const q = id % width,
    r = Math.floor(id / width)
  return [
    r > 0 ? id - width : -1,
    q + 1 < width ? id + 1 : -1,
    r + 1 < height ? id + width : -1,
    q > 0 ? id - 1 : -1,
  ]
}

export const neighbors = (id: number, width: number, height: number) =>
  edgeNeighbors(id, width, height).filter((next) => next >= 0)

/** Eight surrounding samples, clockwise from north. Diagonal edges have sqrt(2)
 * times the length; callers must check traversability before crossing a corner. */
export function adjacentCells(id: number, width: number, height: number): number[] {
  const q = id % width,
    r = Math.floor(id / width)
  return [
    r > 0 ? id - width : -1,
    r > 0 && q + 1 < width ? id - width + 1 : -1,
    q + 1 < width ? id + 1 : -1,
    r + 1 < height && q + 1 < width ? id + width + 1 : -1,
    r + 1 < height ? id + width : -1,
    r + 1 < height && q > 0 ? id + width - 1 : -1,
    q > 0 ? id - 1 : -1,
    r > 0 && q > 0 ? id - width - 1 : -1,
  ]
}

export function cellAt(x: number, y: number, width: number, height: number): number | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  const q = Math.floor(x / CELL_SIZE),
    r = Math.floor(y / CELL_SIZE)
  return q >= 0 && r >= 0 && q < width && r < height ? r * width + q : undefined
}

/** Structural adjacency for validating historical journeys. Land/sea corners
 * cannot be crossed and ports use shared faces. Actual travel also excludes
 * mountains through movementNeighbors below. */
export function geographicNeighbors(
  cells: readonly { terrain: string }[],
  id: number,
  width: number,
  height: number,
): number[] {
  const face = neighbors(id, width, height)
  const water = cells[id].terrain === 'water'
  const q = id % width,
    r = Math.floor(id / width)
  // Faces already have the required N/E/S/W order. Only visit diagonals,
  // preserving NE/SE/SW/NW tie order without allocating coordinate pairs.
  const adjacent = adjacentCells(id, width, height)
  for (let i = 1; i < 8; i += 2) {
    const next = adjacent[i]
    if (next < 0 || (cells[next].terrain === 'water') !== water) continue
    const x = next % width,
      y = Math.floor(next / width)
    if (
      (cells[r * width + x].terrain === 'water') === water &&
      (cells[y * width + q].terrain === 'water') === water
    )
      face.push(next)
  }
  return face
}

export const stepDistance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) / CELL_SIZE

/** Actual movement excludes peaks, including diagonal corner cuts and ports. */
export function movementNeighbors(
  cells: readonly { terrain: string; elevation?: number }[],
  id: number,
  width: number,
  height: number,
): number[] {
  if (highMountain(cells[id])) return []
  const q = id % width,
    r = Math.floor(id / width)
  return geographicNeighbors(cells, id, width, height).filter((next) => {
    if (highMountain(cells[next])) return false
    const x = next % width,
      y = Math.floor(next / width)
    return q === x || r === y || (!highMountain(cells[r * width + x]) && !highMountain(cells[y * width + q]))
  })
}
