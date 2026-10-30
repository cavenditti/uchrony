/** The bilateral dossier keeps influence, voluntary royal agreements and the
 * victor's settlement authority beside the existing peace controls. */
import { useState } from 'react'
import {
  CAPITULATION_LABELS,
  CAPITULATION_OUTCOMES,
  capitulationQuote,
  type CapitulationOutcome,
} from '../sim/capitulation'
import {
  crownOf,
  isMonarchy,
  marriageOf,
  royalAgreementObstacle,
  type RoyalAgreement,
} from '../sim/dynasties'
import { dependencyOf, diplomaticInfluence } from '../sim/state-dependencies'
import { relation, type Command, type World } from '../sim/types'

type Props = { world: World; nation: number; target: number; command: (c: Command) => void }

/** Consequences are visible before a settlement is imposed; there is no defeated-state veto. */
export function CapitulationPanel({ world, nation, target, command }: Props) {
  const [outcome, setOutcome] = useState<CapitulationOutcome>('annex')
  const [indemnity, setIndemnity] = useState('50')
  const quote = capitulationQuote(world, nation, target, outcome)
  const percent = Number(indemnity)
  const effects: Record<CapitulationOutcome, string> = {
    annex: `Absorb the remaining provinces, public treasury, assets and debt. Defeated forces demobilize; local resistance remains. Administration costs ${quote.cost.toLocaleString(undefined, { maximumFractionDigits: 3 })}k crowns.`,
    subject:
      'Keep a separate government under your foreign-policy authority. Its forces demobilize, it pays the selected indemnity and owes 15% of public receipts as tribute.',
    'personal-union':
      'Place both monarchies under your ruler. Territory, laws, debts, treasuries and forces remain separate. The junior crown follows your offensive foreign policy and pays the selected indemnity.',
    independence:
      'Demobilize the defeated forces, collect the selected indemnity, withdraw your occupiers and restore independent government under a five-year truce.',
  }
  return (
    <section className="peace-negotiation" aria-label="Capitulation settlement">
      <h3>Dictate capitulation</h3>
      <p className="panel-note">
        Secure occupation of every remaining province and two-to-one effective field strength give you
        settlement authority. The defeated government cannot veto your terms.
      </p>
      <label className="select-label">
        Settlement
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as CapitulationOutcome)}>
          {CAPITULATION_OUTCOMES.map((kind) => (
            <option key={kind} value={kind}>
              {CAPITULATION_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>
      {outcome !== 'annex' && (
        <label className="select-label">
          Indemnity, % of remaining treasury
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={indemnity}
            onChange={(e) => setIndemnity(e.target.value)}
          />
        </label>
      )}
      <p>{effects[outcome]}</p>
      {quote.obstacle && <p className="panel-note">{quote.obstacle}</p>}
      <button
        className="button full"
        disabled={
          !!quote.obstacle ||
          (outcome !== 'annex' && (!Number.isFinite(percent) || percent < 0 || percent > 100))
        }
        onClick={() =>
          command({
            type: 'capitulate',
            nation,
            target,
            outcome,
            indemnity: outcome === 'annex' ? 1 : percent / 100,
          })
        }
      >
        Impose settlement
      </button>
    </section>
  )
}

/** Royal proposals retain explicit signatures and explain which crown will be senior. */
export function SovereignRelations({ world, nation, target, command }: Props) {
  const war = relation(world, nation, target)?.treaty === 'war'
  const marriage = marriageOf(world, nation, target)
  const tie = [dependencyOf(world, nation), dependencyOf(world, target)].find(
    (d) => d && [nation, target].includes(d.senior),
  )
  const monarchies = isMonarchy(world, nation) && isMonarchy(world, target)
  const crown = crownOf(world, nation)
  const proposals =
    world.statecraft?.offers.filter(
      (o) =>
        o.status === 'proposed' &&
        o.parties.includes(nation) &&
        o.parties.includes(target) &&
        o.terms.some((t) => t.kind === 'royal-marriage' || t.kind === 'personal-union'),
    ) ?? []
  return (
    <>
      {tie && (
        <p className="panel-note">
          {world.nations[tie.junior].shortName} is{' '}
          {tie.kind === 'personal-union' ? 'the junior crown in a personal union with' : 'a subject of'}{' '}
          {world.nations[tie.senior].shortName}.{' '}
          {tie.kind === 'subject'
            ? 'Tribute: 15% of public receipts.'
            : `Shared ruler: ${world.nations[tie.senior].character?.leader.name ?? 'the senior sovereign'}.`}
        </p>
      )}
      {war ? (
        <CapitulationPanel world={world} nation={nation} target={target} command={command} />
      ) : (
        monarchies && (
          <section className="peace-negotiation" aria-label="Royal diplomacy">
            <h3>Royal diplomacy</h3>
            <div className="data-row">
              <span>Your influence</span>
              <b>{Math.round(diplomaticInfluence(world, nation, target))} / 100</b>
            </div>
            {crown && (
              <p className="panel-note">
                {crown.house}. {crown.heir ? `Heir: ${crown.heir}.` : 'No direct heir is designated.'}
              </p>
            )}
            {marriage ? (
              <p>
                {marriage.royalA} and {marriage.royalB} join the two houses. Their marriage sustains relations
                and provides a claim if a crown has no direct heir.
              </p>
            ) : (
              <p className="panel-note">
                Marriage builds lasting diplomatic ties. It creates an inheritance claim when no direct heir
                remains.
              </p>
            )}
            {(['royal-marriage', 'personal-union'] as RoyalAgreement[]).map((kind) => {
              const obstacle = royalAgreementObstacle(world, kind, nation, target)
              return (
                <div key={kind}>
                  {kind === 'personal-union' && (
                    <p className="panel-note">
                      A union makes {world.nations[nation].shortName} the senior crown. Both states keep their
                      own treasuries and laws.
                    </p>
                  )}
                  <button
                    className="button full"
                    disabled={!!obstacle}
                    onClick={() => command({ type: 'royal-proposal', nation, target, kind })}
                  >
                    {kind === 'royal-marriage' ? 'Propose a royal marriage' : 'Propose a personal union'}
                  </button>
                  {obstacle && <p className="panel-note">{obstacle}</p>}
                </div>
              )
            })}
            {proposals.map((offer) => (
              <div key={offer.id}>
                <h4>{offer.title}</h4>
                <p>{offer.terms.map((t) => t.text).join(' ')}</p>
                <p className="panel-note">
                  Signed: {offer.signatures.map((s) => world.nations[s.nation].shortName).join(', ')}. Both
                  signatures and diplomatic preparation are required.
                </p>
                {!offer.signatures.some((s) => s.nation === nation) && (
                  <button
                    className="button"
                    onClick={() => command({ type: 'royal-answer', nation, offer: offer.id, accept: true })}
                  >
                    Accept royal agreement
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => command({ type: 'royal-answer', nation, offer: offer.id, accept: false })}
                >
                  Decline royal agreement
                </button>
              </div>
            ))}
          </section>
        )
      )}
    </>
  )
}
