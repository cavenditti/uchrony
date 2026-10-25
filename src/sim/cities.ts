import { clamp, population, type World } from './types'
import { neighbors } from './hex'
import { landscapeAt } from './landscape'
import { hashSeed } from './random'
import { localFirmRegion } from './local-units'
import { updateResidentCounts } from './districts'
import { regionalFirms } from './firms'
import type { City, DistrictActivity } from './district-types'
import { MODEL_PARAMETERS } from './model-parameters'

/** Built land changes slowly. Population growth alone does not instantly pave a cell. */
export function evolveCities(w: World, initialize = false) {
  const local = w.localEconomy
  if (!local) return
  if (initialize && !local.cities.length)
    for (const site of w.spatial?.settlements ?? []) {
      local.cities.push({
        id: local.nextCity++,
        name: site.name,
        aliases: [],
        founded: w.month,
        nucleus: site.cell,
        cells: [site.cell],
        population: site.population,
        kind: site.kind,
        parents: [],
        lastNameChange: w.month,
      })
      local.built[site.cell] = Math.max(local.built[site.cell] ?? 0, 0.25)
    }
  const residents = new Float64Array(w.cells.length),
    jobs = new Float64Array(w.cells.length)
  for (const f of w.economy?.firms ?? [])
    if (f.active) {
      const u = local.units[localFirmRegion(f)]
      if (!u || u.retired !== undefined) continue
      jobs[f.cell ?? u.center] +=
        f.employment * (f.laborMix ? f.laborMix.tools + f.laborMix.textiles + f.laborMix.arms : 0.2)
    }
  for (const id of local.active) {
    const u = local.units[id]
    updateResidentCounts(u)
    // Within a coarse district, at most 0.3% relocate each month. Built housing,
    // employment and amenity compete with crowding; topography remains fixed.
    if (!initialize && u.cells.length > 1) {
      const score = (c: number) =>
        Math.log1p(jobs[c] * 2 + (local.built[c] ?? 0) * 6000) +
        landscapeAt(w.cells[c]).habitat * 2 -
        Math.log1p((u.residents[c] ?? 0) / 8000) * 1.5
      const best = [...u.cells].sort((a, b) => score(b) - score(a) || a - b)[0]
      let room = Math.floor(population(u) * 0.003)
      for (const c of u.cells)
        if (c !== best && score(best) > score(c) + 0.15 && room > 0) {
          const amount = Math.min(room, Math.floor((u.residents[c] ?? 0) * 0.003))
          u.residents[c] -= amount
          u.residents[best] += amount
          room -= amount
        }
    }
    for (const c of u.cells) residents[c] = u.residents[c] ?? 0
    const industry = w.economy?.firms ? regionalFirms(w, id).filter((f) => f.active) : []
    const production = { food: 0, mining: 0, factory: 0 }
    for (const f of industry) {
      production.food += f.employment * (f.laborMix?.food ?? 0)
      production.mining +=
        f.employment * ((f.laborMix?.iron ?? 0) + (f.laborMix?.coal ?? 0) + (f.laborMix?.stone ?? 0))
      production.factory +=
        f.employment * ((f.laborMix?.tools ?? 0) + (f.laborMix?.textiles ?? 0) + (f.laborMix?.arms ?? 0))
    }
    const labor = production.food + production.mining + production.factory
    const density = population(u) / Math.max(1, u.cells.length)
    const activity: DistrictActivity =
      population(u) === 0
        ? 'wilderness'
        : production.mining > labor * 0.45
          ? 'mining'
          : production.factory > labor * 0.4
            ? 'industrial'
            : density > 8000
              ? 'urban'
              : production.food > labor * 0.5 || u.fertility > 0.5
                ? 'agricultural'
                : 'mixed'
    u.activity = activity
  }
  if (!initialize)
    for (const id of local.active)
      for (const c of local.units[id].cells) {
        const capacity = landscapeAt(w.cells[c]).resources.timber * 5000 * (1 - (local.built[c] ?? 0) * 0.8)
        const stock = local.reserves[c].timber
        local.reserves[c].timber = stock + Math.max(0, capacity - stock) * 0.002
      }
  const oldBuilt = { ...local.built }
  for (const id of local.active)
    for (const c of local.units[id].cells) {
      const habitat = landscapeAt(w.cells[c]).habitat
      const adjacent = neighbors(c, w.width, w.height).filter((n) => w.cells[n].terrain !== 'water')
      const spread = adjacent.reduce((sum, n) => sum + (oldBuilt[n] ?? 0), 0) / Math.max(1, adjacent.length)
      const demand = clamp((residents[c] + jobs[c] * 2) / MODEL_PARAMETERS.fullBuiltPopulationPerCell)
      const target =
        habitat < 0.06 ? demand * 0.1 : clamp(demand + spread * 0.15 * Math.min(1, residents[c] / 1000))
      if (!initialize) local.built[c] = clamp(oldBuilt[c] + clamp(target - oldBuilt[c], -0.003, 0.006))
    }
  const former = new Set(local.cities.filter((c) => c.absorbedBy === undefined).flatMap((c) => c.cells))
  const remaining = new Set(
    local.active
      .flatMap((id) => local.units[id].cells)
      .filter((c) => (local.built[c] ?? 0) >= (former.has(c) ? 0.12 : 0.24) && residents[c] >= 300),
  )
  const components: number[][] = []
  for (const start of [...remaining].sort((a, b) => a - b)) {
    if (!remaining.delete(start)) continue
    const cells = [start]
    for (let i = 0; i < cells.length; i++)
      for (const next of neighbors(cells[i], w.width, w.height)) if (remaining.delete(next)) cells.push(next)
    components.push(cells.sort((a, b) => a - b))
  }
  const active = local.cities.filter((c) => c.absorbedBy === undefined),
    claimed = new Set<number>(),
    componentAt = new Int32Array(w.cells.length).fill(-1)
  components.forEach((cells, i) => cells.forEach((cell) => (componentAt[cell] = i)))
  const home = new Map<number, number>()
  for (const city of active) {
    const nucleus = componentAt[city.nucleus]
    if (nucleus >= 0) {
      home.set(city.id, nucleus)
      continue
    }
    const overlap = new Map<number, number>()
    for (const cell of city.cells)
      if (componentAt[cell] >= 0)
        overlap.set(componentAt[cell], (overlap.get(componentAt[cell]) ?? 0) + residents[cell])
    const largest = [...overlap].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    if (largest) home.set(city.id, largest[0])
  }
  for (const [part, cells] of components.entries()) {
    const overlaps = active
      .filter((c) => !claimed.has(c.id) && home.get(c.id) === part)
      .sort((a, b) => a.founded - b.founded || b.population - a.population || a.id - b.id)
    let city = overlaps[0]
    if (!city) {
      const nucleus = [...cells].sort((a, b) => residents[b] - residents[a] || a - b)[0]
      const region = w.regions[w.cells[nucleus].region]
      const suffix = ['Ford', 'Cross', 'Vale', 'Heath', 'Bank', 'Mere', 'Ridge', 'Field'][
        hashSeed(`${w.seed}:place:${nucleus}`) % 8
      ]
      const base = region.name
      let name = `${base} ${suffix}`
      if (local.cities.some((c) => c.name === name)) name += ` ${local.nextCity + 1}`
      city = {
        id: local.nextCity++,
        name,
        aliases: [],
        founded: w.month,
        nucleus,
        cells: [],
        population: 0,
        kind: 'village',
        parents: [],
        lastNameChange: w.month,
      }
      local.cities.push(city)
    }
    claimed.add(city.id)
    const previousPopulation = city.population
    for (const other of overlaps.slice(1)) {
      other.absorbedBy = city.id
      city.parents.push(other.id)
      city.aliases = [...new Set([...city.aliases, other.name, ...other.aliases])]
      // Comparable centers retain a compound toponym after sustained urban continuity.
      if (other.population > previousPopulation * 0.35 && w.month - city.lastNameChange >= 60) {
        city.aliases.push(city.name)
        city.name = `${city.name.split('–')[0]}–${other.name.split('–')[0]}`.slice(0, 180)
        city.lastNameChange = w.month
      }
      claimed.add(other.id)
    }
    city.cells = cells
    if (!cells.includes(city.nucleus))
      city.nucleus = [...cells].sort((a, b) => residents[b] - residents[a] || a - b)[0]
    city.population = cells.reduce((sum, c) => sum + residents[c], 0)
    city.kind = city.population >= 40000 ? 'city' : city.population >= 8000 ? 'town' : 'village'
  }
  // Shrinking settlements keep their identities and names, available for later revival.
  for (const city of active)
    if (!claimed.has(city.id)) {
      city.cells = []
      city.population = 0
    }
  const cityAt = new Map<number, City>()
  for (const city of local.cities)
    if (city.absorbedBy === undefined) for (const c of city.cells) cityAt.set(c, city)
  for (const id of local.active) {
    const u = local.units[id]
    const urban = u.cells.reduce((sum, c) => sum + (cityAt.has(c) ? residents[c] : 0), 0)
    u.urban = population(u) ? urban / population(u) : 0
    for (const g of u.communities ?? []) g.urban = u.urban
    const city = cityAt.get(u.center)
    const suffix =
      u.activity === 'mining'
        ? 'mining district'
        : u.activity === 'industrial'
          ? 'industrial district'
          : u.activity === 'agricultural'
            ? 'farmland'
            : u.activity === 'wilderness'
              ? 'uplands'
              : 'district'
    u.name = city?.name ?? `${w.regions[u.province].name} ${suffix}`
  }
}
