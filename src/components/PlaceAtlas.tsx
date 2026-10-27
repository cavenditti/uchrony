import { useEffect, useRef, useState } from 'react'
import { X, MapPin, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  PLACE_KINDS,
  type PlaceKind,
  type PlaceQuery,
  type PlaceResult,
  type WritingRequest,
} from '../sim/almanac-types'
import type { WritingTask } from '../sim/model-tasks'
import { dateLabel } from '../sim/types'

export function PlaceAtlas({
  result,
  startYear,
  currentMonth,
  enabled,
  jobs,
  refresh,
  onQuery,
  onWrite,
  onClose,
  onLocate,
}: {
  result: PlaceResult | null
  startYear: number
  currentMonth: number
  enabled: boolean
  jobs: Record<string, { state: string; message?: string }>
  refresh: number
  onQuery: (q: Omit<PlaceQuery, 'id'>) => void
  onWrite: (r: WritingRequest) => void
  onClose: () => void
  onLocate: (cell: number) => void
}) {
  const [search, setSearch] = useState(''),
    [kind, setKind] = useState<PlaceKind | ''>(''),
    [selected, setSelected] = useState<string | undefined>(),
    [offset, setOffset] = useState(0),
    [question, setQuestion] = useState(''),
    [historyLimit, setHistoryLimit] = useState(30)
  const [form, setForm] = useState<WritingTask>('description')
  const heading = useRef<HTMLHeadingElement>(null)
  const searchField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!selected) searchField.current?.focus()
  }, [selected])
  useEffect(() => {
    const timer = setTimeout(() => onQuery({ search, kind: kind || undefined, place: selected, offset }), 120)
    return () => clearTimeout(timer)
  }, [search, kind, selected, offset, refresh, onQuery])
  const p = result?.selected?.id === selected ? result?.selected : undefined
  useEffect(() => {
    if (p) heading.current?.focus()
  }, [p?.id])
  const date = (month: number) => dateLabel({ startYear, month })
  const choose = (id: string) => {
    setSelected(id)
    setHistoryLimit(30)
    setQuestion('')
  }
  const jobId = p ? `writing:${form}:${p.id}` : ''
  const active = Object.entries(jobs).some(([id, j]) => id.endsWith(`:${p?.id}`) && j.state === 'loading')
  const messages = Object.entries(jobs).filter(([id, j]) => id.endsWith(`:${p?.id}`) && j.state === 'error')
  return (
    <section className="place-atlas" aria-label="Places and histories">
      <div className="place-atlas-heading">
        <h2>Places and histories</h2>
        <button className="icon-button" aria-label="Close places and histories" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className={`place-atlas-body ${selected ? 'has-place' : ''}`}>
        <nav className="place-index" aria-label="Atlas index">
          <label className="select-label">
            Find a place or actor
            <input
              ref={searchField}
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setOffset(0)
              }}
              placeholder="Names and former names"
            />
          </label>
          <label className="select-label">
            Show
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as PlaceKind | '')
                setOffset(0)
              }}
            >
              <option value="">All places and actors</option>
              {PLACE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <p className="panel-note" role="status">
            {result ? `${result.total.toLocaleString()} entries` : 'Reading the atlas…'}
          </p>
          <div className="place-index-rows">
            {result?.entries.map((entry) => (
              <button
                className={selected === entry.id ? 'selected' : ''}
                aria-current={selected === entry.id ? 'true' : undefined}
                key={entry.id}
                onClick={() => choose(entry.id)}
              >
                <span>{entry.name}</span>
                <small>{entry.kind}</small>
              </button>
            ))}
          </div>
          {result?.total === 0 && <p>No matching entries. Try a former name or another type.</p>}
          <div className="place-pagination">
            <button
              className="icon-button"
              aria-label="Previous atlas page"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 60))}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {result && result.total > 0 ? `${offset + 1}–${Math.min(offset + 60, result.total)}` : '0'}
            </span>
            <button
              className="icon-button"
              aria-label="Next atlas page"
              disabled={!result || offset + 60 >= result.total}
              onClick={() => setOffset(offset + 60)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </nav>
        <article className="place-dossier">
          {selected && (
            <button className="text-button place-back" onClick={() => setSelected(undefined)}>
              <ChevronLeft size={15} />
              Back to the atlas
            </button>
          )}
          {!p ? (
            <div className="place-empty">
              <h3>A world with a memory</h3>
              <p>
                Open a river, peak, settlement or actor to explore its names, connections and recorded past.
              </p>
              <p>
                Local records accumulate as time advances. Earlier history is unknown unless it was preserved
                in the saved world.
              </p>
            </div>
          ) : (
            <>
              <div className="place-title">
                <h3 ref={heading} tabIndex={-1}>
                  {p.name}
                </h3>
                <button
                  className="icon-button"
                  aria-label={`Locate ${p.name} on the map`}
                  disabled={p.located === false}
                  title={p.located === false ? 'A geographic location is not recorded' : 'Locate on map'}
                  onClick={() => onLocate(p.cell)}
                >
                  <MapPin size={18} />
                </button>
              </div>
              <p className="place-subtitle">
                {p.kind} · Recorded since {date(p.since)}
              </p>
              <dl className="place-attributes">
                {Object.entries(p.attributes).map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {key === 'areaCells'
                        ? 'Mapped area'
                        : key === 'elevationIndex'
                          ? 'Relative elevation'
                          : key === 'flow'
                            ? 'Relative runoff'
                            : key.replace(/([A-Z])/g, ' $1')}
                    </dt>
                    <dd>
                      {typeof value === 'number'
                        ? key === 'areaCells'
                          ? `${(value * 1.048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} km²`
                          : value.toLocaleString(undefined, { maximumFractionDigits: 3 })
                        : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              {!!p.names.length && (
                <details>
                  <summary>Names through time ({p.names.length})</summary>
                  <ul className="place-name-history">
                    {p.names.map((name, i) => (
                      <li key={i}>
                        <strong>{name.name}</strong> · {name.kind} · {date(name.month)}
                        <p>{name.reason}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {!!result?.related.length && (
                <section className="place-connections">
                  <h4>Connected places and people</h4>
                  {result.related.map((r) => (
                    <button className="text-button" key={r.id} onClick={() => choose(r.id)}>
                      {r.name}
                      <span>{r.kind}</span>
                    </button>
                  ))}
                </section>
              )}
              <section className="place-reading">
                <h4>Accounts of this place</h4>
                {p.accounts.length === 0 && (
                  <p>
                    No expanded account has been written. The recorded timeline below is available without a
                    model.
                  </p>
                )}
                {p.accounts.map((account, i) => (
                  <div className="place-account" key={i}>
                    <h5>{account.title}</h5>
                    {account.question && (
                      <p>
                        <strong>{account.question}</strong>
                      </p>
                    )}
                    <p>{account.text}</p>
                    <small>
                      {account.status === 'tradition'
                        ? 'Local tradition · imagined, not historical evidence'
                        : 'Interpretation of the supplied records'}{' '}
                      · As of {date(account.asOf)}
                    </small>
                    {!!account.sources.length && (
                      <details>
                        <summary>Source records ({account.sources.length})</summary>
                        <ul>
                          {account.sources.map((id) => {
                            const f = result?.facts.find((f) => f.id === id)
                            return (
                              <li key={id}>
                                {f
                                  ? `${date(f.month)} · ${f.title}: ${f.detail}`
                                  : 'Record retained elsewhere in the archive.'}
                              </li>
                            )
                          })}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
                <form
                  className="place-writing"
                  onSubmit={(e) => {
                    e.preventDefault()
                    onWrite({
                      id: jobId,
                      task: form,
                      place: p.id,
                      ...(form === 'historian' ? { question } : {}),
                    })
                  }}
                >
                  <label className="select-label">
                    Request an account
                    <select value={form} onChange={(e) => setForm(e.target.value as WritingTask)}>
                      <option value="description">Describe this place</option>
                      <option value="biography">Write its local history</option>
                      <option value="chronicle">Report local developments</option>
                      <option value="tradition">Compose a local tradition</option>
                      <option value="historian">Ask a historian</option>
                      <option value="naming">Enrich names in this language</option>
                      <option value="culture">Develop its naming tradition</option>
                    </select>
                  </label>
                  {form === 'historian' && (
                    <label className="select-label">
                      Your question
                      <textarea
                        required
                        maxLength={500}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="What do the records tell us about this place?"
                      />
                    </label>
                  )}
                  <button className="button" type="submit" disabled={!enabled || active}>
                    {active ? 'Writing in the background…' : 'Request account'}
                  </button>
                  {!enabled && (
                    <p className="panel-note">
                      Enable LLM assistance in the world menu to request writing. The atlas and its records
                      remain available.
                    </p>
                  )}
                  {active && <p role="status">The world continues while this account is written.</p>}
                  {messages.map(([id, j]) => (
                    <p className="negative" role="alert" key={id}>
                      {j.message}
                    </p>
                  ))}
                </form>
              </section>
              <section className="place-timeline">
                <h4>Recorded timeline</h4>
                <p className="panel-note">
                  Includes records of the surrounding province, identified below. Records persist beyond the
                  recent world chronicle.
                </p>
                {!result?.facts.length && <p>No dated developments have been recorded here yet.</p>}
                {result?.facts.slice(0, historyLimit).map((f) => (
                  <div className="place-fact" key={f.id}>
                    <time>{date(f.month)}</time>
                    <h5>{f.title}</h5>
                    <p>{f.detail}</p>
                    <small>
                      {f.source === 'initial'
                        ? 'Initial observation'
                        : f.source === 'legacy'
                          ? 'Recovered from an earlier save'
                          : 'Recorded development'}
                      {!f.places.includes(p.id) ? ' · Surrounding province' : ''}
                    </small>
                  </div>
                ))}
                {(result?.facts.length ?? 0) > historyLimit && (
                  <button className="text-button" onClick={() => setHistoryLimit((n) => n + 30)}>
                    Read older records
                  </button>
                )}
              </section>
              {result && result.month < currentMonth && (
                <p className="panel-note">
                  This dossier reflects {date(result.month)}.{' '}
                  <button
                    className="text-button"
                    onClick={() => onQuery({ search, kind: kind || undefined, place: selected, offset })}
                  >
                    Refresh records
                  </button>
                </p>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  )
}
