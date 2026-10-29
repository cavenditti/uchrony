/** Merchant offers recover the cost of the stock actually available for sale.
 * Procurement and retail share this rule so a marginal cheap lot, imported
 * freight, or a competing factory sale cannot reset an entire warehouse's price. */
import { loansForBorrower } from './banking'
import { householdNeed, reserveTarget } from './economy'
import { producerAccount } from './ledger'
import { MODEL_PARAMETERS as P } from './model-parameters'
import { marketStore } from './national-accounts'
import { periodInterest, periodRate } from './simulation-period'
import type { Good, Region, World } from './types'

/** Expected physical loss over the current accounting period. */
export const retailDecay = (good: Good) =>
  periodRate(good === 'food' ? 0.035 : good === 'timber' || good === 'textiles' ? 0.006 : 0.001)

/** Recover expected inventory loss and financing per sale, plus a trading margin. */
export function retailMarkup(w: World, r: Region, good: Good) {
  const merchant = w.economy!.producers[r.id]
  const sales = Math.max(1, householdNeed(r, good), merchant.forecast[good])
  const target = reserveTarget(r, good) + householdNeed(r, good)
  const loans = loansForBorrower(w, producerAccount(r.id))
  const principal = loans.reduce((sum, l) => sum + l.principal, 0)
  const rate =
    principal > 0
      ? loans.reduce((sum, l) => sum + l.principal * (l.rate ?? P.policyRateMonthly + P.bankLoanSpread), 0) /
        principal
      : (w.economy!.banking?.centralBank.rate ?? P.policyRateMonthly) + P.bankLoanSpread
  return 0.04 + (Math.max(0, target - sales) * retailDecay(good) + target * periodInterest(rate)) / sales
}

/** Quote the blended landed cost, not the latest lot or a competitor's receipt.
 * Costs are thousands of crowns per unit; selling quotes are crowns per unit.
 * The optional purchase cost supports callers without an open accounting period.
 * An empty warehouse retains its quote; goods still in transit are not offers. */
export function refreshRetailQuote(w: World, r: Region, good: Good, purchaseCost?: number) {
  const stock = w.economy?.accounts?.stores[marketStore(r.id)]
  if ((stock?.quantity[good] ?? r.stocks[good]) <= 1e-9) return
  const cost = stock?.price[good] ?? w.economy?.inventoryPrices?.[marketStore(r.id)]?.[good] ?? purchaseCost
  if (cost !== undefined) r.prices[good] = Math.max(0.01, cost * 1000 * (1 + retailMarkup(w, r, good)))
}
