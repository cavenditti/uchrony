import { simulationMonths } from './simulation-period'
import { ensureUrbanFabric } from './urban-fabric'
import { advanceUrbanConstruction } from './urban-construction'
import { habitableLand } from './terrain-access'
import { STRATA } from './economic-types'
import { producerAccount, householdAccount, transfer } from './ledger'
import { marketStore, recordUse, recordOwnCapital, recordWages } from './national-accounts'
import type { World } from './types'
import { residentialDemand, settlementAccess } from './settlement-access'
import { residentialPools, createResidentialParcel } from './residential-sites'
import { planHousingInvestment } from './housing-investment'
import { MODEL_PARAMETERS } from './model-parameters'
import { coarseHousingDemand } from './housing-demand'

/** Housing-space development has physical inputs and paid labor. No imputed rent removes cash. */
export function advanceLandUse(
  w: World,
  prepared?: ReturnType<typeof settlementAccess>,
  coarse = false,
  aggregateDemand = coarse,
) {
  const a = w.adaptive
  if (!a || !w.economy || !w.localEconomy) return
  ensureUrbanFabric(w)
  advanceUrbanConstruction(w)
  a.construction ??= []
  for (const project of a.construction) {
    project.remaining -= simulationMonths()
    if (project.remaining <= 0) {
      const site = a.sites[project.site]
      site.capacity += project.capacity
      site.investedValue = (site.investedValue ?? 0) + project.cost
    }
  }
  a.construction = a.construction.filter((p) => p.remaining > 0)
  const pending = new Set(a.construction.map((p) => p.site))
  const access = prepared ?? settlementAccess(w)
  const homes = residentialPools(w),
    demand = aggregateDemand ? coarseHousingDemand(w, access) : residentialDemand(w, access)
  for (const id of w.localEconomy.active) {
    const r = w.localEconomy.units[id],
      p = w.economy.producers[id],
      hh = w.economy.households[id]
    const targets = (homes.get(id) ?? [])
      .filter((s) => !pending.has(s.id) && habitableLand(w.cells[s.cell]))
      .sort((x, y) => (demand.get(y.id) ?? 0) - (demand.get(x.id) ?? 0) || x.id.localeCompare(y.id))
    for (const target of targets) {
      if (pending.has(target.id)) continue
      const available = STRATA.reduce((sum, s) => sum + Math.max(0, hh[s].laborForce - hh[s].employed), 0)
      if (!available || p.wage <= 0) break
      let site = target
      const need = demand.get(site.id) ?? 0
      if (need <= 1e-6) continue
      const investment = planHousingInvestment(
        w,
        site,
        need,
        homes.get(id) ?? [],
        available * simulationMonths(),
        access,
        pending,
        256,
        !coarse,
      )
      if (!investment) continue
      site = investment.site
      const { plot, spaces, inputs } = investment
      if (plot) {
        const host = 'pool' in plot && typeof plot.pool === 'number' ? plot.pool : id
        site = createResidentialParcel(w, host, plot.cell, plot.point, plot.parcel)
        site.capitalOwner = producerAccount(id)
        if (plot.building) site.building = plot.building
        if (plot.lanes?.length) (a.lanes ??= []).push(...plot.lanes)
        const hostHomes = homes.get(site.pool) ?? []
        hostHomes.push(site)
        homes.set(site.pool, hostHomes)
      }
      const labor = inputs.labor / simulationMonths()
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
      const { timber, stone } = inputs
      const materials =
        recordUse(w, marketStore(id), 'timber', timber) + recordUse(w, marketStore(id), 'stone', stone)
      r.stocks.timber = Math.max(0, r.stocks.timber - timber)
      r.stocks.stone = Math.max(0, r.stocks.stone - stone)
      r.consumption.timber += timber
      r.consumption.stone += stone
      recordOwnCapital(w, id, producerAccount(id), wages + materials)
      a.construction.push({
        site: site.id,
        capacity: spaces,
        cost: wages + materials,
        remaining: 3,
        sponsor: producerAccount(id),
        host: site.pool,
      })
      pending.add(site.id)
    }
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
