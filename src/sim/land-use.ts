import { STRATA } from './economic-types'
import { producerAccount, householdAccount, transfer } from './ledger'
import { marketStore, recordUse, recordOwnCapital, recordWages } from './national-accounts'
import type { World } from './types'

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
  for (const id of w.localEconomy.active) {
    const r = w.localEconomy.units[id],
      p = w.economy.producers[id],
      hh = w.economy.households[id]
    const available = STRATA.reduce((sum, s) => sum + Math.max(0, hh[s].laborForce - hh[s].employed), 0)
    if (!available || p.wage <= 0) continue
    const targets = r.cells.map((cell) => a.sites[`home:${cell}`]).filter((s) => s && !pending.has(s.id))
    const site = targets.sort(
      (x, y) =>
        (r.residents[y.cell] ?? 0) / Math.max(1, y.capacity) -
        (r.residents[x.cell] ?? 0) / Math.max(1, x.capacity),
    )[0]
    if (!site) continue
    const need = Math.max(0, (r.residents[site.cell] ?? 0) * 1.15 - site.capacity)
    // One resident-place requires timber/stone and two worker-days; wages and materials use existing units.
    const spaces = Math.min(
      need,
      r.stocks.timber / 0.08,
      r.stocks.stone / 0.05,
      available * 10,
      p.cash / (p.wage * 0.1),
    )
    if (spaces <= 1e-6) continue
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
  for (const site of Object.values(a.sites))
    if (site.kind === 'residential')
      w.localEconomy.built[site.cell] = Math.min(
        1,
        (site.openingBuilt ?? w.localEconomy.built[site.cell] ?? 0) +
          Math.max(0, site.capacity - site.openingCapacity) / 12000,
      )
}
