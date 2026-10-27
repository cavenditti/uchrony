import { useEffect, useState } from 'react'
import {
  MODEL_TASKS,
  type ModelTask,
  type ModelSettings,
  type ModelServiceSnapshot,
} from '../sim/model-tasks'

export function ModelAssignments({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<ModelServiceSnapshot | null>(null)
  const [draft, setDraft] = useState<ModelSettings | null>(null)
  const [filter, setFilter] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving'>('loading')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = async (signal?: AbortSignal) => {
    setState('loading')
    setError('')
    try {
      const response = await fetch('/api/history/models', { signal })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load model assignments.')
      setData(body)
      setDraft(structuredClone(body.settings))
      setState('ready')
    } catch (e) {
      if (!signal?.aborted) {
        setError(e instanceof Error ? e.message : 'Connection failed.')
        setState('ready')
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [])
  const change = (task: ModelTask, key: 'model' | 'preference', value: string) => {
    if (!draft) return
    setMessage('')
    setDraft({
      ...draft,
      assignments: { ...draft.assignments, [task]: { ...draft.assignments[task], [key]: value } },
    })
  }
  return (
    <div className="model-assignments">
      <h2 id="dialog-title">Model assignments</h2>
      <p>
        Choose who handles each task. Assignments apply to new requests in every tab. LLM assistance remains
        controlled by the world menu.
      </p>
      {state === 'loading' && <p role="status">Loading assignments and the model catalog…</p>}
      {error && (
        <p className="negative" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => void load()}>
            Retry connection
          </button>
        </p>
      )}
      {draft && data && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setState('saving')
            setError('')
            setMessage('')
            try {
              const response = await fetch('/api/history/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft),
              })
              const body = await response.json()
              if (!response.ok) throw new Error(body.error || 'Assignments could not be saved.')
              setData(body)
              setDraft(structuredClone(body.settings))
              setMessage('Assignments saved. New requests use these choices.')
              onSaved()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not save assignments.')
            } finally {
              setState('ready')
            }
          }}
        >
          <fieldset
            className="assignment-fields"
            disabled={state !== 'ready'}
            aria-label="Model choices and limits"
          >
            {data.catalogError && <p role="status">{data.catalogError}</p>}
            <label className="select-label">
              Find models
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search model names or providers"
              />
            </label>
            <p className="panel-note">
              Choices advertise JSON or structured output. Capability support does not establish writing or
              reasoning quality. Test a few accounts before enabling broad generation.
            </p>
            {(['World writing', 'Simulation'] as const).map((group) => (
              <section key={group} className="assignment-group">
                <h3>{group}</h3>
                {(Object.entries(MODEL_TASKS) as [ModelTask, (typeof MODEL_TASKS)[ModelTask]][])
                  .filter(([, t]) => t.group === group)
                  .map(([task, info]) => {
                    const assignment = draft.assignments[task],
                      selected = data.models.find((m) => m.id === assignment.model),
                      measured = data.measurements[assignment.model]
                    const options = data.models.filter(
                      (m) =>
                        (m.json || m.structured) &&
                        (!m.outputLimit || m.outputLimit >= info.tokens) &&
                        `${m.name} ${m.id}`.toLowerCase().includes(filter.toLowerCase()),
                    )
                    if (selected && !options.includes(selected)) options.unshift(selected)
                    return (
                      <div className="assignment-row" key={task}>
                        <div>
                          <label htmlFor={`model-${task}`}>{info.label}</label>
                          <p>{info.description}</p>
                        </div>
                        <div className="assignment-choice">
                          <select
                            id={`model-${task}`}
                            value={assignment.model}
                            onChange={(e) => change(task, 'model', e.target.value)}
                          >
                            {!selected && (
                              <option value={assignment.model}>
                                {assignment.model} · catalog unavailable
                              </option>
                            )}
                            {options.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                                {m.structured ? ' · structured' : ' · JSON'}
                              </option>
                            ))}
                          </select>
                          <label className="assignment-preference">
                            Provider priority
                            <select
                              aria-label={`${info.label}: provider priority`}
                              value={assignment.preference}
                              onChange={(e) => change(task, 'preference', e.target.value)}
                            >
                              <option value="price">Lowest price</option>
                              <option value="latency">Fastest first response</option>
                              <option value="throughput">Fastest generation</option>
                            </select>
                          </label>
                          <p className="model-evidence">
                            {selected
                              ? `${Math.round(selected.context / 1000)}k context · ${selected.structured ? 'Structured output' : 'JSON output'} · ${selected.inputPrice === null ? 'Unknown input price' : `$${selected.inputPrice.toFixed(3)} input`} / ${selected.outputPrice === null ? 'unknown output price' : `$${selected.outputPrice.toFixed(3)} output`} per million tokens`
                              : 'Capabilities and price are unverified.'}
                          </p>
                          <p className="model-evidence">
                            {measured
                              ? `${measured.calls} requests · ${(measured.elapsedMs / measured.calls / 1000).toFixed(1)}s average completion · ${(measured.outputTokens / Math.max(1, measured.elapsedMs / 1000)).toFixed(1)} output tokens/s overall · ${measured.failures} failures`
                              : 'No measured requests in this server session.'}
                          </p>
                        </div>
                      </div>
                    )
                  })}
              </section>
            ))}
            <fieldset className="writing-budget">
              <legend>Background work and limits</legend>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.backgroundWriting}
                  onChange={(e) => setDraft({ ...draft, backgroundWriting: e.target.checked })}
                />
                Enrich names and naming traditions in the background
              </label>
              <div className="form-columns">
                <label className="select-label">
                  Minimum seconds between enrichment requests
                  <input
                    type="number"
                    min="30"
                    max="3600"
                    required
                    value={draft.backgroundInterval}
                    onChange={(e) => setDraft({ ...draft, backgroundInterval: Number(e.target.value) })}
                  />
                </label>
                <label className="select-label">
                  Maximum calls this server session
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    required
                    value={draft.sessionCallLimit}
                    onChange={(e) => setDraft({ ...draft, sessionCallLimit: Number(e.target.value) })}
                  />
                </label>
              </div>
              <p>
                {data.calls} calls used, including retries. The counter resets when the local server restarts.
                Reading expansions run when requested; the simulation continues at the limit.
              </p>
              <p>
                Reported cost: $
                {Object.values(data.measurements)
                  .reduce((n, m) => n + m.cost, 0)
                  .toFixed(4)}
                {Object.values(data.measurements).some((m) => !m.costKnown)
                  ? ' · some requests have no cost report'
                  : ''}
                . Prices and provider speed can change.
              </p>
            </fieldset>
            <div className="assignment-actions">
              <button className="button primary" disabled={state !== 'ready'} type="submit">
                {state === 'saving' ? 'Saving…' : 'Save assignments'}
              </button>
              <span role="status">{message}</span>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  )
}
