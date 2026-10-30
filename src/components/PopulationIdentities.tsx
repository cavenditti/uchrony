import { evaluateIdentityPolicy } from '../sim/identity-politics'
import { censusOf, mergeCensuses, censusDistribution } from '../sim/view-snapshot'
import { EconomicAccounts } from './EconomicAccounts'
import { useState } from 'react'
import { allForces } from '../sim/forces'
import type { World } from '../sim/types'
import type { IdentityAxis } from '../sim/population-types'
import { communityKey, communitySize } from '../sim/population'
import { identityColor } from '../map/identity'

const count = (n: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const percent = (n: number) => `${Math.round(n * 100)}%`
const axes: { id: IdentityAxis; label: string }[] = [
  { id: 'culture', label: 'Cultural belonging' },
  { id: 'language', label: 'Mother tongue' },
  { id: 'belief', label: 'Belief and tradition' },
  { id: 'movement', label: 'Political outlook' },
]

export function PopulationIdentities({
  world,
  nation,
  region,
}: {
  world: World
  nation: number
  region?: number
}) {
  const [axis, setAxis] = useState<IdentityAxis>('culture')
  const provinces = world.regions.filter((r) =>
    region === undefined ? r.nation === nation : r.id === region,
  )
  const holders = [
    ...provinces,
    ...(region === undefined ? allForces(world).filter((a) => a.nation === nation) : []),
  ]
  const census = mergeCensuses(holders.map((holder) => censusOf(holder, world.month)))
  if (!world.demography || !census.groups)
    return <p className="panel-note">The community census will be available when the simulation advances.</p>
  const name = (id: number) => world.demography!.identities[id]?.name ?? 'Unrecorded'
  const total = census.total
  const weighted = (key: 'loyalty' | 'displacement' | 'grievance') =>
    census.weighted[key] / Math.max(1, total)
  const officialLanguage = world.nations[nation].identity?.language
  const fluent =
    (officialLanguage === undefined ? 0 : (census.fluent[officialLanguage] ?? 0)) / Math.max(1, total)
  const entries = censusDistribution(census, axis)
  const ageSex = census.ageSex
  const visible = entries.slice(0, 8)
  const other = entries.slice(8).reduce((sum, e) => sum + e.count, 0)
  const flows = provinces.reduce(
    (sum, r) => ({
      incoming: sum.incoming + (r.populationDynamics?.immigrants ?? 0),
      outgoing: sum.outgoing + (r.populationDynamics?.emigrants ?? 0),
      refugees: sum.refugees + (r.populationDynamics?.refugees ?? 0),
    }),
    { incoming: 0, outgoing: 0, refugees: 0 },
  )
  return (
    <section className="population-identities" aria-label="Population identities">
      <EconomicAccounts world={world} nation={nation} region={region} />
      {census.hasAges && (
        <details className="age-sex-census">
          <summary>Age and sex census</summary>
          <p className="panel-note">
            Five-year display bands, derived from exact birth months. The state census includes serving
            soldiers and naval crews.
          </p>
          <table className="goods-table">
            <thead>
              <tr>
                <th>Age</th>
                <th>Female</th>
                <th>Male</th>
              </tr>
            </thead>
            <tbody>
              {ageSex
                .filter((row) => row.female + row.male > 0)
                .map((row) => (
                  <tr key={row.age}>
                    <th>{row.age}</th>
                    <td>{row.female.toLocaleString()}</td>
                    <td>{row.male.toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}
      <h4>Communities &amp; identity</h4>
      <p className="panel-note">
        Cultural belonging, language, belief, and political outlook evolve separately. People can share a
        state without sharing an identity.
      </p>
      <label className="select-label">
        View the census by
        <select value={axis} onChange={(e) => setAxis(e.target.value as IdentityAxis)}>
          {axes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="identity-census">
        {visible.map((entry) => (
          <div className="identity-census-row" key={entry.id}>
            <span className="identity-swatch" style={{ background: identityColor(entry.id) }} />
            <span>{name(entry.id)}</span>
            <b>
              {count(entry.count)}
              <small>{percent(entry.count / Math.max(1, total))}</small>
            </b>
          </div>
        ))}
        {other > 0 && (
          <div className="data-row">
            <span>Other communities</span>
            <b>{count(other)}</b>
          </div>
        )}
      </div>
      <div className="data-row">
        <span>Loyalty to the current state</span>
        <b>{percent(weighted('loyalty'))}</b>
      </div>
      <div className="data-row">
        <span>Shared language fluency</span>
        <b>{percent(fluent)}</b>
      </div>
      <div className="data-row">
        <span>Displacement burden</span>
        <b>{percent(weighted('displacement'))}</b>
      </div>
      <div className="data-row">
        <span>Arrivals / departures this month</span>
        <b>
          {count(flows.incoming)} / {count(flows.outgoing)}
        </b>
      </div>
      <div className="data-row">
        <span>Refugee arrivals this month</span>
        <b>{count(flows.refugees)}</b>
      </div>
      <details className="community-records">
        <summary>Political attitudes and government support</summary>
        <p className="panel-note">
          Population-weighted attitudes can differ within the same culture or faith. Government approval
          changes faster than loyalty to the state.
        </p>
        {(
          [
            ['governmentSupport', 'Government support'],
            ['pluralism', 'Pluralism'],
            ['groupIdentification', 'Group identification'],
            ['authority', 'Acceptance of authority'],
            ['localAutonomy', 'Local autonomy'],
            ['publicReligion', 'Public role of religion'],
            ['languageTransmission', 'Household language transmission'],
          ] as const
        ).map(([key, label]) => (
          <div className="data-row" key={key}>
            <span>{label}</span>
            <b>{percent((census.weighted[key] ?? 0) / Math.max(1, total))}</b>
          </div>
        ))}
      </details>
      <details className="community-records">
        <summary>Inspect community records</summary>
        <h4>Identity transitions this month</h4>
        {(
          [
            ['culturalChanges', 'Cultural belonging'],
            ['languageChanges', 'Mother tongue'],
            ['beliefChanges', 'Belief'],
            ['politicalChanges', 'Outlook or allegiance'],
          ] as const
        ).map(([key, label]) => (
          <div className="data-row" key={key}>
            <span>{label}</span>
            <b>{count(provinces.reduce((sum, r) => sum + (r.populationDynamics?.[key] ?? 0), 0))}</b>
          </div>
        ))}
        <p className="panel-note">A person may make more than one transition.</p>
        <p className="panel-note">
          The twelve largest joint communities are shown. Counts include serving soldiers in the state census.
          Displacement measures the lasting burden of uprooting.
        </p>
        {census.largest
          .sort((a, b) => communitySize(b) - communitySize(a))
          .slice(0, 12)
          .map((g, i) => (
            <div className="community-record" key={`${communityKey(g)}:${i}`}>
              <strong>
                {name(g.culture)} · {count(communitySize(g))}
              </strong>
              <p>
                {name(g.language)} · {name(g.belief)}
                <br />
                {name(g.movement)}
              </p>
              <details>
                <summary>Response to declared identity policy</summary>
                <p className="panel-note">
                  Policy-only contributions; actual enforcement and living conditions also affect support.
                </p>
                {Object.entries(evaluateIdentityPolicy(g, world.nations[nation])).map(([key, value]) => (
                  <div className="data-row" key={key}>
                    <span>{key}</span>
                    <b>
                      {value > 0 ? '+' : ''}
                      {Math.round(value * 100)}
                    </b>
                  </div>
                ))}
              </details>
              <dl>
                <div>
                  <dt>Children / adults / elders</dt>
                  <dd>
                    {count(g.population.children)} / {count(g.population.adults)} /{' '}
                    {count(g.population.elders)}
                  </dd>
                </div>
                <div>
                  <dt>Health / literacy</dt>
                  <dd>
                    {percent(g.health)} / {percent(g.literacy)}
                  </dd>
                </div>
                <div>
                  <dt>Living standard / grievance</dt>
                  <dd>
                    {percent(g.wealth)} / {percent(g.grievance)}
                  </dd>
                </div>
                <div>
                  <dt>Preferred allegiance</dt>
                  <dd>{g.allegiance < 0 ? 'Local autonomy' : world.nations[g.allegiance]?.shortName}</dd>
                </div>
              </dl>
            </div>
          ))}
      </details>
    </section>
  )
}
