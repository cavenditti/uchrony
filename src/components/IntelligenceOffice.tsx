import { useState } from 'react'
import type { World, Command } from '../sim/types'
import {
  INTELLIGENCE_PRIORITIES,
  type IntelligencePriority,
  type IntelligenceReport,
  type Estimate,
} from '../sim/intelligence'

const labels: Record<IntelligencePriority, string> = {
  balanced: 'Broad reporting',
  military: 'Military reconnaissance',
  economy: 'Commerce and resources',
  politics: 'Political reporting',
  counterintelligence: 'Counterintelligence',
}
const digits = (n: number) => Math.round(n).toLocaleString()
function range(value: Estimate | undefined, fraction = false) {
  if (!value) return 'Unknown'
  return fraction
    ? `${Math.round(value.low * 100)}–${Math.round(value.high * 100)}%`
    : `${digits(value.low)}–${digits(value.high)}`
}
function Report({
  report,
  month,
  kind,
}: {
  report: IntelligenceReport | undefined
  month: number
  kind: string
}) {
  if (!report) return <p className="intel-unknown">{kind}: no report available.</p>
  const age = month - report.month,
    confidence = report.confidence * Math.exp(-age / 36)
  const fields =
    kind === 'Military'
      ? [
          ['Land troops', 'soldiers'],
          ['Effective land strength', 'effectivePower'],
          ['Warships', 'warships'],
        ]
      : kind === 'Economy'
        ? [
            ['Population', 'population'],
            ['Monthly output, k', 'output'],
            ['Treasury, k', 'treasury'],
            ['Food needs met', 'food'],
            ['Iron output, t', 'iron'],
            ['Coal output, t', 'coal'],
          ]
        : [
            ['Stability', 'stability'],
            ['Legitimacy', 'legitimacy'],
          ]
  return (
    <div className="intel-report">
      <div className="intel-report-heading">
        <strong>{kind}</strong>
        <span>
          {age === 0 ? 'Collected this month' : `${age} months old`} · {Math.round(confidence * 100)}%
          confidence
        </span>
      </div>
      <dl>
        {fields.map(([name, key]) => (
          <div key={key}>
            <dt>{name}</dt>
            <dd>{range(report.values[key], key === 'food')}</dd>
          </div>
        ))}
      </dl>
      <p className="intel-sources">{report.sources.join(' · ')}</p>
    </div>
  )
}
export function IntelligenceOffice({
  world,
  nation,
  onCommand,
}: {
  world: World
  nation: number
  onCommand: (command: Command) => void
}) {
  const s = world.intelligence?.services.find((s) => s.nation === nation),
    n = world.nations[nation],
    [share, setShare] = useState((s?.budgetShare ?? 0.005) * 100),
    [priority, setPriority] = useState<IntelligencePriority>(s?.priority ?? 'balanced'),
    [focus, setFocus] = useState(s?.focus === null || s?.focus === undefined ? '' : String(s.focus))
  return (
    <section className="intelligence-office" aria-label="Intelligence and foreign reports">
      <h3>Intelligence and foreign reports</h3>
      <p className="panel-note">
        This is what {n.shortName} knows. Foreign reports can be incomplete, biased or outdated. Funding
        develops contacts and surveys over months; it does not reveal the world instantly.
      </p>
      <div className="data-row">
        <span>Standing allocation</span>
        <b>{((s?.budgetShare ?? 0.005) * 100).toFixed(1)}% of revenue</b>
      </div>
      <div className="data-row">
        <span>Spent this month</span>
        <b>{digits((s?.spent ?? 0) * 1000)} crowns</b>
      </div>
      <div className="data-row">
        <span>Known states · charted provinces</span>
        <b>
          {s?.dossiers.length ?? 0} · {s?.chart.length ?? 0}
        </b>
      </div>
      <form
        className="intel-form"
        onSubmit={(event) => {
          event.preventDefault()
          onCommand({
            type: 'intelligence',
            nation,
            budgetShare: share / 100,
            priority,
            focus: focus === '' ? null : Number(focus),
          })
        }}
      >
        <label>
          Reporting budget <output>{share.toFixed(1)}%</output>
          <input
            aria-label="Intelligence budget as a percentage of revenue"
            type="range"
            min="0"
            max="15"
            step="0.5"
            value={share}
            onChange={(e) => setShare(Number(e.target.value))}
          />
        </label>
        <p className="intel-estimate">
          About {digits(((n.income * share) / 100) * 1000)} crowns per month at current revenue, limited by
          available cash.
        </p>
        <label>
          Collection priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as IntelligencePriority)}>
            {INTELLIGENCE_PRIORITIES.map((key) => (
              <option key={key} value={key}>
                {labels[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Focus
          <select value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">Spread across known contacts</option>
            {s?.dossiers.map((d) => (
              <option key={d.nation} value={d.nation}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button">
          Fund this reporting plan
        </button>
      </form>
      <p className="panel-note">
        Patrols observe nearby forces. Merchants report on commerce; allies provide liaison reports.
        Counterintelligence obstructs foreign networks. Unreported armies, alliances and countries may still
        exist.
      </p>
      {!s?.dossiers.length && (
        <p className="intel-unknown">
          No foreign contacts reported yet. Local observation and contact establish the first dossiers.
        </p>
      )}
      {s?.dossiers.map((d) => (
        <details className="intel-dossier" key={d.nation}>
          <summary>
            <span>{d.name}</span>
            <small>Open dossier</small>
          </summary>
          {d.politics && (
            <p className="intel-regime">
              {d.politics.government}
              {d.politics.leader ? ` · ${d.politics.leader}` : ''} <span>(last reported)</span>
            </p>
          )}
          <Report report={d.military} month={world.month} kind="Military" />
          <Report report={d.economy} month={world.month} kind="Economy" />
          <Report report={d.politics} month={world.month} kind="Politics" />
        </details>
      ))}
    </section>
  )
}
