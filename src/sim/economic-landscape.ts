import { COMMODITIES, EXTENDED_GOODS, type ExtendedGood } from './commodity-catalog'
import { habitableLand } from './terrain-access'
import { GOODS, clamp, population, type Good, type World } from './types'
import { EXTRACTIVE_OUTPUTS } from './production-chains'
import { landscapeAt } from './landscape'
import { localFirmRegion } from './local-units'
import { transportNetwork } from './transport'
import { localClimate } from './climate'

export const TILE_ACTIVITIES = [
  'wild',
  'fields',
  'pasture',
  'forest',
  'timber',
  'quarry',
  'iron',
  'coal',
  'workshops',
  'town',
] as const
export type TileActivity = (typeof TILE_ACTIVITIES)[number]
/** Explicit sectors survive catalogue additions; array positions are not domain identities. */
const GOOD_ACTIVITY = {
  ...(Object.fromEntries(
    EXTENDED_GOODS.map((good) => [
      good,
      COMMODITIES[good].sector === 'crop'
        ? 'fields'
        : COMMODITIES[good].sector === 'mineral'
          ? 'quarry'
          : 'workshops',
    ]),
  ) as Record<ExtendedGood, TileActivity>),
  food: 'fields',
  timber: 'timber',
  stone: 'quarry',
  ironOre: 'iron',
  coal: 'coal',
  iron: 'workshops',
  tools: 'workshops',
  textiles: 'workshops',
  arms: 'workshops',
  charcoal: 'workshops',
  wool: 'pasture',
} satisfies Record<Good, TileActivity>
export interface EconomicLandscape {
  month: number
  activity: Uint8Array
  intensity: Float32Array
  workers: Float64Array
  residents: Float64Array
  harbors: { cell: number; water: number; region: number; level: number }[]
}
/** Compact, read-only projection of the economy for all observers. Dominant tile
 * use simplifies the illustration; it never moves jobs, goods or bank claims.
 * Published before dossier filtering so unselected countries retain their life. */
export function economicLandscape(w: World): EconomicLandscape {
  const count = w.cells.length,
    activity = new Uint8Array(count),
    intensity = new Float32Array(count),
    workers = new Float64Array(count),
    residents = new Float64Array(count),
    sectors = GOODS.map(() => new Float64Array(count))
  const units = w.localEconomy ? w.localEconomy.active.map((id) => w.localEconomy!.units[id]) : w.regions
  for (const r of units) {
    const total = population(r)
    const usable = r.cells.filter((id) => habitableLand(w.cells[id]))
    for (const id of usable)
      residents[id] = w.localEconomy?.units[r.id]?.residents[id] ?? total / Math.max(1, usable.length)
  }
  const distribution = new Map<string, { weights: number[]; total: number }>()
  for (const f of w.economy?.firms ?? []) {
    if (!f.active || !f.employment) continue
    const r = w.localEconomy?.units[localFirmRegion(f)] ?? w.regions[f.region]
    if (!r) continue
    const cell = f.cell ?? r.center
    for (let g = 0; g < GOODS.length; g++) {
      const good = GOODS[g],
        resource = EXTRACTIVE_OUTPUTS[good]
      const share =
        f.laborMix?.[good] ??
        (f.specialization === 'agricultural' ? Number(good === 'food') : Number(good === 'tools'))
      const jobs = f.employment * share
      if (!jobs) continue
      if (good === 'food' || good === 'wool' || resource) {
        const key = `${r.id}:${g}`
        let spread = distribution.get(key)
        if (!spread) {
          const weights = r.cells.map((id) =>
            !habitableLand(w.cells[id])
              ? 0
              : !resource
                ? landscapeAt(w.cells[id]).habitat
                : (w.localEconomy?.reserves[id]?.[resource] ?? landscapeAt(w.cells[id]).resources[resource]),
          )
          spread = { weights, total: weights.reduce((a, b) => a + b, 0) }
          distribution.set(key, spread)
        }
        if (spread.total > 0)
          r.cells.forEach((id, i) => {
            sectors[g][id] += (jobs * spread!.weights[i]) / spread!.total
          })
        else sectors[g][cell] += jobs
      } else sectors[g][cell] += jobs
    }
  }
  for (const c of w.cells) {
    if (!habitableLand(c)) continue
    const id = c.id,
      soil = landscapeAt(c),
      built = w.localEconomy?.built[id] ?? 0
    // Broad agricultural employment includes scattered forest clearings and
    // grazing. It must not turn every inhabited wood or dry upland into cropland.
    const foodUse: TileActivity =
      c.terrain === 'forest' && built < 0.12 && residents[id] < 5000
        ? 'forest'
        : soil.habitat <= 0.42 || localClimate(w, c).crop === 'pasture'
          ? 'pasture'
          : 'fields'
    let use: TileActivity = c.terrain === 'forest' ? 'forest' : 'wild'
    const jobs = sectors.map((s) => s[id]),
      maximum = Math.max(...jobs)
    workers[id] = jobs.reduce((a, b) => a + b, 0)
    if (residents[id] > (c.terrain === 'forest' ? 1500 : 80) && soil.habitat > 0.15) use = foodUse
    if (maximum > 0) {
      const g = jobs.indexOf(maximum)
      const good = GOODS[g],
        resource = EXTRACTIVE_OUTPUTS[good]
      use = good === 'food' ? foodUse : GOOD_ACTIVITY[good]
      // Extraction must have an actual local endowment, even if a mixed firm's
      // employment book contains a tiny share of every sector.
      if (resource && (w.localEconomy?.reserves[id]?.[resource] ?? soil.resources[resource]) <= 0)
        use = residents[id] > 80 ? foodUse : 'wild'
    }
    if (built >= 0.18 && residents[id] >= 500 && !['quarry', 'iron', 'coal', 'workshops'].includes(use))
      use = 'town'
    activity[id] = TILE_ACTIVITIES.indexOf(use)
    intensity[id] = clamp(
      use === 'forest' ? c.moisture : 0.18 + Math.log1p(workers[id] + residents[id] * 0.1) / 12,
    )
  }
  const harbors = transportNetwork(w).harbors.map((h) => ({
    cell: h.land,
    water: h.water,
    region: h.region,
    level: 1 + (w.regions[h.region].publicWorks?.harbor ?? 0),
  }))
  return { month: w.month, activity, intensity, workers, residents, harbors }
}
