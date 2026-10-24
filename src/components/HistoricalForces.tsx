import { useState } from 'react'
import { dateLabel, type World, type SimEvent } from '../sim/types'
import { describeEffect, effectStrength, EFFECT_LABELS } from '../sim/effects'

export function HistoricalForces({ world, nation }: { world: World; nation: number }) {
  const [expanded, setExpanded] = useState(false),
    state = world.historical,
    society = state?.societies.find((entry) => entry.nation === nation),
    effects =
      state?.effects.filter(
        ({ effect }) =>
          effect.scope === 'world' ||
          (effect.scope === 'nation' && effect.target === nation) ||
          (effect.scope === 'region' && world.regions[effect.target].nation === nation),
      ) ?? [],
    legacies = state?.legacies.filter((entry) => entry.nation === nation).slice(0, 4) ?? []
  return (
    <section className="historical-forces" aria-label="Historical forces">
      <h3>Historical forces</h3>
      {society && (
        <div className="historical-society">
          <strong>{society.leader}</strong>
          <span>Since {dateLabel({ month: society.since, startYear: world.startYear })}</span>
          <p>{society.tradition}</p>
          <div>
            <span>
              Cultural prestige <b>{Math.round(society.prestige)} / 100</b>
            </span>
            <span>
              Pluralism <b>{Math.round(society.pluralism)} / 100</b>
            </span>
          </div>
        </div>
      )}
      {effects.length === 0 ? (
        <p className="panel-note">No lasting historical effects are active in this state.</p>
      ) : (
        <div className="historical-effects">
          {(expanded ? effects : effects.slice(0, 7)).map((active) => {
            const future = active.start > world.month,
              strength = effectStrength(active, world.month),
              location =
                active.effect.scope === 'region'
                  ? world.regions[active.effect.target].name
                  : active.effect.scope === 'world'
                    ? 'Worldwide'
                    : world.nations[active.effect.target].shortName
            return (
              <article key={active.id}>
                <div>
                  <strong>{EFFECT_LABELS[active.effect.stat]}</strong>
                  <b>
                    {future
                      ? 'Pending'
                      : active.effect.kind === 'modifier'
                        ? `${strength >= 0 ? '+' : ''}${(strength * 100).toFixed(1)}%`
                        : 'Scheduled'}
                  </b>
                </div>
                <p>{active.title}</p>
                <small>
                  {location} ·{' '}
                  {future
                    ? `Begins ${dateLabel({ month: active.start, startYear: world.startYear })}`
                    : `Through ${dateLabel({ month: active.end - 1, startYear: world.startYear })}`}
                  {active.effect.curve !== 'steady'
                    ? ` · ${active.effect.curve === 'fade' ? 'Fading' : 'Building'}`
                    : ''}
                </small>
              </article>
            )
          })}
          {effects.length > 7 && (
            <button className="text-button" onClick={() => setExpanded((value) => !value)}>
              {expanded ? 'Show fewer effects' : `Show all ${effects.length} effects`}
            </button>
          )}
        </div>
      )}
      {!!legacies.length && (
        <div className="historical-legacies">
          <h4>Cultural memory</h4>
          {legacies.map((entry, index) => (
            <p key={`${entry.event}-${index}`}>
              <span>
                {entry.kind === 'literature'
                  ? 'Literature'
                  : entry.kind === 'belief'
                    ? 'Belief'
                    : 'Institution'}
              </span>
              {entry.name}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

export function HistoricalConsequences({
  event,
  world,
  onExpand,
  pending,
}: {
  event: SimEvent
  world: World
  onExpand: (id: number) => void
  pending: boolean
}) {
  const historical = event.historical
  if (!historical) return null
  const cause = world.events.find((entry) => entry.id === historical.causeEvent)
  const account = event.expandedAccount || (event.detail.length > 520 ? event.detail : '')
  return (
    <div className="historical-consequences">
      <details
        className="expanded-history"
        onToggle={(toggle) => {
          if (toggle.currentTarget.open && !account && !pending) onExpand(event.id)
        }}
      >
        <summary>More detail</summary>
        {!account && !pending && (
          <button className="text-button" onClick={() => onExpand(event.id)}>
            Expand account
          </button>
        )}
        {account ? (
          <p>{account}</p>
        ) : (
          <p>
            {pending
              ? 'Developing the fuller historical account…'
              : 'OpenRouter will expand this account when available.'}
          </p>
        )}
        {historical.response && (
          <p>
            <strong>{historical.response}.</strong> {historical.rationale}
          </p>
        )}
      </details>
      {historical.response && (
        <div className="historical-response">
          <strong>Government response: {historical.response}</strong>
        </div>
      )}
      {cause && (
        <a className="historical-cause" href={`#history-event-${cause.id}`}>
          Following: {cause.title}
        </a>
      )}
      <details>
        <summary>Consequences · {historical.effects.length}</summary>
        <ul>
          {historical.effects.map((effect, index) => (
            <li key={index}>
              {describeEffect(effect)}
              <small>
                {effect.scope === 'world'
                  ? 'Worldwide'
                  : effect.scope === 'region'
                    ? world.regions[effect.target].name
                    : effect.scope === 'relation'
                      ? `${world.nations[effect.target].shortName}–${world.nations[effect.other].shortName}`
                      : world.nations[effect.target].shortName}
              </small>
            </li>
          ))}
        </ul>
        <p className="historical-provenance">
          {historical.source === 'openrouter'
            ? `Generated with ${historical.model}`
            : historical.source === 'procedural'
              ? 'Contextual simulation event'
              : 'A consequence of an earlier historical event'}
        </p>
      </details>
    </div>
  )
}
