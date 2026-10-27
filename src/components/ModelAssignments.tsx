import { useEffect, useState } from 'react'
import { MODEL_TIERS, MODEL_TIER_LABELS, assignTier, tierChoices, tierModel } from '../sim/model-presets'
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
  const [view, setView] = useState<'simple' | 'advanced'>('simple')
  const [state, setState] = useState<'loading' | 'ready' | 'saving'>('loading')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = async (signal?: AbortSignal, preserveDraft = false) => {
    setState('loading')
    setError('')
    try {
      const response = await fetch('/api/history/models', { signal })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not load model assignments.')
      setData(body)
      setDraft((current) => (preserveDraft && current ? current : structuredClone(body.settings)))
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
  const groups = MODEL_TIERS.map((tier) => {
    const choices = tierChoices(data?.models ?? [], tier)
    const current = draft ? tierModel(draft, tier) : ''
    return { tier, choices, current, selected: choices.some((model) => model.id === current) ? current : '' }
  })
  const simpleReady = groups.every((group) => group.selected)
  return (
    <div className={`model-assignments ${view === 'simple' ? 'model-assignments-simple' : ''}`}>
      <h2 id="dialog-title">Model assignments</h2>
      <p>
        {view === 'simple'
          ? 'Choose two models. Uchrony assigns each task to the right one.'
          : 'Choose a model and provider priority for each task.'}
      </p>
      {state === 'loading' && <p role="status">Loading assignments and the model catalog…</p>}
      {error && (
        <p className="negative" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => void load(undefined, true)}>
            Retry connection
          </button>
        </p>
      )}
      {draft && data && (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (view === 'simple' && !simpleReady) return
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
            <div className="assignment-view-switch" role="group" aria-label="Assignment view">
              <button type="button" aria-pressed={view === 'simple'} onClick={() => setView('simple')}>
                Simplified
              </button>
              <button type="button" aria-pressed={view === 'advanced'} onClick={() => setView('advanced')}>
                Advanced
              </button>
            </div>
            {data.catalogError && <p role="status">{data.catalogError}</p>}
            {view === 'simple' ? (
              <div className="simple-assignments">
                {groups.map(({ tier, choices, current, selected }) => (
                  <div className="simple-assignment" key={tier}>
                    <label htmlFor={`model-tier-${tier}`}>{MODEL_TIER_LABELS[tier].label}</label>
                    <p id={`model-tier-${tier}-help`}>{MODEL_TIER_LABELS[tier].description}</p>
                    <select
                      id={`model-tier-${tier}`}
                      aria-describedby={`model-tier-${tier}-help`}
                      value={selected}
                      disabled={!choices.length}
                      required
                      onChange={(e) => {
                        setMessage('')
                        setDraft(assignTier(draft, tier, e.target.value))
                      }}
                    >
                      {!selected && (
                        <option value="" disabled>
                          {!choices.length
                            ? 'No recommended models available'
                            : current
                              ? 'Current model is outside this shortlist'
                              : 'Custom assignments — choose one model'}
                        </option>
                      )}
                      {choices.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                    {!choices.length && (
                      <p className="panel-note">
                        Try refreshing the catalog, or manage your saved choices in Advanced.
                      </p>
                    )}
                  </div>
                ))}
                {!simpleReady && (
                  <p className="panel-note">
                    Choose a model for each group to save a simplified setup. Your custom assignments are
                    preserved in Advanced until you change a group.
                  </p>
                )}
                {groups.some((group) => !group.choices.length) && (
                  <button type="button" className="text-button" onClick={() => void load(undefined, true)}>
                    Refresh model catalog
                  </button>
                )}
              </div>
            ) : (
              <>
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
                  Choices advertise JSON or structured output. Capability support does not establish writing
                  or reasoning quality. Test a few accounts before enabling broad generation.
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
                    {data.calls} calls used, including retries. The counter resets when the local server
                    restarts. Reading expansions run when requested; the simulation continues at the limit.
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
              </>
            )}
            <p className="panel-note">
              Applies to new requests in every tab. LLM assistance is controlled separately in the World menu.
            </p>
            <div className="assignment-actions">
              <button
                className="button primary"
                disabled={state !== 'ready' || (view === 'simple' && !simpleReady)}
                type="submit"
              >
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
