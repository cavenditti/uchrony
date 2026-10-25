import { beginLedgerMonth, balances } from '../../src/sim/ledger'
import type { World } from '../../src/sim/types'

/** Scenario setup, not a simulated receipt. Establish the new opening cash endowment explicitly. */
export function endowTreasury(w: World, nation: number, amount: number) {
  w.nations[nation].treasury = amount
  rebaseEndowments(w)
}

/** Test-only opening balance sheet after an explicit scenario endowment change. */
export function rebaseEndowments(w: World) {
  const b = w.economy?.banking
  if (b) {
    for (const bank of b.banks) {
      bank.deposits = Object.entries(balances(w)).reduce(
        (sum, [account, value]) => sum + (b.accounts[account] === bank.id ? value : 0),
        0,
      )
      const loans = w
        .economy!.credit.loans.filter((l) => l.bank === bank.id)
        .reduce((s, l) => s + l.principal, 0)
      bank.reserves = bank.deposits + bank.centralBankDebt + bank.equity - loans
    }
    b.centralBank.reserves = b.banks.reduce((s, bank) => s + bank.reserves, 0)
    b.centralBank.advances = b.banks.reduce((s, bank) => s + bank.centralBankDebt, 0)
    b.centralBank.equity = b.centralBank.advances - b.centralBank.reserves
  }
  beginLedgerMonth(w)
}
