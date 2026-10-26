import { useState } from 'react'
import { GOODS, population, type World } from '../sim/types'
import { STRATA } from '../sim/economic-types'
import { localFirmRegion } from '../sim/local-units'

const compact = (v: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
const crowns = (v: number) => `${compact(v * 1000)} crowns`

export function DistrictEconomies({ world, province }: { world: World; province: number }) {
  const [selection, setSelection] = useState<number | null>(null)
  const local = world.localEconomy,
    economy = world.economy
  if (!local || !economy)
    return (
      <p className="panel-note">
        Local markets and district populations initialize on the first monthly step.
      </p>
    )
  if (world.viewOnly && world.viewNation !== undefined && world.viewNation !== world.regions[province].nation)
    return (
      <p className="panel-note" role="status">
        Loading this district's economic accounts…
      </p>
    )
  const units = local.active
    .map((id) => local.units[id])
    .filter((u) => u.province === province)
    .sort((a, b) => population(b) - population(a) || a.id - b.id)
  const unit = units.find((u) => u.id === selection) ?? units[0]
  if (!unit) return null
  const firms = (economy.firms ?? []).filter((f) => localFirmRegion(f) === unit.id)
  const accounts = new Set([
    `producer:${unit.id}`,
    ...STRATA.map((s) => `household:${unit.id}:${s}`),
    ...firms.map((f) => `firm:${f.id}`),
  ])
  const debt = economy.credit.loans
    .filter((l) => accounts.has(l.borrower))
    .reduce((sum, l) => sum + l.principal, 0)
  const deposits =
    economy.producers[unit.id].cash +
    STRATA.reduce((sum, s) => sum + economy.households[unit.id][s].cash, 0) +
    firms.reduce((sum, f) => sum + f.cash, 0)
  const arriving =
    local.shipmentTotals?.[unit.id]?.arriving ??
    local.shipments.filter((s) => s.to === unit.id).reduce((sum, s) => sum + s.quantity, 0)
  const leaving =
    local.shipmentTotals?.[unit.id]?.leaving ??
    local.shipments.filter((s) => s.from === unit.id).reduce((sum, s) => sum + s.quantity, 0)
  const city = local.cities.find(
    (c) => c.absorbedBy === undefined && c.cells.some((id) => unit.cells.includes(id)),
  )
  return (
    <details className="district-economies">
      <summary>
        Local markets <span>{units.length} resident catchments</span>
      </summary>
      <label className="district-selector">
        Inspect a local market
        <select value={unit.id} onChange={(event) => setSelection(Number(event.target.value))}>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {compact(population(u))} people · {u.id === province ? 'depot' : u.activity}
            </option>
          ))}
        </select>
      </label>
      <p className="panel-note">
        {unit.activity[0].toUpperCase() + unit.activity.slice(1)} district across {unit.cells.length} terrain{' '}
        {unit.cells.length === 1 ? 'cell' : 'cells'}.{' '}
        {unit.id === province ? 'Contains the established regional depot.' : ''}
        {world.adaptive
          ? ' Economic accounts continue across changes to municipal and provincial borders.'
          : ''}
      </p>
      <dl className="stratum-accounts">
        <div>
          <dt>Residents</dt>
          <dd>{population(unit).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Children / adults / elders</dt>
          <dd>
            {compact(unit.population.children)} / {compact(unit.population.adults)} /{' '}
            {compact(unit.population.elders)}
          </dd>
        </div>
        <div>
          <dt>Firms operating</dt>
          <dd>{firms.filter((f) => f.active).length}</dd>
        </div>
        <div>
          <dt>Food needs met</dt>
          <dd>{(unit.foodCoverage * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Deposits</dt>
          <dd>{crowns(deposits)}</dd>
        </div>
        <div>
          <dt>Outstanding loans</dt>
          <dd>{crowns(debt)}</dd>
        </div>
        <div>
          <dt>Goods arriving / leaving this month</dt>
          <dd>
            {compact(arriving)} / {compact(leaving)} t
          </dd>
        </div>
      </dl>
      <table className="district-goods">
        <caption>Local market and firm inventories</caption>
        <thead>
          <tr>
            <th>Good</th>
            <th scope="col">Stock (t)</th>
            <th scope="col">
              Market quote
              <br />
              crowns / t
            </th>
          </tr>
        </thead>
        <tbody>
          {GOODS.map((g) => (
            <tr key={g}>
              <th scope="row">{g[0].toUpperCase() + g.slice(1)}</th>
              <td>{compact(unit.stocks[g] + firms.reduce((sum, f) => sum + f.stocks[g], 0))}</td>
              <td>{unit.prices[g].toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>Natural resources remaining</summary>
        <dl className="stratum-accounts">
          {(['timber', 'stone', 'iron', 'coal'] as const).map((g) => (
            <div key={g}>
              <dt>{g[0].toUpperCase() + g.slice(1)}</dt>
              <dd>{compact(unit.cells.reduce((sum, c) => sum + (local.reserves[c]?.[g] ?? 0), 0))} t</dd>
            </div>
          ))}
        </dl>
        <p className="panel-note">
          These are unextracted resources. Timber regrows; mineral deposits are finite.
        </p>
      </details>
      {city && (
        <p className="panel-note">
          Part of {city.name}, with {compact(city.population)} residents across {city.cells.length} terrain
          cells.{city.aliases.length ? ` Earlier names: ${city.aliases.join(', ')}.` : ''}
        </p>
      )}
    </details>
  )
}
