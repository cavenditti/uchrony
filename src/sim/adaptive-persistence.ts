import { GOODS, type World } from './types'
import { adaptiveMesh } from './adaptive-world'
import { STRATA } from './economic-types'
import { cellPosition } from './physical-space'

export function validateAdaptiveWorld(w: World) {
  const a = w.adaptive
  if (!a) return
  const fail = (detail: string): never => {
    throw new Error(`Invalid adaptive world: ${detail}`)
  }
  const finite = (v: unknown, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min
  const object = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  const cell = (v: number) => Number.isSafeInteger(v) && w.cells[v]?.terrain !== 'water' && !!w.cells[v]
  const date = (v: unknown) => Number.isSafeInteger(v) && finite(v) && Number(v) <= w.month
  if (
    !w.localEconomy ||
    a.version !== 1 ||
    !finite(a.initialized) ||
    a.initialized > w.month ||
    !Number.isSafeInteger(a.revision) ||
    a.revision < 0 ||
    !finite(a.metersPerMapUnit, 1) ||
    !finite(a.minimumSpan, 25) ||
    !['adaptive', 'coarse', 'fine'].includes(a.mode)
  )
    fail('unsupported version, units or resolution')
  if (
    !object(a.sites) ||
    !object(a.jurisdictions) ||
    !object(a.tree) ||
    !Array.isArray(a.tree.leaves) ||
    !object(a.tree.changed) ||
    !Array.isArray(a.boundaries) ||
    !Array.isArray(a.names) ||
    !Array.isArray(a.commuting) ||
    !Number.isSafeInteger(a.nextJurisdiction) ||
    a.nextJurisdiction < 0
  )
    fail('missing structures')
  if (
    !date(a.tree.month) ||
    !date(a.reviewMonth) ||
    !a.migration ||
    a.migration.source !== 'legacy' ||
    !date(a.migration.month) ||
    !Array.isArray(a.migration.assumptions) ||
    a.migration.assumptions.some((s) => typeof s !== 'string') ||
    Object.entries(a.tree.changed).some(([id, month]) => !/^r[0-3]{0,39}$/.test(id) || !date(month))
  )
    fail('invalid migration or mesh dates')
  const addresses = new Set(a.tree.leaves)
  if (!addresses.size || addresses.size !== a.tree.leaves.length) fail('duplicate or empty leaves')
  for (const id of addresses) {
    if (!/^r[0-3]{0,39}$/.test(id)) fail('invalid quadtree address')
    for (let n = 1; n < id.length; n++)
      if (addresses.has(id.slice(0, n))) fail('overlapping active parent and child')
  }
  for (const [id, site] of Object.entries(a.sites)) {
    if (
      !site ||
      site.id !== id ||
      !cell(site.cell) ||
      !w.localEconomy!.units[site.pool] ||
      !['residential', 'establishment', 'market', 'civic'].includes(site.kind) ||
      typeof site.entity !== 'string' ||
      !finite(site.capacity) ||
      !finite(site.openingCapacity) ||
      !finite(site.capitalReference) ||
      !date(site.founded) ||
      (site.retired !== undefined && (!date(site.retired) || site.retired < site.founded)) ||
      (site.openingBuilt !== undefined && !finite(site.openingBuilt)) ||
      (site.investedValue !== undefined && !finite(site.investedValue)) ||
      !finite(site.x) ||
      !finite(site.y)
    )
      fail('invalid site or ownership')
    const p = cellPosition(w, site.cell)
    if (Math.hypot(p.x - site.x, p.y - site.y) > 1000) fail('site is outside its physical cell')
  }
  for (const id of w.localEconomy!.active)
    for (const c of w.localEconomy!.units[id].cells)
      if (a.sites[`home:${c}`]?.pool !== id) fail('residents have no persistent home site')
  for (const level of ['municipality', 'province']) {
    const seen = new Set<number>()
    for (const [id, j] of Object.entries(a.jurisdictions)) {
      const sequence = /^(?:municipality|province):reform:(\d+)$/.exec(id)
      if (sequence && Number(sequence[1]) >= a.nextJurisdiction)
        fail('jurisdiction sequence would overwrite an existing legal identity')
      if (
        !j ||
        j.id !== id ||
        !['municipality', 'province'].includes(j.level) ||
        !w.nations[j.nation] ||
        typeof j.name !== 'string' ||
        !Array.isArray(j.cells) ||
        !j.cells.length ||
        !j.cells.includes(j.seat) ||
        !Array.isArray(j.successors) ||
        !Array.isArray(j.predecessors) ||
        j.account !== `government:${j.nation}` ||
        !date(j.founded) ||
        !date(j.revised) ||
        j.revised < j.founded ||
        (j.retired !== undefined && (!date(j.retired) || j.retired < j.founded)) ||
        new Set(j.cells).size !== j.cells.length ||
        j.cells.some((c) => !cell(c))
      )
        fail('invalid jurisdiction')
      if ([...j.successors, ...j.predecessors].some((ref) => !a.jurisdictions[ref]))
        fail('unresolved legal succession')
      if (j.level !== level || j.retired !== undefined) continue
      for (const c of j.cells) {
        if (!cell(c) || seen.has(c) || w.regions[w.cells[c].region].nation !== j.nation)
          fail('overlapping or foreign jurisdiction')
        seen.add(c)
      }
    }
    if (seen.size !== w.cells.filter((c) => c.terrain !== 'water').length) fail('unassigned land')
  }
  for (const change of a.boundaries) {
    if (
      !change ||
      !date(change.month) ||
      !['municipality', 'province'].includes(change.level) ||
      !Array.isArray(change.from) ||
      !change.from.length ||
      !Array.isArray(change.to) ||
      !change.to.length ||
      [...change.from, ...change.to].some((id) => a.jurisdictions[id]?.level !== change.level) ||
      typeof change.reason !== 'string' ||
      !finite(change.cost) ||
      !Array.isArray(change.assignments) ||
      change.assignments.some(
        (entry) =>
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          !cell(entry[0]) ||
          !change.to.includes(entry[1]) ||
          !a.jurisdictions[entry[1]].cells.includes(entry[0]),
      ) ||
      new Set(change.assignments.map(([c]) => c)).size !== change.assignments.length
    )
      fail('invalid dated jurisdiction membership')
  }
  const names = new Set<string>()
  for (const name of a.names) {
    if (
      !name ||
      typeof name.id !== 'string' ||
      names.has(name.id) ||
      typeof name.name !== 'string' ||
      !cell(name.cell) ||
      !date(name.since) ||
      !Array.isArray(name.aliases) ||
      name.aliases.some((s) => typeof s !== 'string')
    )
      fail('invalid place name')
    names.add(name.id)
  }
  if (
    (a.commutingRows !== undefined && !Array.isArray(a.commutingRows)) ||
    (a.commuteRoutes !== undefined && !object(a.commuteRoutes)) ||
    (a.transit !== undefined && !Array.isArray(a.transit)) ||
    (a.construction !== undefined && !Array.isArray(a.construction))
  )
    fail('invalid optional records')
  for (const row of a.commutingRows ?? []) {
    if (
      !Array.isArray(row) ||
      row.length !== 13 ||
      !w.localEconomy!.units[row[0]] ||
      !a.sites[`firm:${row[1]}`] ||
      !a.commuteRoutes?.[row[2]] ||
      row.slice(3).some((n) => !finite(n))
    )
      fail('invalid compact commuting row')
  }
  for (const route of Object.values(a.commuteRoutes ?? {}))
    if (
      !Array.isArray(route.cells) ||
      !route.cells.length ||
      route.cells.some((c) => !cell(c)) ||
      !finite(route.minutes) ||
      !['walk', 'road', 'rail'].includes(route.mode)
    )
      fail('invalid physical commuting path')
  for (const flow of a.commuting)
    if (
      !w.localEconomy!.units[flow.residence] ||
      !a.sites[flow.workplace] ||
      !STRATA.includes(flow.stratum) ||
      !finite(flow.workers) ||
      !finite(flow.wage) ||
      !finite(flow.minutes) ||
      !['walk', 'road', 'rail'].includes(flow.mode) ||
      !Array.isArray(flow.route ? a.commuteRoutes?.[flow.route]?.cells : flow.cells) ||
      (flow.route ? a.commuteRoutes![flow.route].cells : flow.cells!).some((c) => !cell(c))
    )
      fail('invalid commuting flow')
  for (const project of a.construction ?? [])
    if (
      !a.sites[project.site] ||
      !finite(project.cost) ||
      !finite(project.capacity) ||
      !Number.isSafeInteger(project.remaining) ||
      project.remaining < 1
    )
      fail('invalid construction project')
  const shipments = new Set<number>()
  for (const shipment of a.transit ?? []) {
    if (
      !shipment ||
      !Number.isSafeInteger(shipment.id) ||
      shipment.id < 0 ||
      shipments.has(shipment.id) ||
      !Number.isSafeInteger(a.nextTransit) ||
      a.nextTransit! <= shipment.id ||
      !w.localEconomy!.units[shipment.from] ||
      !w.localEconomy!.units[shipment.to] ||
      shipment.owner !== `producer:${shipment.to}` ||
      !date(shipment.dispatched) ||
      !Number.isSafeInteger(shipment.arrives) ||
      shipment.arrives <= shipment.dispatched ||
      !object(shipment.goods) ||
      GOODS.some((g) => !finite(shipment.goods[g])) ||
      !Array.isArray(shipment.legs) ||
      !shipment.legs.length ||
      shipment.legs.some(
        (leg) =>
          !['land', 'sea'].includes(leg.mode) ||
          !Array.isArray(leg.cells) ||
          !leg.cells.length ||
          leg.cells.some((c) => !Number.isSafeInteger(c) || !w.cells[c]),
      )
    )
      fail('invalid freight ownership or journey')
    shipments.add(shipment.id)
  }
  adaptiveMesh(w) // restores cut-cell coverage and 2:1 interfaces without changing authority
}
