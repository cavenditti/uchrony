import { economicRegions, economicRegion, provinceId, localFirmRegion } from '../sim/local-units'
import { STRATA, STRATUM_LABELS } from '../sim/economic-types'
import { censusOf } from '../sim/view-snapshot'
import type { EconomicStratum } from '../sim/economic-types'
const stratumPeople = (world: World, region: number, stratum: EconomicStratum) => {
  const place = economicRegion(world, region)
  return (place.strataCounts ?? censusOf(place, world.month).strata)[stratum] ?? 0
}
import type { World } from '../sim/types'
const money = (n: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n * 1000)
const percent = (n: number) => `${(n * 100).toFixed(1)}%`
export function EconomicAccounts({
  world,
  nation,
  region,
}: {
  world: World
  nation: number
  region?: number
}) {
  const e = world.economy
  if (!e) return <p className="panel-note">Household accounts initialize when this legacy world advances.</p>
  if (world.viewOnly && world.viewNation !== undefined && world.viewNation !== nation)
    return (
      <p className="panel-note" role="status">
        Loading this state's economic accounts…
      </p>
    )
  const places = economicRegions(world).filter((r) =>
    region === undefined ? r.nation === nation : provinceId(r) === region,
  )
  return (
    <section className="economic-accounts" aria-label="Household economic strata">
      <h4>Households &amp; livelihoods</h4>
      <p className="panel-note">
        Civilian accounts are pooled by economic role within each local district. Culture, language and
        beliefs remain independent.
      </p>
      {STRATA.map((s) => {
        const people = places.reduce((sum, r) => sum + stratumPeople(world, r.id, s), 0)
        const sum = (key: 'cash' | 'income' | 'taxes' | 'transfers' | 'laborForce' | 'employed') =>
          places.reduce((total, r) => total + e.households[r.id][s][key], 0)
        const labor = sum('laborForce'),
          jobs = sum('employed')
        const food =
          places.reduce(
            (total, r) => total + e.households[r.id][s].foodCoverage * stratumPeople(world, r.id, s),
            0,
          ) / Math.max(1, people)
        return (
          <details key={s}>
            <summary>
              {STRATUM_LABELS[s]} <span>{people.toLocaleString()} people</span>
            </summary>
            <dl className="stratum-accounts">
              <div>
                <dt>Cash per person</dt>
                <dd>{money(sum('cash') / Math.max(1, people))} crowns</dd>
              </div>
              <div>
                <dt>Monthly disposable income / person</dt>
                <dd>
                  {money((sum('income') + sum('transfers') - sum('taxes')) / Math.max(1, people))} crowns
                </dd>
              </div>
              <div>
                <dt>Employment / labor force</dt>
                <dd>{percent(labor ? jobs / labor : 0)}</dd>
              </div>
              <div>
                <dt>Food needs met</dt>
                <dd>{percent(food)}</dd>
              </div>
            </dl>
          </details>
        )
      })}
      <details>
        <summary>
          Competing enterprises{' '}
          <span>
            {e.firms?.filter((f) => f.active && places.some((r) => r.id === localFirmRegion(f))).length ?? 0}{' '}
            operating
          </span>
        </summary>
        <p className="panel-note">
          Firms compete for workers and wholesale orders. Each pays its own wages, materials and debt.
        </p>
        {region !== undefined &&
          e.firms
            ?.filter((f) => f.region === region && f.active)
            .map((f) => (
              <details key={f.id}>
                <summary>
                  Enterprise {f.id + 1} · generation {f.generation + 1}
                </summary>
                <dl className="stratum-accounts">
                  <div>
                    <dt>Workers employed</dt>
                    <dd>{Math.round(f.employment).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Monthly base wage</dt>
                    <dd>{money(f.wage)} crowns</dd>
                  </div>
                  <div>
                    <dt>Deposits</dt>
                    <dd>{money(f.cash)} crowns</dd>
                  </div>
                  <div>
                    <dt>Outstanding loans</dt>
                    <dd>
                      {money(
                        e.credit.loans
                          .filter((l) => l.borrower === `firm:${f.id}`)
                          .reduce((sum, l) => sum + l.principal, 0),
                      )}{' '}
                      crowns
                    </dd>
                  </div>
                  <div>
                    <dt>Cash operating surplus</dt>
                    <dd>{money(f.profit)} crowns</dd>
                  </div>
                  <div>
                    <dt>Price markup</dt>
                    <dd>{percent(f.markup)}</dd>
                  </div>
                </dl>
              </details>
            ))}
      </details>
    </section>
  )
}
export function MacroAccounts({ world, nation }: { world: World; nation: number }) {
  const e = world.economy,
    stats = e?.national[nation],
    gdp = e?.accounts?.nations[nation]
  if (!e || !stats)
    return <p className="panel-note">Monthly economic indicators appear after the first advance.</p>
  return (
    <div className="macro-accounts">
      {(
        [
          ['Real output, initial prices', `${money(stats.realOutput)} crowns`],
          ['Household consumption', `${money(stats.consumption)} crowns`],
          ['Private capital formation', `${money(stats.investment)} crowns`],
          ['Unemployment', percent(stats.unemployment)],
          ['Basket price level', `${stats.priceIndex.toFixed(2)}× initial prices`],
          ['Income inequality, grouped Gini', stats.inequality.toFixed(3)],
          ['Cash reconciliation error', `${e.ledger.discrepancy.toExponential(1)} k crowns`],
        ] as const
      ).map(([label, value]) => (
        <div className="data-row" key={label}>
          <span>{label}</span>
          <b>{value}</b>
        </div>
      ))}
      {gdp && (
        <details className="economic-accounts">
          <summary>How GDP reconciles</summary>
          {[
            ['Production GDP', gdp.productionGDP],
            ['Expenditure GDP', gdp.expenditureGDP],
            ['Income GDP', gdp.incomeGDP],
            ['Government consumption', gdp.government],
            ['Gross fixed investment', gdp.fixedInvestment],
            ['Inventory transactions', gdp.inventoryChange],
            ['Exports', gdp.exports],
            ['Imports', gdp.imports],
            ['Inventory holding gains · excluded', gdp.holdingGains],
          ].map(([label, value]) => (
            <div className="data-row" key={label}>
              <span>{label}</span>
              <b>{money(Number(value))} crowns</b>
            </div>
          ))}
          <p className="panel-note">
            Reconciliation error: {gdp.discrepancy.toExponential(1)} thousand crowns. Inventory revaluation is
            excluded from GDP.
          </p>
        </details>
      )}
      {e.banking && (
        <details className="economic-accounts">
          <summary>Shared currency &amp; banks</summary>
          <p className="panel-note">
            These banks serve the whole world. Lending creates deposits; repayments destroy them.
          </p>
          <div className="data-row">
            <span>Policy rate, annualized</span>
            <b>{percent(e.banking.centralBank.rate * 12)}</b>
          </div>
          {e.banking.banks.map((bank) => (
            <details key={bank.id}>
              <summary>Bank {bank.id + 1}</summary>
              <dl className="stratum-accounts">
                <div>
                  <dt>Customer deposits</dt>
                  <dd>{money(bank.deposits)} crowns</dd>
                </div>
                <div>
                  <dt>Equity</dt>
                  <dd>{money(bank.equity)} crowns</dd>
                </div>
                <div>
                  <dt>Settlement reserves</dt>
                  <dd>{money(bank.reserves)} crowns</dd>
                </div>
                <div>
                  <dt>Outstanding loan assets</dt>
                  <dd>
                    {money(
                      world.viewBankLoans?.[bank.id] ??
                        e.credit.loans
                          .filter((l) => l.bank === bank.id)
                          .reduce((sum, l) => sum + l.principal, 0),
                    )}{' '}
                    crowns
                  </dd>
                </div>
                <div>
                  <dt>Central-bank borrowing</dt>
                  <dd>{money(bank.centralBankDebt)} crowns</dd>
                </div>
                <div>
                  <dt>Resolutions to date</dt>
                  <dd>{bank.resolutions}</dd>
                </div>
              </dl>
            </details>
          ))}
        </details>
      )}
      <p className="panel-note">
        Production, spending and income are reconciled from separate records. See About &amp; mathematics for
        the equations, coverage and assumptions.
      </p>
    </div>
  )
}
