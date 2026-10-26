import { settlementComponents, settledResidentsByCell } from './settlement-morphology'
import { optimizeResidentialLocations, settlementAccess } from './settlement-access'
import { clamp, population, type World } from './types'
import { neighbors } from './grid'
import { landscapeAt } from './landscape'
import { hashSeed } from './random'
import { localFirmRegion } from './local-units'
import { updateResidentCounts } from './districts'
import { regionalFirms } from './firms'
import type { City, DistrictActivity } from './district-types'
import { MODEL_PARAMETERS } from './model-parameters'
import { cellPolygon, polygonArea } from './physical-space'
import { SETTLEMENT, isVisibleSettlement, settlementKind } from './settlement-model'

/** Built land changes slowly. Population growth alone does not instantly pave a cell. */
export function advanceSettlements(
  w: World,
  initialize = false,
  access?: ReturnType<typeof settlementAccess>,
) {
  const local = w.localEconomy
  if (!local) return
  const residents = new Float64Array(w.cells.length),
    jobs = new Float64Array(w.cells.length)
  for (const f of w.economy?.firms ?? [])
    if (f.active) {
      const u = local.units[localFirmRegion(f)]
      if (!u || u.retired !== undefined) continue
      jobs[f.cell ?? u.center] +=
        f.employment * (f.laborMix ? f.laborMix.tools + f.laborMix.textiles + f.laborMix.arms : 0.2)
    }
  for (const id of local.active) updateResidentCounts(local.units[id])
  if (w.adaptive && !initialize) optimizeResidentialLocations(w, access)
  for (const id of local.active) {
    const u = local.units[id]
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
  if (!initialize && !w.adaptive) {
    const oldBuilt = { ...local.built }
    for (const id of local.active)
      for (const c of local.units[id].cells) {
        const habitat = landscapeAt(w.cells[c]).habitat
        const adjacent = neighbors(c, w.width, w.height).filter((n) => w.cells[n].terrain !== 'water')
        const spread = adjacent.reduce((sum, n) => sum + (oldBuilt[n] ?? 0), 0) / Math.max(1, adjacent.length)
        const demand = clamp((residents[c] + jobs[c] * 2) / MODEL_PARAMETERS.fullBuiltPopulationPerCell)
        const target =
          habitat < 0.06 ? demand * 0.1 : clamp(demand + spread * 0.15 * Math.min(1, residents[c] / 1000))
        if (!initialize && !w.adaptive)
          local.built[c] = clamp(oldBuilt[c] + clamp(target - oldBuilt[c], -0.003, 0.006))
      }
  }
  const settled = settledResidentsByCell(w)
  for (const id of local.active) {
    const u = local.units[id]
    const urban = u.cells.reduce((sum, c) => sum + (settled.get(c) ?? 0), 0)
    u.urban = population(u) ? urban / population(u) : 0
    for (const g of u.communities ?? []) g.urban = u.urban
  }
}

/** Observer projection only: names and ancestry never determine physical activity. */
export function refreshCityLabels(w: World) {
  const local = w.localEconomy
  if (!local) return
  const residents = new Float64Array(w.cells.length)
  for (const id of local.active)
    for (const c of local.units[id].cells) residents[c] = local.units[id].residents[c] ?? 0
  const physical = w.adaptive?.residentialVersion === 1 ? settlementComponents(w) : undefined
  let components: number[][]
  if (physical) components = physical.map((p) => p.cells)
  else {
    const remaining = new Set(
      local.active
        .flatMap((id) => local.units[id].cells)
        .filter(
          (c) =>
            (local.built[c] ?? 0) >= 0.24 &&
            residents[c] / (polygonArea(cellPolygon(w, c)) / 1e6) >= SETTLEMENT.minimumDensity,
        ),
    )
    components = []
    for (const start of [...remaining].sort((a, b) => a - b)) {
      if (!remaining.delete(start)) continue
      const cells = [start]
      for (let i = 0; i < cells.length; i++)
        for (const next of neighbors(cells[i], w.width, w.height))
          if (remaining.delete(next)) cells.push(next)
      if (isVisibleSettlement(cells.reduce((sum, cell) => sum + residents[cell], 0)))
        components.push(cells.sort((a, b) => a - b))
    }
  }
  const componentBySite = new Map<string, number>()
  physical?.forEach((part, i) => part.sites.forEach((site) => componentBySite.set(site.id, i)))
  const active = local.cities.filter((c) => c.absorbedBy === undefined),
    claimed = new Set<number>(),
    componentAt = new Int32Array(w.cells.length).fill(-1)
  components.forEach((cells, i) => cells.forEach((cell) => (componentAt[cell] = i)))
  const home = new Map<number, number>()
  for (const city of active) {
    const nucleus = physical
      ? (componentBySite.get(city.nucleusSite ?? `home:${city.nucleus}`) ?? -1)
      : componentAt[city.nucleus]
    if (nucleus >= 0) {
      home.set(city.id, nucleus)
      continue
    }
    const overlap = new Map<number, number>()
    if (physical) {
      for (const id of city.sites ?? city.cells.map((c) => `home:${c}`)) {
        const part = componentBySite.get(id)
        if (part !== undefined)
          overlap.set(part, (overlap.get(part) ?? 0) + (w.adaptive!.sites[id]?.residents ?? 0))
      }
    } else
      for (const cell of city.cells)
        if (componentAt[cell] >= 0)
          overlap.set(componentAt[cell], (overlap.get(componentAt[cell]) ?? 0) + residents[cell])
    const largest = [...overlap].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    if (largest) home.set(city.id, largest[0])
  }
  const byComponent = new Map<number, City[]>()
  for (const city of active) {
    const part = home.get(city.id)
    if (part === undefined) continue
    const members = byComponent.get(part) ?? []
    members.push(city)
    byComponent.set(part, members)
  }
  const usedNames = new Set(local.cities.map((c) => c.name))
  for (const [part, cells] of components.entries()) {
    const overlaps = (byComponent.get(part) ?? []).sort(
      (a, b) => a.founded - b.founded || b.population - a.population || a.id - b.id,
    )
    let city = overlaps[0]
    if (!city) {
      const nucleus =
        physical?.[part].nucleus.cell ?? [...cells].sort((a, b) => residents[b] - residents[a] || a - b)[0]
      const region = w.regions[w.cells[nucleus].region]
      const suffix = ['Ford', 'Cross', 'Vale', 'Heath', 'Bank', 'Mere', 'Ridge', 'Field'][
        hashSeed(`${w.seed}:place:${nucleus}`) % 8
      ]
      const base = region.name
      let name = `${base} ${suffix}`
      if (usedNames.has(name)) name += ` ${local.nextCity + 1}`
      usedNames.add(name)
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
    if (physical) {
      city.sites = physical[part].sites.map((s) => s.id)
      if (!city.nucleusSite || !city.sites.includes(city.nucleusSite))
        city.nucleusSite = physical[part].nucleus.id
      city.nucleus = w.adaptive!.sites[city.nucleusSite].cell
    }
    city.population = physical?.[part].population ?? cells.reduce((sum, c) => sum + residents[c], 0)
    city.kind = settlementKind(city.population)
  }
  // Shrinking settlements keep their identities and names, available for later revival.
  for (const city of active)
    if (!claimed.has(city.id)) {
      city.cells = []
      if (city.sites) city.sites = []
      city.population = 0
    }
  const cityAt = new Map<number, City>()
  for (const city of local.cities)
    if (city.absorbedBy === undefined) for (const c of city.cells) cityAt.set(c, city)
  for (const id of local.active) {
    const u = local.units[id]
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

/** Compatibility entry point for fixtures and legacy initialization. */
export function evolveCities(w: World, initialize = false) {
  advanceSettlements(w, initialize)
  refreshCityLabels(w)
}
