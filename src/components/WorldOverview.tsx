import { useMemo, useState } from 'react'
import { population, relation, type Command, type World } from '../sim/types'
import { INSTITUTION_POWERS, PROVINCIAL_POWERS, type Charter } from '../sim/institutions'
import { authoritySummary } from '../sim/sovereignty'
import { effectiveForce } from '../sim/strategic-assessment'

type View = 'relations' | 'economy' | 'population' | 'military' | 'government' | 'provinces' | 'institutions'
const labels: Record<View, string> = {
  relations: 'Relations',
  economy: 'Economy',
  population: 'Population',
  military: 'Military',
  government: 'Government',
  provinces: 'Provinces',
  institutions: 'Institutions',
}
const number = (value: number) => Math.round(value).toLocaleString(),
  percent = (value: number) => `${Math.round(value * 100)}%`
const templates: Record<Charter['form'], { name: string; powers: Charter['powers']; rule: Charter['rule'] }> =
  {
    'defense-league': { name: 'Mutual Defense League', powers: ['defense'], rule: 'unanimity' },
    'customs-union': { name: 'Common Market', powers: ['trade'], rule: 'majority' },
    'research-community': { name: 'Community of Learning', powers: ['research'], rule: 'majority' },
    confederation: {
      name: 'Confederation of States',
      powers: ['defense', 'trade', 'research'],
      rule: 'unanimity',
    },
    federation: {
      name: 'Federal Council',
      powers: ['defense', 'trade', 'research', 'taxation', 'foreignPolicy'],
      rule: 'weighted',
    },
    bespoke: { name: 'New Common Institution', powers: ['trade'], rule: 'unanimity' },
  }
export function WorldOverview({
  world,
  nation,
  onNation,
  onCommand,
}: {
  world: World
  nation: number
  onNation: (id: number) => void
  onCommand: (command: Command) => void
}) {
  const [view, setView] = useState<View>('relations'),
    [pair, setPair] = useState<[number, number] | null>(null),
    [sort, setSort] = useState({ key: 'people', descending: true }),
    [confidential, setConfidential] = useState(false),
    [filter, setFilter] = useState(''),
    [founder, setFounder] = useState(nation),
    [members, setMembers] = useState<number[]>([nation]),
    [form, setForm] = useState<Charter['form']>('defense-league'),
    [name, setName] = useState(templates['defense-league'].name),
    [powers, setPowers] = useState<Charter['powers']>(['defense']),
    [rule, setRule] = useState<Charter['rule']>('unanimity'),
    [contribution, setContribution] = useState(0.02),
    [province, setProvince] = useState(''),
    [autonomy, setAutonomy] = useState(0.35),
    [localPowers, setLocalPowers] = useState<(typeof PROVINCIAL_POWERS)[number][]>([
      'taxation',
      'education',
      'policing',
      'infrastructure',
    ])
  const states = useMemo(
      () =>
        world.nations.filter(
          (n) => n.extinct === undefined && n.population > 0 && world.regions.some((r) => r.nation === n.id),
        ),
      [world],
    ),
    institutions = (world.institutions?.organizations ?? []).filter(
      (o) => confidential || o.visibility === 'public',
    ),
    actors = states.map((n) => {
      const regions = world.regions.filter((r) => r.nation === n.id),
        people = regions.reduce((s, r) => s + population(r), 0),
        avg = (
          key:
            | 'health'
            | 'literacy'
            | 'foodCoverage'
            | 'happiness'
            | 'materialCoverage'
            | 'unrest'
            | 'infrastructure',
        ) => regions.reduce((s, r) => s + (r[key] ?? 1) * population(r), 0) / Math.max(1, people),
        armies = world.armies.filter((a) => a.nation === n.id),
        fleets = world.warfare?.fleets.filter((f) => f.nation === n.id) ?? [],
        soldiers = armies.reduce((s, a) => s + a.soldiers, 0),
        security = authoritySummary(world, n.id)
      return {
        id: n.id,
        name: n.shortName,
        color: n.color,
        people: n.population,
        output: n.gdp,
        realOutput: world.economy?.national[n.id]?.realOutput ?? 0,
        unemployment: world.economy?.national[n.id]?.unemployment ?? 0,
        inequality: world.economy?.national[n.id]?.inequality ?? 0,
        perHead: (n.gdp * 1000) / Math.max(1, n.population),
        treasury: n.treasury,
        debt: n.debt,
        food: avg('foodCoverage'),
        materials: avg('materialCoverage'),
        tax: n.policies.tax,
        trade: world.routes
          .filter((r) => world.regions[r.from].nation === n.id || world.regions[r.to].nation === n.id)
          .reduce((s, r) => s + r.volume, 0),
        literacy: avg('literacy'),
        health: avg('health'),
        happiness: avg('happiness'),
        unrest: avg('unrest'),
        soldiers,
        crew: fleets.reduce((s, f) => s + f.soldiers, 0),
        power: effectiveForce(world, n.id),
        warships: fleets.reduce((s, f) => s + f.warships, 0),
        transports: fleets.reduce((s, f) => s + f.transports, 0),
        supply: armies.reduce((s, a) => s + a.soldiers * a.supply, 0) / Math.max(1, soldiers),
        stability: n.stability,
        legitimacy: n.legitimacy,
        territory: regions.length,
        vulnerable: security.fragile,
        contested: security.contested,
        occupied: regions.filter((r) => r.occupation).length,
        autonomy:
          regions.reduce((s, r) => s + (r.delegation?.autonomy ?? 0) * population(r), 0) /
          Math.max(1, people),
        bodies: institutions.filter((o) => o.status === 'active' && o.members.includes(n.id)).length,
      }
    })
  type Row = (typeof actors)[number]
  type Column = { key: keyof Row; label: string; format?: (value: number) => string }
  const columns: Record<string, Column[]> = {
    economy: [
      { key: 'output', label: 'Value added, k' },
      { key: 'realOutput', label: 'Real output, k' },
      { key: 'unemployment', label: 'Unemployment', format: percent },
      { key: 'inequality', label: 'Income Gini', format: (value) => value.toFixed(3) },
      { key: 'perHead', label: 'Output / person' },
      { key: 'treasury', label: 'Treasury, k' },
      { key: 'debt', label: 'Debt, k' },
      { key: 'tax', label: 'Tax %' },
      { key: 'food', label: 'Food met', format: percent },
      { key: 'materials', label: 'Other needs', format: percent },
      { key: 'trade', label: 'Freight, t' },
    ],
    population: [
      { key: 'people', label: 'Population' },
      { key: 'territory', label: 'Provinces' },
      { key: 'literacy', label: 'Literacy', format: percent },
      { key: 'health', label: 'Health', format: percent },
      { key: 'happiness', label: 'Contentment', format: percent },
      { key: 'unrest', label: 'Unrest / 100' },
    ],
    military: [
      { key: 'soldiers', label: 'Field troops' },
      { key: 'power', label: 'Effective force' },
      { key: 'supply', label: 'Supply', format: percent },
      { key: 'crew', label: 'Naval crew' },
      { key: 'warships', label: 'Warships' },
      { key: 'transports', label: 'Transports' },
      { key: 'occupied', label: 'Occupations held' },
    ],
    government: [
      { key: 'stability', label: 'Stability' },
      { key: 'legitimacy', label: 'Legitimacy' },
      { key: 'vulnerable', label: 'Vulnerable provinces' },
      { key: 'contested', label: 'Contested provinces' },
      { key: 'autonomy', label: 'Provincial autonomy', format: percent },
      { key: 'bodies', label: 'Institutions' },
    ],
  }
  const visible = actors
      .filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => {
        const x = a[sort.key as keyof Row],
          y = b[sort.key as keyof Row],
          difference =
            typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
        return (sort.descending ? -1 : 1) * difference || a.id - b.id
      }),
    chooseSort = (key: string) =>
      setSort((old) => ({ key, descending: old.key === key ? !old.descending : true })),
    bodyBetween = (a: number, b: number) =>
      institutions.filter((o) => o.status === 'active' && o.members.includes(a) && o.members.includes(b)),
    pairRelation = pair ? relation(world, ...pair) : undefined
  return (
    <section className="world-overview">
      <div className="overview-heading">
        <div>
          <h2 id="world-overview-title">The world in relation.</h2>
          <p>
            Compare {states.length} active states, their dependencies and shared institutions. This observer’s
            overview is broader than the reports available to each government.
          </p>
        </div>
        <span>
          {world.startYear + Math.floor(world.month / 12)} · month {world.month}
        </span>
      </div>
      <nav className="overview-tabs" aria-label="World comparisons">
        {(Object.keys(labels) as View[]).map((key) => (
          <button
            type="button"
            key={key}
            aria-pressed={view === key}
            className={view === key ? 'active' : ''}
            onClick={() => setView(key)}
          >
            {labels[key]}
          </button>
        ))}
      </nav>
      <div className="overview-tools">
        <label className="select-label">
          Find a state
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="State name" />
        </label>
        <label className="confidential-toggle">
          <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
          Inspect confidential institutions
        </label>
      </div>
      {view === 'relations' && (
        <>
          <p className="panel-note">
            Select a pair to inspect it. W = war · A = alliance · L = common defense league · T = trade · C =
            armistice. Numbers show bilateral opinion.
          </p>
          <div className="overview-table-scroll">
            <table className="relations-matrix">
              <caption>
                Relationships between active states
                {confidential ? ', including confidential institutions' : '; public diplomatic record'}
              </caption>
              <thead>
                <tr>
                  <th scope="col">State</th>
                  {visible.map((b) => (
                    <th scope="col" key={b.id} title={world.nations[b.id].name}>
                      {b.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      <button type="button" className="text-button" onClick={() => onNation(a.id)}>
                        <i style={{ background: a.color }} />
                        {a.name}
                      </button>
                    </th>
                    {visible.map((b) => {
                      if (a.id === b.id)
                        return (
                          <td className="matrix-self" key={b.id}>
                            —
                          </td>
                        )
                      const rel = relation(world, a.id, b.id),
                        common = bodyBetween(a.id, b.id),
                        league = common.some((o) => o.charter.powers.includes('defense')),
                        trade = common.some((o) => o.charter.powers.includes('trade')),
                        kind =
                          rel?.treaty === 'war'
                            ? 'war'
                            : rel?.treaty === 'alliance'
                              ? 'alliance'
                              : league
                                ? 'league'
                                : rel?.treaty === 'trade' || trade
                                  ? 'trade'
                                  : rel?.treaty === 'truce'
                                    ? 'truce'
                                    : 'neutral',
                        symbol = {
                          war: 'W',
                          alliance: 'A',
                          league: 'L',
                          trade: 'T',
                          truce: 'C',
                          neutral: '·',
                        }[kind]
                      return (
                        <td key={b.id}>
                          <button
                            type="button"
                            className={`matrix-cell ${kind} ${pair?.includes(a.id) && pair.includes(b.id) ? 'selected' : ''}`}
                            aria-label={`${a.name} and ${b.name}: ${kind}, opinion ${Math.round(rel?.opinion ?? 0)}`}
                            title={`${world.nations[a.id].name} ↔ ${world.nations[b.id].name}: ${kind}${common.length ? `; ${common.map((o) => o.name).join(', ')}` : ''}`}
                            onClick={() => setPair([a.id, b.id])}
                          >
                            <strong>{symbol}</strong>
                            <small>{Math.round(rel?.opinion ?? 0)}</small>
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pair && (
            <aside className="relationship-detail">
              <h3>
                {world.nations[pair[0]].shortName} ↔ {world.nations[pair[1]].shortName}
              </h3>
              <p>
                {pairRelation?.treaty ?? 'Neutral'} · Opinion {Math.round(pairRelation?.opinion ?? 0)} ·
                Grievance {Math.round(pairRelation?.grievance ?? 0)} · War exhaustion{' '}
                {Math.round(pairRelation?.warExhaustion ?? 0)}
              </p>
              {bodyBetween(...pair).map((o) => (
                <p key={o.id}>
                  {o.name} · {o.charter.powers.join(', ')}
                </p>
              ))}
            </aside>
          )}
        </>
      )}
      {columns[view] && (
        <div className="overview-table-scroll">
          <table className="comparison-table">
            <caption>{labels[view]} across active states · select a heading to sort</caption>
            <thead>
              <tr>
                <th scope="col">
                  <button type="button" onClick={() => chooseSort('name')}>
                    State
                  </button>
                </th>
                {columns[view].map((c) => (
                  <th
                    scope="col"
                    key={c.key}
                    aria-sort={sort.key === c.key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                  >
                    <button type="button" onClick={() => chooseSort(c.key)}>
                      {c.label}
                      {sort.key === c.key ? (sort.descending ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    <button type="button" className="text-button" onClick={() => onNation(a.id)}>
                      <i style={{ background: a.color }} />
                      {a.name}
                    </button>
                  </th>
                  {columns[view].map((c) => (
                    <td key={c.key}>{(c.format ?? number)(a[c.key] as number)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === 'provinces' && (
        <div className="overview-table-scroll">
          <table className="comparison-table">
            <caption>Provincial living conditions and delegated authority</caption>
            <thead>
              <tr>
                {[
                  'Province',
                  'State',
                  'People',
                  'Food met',
                  'Other needs',
                  'Unrest',
                  'Infrastructure',
                  'Autonomy',
                  'Local funds, k',
                ].map((label) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {world.regions
                .filter((r) =>
                  (world.nations[r.nation]?.shortName ?? 'Unclaimed')
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .sort((a, b) => b.unrest - a.unrest)
                .map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.name}</th>
                    <td>{world.nations[r.nation]?.shortName ?? 'Unclaimed'}</td>
                    <td>{number(population(r))}</td>
                    <td>{percent(r.foodCoverage)}</td>
                    <td>{percent(r.materialCoverage ?? 1)}</td>
                    <td>{Math.round(r.unrest)}</td>
                    <td>{percent(r.infrastructure)}</td>
                    <td>{percent(r.delegation?.autonomy ?? 0)}</td>
                    <td>{number(r.delegation?.treasury ?? 0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {view === 'institutions' && (
        <>
          <p className="panel-note">
            A defense league pools security while preserving sovereignty. Customs and research communities
            share specific functions. Confederations and federations can delegate broader powers, voting and
            contributions. Mergers remain separate sovereign settlements.
          </p>
          <div className="institution-grid">
            {institutions
              .filter((o) => o.status === 'active')
              .map((o) => (
                <article key={o.id}>
                  <small>
                    {o.visibility === 'secret' ? 'Confidential · ' : ''}
                    {o.charter.form.replaceAll('-', ' ')}
                  </small>
                  <h3>{o.name}</h3>
                  <p>{o.members.map((id) => world.nations[id].shortName).join(' · ')}</p>
                  <dl>
                    <div>
                      <dt>Delegated powers</dt>
                      <dd>{o.charter.powers.join(', ')}</dd>
                    </div>
                    <div>
                      <dt>Decisions</dt>
                      <dd>
                        {o.charter.rule} ·{' '}
                        {o.charter.exit === 'notice' ? 'Notice expected on withdrawal' : 'Free withdrawal'}
                      </dd>
                    </div>
                    <div>
                      <dt>Contributions</dt>
                      <dd>{percent(o.charter.contribution)} of member public income</dd>
                    </div>
                    <div>
                      <dt>Common treasury</dt>
                      <dd>
                        {number(o.treasury)}k · {number(o.grants)}k defense grants this month
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
          </div>
          {!institutions.some((o) => o.status === 'active') && (
            <p>
              No shared institution has been founded yet. Its charter requires the participating governments’
              consent.
            </p>
          )}
          <details className="institution-builder">
            <summary>Propose a shared institution</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onCommand({
                  type: 'charter-proposal',
                  nation: founder,
                  members: [...new Set([founder, ...members])],
                  name,
                  charter: { operation: 'found', id: 0, form, powers, rule, contribution, exit: 'notice' },
                })
              }}
            >
              <div className="form-columns">
                <label className="select-label">
                  Proposing government
                  <select
                    value={founder}
                    onChange={(e) => {
                      setFounder(Number(e.target.value))
                      setProvince('')
                    }}
                  >
                    {states.map((n) => (
                      <option value={n.id} key={n.id}>
                        {n.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="select-label">
                  Constitutional form
                  <select
                    value={form}
                    onChange={(e) => {
                      const next = e.target.value as Charter['form']
                      setForm(next)
                      setName(templates[next].name)
                      setPowers(templates[next].powers)
                      setRule(templates[next].rule)
                    }}
                  >
                    {Object.keys(templates).map((key) => (
                      <option key={key} value={key}>
                        {key.replaceAll('-', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="select-label">
                Name
                <input required maxLength={140} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <fieldset>
                <legend>Invited members</legend>
                <div className="member-choices">
                  {states.map((n) => (
                    <label key={n.id}>
                      <input
                        type="checkbox"
                        disabled={n.id === founder}
                        checked={n.id === founder || members.includes(n.id)}
                        onChange={(e) =>
                          setMembers((old) =>
                            e.target.checked ? [...old, n.id] : old.filter((id) => id !== n.id),
                          )
                        }
                      />
                      {n.shortName}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Delegated powers</legend>
                <div className="member-choices">
                  {INSTITUTION_POWERS.map((power) => (
                    <label key={power}>
                      <input
                        type="checkbox"
                        checked={powers.includes(power)}
                        onChange={(e) =>
                          setPowers((old) =>
                            e.target.checked ? [...old, power] : old.filter((p) => p !== power),
                          )
                        }
                      />
                      {power === 'foreignPolicy' ? 'Foreign policy' : power}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="form-columns">
                <label className="select-label">
                  Decision rule
                  <select value={rule} onChange={(e) => setRule(e.target.value as Charter['rule'])}>
                    <option value="unanimity">Unanimity</option>
                    <option value="majority">Majority of states</option>
                    <option value="weighted">Population-weighted votes</option>
                  </select>
                </label>
                <label className="select-label">
                  Income contribution
                  <input
                    type="number"
                    min={0}
                    max={15}
                    step={0.5}
                    value={contribution * 100}
                    onChange={(e) => setContribution(Number(e.target.value) / 100)}
                  />
                  <small>Percent of member public income</small>
                </label>
              </div>
              <button
                className="button primary"
                disabled={powers.length === 0 || new Set([founder, ...members]).size < 2}
                type="submit"
              >
                Send charter proposal
              </button>
              <p className="panel-note">
                Only the proposing government signs now. Other members must consent; this action cannot
                transfer another state’s authority by itself.
              </p>
            </form>
          </details>
          <details className="institution-builder">
            <summary>Delegate powers to provinces</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onCommand({
                  type: 'devolution',
                  nation: founder,
                  regions:
                    province === 'all'
                      ? world.regions.filter((r) => r.nation === founder).map((r) => r.id)
                      : [Number(province)],
                  autonomy,
                  powers: localPowers,
                })
              }}
            >
              <div className="form-columns">
                <label className="select-label">
                  Government
                  <select
                    value={founder}
                    onChange={(e) => {
                      setFounder(Number(e.target.value))
                      setProvince('')
                    }}
                  >
                    {states.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="select-label">
                  Provinces
                  <select required value={province} onChange={(e) => setProvince(e.target.value)}>
                    <option value="" disabled>
                      Choose provinces
                    </option>
                    <option value="all">All owned provinces</option>
                    {world.regions
                      .filter((r) => r.nation === founder)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label className="select-label">
                Autonomy and retained tax share: {percent(autonomy)}
                <input
                  type="range"
                  min={0}
                  max={0.8}
                  step={0.05}
                  value={autonomy}
                  onChange={(e) => setAutonomy(Number(e.target.value))}
                />
              </label>
              <fieldset>
                <legend>Provincial responsibilities</legend>
                <div className="member-choices">
                  {PROVINCIAL_POWERS.map((power) => (
                    <label key={power}>
                      <input
                        type="checkbox"
                        checked={localPowers.includes(power)}
                        onChange={(e) =>
                          setLocalPowers((old) =>
                            e.target.checked ? [...old, power] : old.filter((p) => p !== power),
                          )
                        }
                      />
                      {power}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className="button primary" disabled={!province}>
                Record provincial charter
              </button>
              <p className="panel-note">
                Retained taxes fund local institutions and services. Central revenue falls accordingly.
                Sovereign borders remain in place.
              </p>
            </form>
          </details>
          {world.statecraft?.offers
            .filter(
              (o) =>
                o.status === 'proposed' &&
                o.visibility === 'public' &&
                o.terms.some((t) => t.kind === 'institution'),
            )
            .map((o) => (
              <p className="panel-note" key={o.id}>
                Awaiting consent: {o.title} · {o.signatures.length}/{o.parties.length} governments
              </p>
            ))}
        </>
      )}
    </section>
  )
}
