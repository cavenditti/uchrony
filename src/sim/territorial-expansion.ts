import { expansionParameters } from './expansion-parameters'
import { recordWorldEvent } from './event-memory'
import { CELL_METERS, edgeNeighbors } from './grid'
import { communitySize } from './population'
import { clamp, population, type Nation, type Region, type World } from './types'

export const UNCLAIMED_ENCLAVE_MAX_AREA_KM2 = 16

/** Absorb whole unclaimed pockets, including empty or mountainous land. Only
 * shared land edges count: water and the map boundary leave a pocket open.
 * Decide from one ownership snapshot, and never claim land outside the pocket. */
export function absorbUnclaimedEnclaves(world: World) {
  const independent = world.regions.filter((region) => region.nation === -1)
  if (!independent.length) return 0
  const visited = new Uint8Array(world.cells.length)
  const pending: { regions: Region[]; nation: number; area: number }[] = []
  for (const region of independent)
    for (const start of region.cells) {
      if (visited[start]) continue
      const cells = [start],
        provinces = new Set<number>()
      let enclosed = true,
        nation = -1
      visited[start] = 1
      for (let i = 0; i < cells.length; i++) {
        const cell = world.cells[cells[i]]
        provinces.add(cell.region)
        for (const next of edgeNeighbors(cell.id, world.width, world.height)) {
          const neighbor = world.cells[next]
          if (!neighbor || neighbor.terrain === 'water') {
            enclosed = false
            continue
          }
          const owner = world.regions[neighbor.region].nation
          if (owner === -1) {
            if (!visited[next]) {
              visited[next] = 1
              cells.push(next)
            }
          } else if (nation === -1) nation = owner
          else if (nation !== owner) enclosed = false
        }
      }
      const area = (cells.length * CELL_METERS ** 2) / 1e6
      if (
        !enclosed ||
        area >= UNCLAIMED_ENCLAVE_MAX_AREA_KM2 ||
        nation < 0 ||
        !world.nations[nation] ||
        world.nations[nation].extinct !== undefined
      )
        continue
      const regions = [...provinces].map((id) => world.regions[id])
      // Sovereignty is provincial. A disconnected province must not pull in
      // another piece of land that was not enclosed by this same boundary.
      if (regions.reduce((sum, r) => sum + r.cells.length, 0) !== cells.length) continue
      pending.push({ regions, nation, area })
    }
  let absorbed = 0
  for (const { regions, nation, area } of pending) {
    for (const region of regions) claimIndependentProvince(world, region, nation, false)
    absorbed += regions.length
    recordWorldEvent(world, {
      id: world.nextEvent++,
      month: world.month,
      type: 'world',
      nation,
      region: regions[0].id,
      title: `${world.nations[nation].shortName} absorbs an unclaimed enclave`,
      detail: `An unclaimed pocket of ${area.toFixed(2)} km² (${regions.map((r) => r.name).join(', ')}) is completely surrounded by ${world.nations[nation].shortName}. Its territory joins the surrounding state; residents, identities, homes and assets are preserved.`,
    })
  }
  if (absorbed && world.sovereignty?.frontiers)
    world.sovereignty.frontiers = world.sovereignty.frontiers.filter(
      (progress) => world.regions[progress.region].nation === -1,
    )
  return absorbed
}

export function culturalAffinity(nation: Nation, region: Region) {
  const people = population(region)
  if (!people || !nation.identity) return 0
  return (
    (region.communities ?? []).reduce(
      (sum, group) =>
        sum +
        communitySize(group) *
          ((group.culture === nation.identity!.culture ? 0.6 : 0) +
            (group.language === nation.identity!.language ? 0.4 : 0)),
      0,
    ) / people
  )
}

/** Productive land and related communities give expansion a concrete payoff.
 * This is a preference, never an exemption from founding's material costs. */
export function frontierValue(world: World, nation: Nation, region: Region) {
  const foodNeed = 1 + clamp(1.2 - nation.foodCoverage) * 2
  const resources = region.deposits.iron * 0.8 + region.deposits.coal * 0.5 + region.deposits.timber * 0.3
  const economic =
    region.fertility * foodNeed + resources + clamp(region.gdp / Math.max(1, population(region)) / 0.01) * 0.3
  const cultural = culturalAffinity(nation, region)
  const at = world.cells[region.center],
    home = world.cells[world.regions[nation.capital].center]
  const distance = Math.hypot(at.x - home.x, at.y - home.y)
  return {
    economic,
    cultural,
    score: economic * expansionParameters().economicWeight + cultural * 1.2 + 0.3 / (1 + distance / 20),
  }
}

/** Political integration changes jurisdiction, not ancestry, goods, or homes. */
export function claimIndependentProvince(world: World, region: Region, nation: number, voluntary: boolean) {
  if (region.nation !== -1) throw new Error('Only independent land can join a state.')
  region.nation = nation
  for (const group of region.communities ?? []) {
    group.host = nation
    if (voluntary && group.allegiance === -1) {
      group.allegiance = nation
      group.loyalty = Math.max(0.6, group.loyalty)
    }
  }
  if (world.localEconomy)
    for (const id of world.localEconomy.active) {
      const unit = world.localEconomy.units[id]
      if (unit.province === region.id) {
        unit.nation = nation
        for (const group of unit.communities ?? []) group.host = nation
      }
    }
  if (world.adaptive) {
    for (const level of ['province', 'municipality'] as const) {
      const id = `${level}:${region.id}`
      world.adaptive.jurisdictions[id] = {
        id,
        level,
        name: region.name,
        nation,
        seat: region.center,
        cells: [...region.cells],
        founded: world.month,
        revised: world.month,
        predecessors: [],
        successors: [],
        account: `government:${nation}`,
      }
    }
    world.adaptive.revision++
  }
}
