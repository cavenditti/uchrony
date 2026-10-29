/** Date navigation keeps the live world paused and never substitutes historical data for a save. */
import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, History, Search } from 'lucide-react'
import { dateLabel, type Command, type World } from '../sim/types'
import type { ArchiveQuery, ArchiveResult } from '../sim/world-archive'
import type { HistoricalLayer } from '../sim/archive-presentation'
import { HistoricalMap } from './HistoricalMap'
import { InstitutionDossier } from './InstitutionDossier'
export function HistoricalAtlas({
  world,
  result,
  error,
  initialInstitution,
  onQuery,
  onClose,
  onCommand,
}: {
  world: World
  result: ArchiveResult | null
  error: string
  initialInstitution?: number
  onQuery: (query: Omit<ArchiveQuery, 'id'>) => void
  onClose: () => void
  onCommand: (command: Command) => void
}) {
  const [month, setMonth] = useState(world.month),
    [institution, setInstitution] = useState<number | undefined>(initialInstitution),
    [offset, setOffset] = useState(0),
    [confidential, setConfidential] = useState(false),
    [province, setProvince] = useState<number | null>(null),
    [nationId, setNationId] = useState<number | null>(null),
    [layer, setLayer] = useState<HistoricalLayer>('political'),
    [filter, setFilter] = useState(''),
    [comparison, setComparison] = useState<ArchiveResult>()
  const [tab, setTab] = useState<'states' | 'institutions'>(
    initialInstitution === undefined ? 'states' : 'institutions',
  )
  const date = (month: number) => dateLabel({ startYear: world.startYear, month })
  useEffect(() => {
    const timer = setTimeout(() => onQuery({ month, institution, confidential, offset }), 60)
    return () => clearTimeout(timer)
  }, [month, institution, confidential, offset, onQuery, world.month, world.institutions])
  const go = (date: number) => {
    setMonth(date)
    setOffset(0)
  }
  const pickInstitution = (id: number) => {
    setInstitution(id)
    setOffset(0)
    setTab('institutions')
  }
  const pickNation = (id: number) => {
    setNationId(id)
    setProvince(result?.provinces.find((p) => p.nation === id)?.id ?? null)
    setInstitution(undefined)
    setTab('states')
  }
  const selected = province === null ? undefined : result?.provinces[province],
    nation = result?.nations[nationId ?? selected?.nation ?? -1]
  const controlled = world.nations.filter((n) => !n.ai && n.extinct === undefined).map((n) => n.id)
  const ready = result && !error
  return (
    <section className="historical-atlas" aria-label="Historical atlas">
      <div className="history-toolbar">
        <h1>
          <History size={21} /> Historical atlas
        </h1>
        <button className="button-secondary" onClick={onClose}>
          <ArrowLeft size={15} /> Return to present
        </button>
      </div>
      <div className="history-datebar">
        <button
          className="icon-button"
          aria-label="Previous month"
          disabled={!result || month <= result.since}
          onClick={() => go(Math.max(result!.since, month - 1))}
        >
          <ChevronLeft size={19} />
        </button>
        <label className="history-date-label">
          Viewing <strong>{date(result?.month ?? month)}</strong>
        </label>
        <button
          className="icon-button"
          aria-label="Next month"
          disabled={month >= world.month}
          onClick={() => go(Math.min(world.month, month + 1))}
        >
          <ChevronRight size={19} />
        </button>
        <input
          aria-label="Historical date"
          type="range"
          min={result?.since ?? world.month}
          max={world.month}
          value={month}
          onChange={(e) => go(Number(e.target.value))}
        />
        <label>
          Month
          <input
            aria-label="Historical month number"
            type="number"
            min={result?.since ?? world.month}
            max={world.month}
            value={month}
            onChange={(e) => {
              const value = Number(e.target.value)
              if (Number.isInteger(value) && value >= (result?.since ?? 0) && value <= world.month) go(value)
            }}
          />
        </label>
        <span className="subtle">Present: {date(world.month)}</span>
      </div>
      <div className="history-coverage" role="status">
        {error ||
          (!result
            ? 'Loading preserved observations…'
            : `Detailed records begin ${date(result.since)}. Earlier detail is unknown.`)}
        {result && month !== result.month && ` Showing the last observation before ${date(month)}.`}
        {result?.approximate && ' Approximate fast-forward observation.'}
        {result && result.requestedMonth !== month && ' Loading selected date…'}
      </div>
      {error && (
        <button className="text-button" onClick={() => onQuery({ month, institution, confidential, offset })}>
          Retry historical query
        </button>
      )}
      {ready && (
        <div className="history-layout">
          <div className="history-geography">
            <div className="history-map-toolbar">
              <label>
                Map layer
                <select value={layer} onChange={(e) => setLayer(e.target.value as HistoricalLayer)}>
                  <option value="political">Political ownership</option>
                  <option value="wars">Wars</option>
                  <option value="population">National population</option>
                  <option value="economy">National economic output</option>
                </select>
              </label>
              <button className="text-button" onClick={() => setComparison(comparison ? undefined : result)}>
                {comparison ? `Clear comparison with ${date(comparison.month)}` : 'Compare from this date'}
              </button>
            </div>
            <HistoricalMap
              world={world}
              result={result}
              layer={layer}
              selected={province}
              members={result.selected?.members}
              comparison={comparison}
              onSelect={(id) => {
                setNationId(result.provinces[id]?.nation ?? null)
                setProvince(id)
                setInstitution(undefined)
                setTab('states')
              }}
            />
          </div>
          <aside className="history-dossier" aria-label="Dated dossiers">
            <nav className="history-tabs" aria-label="Historical records">
              <button
                aria-pressed={tab === 'states'}
                onClick={() => {
                  setTab('states')
                  setInstitution(undefined)
                }}
              >
                States
              </button>
              <button aria-pressed={tab === 'institutions'} onClick={() => setTab('institutions')}>
                Institutions
              </button>
            </nav>
            <label className="history-search">
              <Search size={16} />
              <input
                aria-label="Search historical records"
                placeholder="Find a state or institution…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            {tab === 'states' && (
              <>
                {nation && (
                  <article className="historical-state-dossier">
                    <h2>{nation.name}</h2>
                    <p>
                      {selected?.name} · {date(result.month)}
                    </p>
                    <p>
                      {nation.government}
                      {nation.extinct !== undefined ? ' · Extinct' : ''}
                    </p>
                    <dl className="history-facts">
                      <div>
                        <dt>Population</dt>
                        <dd>{Math.round(nation.population).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Economic output</dt>
                        <dd>{Math.round(nation.gdp).toLocaleString()}k crowns / month</dd>
                      </div>
                      <div>
                        <dt>Treasury</dt>
                        <dd>{Math.round(nation.treasury).toLocaleString()}k crowns</dd>
                      </div>
                      <div>
                        <dt>Stability</dt>
                        <dd>{Math.round(nation.stability)}%</dd>
                      </div>
                    </dl>
                    <h3>Wars at this date</h3>
                    {result.wars
                      .filter((w) => w.a === nation.id || w.b === nation.id)
                      .map((w) => (
                        <p key={`${w.a}:${w.b}`}>
                          Against{' '}
                          <button
                            className="text-button"
                            onClick={() => pickNation(w.a === nation.id ? w.b : w.a)}
                          >
                            {result.nations[w.a === nation.id ? w.b : w.a]?.name}
                          </button>{' '}
                          · Since {date(w.since)}
                        </p>
                      ))}
                    {!result.wars.some((w) => w.a === nation.id || w.b === nation.id) && (
                      <p className="subtle">No recorded war.</p>
                    )}
                    <h3>Institutions</h3>
                    {result.institutions
                      .filter((o) => o.status !== 'dissolved' && o.members.includes(nation.id))
                      .map((o) => (
                        <p key={o.id}>
                          <button className="text-button" onClick={() => pickInstitution(o.id)}>
                            {o.name}
                          </button>{' '}
                          · {o.status}
                        </p>
                      ))}
                  </article>
                )}
                {selected && !nation && <p>{selected.name} was unclaimed at this date.</p>}
                {!selected && (
                  <p className="subtle">
                    Select territory on the map or choose a state to open its dated dossier.
                  </p>
                )}
                <ul className="history-record-list">
                  {result.nations
                    .filter((n) => n.name.toLowerCase().includes(filter.toLowerCase()))
                    .map((n) => (
                      <li key={n.id}>
                        <button onClick={() => pickNation(n.id)}>
                          <span>{n.name}</span>
                          <small>
                            {n.extinct !== undefined
                              ? 'Extinct'
                              : `${Math.round(n.population).toLocaleString()} people`}
                          </small>
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
            {tab === 'institutions' && (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={confidential}
                    onChange={(e) => setConfidential(e.target.checked)}
                  />{' '}
                  Include confidential institutions
                </label>
                <ul className="history-record-list">
                  {result.institutions
                    .filter((o) => o.name.toLowerCase().includes(filter.toLowerCase()))
                    .map((o) => (
                      <li key={o.id}>
                        <button aria-pressed={institution === o.id} onClick={() => pickInstitution(o.id)}>
                          <span>{o.name}</span>
                          <small>
                            {o.status} · {o.members.length} members
                          </small>
                        </button>
                      </li>
                    ))}
                </ul>
                {!result.institutions.length && <p>No institutions are recorded at this date.</p>}
                {institution !== undefined && !result.selected && (
                  <p className="history-notice">
                    This institution is not recorded at the selected date, or requires confidential observer
                    access.
                  </p>
                )}
                {result.selected && (
                  <InstitutionDossier
                    key={`${result.selected.id}:${result.month}`}
                    result={result}
                    startYear={world.startYear}
                    currentMonth={world.month}
                    controlled={controlled}
                    onCommand={onCommand}
                    onDate={go}
                    onNation={pickNation}
                    onPage={setOffset}
                  />
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
