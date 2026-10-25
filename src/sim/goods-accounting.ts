import { economicRegions } from './local-units'
import { GOODS, inventory, type World, type Inventory } from './types'

/** Includes mobile stores: loading a convoy is a transfer, not final consumption. */
export function physicalStocks(w: World): Inventory {
  const totals = inventory()
  for (const r of economicRegions(w)) for (const g of GOODS) totals[g] += r.stocks[g]
  for (const f of w.economy?.firms ?? []) for (const g of GOODS) totals[g] += f.stocks[g]
  for (const a of w.armies) {
    totals.food += a.operations?.food ?? 0
    totals.arms += a.operations?.arms ?? 0
  }
  for (const f of w.warfare?.fleets ?? []) {
    totals.food += f.food
    totals.arms += f.arms
  }
  return totals
}
export function beginGoodsMonth(w: World) {
  if (!w.economy) return
  w.economy.goods = {
    opening: physicalStocks(w),
    injections: inventory(),
    destruction: inventory(),
    residual: inventory(),
  }
  for (const r of economicRegions(w)) {
    r.production = inventory()
    r.consumption = inventory()
  }
}
export function auditGoods(w: World) {
  const e = w.economy,
    ledger = e?.goods
  if (!e || !ledger) return inventory()
  const closing = physicalStocks(w)
  for (const g of GOODS) {
    const made = economicRegions(w).reduce((sum, r) => sum + r.production[g], 0)
    const used = economicRegions(w).reduce((sum, r) => sum + r.consumption[g] + e.producers[r.id].losses[g], 0)
    ledger.residual[g] =
      closing[g] - ledger.opening[g] - made - ledger.injections[g] + used + ledger.destruction[g]
    if (Math.abs(ledger.residual[g]) > 1e-7 * Math.max(1, ledger.opening[g] + made))
      throw new Error(`Unreconciled ${g}: ${ledger.residual[g]} tonnes`)
  }
  return ledger.residual
}
