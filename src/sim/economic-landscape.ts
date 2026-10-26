import { GOODS, clamp, population, type World } from './types'
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
    for (const id of r.cells)
      residents[id] = w.localEconomy?.units[r.id]?.residents[id] ?? total / Math.max(1, r.cells.length)
  }
  const distribution = new Map<string, { weights: number[]; total: number }>()
  for (const f of w.economy?.firms ?? []) {
    if (!f.active || !f.employment) continue
    const r = w.localEconomy?.units[localFirmRegion(f)] ?? w.regions[f.region]
    if (!r) continue
    const cell = f.cell ?? r.center
    for (let g = 0; g < GOODS.length; g++) {
      const share =
        f.laborMix?.[GOODS[g]] ?? (f.specialization === 'agricultural' ? Number(g === 0) : Number(g === 5))
      const jobs = f.employment * share
      if (!jobs) continue
      if (g <= 4) {
        const key = `${r.id}:${g}`
        let spread = distribution.get(key)
        if (!spread) {
          const weights = r.cells.map((id) =>
            g === 0
              ? landscapeAt(w.cells[id]).habitat
              : (w.localEconomy?.reserves[id]?.[GOODS[g] as 'timber'] ??
                landscapeAt(w.cells[id]).resources[GOODS[g] as 'timber']),
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
    if (c.terrain === 'water') continue
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
      use = ([foodUse, 'timber', 'quarry', 'iron', 'coal', 'workshops', 'workshops', 'workshops'] as const)[g]
      // Extraction must have an actual local endowment, even if a mixed firm's
      // employment book contains a tiny share of every sector.
      if (
        g >= 1 &&
        g <= 4 &&
        (w.localEconomy?.reserves[id]?.[GOODS[g] as 'timber'] ?? soil.resources[GOODS[g] as 'timber']) <= 0
      )
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
