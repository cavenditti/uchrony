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
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ].map(([dx, dy]) => {
    const x = q + dx,
      y = r + dy
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x
  })
}

export function cellAt(x: number, y: number, width: number, height: number): number | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  const q = Math.floor(x / CELL_SIZE),
    r = Math.floor(y / CELL_SIZE)
  return q >= 0 && r >= 0 && q < width && r < height ? r * width + q : undefined
}

/** Physical movement may be diagonal, but cannot squeeze between two blocked
 * corners or embark/disembark across a point contact. Ports use shared faces. */
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
  for (const next of adjacentCells(id, width, height)) {
    if (next < 0 || face.includes(next) || (cells[next].terrain === 'water') !== water) continue
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

/** Travel shares geographic adjacency until additional movement rules apply. */
export const movementNeighbors = geographicNeighbors
