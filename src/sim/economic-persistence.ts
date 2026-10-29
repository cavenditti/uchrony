import { auditBanks } from './banking'
import { configurationFor } from './configuration'
import { STRATA } from './economic-types'
import { balances } from './ledger'
import { economicRegion } from './local-units'
import { auditNationalAccounts, emptyGDP } from './national-accounts'
import { numberValidator, recordValue, validationFailure } from './persistence-primitives'
import { supplierDebt } from './supplier-credit'
import { GOODS, type World } from './types'
export function validateEconomy(w: World) {
  const bankAccount = (account: unknown) => {
    if (typeof account !== 'string' || !/^bank:(0|[1-9]\d*)$/.test(account)) return false
    return Number(account.slice(5)) < configurationFor(w).model.bankCount
  }
  const e = w.economy
  if (!e) return
  const fail = validationFailure('Invalid economic save: ', '', '')
  const num = numberValidator(0, 1e16)
  const obj = recordValue
  if (
    !obj(e) ||
    e.version !== 1 ||
    !num(e.initialized) ||
    e.initialized > w.month ||
    !obj(e.households) ||
    !obj(e.producers) ||
    !obj(e.credit) ||
    !obj(e.ledger) ||
    !obj(e.national) ||
    !obj(e.totals)
  )
    fail('missing account system')
  if (
    e.periodMonths !== undefined &&
    (!Number.isInteger(e.periodMonths) || e.periodMonths < 1 || e.periodMonths > 6)
  )
    fail('accounting interval')
  for (const r of w.localEconomy ? Object.values(w.localEconomy.units) : w.regions) {
    const f = e.producers[r.id],
      hs = e.households[r.id]
    if (!obj(f) || !obj(hs)) fail('missing regional accounts')
    for (const key of [
      'cash',
      'wage',
      'payroll',
      'sales',
      'purchases',
      'freight',
      'taxes',
      'interest',
      'capital',
      'investment',
      'grossOutput',
      'desiredEmployment',
      'publicServices',
      'realServices',
    ] as const)
      if (!num(f[key])) fail(`producer ${key}`)
    for (const key of [
      'previousLabor',
      'previousJobs',
      'previousResearchServices',
      'educationServices',
      'administrationServices',
      'infrastructureServices',
      'researchServices',
      'militaryServices',
      'provincialServices',
    ] as const)
      if (f[key] !== undefined && !num(f[key])) fail(`producer ${key}`)
    for (const key of ['profit', 'valueAdded', 'realOutput'] as const)
      if (!num(f[key], -1e16)) fail(`producer ${key}`)
    for (const key of [
      'forecast',
      'planned',
      'sold',
      'inputTargets',
      'openingStocks',
      'losses',
      'intermediate',
    ] as const)
      if (!obj(f[key]) || GOODS.some((g) => !num(f[key][g]))) fail('producer goods account')
    if (
      !Array.isArray(f.projects) ||
      f.projects.length > 4096 ||
      f.projects.some(
        (p) =>
          !obj(p) ||
          !Number.isInteger(p.remaining) ||
          p.remaining < 1 ||
          p.remaining > 120 ||
          !num(p.capital) ||
          !num(p.cost),
      )
    )
      fail('capital projects')
    for (const s of STRATA) {
      const h = hs[s]
      if (!obj(h)) fail('household stratum')
      for (const key of [
        'cash',
        'income',
        'taxes',
        'transfers',
        'expenditure',
        'employed',
        'laborForce',
        'foodCoverage',
        'materialCoverage',
      ] as const)
        if (!num(h[key])) fail(`household ${key}`)
      if (h.foodCoverage > 1 || h.materialCoverage > 1 || h.employed > h.laborForce + 1e-7)
        fail('household coverage or labor')
      if (!obj(h.consumption) || GOODS.some((g) => !num(h.consumption[g]))) fail('household consumption')
    }
  }
  if (e.firms !== undefined) {
    if (
      !Array.isArray(e.firms) ||
      (w.localEconomy ? e.firms.length > w.localEconomy.nextId * 32 : e.firms.length !== w.regions.length * 4)
    )
      fail('firm registry')
    for (const [id, f] of e.firms.entries()) {
      if (
        !obj(f) ||
        f.id !== id ||
        (w.localEconomy
          ? !w.regions[f.region] ||
            !w.localEconomy.units[f.locality!] ||
            !w.localEconomy.units[f.locality!].cells.includes(f.cell!)
          : f.region !== Math.floor(id / 4)) ||
        typeof f.active !== 'boolean' ||
        !Number.isInteger(f.generation) ||
        f.generation < 0
      )
        fail('firm identity')
      if (f.activity !== undefined && !['food', 'tools', 'textiles'].includes(f.activity))
        fail('firm activity')
      if (
        f.owners !== undefined &&
        (!obj(f.owners) ||
          Object.entries(f.owners).some(
            ([a, v]) =>
              !num(v) ||
              !(
                (/^government:\d+$/.test(a) && w.nations[+a.split(':')[1]]) ||
                (/^household:\d+:(smallholder|laborer|artisan|professional|owner)$/.test(a) &&
                  e.households[+a.split(':')[1]])
              ),
          ))
      )
        fail('firm ownership')
      for (const key of [
        'cash',
        'capital',
        'productivity',
        'wage',
        'markup',
        'employment',
        'desiredEmployment',
        'payroll',
        'sales',
        'purchases',
        'interest',
        'taxes',
        'distress',
      ] as const)
        if (!num(f[key])) fail(`firm ${key}`)
      if (!num(f.profit, -1e16)) fail('firm profit')
      if (f.labor !== undefined) {
        if (
          !obj(f.labor) ||
          ['opening', 'retained', 'hires', 'separations', 'vacancies', 'unfilled'].some(
            (key) => !num(f.labor![key as keyof NonNullable<typeof f.labor>]),
          )
        )
          fail('firm labor flows')
        const flow = f.labor
        const tolerance = 1e-7 * Math.max(1, flow.opening, f.employment)
        if (
          Math.abs(flow.opening - flow.retained - flow.separations) > tolerance ||
          Math.abs(flow.vacancies - flow.hires - flow.unfilled) > tolerance ||
          (f.active && Math.abs(f.employment - flow.retained - flow.hires) > tolerance)
        )
          fail('firm employment identity')
      }
      if (
        f.laborMix !== undefined &&
        (!obj(f.laborMix) ||
          GOODS.some((g) => !num(f.laborMix![g]) || f.laborMix![g] > 1) ||
          Math.abs(GOODS.reduce((sum, g) => sum + f.laborMix![g], 0) - 1) > 1e-7)
      )
        fail('firm labor allocation')
      for (const key of ['stocks', 'prices', 'production', 'planned', 'forecast', 'sold'] as const)
        if (!obj(f[key]) || GOODS.some((g) => !num(f[key][g]))) fail('firm inventory')
      if (
        !Array.isArray(f.projects) ||
        f.projects.length > 4096 ||
        f.projects.some(
          (p) =>
            !obj(p) ||
            !Number.isInteger(p.remaining) ||
            p.remaining < 1 ||
            p.remaining > 120 ||
            !num(p.capital) ||
            !num(p.cost),
        )
      )
        fail('firm projects')
    }
  }
  const accounts = balances(w),
    keys = new Set(Object.keys(accounts)),
    ids = new Set<number>()
  if (
    !num(e.credit.cash) ||
    !num(e.credit.losses) ||
    !Number.isInteger(e.credit.nextId) ||
    e.credit.nextId < 1 ||
    !Array.isArray(e.credit.loans) ||
    e.credit.loans.length > Math.max(10000, (w.localEconomy?.nextId ?? 0) * 40)
  )
    fail('credit intermediary')
  for (const l of e.credit.loans) {
    if (
      !obj(l) ||
      !Number.isInteger(l.id) ||
      l.id < 1 ||
      l.id >= e.credit.nextId ||
      ids.has(l.id) ||
      !keys.has(l.borrower) ||
      !num(l.principal) ||
      (l.contract !== undefined &&
        (!Number.isSafeInteger(l.contract) || l.contract < 1 || l.contract >= e.credit.nextId)) ||
      !Number.isInteger(l.arrears) ||
      l.arrears < 0 ||
      l.arrears > 120 ||
      !num(l.originated) ||
      l.originated > w.month
    )
      fail('loan claim')
    if (e.banking && (!Number.isInteger(l.bank) || !e.banking.banks[l.bank!] || !num(l.rate)))
      fail('bank loan terms')
    if (l.rateType !== undefined && l.rateType !== 'fixed' && l.rateType !== 'floating')
      fail('loan rate type')
    if (
      l.rateType === 'floating' &&
      (!num(l.spread) ||
        !Number.isInteger(l.resetMonths) ||
        l.resetMonths! < 1 ||
        l.resetMonths! > 120 ||
        !Number.isSafeInteger(l.nextReset) ||
        l.nextReset! < l.originated ||
        l.nextReset! > w.month + l.resetMonths!)
    )
      fail('floating loan reset')
    ids.add(l.id)
  }
  if (e.supplierCredit !== undefined) {
    if (!obj(e.supplierCredit)) fail('supplier claims')
    for (const [id, claims] of Object.entries(e.supplierCredit)) {
      if (
        !/^\d+$/.test(id) ||
        !w.nations[+id] ||
        !obj(claims) ||
        Object.entries(claims).some(([a, v]) => !keys.has(a) || !a.startsWith('producer:') || !num(v))
      )
        fail('supplier claims')
    }
  }
  for (const n of w.nations) {
    const debt = e.credit.loans
      .filter((l) => l.borrower === `government:${n.id}`)
      .reduce((sum, l) => sum + l.principal, supplierDebt(w, n.id))
    if (Math.abs(debt - n.debt) > Math.max(1, debt) * 1e-8) fail('sovereign liability has no matching asset')
  }
  const l = e.ledger
  if (
    !Number.isInteger(l.month) ||
    l.month < 0 ||
    l.month > w.month ||
    !obj(l.opening) ||
    !obj(l.net) ||
    !Array.isArray(l.entries) ||
    l.entries.length > 1024 ||
    !num(l.transactions) ||
    !num(l.volume) ||
    !num(l.discrepancy)
  )
    fail('ledger structure')
  for (const [key, value] of Object.entries(l.opening))
    if (!keys.has(key) || !num(value)) fail('opening account')
  for (const [key, value] of Object.entries(l.net))
    if (!keys.has(key) || !num(value, -1e16)) fail('account flow')
  for (const item of l.entries)
    if (
      !obj(item) ||
      !(keys.has(item.from) || bankAccount(item.from)) ||
      !(keys.has(item.to) || bankAccount(item.to)) ||
      !num(item.amount) ||
      typeof item.category !== 'string' ||
      item.category.length > 160
    )
      fail('journal entry')
  // Commands may occur between months; their journal must still reconcile.
  let discrepancy = 0
  for (const key of keys)
    discrepancy = Math.max(discrepancy, Math.abs(accounts[key] - (l.opening[key] ?? 0) - (l.net[key] ?? 0)))
  const scale = Object.values(l.opening).reduce((largest, value) => Math.max(largest, value), 1)
  if (discrepancy > 1e-8 * scale) fail('unrecorded cash change')
  if (
    Math.abs(Object.values(l.net).reduce((s, v) => s + v, 0) - (l.created ?? 0) + (l.destroyed ?? 0)) >
    1e-8 * scale
  )
    fail('unmatched deposit creation')
  if (e.banking) {
    const b = e.banking
    if (
      !obj(b) ||
      b.version !== 1 ||
      !Array.isArray(b.banks) ||
      b.banks.length !== configurationFor(w).model.bankCount ||
      !obj(b.accounts) ||
      !obj(b.centralBank) ||
      !num(b.created) ||
      !num(b.destroyed) ||
      !num(b.lastPriceIndex)
    )
      fail('banking system')
    for (const [id, bank] of b.banks.entries()) {
      if (!obj(bank) || bank.id !== id || !obj(bank.owners)) fail('bank identity')
      for (const key of ['reserves', 'deposits', 'centralBankDebt', 'losses', 'resolutions'] as const)
        if (!num(bank[key], -1e-7)) fail(`bank ${key}`)
      if (!num(bank.equity, -1e16) || !num(bank.income, -1e16)) fail('bank income or equity')
      for (const [owner, shares] of Object.entries(bank.owners))
        if (!keys.has(owner) || !num(shares)) fail('bank ownership')
    }
    for (const [account, id] of Object.entries(b.accounts))
      if (!keys.has(account) || !Number.isInteger(id) || !b.banks[id]) fail('deposit account bank')
    for (const key of ['advances', 'reserves', 'rate'] as const)
      if (!num(b.centralBank[key], -1e-7)) fail('central bank')
    if (!num(b.centralBank.equity, -1e16)) fail('central bank equity')
    if (b.policy !== undefined) {
      const p = b.policy
      if (
        !obj(p) ||
        p.regime !== 'inflation-target' ||
        !Array.isArray(p.logChanges) ||
        p.logChanges.length > 12 ||
        p.logChanges.some((x) => !num(x, -1e16)) ||
        !Number.isSafeInteger(p.lastMonth) ||
        p.lastMonth < 0 ||
        p.lastMonth > w.month ||
        !num(p.target, -1) ||
        !num(p.neutralRealRate, -1) ||
        !num(p.inflation, -1e16) ||
        !num(p.expectedInflation, -1e16) ||
        !num(p.referenceUnemployment) ||
        p.referenceUnemployment > 1 ||
        !num(p.inflationResponse) ||
        !num(p.unemploymentResponse) ||
        !num(p.inertia) ||
        p.inertia >= 1 ||
        !num(p.expectationAdjustment) ||
        p.expectationAdjustment > 1
      )
        fail('monetary policy')
    }
    auditBanks(w, false)
  }
  if (e.accounts) {
    const a = e.accounts
    if (
      !obj(a) ||
      !Number.isInteger(a.month) ||
      a.month < 0 ||
      a.month > w.month ||
      (a.complete !== undefined && typeof a.complete !== 'boolean') ||
      !Array.isArray(a.territories) ||
      a.territories.length !== (w.localEconomy?.nextId ?? w.regions.length) ||
      a.territories.some((n) => !Number.isInteger(n) || (n !== -1 && !w.nations[n])) ||
      !obj(a.nations) ||
      !obj(a.world) ||
      !obj(a.stores) ||
      !obj(a.businesses) ||
      !obj(a.regionalValueAdded)
    )
      fail('GDP ledger')
    for (const n of [a.world, ...Object.values(a.nations)]) {
      if (!obj(n) || (Object.keys(emptyGDP()) as (keyof typeof n)[]).some((key) => !num(n[key], -1e16)))
        fail('GDP amount')
      if (
        a.complete &&
        Math.max(
          Math.abs(n.output - n.intermediate + n.productTaxes - n.productionGDP),
          Math.abs(
            n.consumption +
              n.government +
              n.fixedInvestment +
              n.inventoryChange +
              n.exports -
              n.imports -
              n.productionGDP,
          ),
          Math.abs(n.wages + n.operatingSurplus + n.mixedIncome + n.productTaxes - n.productionGDP),
          Math.abs(n.productionGDP - n.expenditureGDP),
          Math.abs(n.productionGDP - n.incomeGDP),
        ) >
          Math.max(1, Math.abs(n.output)) * 1e-7
      )
        fail('GDP reconciliation')
    }
    for (const s of Object.values(a.stores)) {
      if (
        !obj(s) ||
        (s.nation !== -1 && !w.nations[s.nation]) ||
        !economicRegion(w, s.region) ||
        typeof s.government !== 'boolean'
      )
        fail('GDP inventory owner')
      for (const key of ['opening', 'quantity', 'price'] as const)
        if (!obj(s[key]) || GOODS.some((g) => !num(s[key][g]))) fail('GDP inventory')
      for (const key of ['openingValue', 'flows', 'other'] as const)
        if (!num(s[key], -1e16)) fail('GDP inventory value')
    }
    for (const [owner, b] of Object.entries(a.businesses))
      if (
        !keys.has(owner) ||
        !obj(b) ||
        !Number.isInteger(b.nation) ||
        (b.nation !== -1 && !w.nations[b.nation]) ||
        (['receipts', 'purchases', 'wages', 'ownAccount', 'inventoryChange'] as const).some(
          (key) => !num(b[key], -1e16),
        )
      )
        fail('GDP business records')
    for (const [region, value] of Object.entries(a.regionalValueAdded))
      if (!economicRegion(w, Number(region)) || !num(value, -1e16)) fail('regional GDP')
    if (a.complete) auditNationalAccounts(w)
  }
  for (const value of Object.values(e.totals)) if (!num(value, -1e16)) fail('macroeconomic totals')
  if (e.goods)
    for (const key of ['opening', 'injections', 'destruction', 'residual'] as const)
      if (!obj(e.goods[key]) || GOODS.some((g) => !num(e.goods![key][g], key === 'residual' ? -1e16 : 0)))
        fail('physical goods ledger')
  for (const [id, stats] of Object.entries(e.national))
    if (
      (Number(id) !== -1 && !w.nations[Number(id)]) ||
      !obj(stats) ||
      Object.values(stats).some((v) => !num(v, -1e16))
    )
      fail('national accounts')
}
