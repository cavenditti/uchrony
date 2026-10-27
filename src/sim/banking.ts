import { recordWorldEvent } from './event-memory'
import { balance, balances, changeDeposit, ensureEconomy, governmentAccount } from './ledger'
import { clamp, type World } from './types'
import type { Bank, EconomicStratum, Loan } from './economic-types'
import { MODEL_PARAMETERS as P } from './model-parameters'
import { newMonetaryPolicy, observePrices, policyRate } from './monetary-policy'

const accountHash = (key: string) => {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0
  return h
}
export function ensureBanking(w: World) {
  const e = w.economy!
  if (e.banking) return e.banking
  const capital = e.credit.cash
  e.credit.cash = 0
  const banks: Bank[] = Array.from({ length: P.bankCount }, (_, id) => ({
    id,
    reserves: capital / P.bankCount,
    deposits: 0,
    equity: capital / P.bankCount,
    centralBankDebt: 0,
    income: 0,
    losses: 0,
    resolutions: 0,
    owners: {},
  }))
  e.banking = {
    version: 1,
    banks,
    accounts: {},
    centralBank: { advances: 0, reserves: capital, equity: -capital, rate: P.policyRateMonthly },
    lastPriceIndex: 1,
    policy: newMonetaryPolicy(w.month),
    created: 0,
    destroyed: 0,
    discrepancy: 0,
  }
  for (const [account, amount] of Object.entries(balances(w))) {
    if (account === 'credit') continue
    const bank = banks[accountHash(account) % banks.length]
    e.banking.accounts[account] = bank.id
    bank.deposits += amount
    bank.reserves += amount
    e.banking.centralBank.reserves += amount
    e.banking.centralBank.equity -= amount
    if (account.endsWith(':owner') && amount > 0) bank.owners[account] = amount
  }
  // Legacy loan claims are opening bank assets, with matching opening equity, not new deposits.
  for (const loan of e.credit.loans) {
    const bank = accountBank(w, loan.borrower)
    loan.bank = bank.id
    loan.rate = P.policyRateMonthly + P.bankLoanSpread
    bank.equity += loan.principal
  }
  // The former intermediary's own cash becomes reserve-backed opening bank equity.
  e.ledger.opening = balances(w)
  e.ledger.net = {}
  e.ledger.entries = []
  e.ledger.created = e.ledger.destroyed = 0
  return e.banking
}
export function accountBank(w: World, account: string): Bank {
  const b = ensureBanking(w)
  const id = b.accounts[account] ?? (b.accounts[account] = accountHash(account) % b.banks.length)
  return b.banks[id]
}
export function bankLoans(w: World, bank: number) {
  let total = 0
  for (const loan of w.economy!.credit.loans) if (loan.bank === bank) total += loan.principal
  return total
}
/** Central-bank advances supply settlement liquidity; they do not increase bank equity. */
function reserveFunding(w: World, bank: Bank, required: number) {
  if (bank.reserves + 1e-8 >= required) return
  const b = ensureBanking(w),
    shortage = required - bank.reserves
  const collateral = Math.max(0, bankLoans(w, bank.id) * 0.95 - bank.centralBankDebt)
  if (bank.equity <= 0 || shortage > collateral + 1e-6)
    throw new Error(`Bank ${bank.id} cannot settle an uncollateralized reserve outflow`)
  bank.reserves += shortage
  bank.centralBankDebt += shortage
  b.centralBank.advances += shortage
  b.centralBank.reserves += shortage
}
export function settleBankTransfer(w: World, from: string, to: string, amount: number) {
  const a = accountBank(w, from),
    b = accountBank(w, to)
  settleBankAccounts(w, a, b, amount)
}
/** Same settlement primitive for a phase that has already resolved its banks. */
export function settleBankAccounts(w: World, a: Bank, b: Bank, amount: number) {
  if (a === b) return
  reserveFunding(w, a, amount)
  a.reserves = Math.max(0, a.reserves - amount)
  b.reserves += amount
  a.deposits -= amount
  b.deposits += amount
}
export function issueBankLoan(w: World, borrower: string, requested: number, limit: number) {
  const e = ensureEconomy(w),
    b = ensureBanking(w),
    bank = accountBank(w, borrower)
  let existing: Loan | undefined,
    outstanding = 0,
    assets = 0
  // Repeated local orders need the same three aggregates, in the original summation order.
  for (const loan of e.credit.loans) {
    if (loan.bank === bank.id) assets += loan.principal
    if (loan.borrower === borrower) {
      outstanding += loan.principal
      if (!existing && loan.bank === bank.id) existing = loan
    }
  }
  const capacity = Math.max(0, bank.equity / P.bankCapitalRatio - assets)
  const amount = Math.max(0, Math.min(requested, limit - outstanding, capacity))
  if (!Number.isFinite(amount) || amount <= 1e-9) return 0
  const rate = b.centralBank.rate + P.bankLoanSpread
  if (existing) {
    // A top-up is new lending at today's price; preserve the weighted cost of
    // outstanding fixed principal instead of granting an old rate indefinitely.
    existing.rate =
      ((existing.rate ?? rate) * existing.principal + rate * amount) / (existing.principal + amount)
    existing.principal += amount
  } else
    e.credit.loans.push({
      id: e.credit.nextId++,
      borrower,
      principal: amount,
      arrears: 0,
      originated: w.month,
      bank: bank.id,
      rate,
      rateType: 'floating',
      spread: P.bankLoanSpread,
      resetMonths: P.loanResetMonths,
      nextReset: w.month + P.loanResetMonths,
    })
  changeDeposit(w, borrower, amount, `bank:${bank.id}`, 'bank loan origination')
  bank.deposits += amount
  if (borrower.startsWith('government:')) w.nations[Number(borrower.split(':')[1])].debt += amount
  return amount
}
/** Principal extinguishes deposits and a loan asset. Interest extinguishes deposits and raises equity. */
export function payBank(
  w: World,
  account: string,
  lender: number,
  requested: number,
  category: string,
  interest = false,
) {
  const amount = Math.min(balance(w, account), Math.max(0, requested))
  if (!amount) return 0
  const payer = accountBank(w, account),
    bank = ensureBanking(w).banks[lender]
  if (payer !== bank) {
    reserveFunding(w, payer, amount)
    payer.reserves = Math.max(0, payer.reserves - amount)
    bank.reserves += amount
  }
  payer.deposits -= amount
  changeDeposit(w, account, -amount, `bank:${lender}`, category)
  if (interest) {
    bank.equity += amount
    bank.income += amount
  }
  return amount
}
export function bankDistribution(w: World, bank: Bank, account: string, requested: number, category: string) {
  const amount = Math.max(0, Math.min(requested, bank.equity))
  if (!amount) return 0
  const receiver = accountBank(w, account)
  if (bank !== receiver) {
    reserveFunding(w, bank, amount)
    bank.reserves = Math.max(0, bank.reserves - amount)
    receiver.reserves += amount
  }
  receiver.deposits += amount
  bank.equity -= amount
  changeDeposit(w, account, amount, `bank:${bank.id}`, category)
  if (account.startsWith('household:')) {
    const [, region, stratum] = account.split(':')
    w.economy!.households[Number(region)][stratum as EconomicStratum].income += amount
  }
  return amount
}
export function writeDownLoan(w: World, loan: Loan, amount: number) {
  const loss = Math.min(loan.principal, Math.max(0, amount)),
    bank = ensureBanking(w).banks[loan.bank!]
  loan.principal -= loss
  bank.equity -= loss
  bank.income -= loss
  bank.losses += loss
  w.economy!.credit.losses += loss
  if (bank.equity < 0) resolveBank(w, bank)
  return loss
}
/** Insolvent owners are wiped out; deposit creditors receive explicit equity in a recapitalized bank. */
export function resolveBank(w: World, bank: Bank) {
  if (bank.equity >= 0) return
  const b = ensureBanking(w),
    target = bankLoans(w, bank.id) * P.bankCapitalRatio
  const need = Math.min(bank.deposits, target - bank.equity)
  bank.owners = {}
  for (const [account, id] of Object.entries(b.accounts)) {
    if (id !== bank.id) continue
    const cash = balance(w, account)
    const converted = bank.deposits > 0 ? (cash * need) / bank.deposits : 0
    if (!converted) continue
    changeDeposit(w, account, -converted, `bank:${bank.id}`, 'bank resolution: deposits converted to equity')
    bank.owners[account] = converted
  }
  bank.deposits -= need
  bank.equity += need
  // If deposits are exhausted, the remaining creditor is the central bank.
  // Recognize its unrecoverable secured claim on both balance sheets; do not
  // leave a bank with negative equity or manufacture replacement deposits.
  if (bank.equity < 0) {
    const loss = Math.min(bank.centralBankDebt, -bank.equity)
    bank.centralBankDebt -= loss
    bank.equity += loss
    b.centralBank.advances -= loss
    b.centralBank.equity -= loss
  }
  bank.resolutions++
}
export function settleBanks(w: World) {
  const e = ensureEconomy(w),
    b = ensureBanking(w)
  for (const loan of e.credit.loans) {
    if (loan.rateType === 'floating' && w.month >= loan.nextReset!) {
      loan.rate = b.centralBank.rate + loan.spread!
      loan.nextReset = w.month + loan.resetMonths!
    }
    const due = loan.principal * (loan.rate ?? b.centralBank.rate + P.bankLoanSpread)
    const interest = payBank(w, loan.borrower, loan.bank!, due, 'bank loan interest', true)
    const principal = payBank(
      w,
      loan.borrower,
      loan.bank!,
      loan.principal * P.creditRepaymentMonthly,
      'bank loan principal',
    )
    loan.principal -= principal
    loan.arrears = interest + 1e-8 < due ? loan.arrears + 1 : 0
    if (loan.borrower.startsWith('firm:')) e.firms![Number(loan.borrower.split(':')[1])].interest += interest
    if (loan.borrower.startsWith('producer:'))
      e.producers[Number(loan.borrower.split(':')[1])].interest += interest
    if (loan.borrower.startsWith('government:'))
      w.nations[Number(loan.borrower.split(':')[1])].spending += interest
    if (loan.arrears >= P.defaultAfterMonths) {
      writeDownLoan(w, loan, loan.principal * (1 - P.defaultRecovery))
      loan.arrears = 0
      if (loan.borrower.startsWith('government:')) {
        const n = w.nations[Number(loan.borrower.split(':')[1])]
        n.legitimacy = clamp(n.legitimacy - 4, 0, 100)
        n.stability = clamp(n.stability - 3, 5, 99)
        recordWorldEvent(w, {
          id: w.nextEvent++,
          month: w.month,
          type: 'economy',
          nation: n.id,
          title: `${n.shortName} restructures its debt`,
          detail: 'Unpaid interest triggers a matched borrower liability and bank asset write-down.',
        })
      }
    }
  }
  e.credit.loans = e.credit.loans.filter((l) => l.principal > 1e-8)
  for (const n of w.nations)
    n.debt = e.credit.loans
      .filter((l) => l.borrower === governmentAccount(n.id))
      .reduce((sum, l) => sum + l.principal, 0)
  for (const bank of b.banks) {
    resolveBank(w, bank)
    const charge = Math.min(bank.reserves, bank.centralBankDebt * b.centralBank.rate)
    bank.reserves -= charge
    bank.equity -= charge
    bank.income -= charge
    b.centralBank.reserves -= charge
    b.centralBank.equity += charge
    const repayment = Math.min(bank.centralBankDebt, Math.max(0, bank.reserves - bank.deposits * 0.1))
    bank.reserves -= repayment
    bank.centralBankDebt -= repayment
    b.centralBank.reserves -= repayment
    b.centralBank.advances -= repayment
    resolveBank(w, bank)
    const distributable = Math.min(
      Math.max(0, bank.income) * 0.65,
      Math.max(0, bank.equity - bankLoans(w, bank.id) * (P.bankCapitalRatio + 0.025)),
    )
    const totalShares = Object.values(bank.owners).reduce((sum, value) => sum + value, 0)
    for (const [owner, shares] of Object.entries(bank.owners))
      if (totalShares)
        bankDistribution(w, bank, owner, (distributable * shares) / totalShares, 'bank equity dividend')
  }
}
/** Announce the next month's rate after this month's prices and employment are
 * measured. Legacy saves start with a fresh observation window, not fabricated history. */
export function updateMonetaryPolicy(w: World) {
  const e = ensureEconomy(w),
    b = ensureBanking(w)
  const policy = (b.policy ??= newMonetaryPolicy(w.month - 1))
  if (policy.lastMonth >= w.month) return
  if (e.totals.priceIndex > 0 && b.lastPriceIndex > 0)
    observePrices(policy, Math.log(e.totals.priceIndex / b.lastPriceIndex))
  b.centralBank.rate =
    policyRate(b.centralBank.rate * 12, policy.inflation, e.totals.unemployment, policy) / 12
  b.lastPriceIndex = e.totals.priceIndex
  policy.lastMonth = w.month
}
export function auditBanks(w: World, record = true) {
  ensureEconomy(w)
  const b = ensureBanking(w),
    deposits = b.banks.map(() => 0)
  for (const [account, amount] of Object.entries(balances(w)))
    if (account !== 'credit') deposits[b.accounts[account] ?? accountHash(account) % b.banks.length] += amount
  let error = 0
  for (const bank of b.banks) {
    error = Math.max(
      error,
      Math.abs(bank.deposits - deposits[bank.id]),
      Math.abs(bank.reserves + bankLoans(w, bank.id) - bank.deposits - bank.centralBankDebt - bank.equity),
    )
  }
  error = Math.max(
    error,
    Math.abs(b.centralBank.reserves - b.banks.reduce((s, bank) => s + bank.reserves, 0)),
    Math.abs(b.centralBank.advances - b.banks.reduce((s, bank) => s + bank.centralBankDebt, 0)),
    Math.abs(b.centralBank.advances - b.centralBank.reserves - b.centralBank.equity),
  )
  if (record) b.discrepancy = error
  if (error > 1e-8 * Math.max(1, b.centralBank.reserves))
    throw new Error(`Unreconciled bank balance sheet: ${error}`)
  return error
}
