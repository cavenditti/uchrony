import { useState } from 'react'
import type { Command, World } from '../sim/types'

export function PeaceNegotiation({
  world: w,
  nation,
  target,
  command,
}: {
  world: World
  nation: number
  target: number
  command: (c: Command) => void
}) {
  const [payer, setPayer] = useState(nation),
    [payment, setPayment] = useState('0'),
    [territory, setTerritory] = useState('')
  const proposals =
    w.statecraft?.offers.filter(
      (p) =>
        p.status === 'proposed' &&
        p.parties.includes(nation) &&
        p.parties.includes(target) &&
        p.terms.some((t) => t.kind === 'peace'),
    ) ?? []
  const amount = Number(payment)
  return (
    <section className="peace-negotiation" aria-label="Peace negotiations">
      <h3>Negotiate peace</h3>
      <p className="panel-note">
        Offer compensation or a province in exchange for a five-year truce. Each government must sign. Armies
        withdraw from land that is not ceded.
      </p>
      <label className="select-label">
        Compensation paid by
        <select value={payer} onChange={(e) => setPayer(Number(e.target.value))}>
          {[nation, target].map((id) => (
            <option key={id} value={id}>
              {w.nations[id].shortName}
            </option>
          ))}
        </select>
      </label>
      <label className="select-label">
        One-time payment, k crowns
        <input
          type="number"
          min="0"
          step="0.1"
          value={payment}
          onChange={(e) => setPayment(e.target.value)}
        />
      </label>
      <label className="select-label">
        Territorial concession
        <select value={territory} onChange={(e) => setTerritory(e.target.value)}>
          <option value="">No territory</option>
          {w.regions
            .filter((r) => [nation, target].includes(r.nation))
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}: {w.nations[r.nation].shortName} →{' '}
                {w.nations[r.nation === nation ? target : nation].shortName}
              </option>
            ))}
        </select>
      </label>
      <button
        className="button full"
        disabled={!Number.isFinite(amount) || amount < 0 || amount > 1e12}
        onClick={() =>
          command({
            type: 'peace-proposal',
            nation,
            target,
            payer,
            payment: amount,
            cede: territory === '' ? [] : [Number(territory)],
          })
        }
      >
        Propose these terms
      </button>
      {proposals.map((p) => (
        <div key={p.id}>
          <h4>{p.title}</h4>
          <ul>
            {p.terms.map((t, i) => (
              <li key={i}>
                {t.kind === 'peace'
                  ? 'Five-year truce and withdrawal'
                  : t.kind === 'payment'
                    ? `${w.nations[t.from].shortName} pays ${t.amount.toLocaleString(undefined, { maximumFractionDigits: 3 })}k to ${w.nations[t.to].shortName}`
                    : t.kind === 'cede'
                      ? `${w.nations[t.from].shortName} cedes ${t.regions.map((id) => w.regions[id].name).join(', ')} to ${w.nations[t.to].shortName}`
                      : t.text || t.kind}
              </li>
            ))}
          </ul>
          <p className="panel-note">
            Signed: {p.signatures.map((s) => w.nations[s.nation].shortName).join(', ') || 'none'}
          </p>
          {!p.signatures.some((s) => s.nation === nation) && (
            <button
              className="button"
              onClick={() => command({ type: 'peace-answer', nation, offer: p.id, accept: true })}
            >
              Accept these terms
            </button>
          )}
          <button
            className="button secondary"
            onClick={() => command({ type: 'peace-answer', nation, offer: p.id, accept: false })}
          >
            Reject proposal
          </button>
        </div>
      ))}
    </section>
  )
}
