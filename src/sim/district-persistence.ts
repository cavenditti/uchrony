import { expeditionOwner } from './overseas-types'
import { geographicNeighbors as movementNeighbors, neighbors } from './grid'
import { integerValidator, numberValidator, recordValue, validationFailure } from './persistence-primitives'
import { communitySize } from './population'
import { GOODS, population, type World } from './types'

/** Import checks are read-only. Duplicate/missing ownership must never be repaired by minting or deleting assets. */
export function validateDistrictEconomy(w: World) {
  const s = w.localEconomy
  if (s === undefined) return
  const fail = validationFailure('Invalid district economy: ', '', '')
  const num = numberValidator(0, 1e16)
  const int = integerValidator(0, 1e9, true)
  const obj = recordValue
  if (
    !obj(s) ||
    s.version !== 1 ||
    !int(s.initialized, 0, w.month) ||
    !int(s.nextId, w.regions.length, 1e6) ||
    !Array.isArray(s.active) ||
    s.active.length > w.cells.length ||
    !obj(s.units) ||
    !obj(s.built) ||
    !obj(s.reserves) ||
    !Array.isArray(s.cities) ||
    !Array.isArray(s.shipments) ||
    !int(s.revision) ||
    !int(s.reorganizations) ||
    !int(s.lastRemesh, 0, w.month) ||
    !int(s.nextCity)
  )
    fail('registry')
  const active = new Set(s.active),
    seen = new Set<number>(),
    totals = new Map<number, number>()
  if (
    active.size !== s.active.length ||
    Object.keys(s.units).length + Object.keys(s.archive ?? {}).length !== s.nextId
  )
    fail('unit identities')
  if (s.archive !== undefined) {
    if (!obj(s.archive)) fail('district archive')
    for (const [id, entry] of Object.entries(s.archive))
      if (
        !int(+id, 0, s.nextId - 1) ||
        s.units[+id] ||
        !obj(entry) ||
        !w.regions[entry.province] ||
        typeof entry.name !== 'string' ||
        entry.name.length > 220 ||
        !int(entry.founded, 0, w.month) ||
        !int(entry.retired, entry.founded, w.month) ||
        !Array.isArray(entry.predecessors)
      )
        fail('archived identity')
  }
  for (const r of w.regions)
    for (const g of r.communities ?? []) {
      if (!int(g.locality) || !active.has(g.locality) || s.units[g.locality]?.province !== r.id)
        fail('resident district')
      totals.set(g.locality!, (totals.get(g.locality!) ?? 0) + communitySize(g))
    }
  for (const [key, u] of Object.entries(s.units)) {
    if (
      !obj(u) ||
      u.id !== +key ||
      !int(u.id, 0, s.nextId - 1) ||
      !w.regions[u.province] ||
      !int(u.center, 0, w.cells.length - 1) ||
      typeof u.name !== 'string' ||
      u.name.length > 220 ||
      !obj(u.residents) ||
      !obj(u.population) ||
      !num(u.capitalReference) ||
      !Array.isArray(u.cells) ||
      !Array.isArray(u.neighbors) ||
      !Array.isArray(u.predecessors) ||
      !int(u.founded, 0, w.month)
    )
      fail('unit')
    if (!['agricultural', 'mining', 'industrial', 'urban', 'mixed', 'wilderness'].includes(u.activity))
      fail('specialization')
    for (const g of GOODS)
      for (const inventory of [u.stocks, u.production, u.consumption, u.prices, u.plannedProduction])
        if (!obj(inventory) || !num(inventory![g])) fail('local inventories')
    for (const field of [
      'urban',
      'literacy',
      'health',
      'happiness',
      'foodCoverage',
      'materialCoverage',
    ] as const)
      if (!num(u[field], 0, 1)) fail('local household conditions')
    for (const field of [
      'industry',
      'infrastructure',
      'fertility',
      'employed',
      'unrest',
      'devastation',
    ] as const)
      if (!num(u[field])) fail('local capacity')
    if (!num(u.gdp, -1e16) || !num(u.migration, -1e14) || !int(u.births) || !int(u.deaths))
      fail('local flows')
    if (!active.has(u.id)) {
      if (
        !int(u.retired, 0, w.month) ||
        u.cells.length ||
        population(u) !== 0 ||
        GOODS.some((g) => u.stocks[g] !== 0)
      )
        fail('retired unit owns physical assets')
      continue
    }
    if (
      u.retired !== undefined ||
      u.nation !== w.regions[u.province].nation ||
      !u.cells.length ||
      !u.cells.includes(u.center) ||
      population(u) !== (totals.get(u.id) ?? 0)
    )
      fail('local census or jurisdiction')
    let people = 0
    const cells = new Set(u.cells),
      reached = new Set([u.cells[0]]),
      queue = [u.cells[0]]
    if (cells.size !== u.cells.length || Object.keys(u.residents).length !== u.cells.length)
      fail('cell ownership')
    for (let i = 0; i < queue.length; i++)
      for (const c of neighbors(queue[i], w.width, w.height))
        if (cells.has(c) && !reached.has(c)) {
          reached.add(c)
          queue.push(c)
        }
    if (reached.size !== cells.size) fail('disconnected unit')
    for (const c of u.cells) {
      if (
        !int(c, 0, w.cells.length - 1) ||
        w.cells[c].region !== u.province ||
        w.cells[c].terrain === 'water' ||
        seen.has(c) ||
        !int(u.residents[c])
      )
        fail('cell ownership')
      seen.add(c)
      people += u.residents[c]
      if (!num(s.built[c], 0, 1) || !obj(s.reserves[c])) fail('land use')
      for (const good of ['timber', 'stone', 'iron', 'coal'] as const)
        if (!num(s.reserves[c][good])) fail('natural reserves')
    }
    if (people !== population(u)) fail('cell residents')
    for (const other of u.neighbors)
      if (!active.has(other) || !s.units[other].neighbors.includes(u.id)) fail('neighbor graph')
  }
  if (seen.size !== w.cells.filter((c) => c.terrain !== 'water').length) fail('incomplete land partition')
  for (const r of w.regions) {
    const u = s.units[r.id]
    if (!u || u.province !== r.id || !u.cells.includes(r.center)) fail('administrative depot')
    for (const g of GOODS) if (r.stocks[g] !== u.stocks[g]) fail('provincial depot stock')
  }
  const cityIds = new Set<number>(),
    cityCells = new Set<number>(),
    citySites = new Set<string>()
  for (const c of s.cities) {
    if (
      !obj(c) ||
      !int(c.id, 0, s.nextCity - 1) ||
      cityIds.has(c.id) ||
      typeof c.name !== 'string' ||
      c.name.length > 180 ||
      !int(c.nucleus, 0, w.cells.length - 1) ||
      !Array.isArray(c.cells) ||
      !Array.isArray(c.parents) ||
      !Array.isArray(c.aliases) ||
      c.aliases.some((a) => typeof a !== 'string' || a.length > 180) ||
      !int(c.founded, 0, w.month) ||
      !int(c.lastNameChange, 0, w.month) ||
      !int(c.population)
    )
      fail('city identity')
    if (!['village', 'town', 'city'].includes(c.kind)) fail('city kind')
    if (
      c.abandoned !== undefined &&
      (!int(c.abandoned, c.founded, w.month) || c.population !== 0 || c.cells.length || c.sites?.length)
    )
      fail('abandoned city')
    cityIds.add(c.id)
    if (
      c.field !== undefined &&
      (!obj(c.field) ||
        !num(c.field.reach) ||
        !(c.field.reach > 0) ||
        !num(c.field.prominence, 0, 1) ||
        !int(c.field.developed, 0, c.population) ||
        !num(c.field.x) ||
        !num(c.field.y))
    )
      fail('place field')
    if (c.metropolis !== undefined) {
      const m = c.metropolis
      if (
        !obj(m) ||
        !int(m.centre, 0, s.nextCity - 1) ||
        m.centre === c.id ||
        !int(m.since, 0, w.month) ||
        [m.incorporated, m.pending].some((month) => month !== undefined && !int(month, m.since, w.month)) ||
        c.absorbedBy !== undefined
      )
        fail('city metropolis')
    }
    if (
      c.history !== undefined &&
      (!Array.isArray(c.history) ||
        c.history.some(
          (e, i) =>
            !obj(e) ||
            !int(e.month, i ? c.history![i - 1].month : 0, w.month) ||
            !int(e.with, 0, s.nextCity - 1) ||
            e.with === c.id ||
            !['linked', 'separated', 'incorporated', 'released', 'merged'].includes(e.kind),
        ))
    )
      fail('city history')
    if (c.absorbedBy !== undefined && !int(c.absorbedBy, 0, s.nextCity - 1)) fail('city succession')
    if (c.absorbedBy !== undefined) continue
    if (c.sites !== undefined) {
      if (
        !Array.isArray(c.sites) ||
        new Set(c.sites).size !== c.sites.length ||
        c.sites.some(
          (id) => !w.adaptive?.sites[id] || w.adaptive.sites[id].kind !== 'residential' || citySites.has(id),
        ) ||
        (c.sites.length &&
          (!c.nucleusSite ||
            !c.sites.includes(c.nucleusSite) ||
            w.adaptive!.sites[c.nucleusSite].cell !== c.nucleus))
      )
        fail('city residential footprint')
      let people = 0
      for (const id of c.sites) {
        const site = w.adaptive!.sites[id]
        citySites.add(id)
        if (!c.cells.includes(site.cell)) fail('city parcel is outside footprint')
        people += site.residents ?? 0
      }
      if (people !== c.population) fail('city occupied population')
    }
    for (const id of c.cells) {
      if (!seen.has(id) || (!c.sites && cityCells.has(id))) fail('city footprint')
      cityCells.add(id)
    }
  }
  if (
    s.cities.some(
      (c) =>
        c.parents.some((id) => !cityIds.has(id)) ||
        (c.absorbedBy !== undefined && !cityIds.has(c.absorbedBy)),
    )
  )
    fail('city lineage')
  const citiesById = new Map(s.cities.map((c) => [c.id, c]))
  for (const city of s.cities) {
    if (city.history?.some((e) => !cityIds.has(e.with))) fail('city history reference')
    if (city.metropolis) {
      const centre = citiesById.get(city.metropolis.centre)
      // A centre administers its quarters, so it cannot itself be a quarter.
      if (
        !centre ||
        centre.absorbedBy !== undefined ||
        centre.metropolis?.incorporated !== undefined ||
        !centre.population ||
        !city.population ||
        w.localEconomy!.units[w.adaptive?.sites[centre.nucleusSite!]?.pool ?? -1]?.nation !==
          w.localEconomy!.units[w.adaptive?.sites[city.nucleusSite!]?.pool ?? -1]?.nation
      )
        fail('city metropolis reference')
    }
    const lineage = new Set<number>([city.id])
    let successor = city.absorbedBy
    while (successor !== undefined) {
      if (lineage.has(successor)) fail('city succession cycle')
      lineage.add(successor)
      successor = citiesById.get(successor)?.absorbedBy
    }
  }
  for (const f of w.economy?.firms ?? []) {
    const u = s.units[f.locality!]
    if (
      !u ||
      !active.has(u.id) ||
      u.province !== f.region ||
      !u.cells.includes(f.cell!) ||
      !obj(f.owners) ||
      Object.entries(f.owners!).some(
        ([a, v]) =>
          !num(v) ||
          !(
            expeditionOwner(w, a) ||
            (/^government:\d+$/.test(a) && w.nations[Number(a.split(':')[1])]) ||
            (/^household:\d+:(smallholder|laborer|artisan|professional|owner)$/.test(a) &&
              w.economy!.households[Number(a.split(':')[1])])
          ),
      )
    )
      fail('firm site or ownership')
  }
  if (s.shipments.length > w.cells.length * 100) fail('shipment budget')
  for (const shipment of s.shipments) {
    if (
      !obj(shipment) ||
      !s.units[shipment.from] ||
      !s.units[shipment.to] ||
      !GOODS.includes(shipment.good) ||
      !num(shipment.quantity) ||
      !num(shipment.value) ||
      !num(shipment.freight) ||
      !num(shipment.tariff) ||
      !Array.isArray(shipment.legs) ||
      !Array.isArray(shipment.cells)
    )
      fail('shipment')
    let last = shipment.legs[0]?.cells?.[0] ?? s.units[shipment.from].center
    if (last !== s.units[shipment.from].center) fail('shipment origin')
    for (const leg of shipment.legs) {
      if (
        !leg ||
        !['land', 'sea'].includes(leg.mode) ||
        !Array.isArray(leg.cells) ||
        leg.cells.length < 2 ||
        leg.cells[0] !== last
      )
        fail('shipment route')
      for (let i = 0; i < leg.cells.length; i++) {
        const c = leg.cells[i]
        if (
          !int(c, 0, w.cells.length - 1) ||
          (w.cells[c].terrain === 'water') !== (leg.mode === 'sea' && i > 0 && i < leg.cells.length - 1) ||
          (i > 0 && !movementNeighbors(w.cells, leg.cells[i - 1], w.width, w.height).includes(c))
        )
          fail('shipment geometry')
      }
      last = leg.cells.at(-1)!
    }
    if (last !== s.units[shipment.to].center) fail('shipment destination')
  }
}
