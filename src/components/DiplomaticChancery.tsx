import { inWorldText } from '../sim/narrative'
import { useEffect, useRef, useState } from 'react'
import { dateLabel, type World } from '../sim/types'
import type { DiplomaticClause, AgentServiceStatus } from '../sim/statecraft-types'
import { visibleAgreement } from '../sim/agreement-references'
import { AgreementReference, AgreementText } from './AgreementReference'
import { foreignOfficeContext } from '../sim/diplomatic-friction'

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
    case 'royal-marriage':
      return `${from} and ${to} join their royal houses by marriage.`
    case 'personal-union':
      return `${to} shares ${from}’s ruler while retaining separate territory and accounts.`
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
  const [confidentialFor, setConfidentialFor] = useState<number | null>(null)
  const [navigation, setNavigation] = useState({ scope: '', ids: [] as number[], position: -1 })
  const selectedRef = useRef<HTMLElement>(null),
    agreementsHeading = useRef<HTMLHeadingElement>(null)
  const confidential = confidentialFor === nation,
    scope = `${nation}:${confidential}`
  const state = world.statecraft,
    agent = state?.agents.find((entry) => entry.nation === nation),
    offers =
      state?.offers
        .filter((offer) => offer.visibility === 'public' || (confidential && offer.parties.includes(nation)))
        .sort((a, b) => b.month - a.month || b.id - a.id)
        .slice(0, 12) ?? [],
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
  const selected =
    navigation.scope === scope
      ? visibleAgreement(state?.offers ?? [], navigation.ids[navigation.position], nation, confidential)
      : undefined
  const documents = selected ? [selected, ...offers.filter((offer) => offer.id !== selected.id)] : offers
  useEffect(() => {
    if (!selected) return
    selectedRef.current?.focus({ preventScroll: true })
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected?.id])
  const onOpen = (id: number) => {
    if (!visibleAgreement(state?.offers ?? [], id, nation, confidential)) return
    setNavigation((previous) => {
      if (previous.scope === scope && previous.ids[previous.position] === id) return previous
      const ids = [
        ...(previous.scope === scope ? previous.ids.slice(0, previous.position + 1) : []),
        id,
      ].slice(-40)
      return { scope, ids, position: ids.length - 1 }
    })
  }
  const referenceProps = { world, nation, confidential, onOpen }
  const office = foreignOfficeContext(world, nation)
  const text = (value: string) => <AgreementText {...referenceProps} text={value} />
  return (
    <section className="diplomatic-chancery">
      <h3>State agency</h3>
      <div className="data-row">
        <span>Diplomatic attention committed</span>
        <b>{Math.round((office.committed / office.capacity) * 100)}%</b>
      </div>
      <div className="data-row">
        <span>Foreign office spending this month</span>
        <b>{Math.round(office.spent * 1000).toLocaleString()} crowns</b>
      </div>
      <p className="panel-note">
        Negotiations occupy envoys and require dispatches, review and public funds. Existing arrangements
        remain in force without repeated agreements.
      </p>
      {office.notice && <p className="panel-note">{office.notice}</p>}
      <p className="panel-note">
        {working
          ? `${working.role === 'strategy' ? 'Strategic deliberation' : 'Routine assessment'} in progress.`
          : 'Government instructions remain in force while its agents deliberate.'}{' '}
        The simulation continues in the background.
      </p>
      {agent && (
        <>
          <p className="agent-assessment">{text(agent.assessment)}</p>
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
          onChange={(event) => setConfidentialFor(event.target.checked ? nation : null)}
        />
        Inspect this state's confidential archive
      </label>
      {confidential && agent && (
        <details className="agent-private-plan">
          <summary>Private strategy and institutional record</summary>
          <p>{text(agent.strategy)}</p>
          <ul>
            {agent.goals.map((goal, index) => (
              <li key={index}>{text(goal)}</li>
            ))}
          </ul>
          <p>{text(agent.memory)}</p>
          <small>
            Government credibility: {agent.integrity}/100 · {agent.lastModel || 'Awaiting first deliberation'}
          </small>
          {state?.audit
            .filter((entry) => entry.nation === nation)
            .slice(0, 3)
            .map((entry) => (
              <p key={entry.id}>{text(entry.message)}</p>
            ))}
        </details>
      )}
      <h4 ref={agreementsHeading} tabIndex={-1}>
        Agreements and proposals
      </h4>
      {!offers.length && <p className="panel-note">No diplomatic proposals have been recorded yet.</p>}
      {documents.map((offer) => (
        <article
          className={`diplomatic-document ${selected?.id === offer.id ? 'referenced-agreement' : ''}`}
          id={`agreement-${offer.id}`}
          key={offer.id}
          ref={selected?.id === offer.id ? selectedRef : undefined}
          tabIndex={selected?.id === offer.id ? -1 : undefined}
        >
          {selected?.id === offer.id && (
            <nav className="agreement-navigation" aria-label="Agreement reference history">
              <button
                className="text-button"
                disabled={navigation.position < 1}
                onClick={() => setNavigation({ ...navigation, position: navigation.position - 1 })}
              >
                Back
              </button>
              <button
                className="text-button"
                disabled={navigation.position >= navigation.ids.length - 1}
                onClick={() => setNavigation({ ...navigation, position: navigation.position + 1 })}
              >
                Forward
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setNavigation({ scope, ids: [], position: -1 })
                  agreementsHeading.current?.focus({ preventScroll: true })
                }}
              >
                Close reference
              </button>
            </nav>
          )}
          <div>
            <small>
              {offer.visibility === 'secret' ? 'Confidential' : 'Public'} · {offer.status}
            </small>
            <time>{dateLabel({ month: offer.month, startYear: world.startYear })}</time>
          </div>
          <h5>{text(offer.title)}</h5>
          <p>{offer.parties.map((id) => world.nations[id].shortName).join(' · ')}</p>
          {offer.status === 'proposed' && offer.notBefore !== undefined && offer.notBefore > world.month && (
            <p className="panel-note">
              Diplomatic preparation · earliest implementation{' '}
              {dateLabel({ month: offer.notBefore, startYear: world.startYear })}, subject to consent.
            </p>
          )}
          {offer.status === 'proposed' && offer.nativeReview && (
            <p className="panel-note">{offer.nativeReview}</p>
          )}
          {!!offer.supersedes && (
            <p className="agreement-relationship">
              Revises <AgreementReference {...referenceProps} id={offer.supersedes} />
            </p>
          )}
          <details open={selected?.id === offer.id ? true : undefined}>
            <summary>Terms and developments</summary>
            <ul>
              {offer.terms.map((term, index) => (
                <li key={index}>
                  {text(describe(world, term))}
                  {term.text && !describe(world, term).includes(term.text) && (
                    <small className="agreement-clause-note">{text(term.text)}</small>
                  )}
                </li>
              ))}
            </ul>
            <p>
              Accepted by{' '}
              {offer.signatures.map((signature) => world.nations[signature.nation].shortName).join(', ')}.
            </p>
            {offer.ruling && <p className="agreement-development">Development: {text(offer.ruling)}</p>}
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
          <h5>{text(message.subject)}</h5>
          <p className="message-parties">
            {world.nations[message.from].shortName} →{' '}
            {message.to.map((id) => world.nations[id].shortName).join(', ')}
          </p>
          <p>{text(message.body)}</p>
          {!!message.offer && (
            <p className="agreement-relationship">
              Regarding <AgreementReference {...referenceProps} id={message.offer} />
            </p>
          )}
        </article>
      ))}
      {!!status.error && (
        <p className="panel-note">
          Model service: {inWorldText(status.error)} Existing instructions and local events continue.
        </p>
      )}
    </section>
  )
}
