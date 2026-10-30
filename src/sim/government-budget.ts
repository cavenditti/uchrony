/** Cash budgeting for native development programs. Taxes fund ordinary services;
 * temporary stimulus tapers before credit is exhausted, not after an unreachable
 * debt threshold. Debt principal is a cash requirement, not GDP expenditure. */
import { scheduledLoanPayments } from './banking'
import { MODEL_PARAMETERS as P } from './model-parameters'
import { periodRate, simulationMonths } from './simulation-period'
import { clamp, type World } from './types'

/** One loan-book pass for all states; never scan the whole book per province. */
export function governmentDebtPayments(w: World) {
  const payments = new Map<number, number>()
  for (const loan of w.economy?.credit.loans ?? []) {
    if (!loan.borrower.startsWith('government:')) continue
    const nation = Number(loan.borrower.slice(11)),
      due = scheduledLoanPayments(w, loan)
    payments.set(nation, (payments.get(nation) ?? 0) + due.interest + due.principal)
  }
  for (const [id, claims] of Object.entries(w.economy?.supplierCredit ?? {}))
    payments.set(
      +id,
      (payments.get(+id) ?? 0) +
        Object.values(claims).reduce((sum, amount) => sum + amount, 0) * periodRate(1 / 60),
    )
  return payments
}

/** Credit is bounded by both revenue and the service cost of a new loan. */
export function developmentCreditLimit(w: World, revenue: number) {
  const rate = (w.economy?.banking?.centralBank.rate ?? P.policyRateMonthly) + P.bankLoanSpread + 1 / 240
  return Math.min(revenue * 36, (revenue * 0.2) / Math.max(0.001, rate))
}

/** Period spending ceiling after debt cash requirements; surplus reserves may
 * support investment, but a high debt load cannot authorize permanent stimulus. */
export function developmentBudget(
  revenue: number,
  cash: number,
  debt: number,
  limit: number,
  payments: number,
  unemployment: number,
) {
  const months = simulationMonths()
  // Half of the credit envelope is the stimulus zone. Beyond it, receipts must
  // cover services and amortization while rebuilding a modest operating buffer.
  const headroom = limit > 0 ? clamp(1 - (2 * debt) / limit) : 0
  const stimulus = (0.15 + clamp((unemployment - 0.06) / 0.2) * 0.5) * headroom
  const reserveDraw = Math.max(0, cash - revenue * 6) * periodRate(0.01)
  return Math.max(0, revenue * months * (0.9 + stimulus) - payments + reserveDraw)
}
