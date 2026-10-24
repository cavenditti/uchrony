import { useState } from 'react'
import { dateLabel, type World } from '../sim/types'
import type { DiplomaticClause, AgentServiceStatus } from '../sim/statecraft-types'

function describe(world: World, term: DiplomaticClause) {
  const from = world.nations[term.from]?.shortName ?? 'New state',
    to = world.nations[term.to]?.shortName ?? 'New state',
    places = term.regions.map((id) => world.regions[id]?.name).join(', '),
    duration = term.duration ? ` for ${term.duration} months` : ''
  switch (term.kind) {
    case 'payment':
      return `${from} pays ${to} ${(term.amount * 1000).toLocaleString()} crowns.`
    case 'tribute':
      return `${from} pays ${to} ${(term.amount * 1000).toLocaleString()} crowns monthly${duration}.`
    case 'goods':
      return `${from} supplies ${to} ${term.amount.toLocaleString()} t of ${term.good} monthly${duration}, subject to actual carriage.`
    case 'cede':
      return `${from} transfers ${places} to ${to}.`
    case 'merge':
      return `${from} merges into ${to}${term.text ? ` as ${term.text}` : ''}.`
    case 'create':
      return `${from} establishes ${term.text} in ${places}.`
    case 'research':
      return `${from} shares research in ${term.field} with ${to}${duration}.`
    case 'access':
      return `${from} grants military access to ${to}${duration}.`
    case 'war':
      return `${from} declares war on ${to}.`
    case 'custom':
      return term.text
    default:
      return `${from}–${to}: ${term.kind}${duration}${term.text ? `. ${term.text}` : ''}.`
  }
}
export function DiplomaticChancery({
  world,
  nation,
  status,
  onReview,
}: {
  world: World
  nation: number
  status: AgentServiceStatus
  onReview: (nation: number) => void
}) {
  const [confidential, setConfidential] = useState(false),
    state = world.statecraft,
    agent = state?.agents.find((entry) => entry.nation === nation),
    offers =
      state?.offers
        .filter((offer) => offer.visibility === 'public' || (confidential && offer.parties.includes(nation)))
        .slice(-12)
        .reverse() ?? [],
    messages =
      state?.messages
        .filter(
          (message) =>
            message.visibility === 'public' ||
            (confidential && (message.from === nation || message.to.includes(nation))),
        )
        .slice(-12)
        .reverse() ?? [],
    working = status.active.find((job) => job.nation === nation)
  return (
    <section className="diplomatic-chancery">
      <h3>State agency</h3>
      <p className="panel-note">
        {working
          ? `${working.role === 'strategy' ? 'Strategic deliberation' : 'Routine assessment'} in progress.`
          : 'Government instructions remain in force while its agents deliberate.'}{' '}
        The simulation continues in the background.
      </p>
      {agent && (
        <>
          <p className="agent-assessment">{agent.assessment}</p>
          <div className="data-row">
            <span>Last strategic review</span>
            <b>
              {agent.lastStrategy
                ? dateLabel({ month: agent.lastStrategy, startYear: world.startYear })
                : 'Not yet completed'}
            </b>
          </div>
        </>
      )}
      <button className="button full" onClick={() => onReview(nation)}>
        Request strategic review
      </button>
      <label className="confidential-toggle">
        <input
          type="checkbox"
          checked={confidential}
          onChange={(event) => setConfidential(event.target.checked)}
        />
        Inspect this state's confidential archive
      </label>
      {confidential && agent && (
        <details className="agent-private-plan">
          <summary>Private strategy and institutional record</summary>
          <p>{agent.strategy}</p>
          <ul>
            {agent.goals.map((goal, index) => (
              <li key={index}>{goal}</li>
            ))}
          </ul>
          <p>{agent.memory}</p>
          <small>
            Institutional compliance: {agent.integrity}/100 ·{' '}
            {agent.lastModel || 'Awaiting first deliberation'}
          </small>
          {state?.audit
            .filter((entry) => entry.nation === nation)
            .slice(0, 3)
            .map((entry) => (
              <p key={entry.id}>{entry.message}</p>
            ))}
        </details>
      )}
      <h4>Agreements and proposals</h4>
      {!offers.length && <p className="panel-note">No diplomatic proposals have been recorded yet.</p>}
      {offers.map((offer) => (
        <article className="diplomatic-document" key={offer.id}>
          <div>
            <small>
              {offer.visibility === 'secret' ? 'Confidential' : 'Public'} · {offer.status}
            </small>
            <time>{dateLabel({ month: offer.month, startYear: world.startYear })}</time>
          </div>
          <h5>{offer.title}</h5>
          <p>{offer.parties.map((id) => world.nations[id].shortName).join(' · ')}</p>
          <details>
            <summary>Terms and adjudication</summary>
            <ul>
              {offer.terms.map((term, index) => (
                <li key={index}>{describe(world, term)}</li>
              ))}
            </ul>
            <p>
              Accepted by{' '}
              {offer.signatures.map((signature) => world.nations[signature.nation].shortName).join(', ')}.
            </p>
            {offer.ruling && <p className="referee-explanation">Referee: {offer.ruling}</p>}
            {offer.breaches > 0 && <small>Recorded obligation shortfalls: {offer.breaches}</small>}
          </details>
        </article>
      ))}
      <h4>Diplomatic correspondence</h4>
      {!messages.length && <p className="panel-note">No correspondence has arrived yet.</p>}
      {messages.map((message) => (
        <article className="diplomatic-document" key={message.id}>
          <div>
            <small>{message.visibility === 'secret' ? 'Confidential' : 'Public'}</small>
            <time>{dateLabel({ month: message.month, startYear: world.startYear })}</time>
          </div>
          <h5>{message.subject}</h5>
          <p className="message-parties">
            {world.nations[message.from].shortName} →{' '}
            {message.to.map((id) => world.nations[id].shortName).join(', ')}
          </p>
          <p>{message.body}</p>
        </article>
      ))}
      {!!status.error && (
        <p className="panel-note">
          Model service: {status.error} Existing instructions and local events continue.
        </p>
      )}
    </section>
  )
}
