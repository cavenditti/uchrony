import { STRATA } from './economic-types'
import { producerAccount, householdAccount, transfer } from './ledger'
import { marketStore, recordUse, recordOwnCapital, recordWages } from './national-accounts'
import type { World } from './types'
import { residentialDemand } from './settlement-access'
import { residentialPools, findResidentialParcel, createResidentialParcel } from './residential-sites'
import { MODEL_PARAMETERS } from './model-parameters'

/** Housing-space development has physical inputs and paid labor. No imputed rent removes cash. */
export function advanceLandUse(w: World) {
  const a = w.adaptive
  if (!a || !w.economy || !w.localEconomy) return
  a.construction ??= []
  for (const project of a.construction) {
    project.remaining--
    if (project.remaining === 0) {
      const site = a.sites[project.site]
      site.capacity += project.capacity
      site.investedValue = (site.investedValue ?? 0) + project.cost
    }
  }
  a.construction = a.construction.filter((p) => p.remaining > 0)
  const pending = new Set(a.construction.map((p) => p.site))
  const homes = residentialPools(w),
    demand = residentialDemand(w)
  for (const id of w.localEconomy.active) {
    const r = w.localEconomy.units[id],
      p = w.economy.producers[id],
      hh = w.economy.households[id]
    const available = STRATA.reduce((sum, s) => sum + Math.max(0, hh[s].laborForce - hh[s].employed), 0)
    if (!available || p.wage <= 0) continue
    const targets = (homes.get(id) ?? []).filter((s) => !pending.has(s.id))
    let site = targets.sort(
      (x, y) => (demand.get(y.id) ?? 0) - (demand.get(x.id) ?? 0) || x.id.localeCompare(y.id),
    )[0]
    if (!site) continue
    const reserved = a.construction
      .filter((p) => a.sites[p.site].pool === id)
      .reduce((sum, p) => sum + p.capacity, 0)
    const need = Math.max(0, (demand.get(site.id) ?? 0) - reserved)
    if (!need) continue
    // Expansion surveys real plots once an existing ground footprint is full.
    // Surveying alone reserves neither a parcel nor any construction resources.
    const plot =
      a.residentialVersion === 1 && site.parcel && site.capacity * 40 >= site.parcel.size ** 2
        ? findResidentialParcel(w, site, homes.get(id))
        : undefined
    // One resident-place requires timber/stone and two worker-days; wages and materials use existing units.
    const spaces = Math.min(
      need,
      r.stocks.timber / 0.08,
      r.stocks.stone / 0.05,
      available * 10,
      p.cash / (p.wage * 0.1),
      plot ? plot.parcel.size ** 2 / 40 : Infinity,
    )
    if (spaces <= 1e-6) continue
    if (plot) {
      site = createResidentialParcel(w, id, plot.cell, plot.point, plot.parcel)
      homes.get(id)!.push(site)
    }
    const labor = spaces * 0.1
    let wages = 0
    for (const s of STRATA) {
      const h = hh[s],
        jobs = (labor * Math.max(0, h.laborForce - h.employed)) / available
      const paid = transfer(
        w,
        producerAccount(id),
        householdAccount(id, s),
        jobs * p.wage,
        'housing construction wages',
      )
      h.employed += paid / p.wage
      h.income += paid
      wages += paid
      recordWages(w, id, producerAccount(id), paid)
    }
    const timber = spaces * 0.08,
      stone = spaces * 0.05
    const materials =
      recordUse(w, marketStore(id), 'timber', timber) + recordUse(w, marketStore(id), 'stone', stone)
    r.stocks.timber = Math.max(0, r.stocks.timber - timber)
    r.stocks.stone = Math.max(0, r.stocks.stone - stone)
    r.consumption.timber += timber
    r.consumption.stone += stone
    recordOwnCapital(w, id, producerAccount(id), wages + materials)
    a.construction.push({ site: site.id, capacity: spaces, cost: wages + materials, remaining: 3 })
  }
  // Built cover is a physical capacity projection; legacy opening cover is preserved as a lower constraint.
  const cover = new Map<number, { opening: number; added: number }>()
  for (const sites of homes.values())
    for (const site of sites) {
      const c = cover.get(site.cell) ?? { opening: 0, added: 0 }
      c.opening = Math.max(c.opening, site.openingBuilt ?? 0)
      c.added += Math.max(0, site.capacity - site.openingCapacity)
      cover.set(site.cell, c)
    }
  for (const [cell, c] of cover)
    w.localEconomy.built[cell] = Math.min(
      1,
      c.opening + c.added / MODEL_PARAMETERS.fullBuiltPopulationPerCell,
    )
}
