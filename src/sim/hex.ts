export const HEX = 7

/** Clockwise edge neighbors of an odd-row, pointy-top hex. Missing edges keep their slot. */
export function edgeNeighbors(id: number, width: number, height: number): number[] {
  const q = id % width,
    r = Math.floor(id / width),
    odd = r % 2
  return [
    [q + odd, r - 1],
    [q + 1, r],
    [q + odd, r + 1],
    [q - 1 + odd, r + 1],
    [q - 1, r],
    [q - 1 + odd, r - 1],
  ].map(([x, y]) => (x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x))
}
export const neighbors = (id: number, width: number, height: number) =>
  edgeNeighbors(id, width, height).filter((id) => id >= 0)
