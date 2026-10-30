/** Host permissions and negotiated requests share the existing bilateral dossier. */
import { useState } from 'react'
import { diplomaticAccessView } from '../sim/agreements'
import { borderPolicy, type BorderPolicy } from '../sim/border-policy'
import { tradePolicy } from '../sim/trade-policy'
import { relation, type Command, type World } from '../sim/types'
import { describeClause } from './DiplomaticChancery'

type AgreementKind = Extract<Command, { type: 'access-proposal' }>['kind']
const agreementLabels: Record<AgreementKind, string> = {
  transit: 'Military transit',
  access: 'Transit and resupply',
  basing: 'Permanent military basing',
  'preferential-trade': 'Preferential trade (half tariffs)',
}

/** Commands retain the same validation and consent rules as autonomous governments. */
export function BorderAccess({
  world,
  nation,
  target,
  command,
}: {
  world: World
  nation: number
  target: number
  command: (c: Command) => void
}) {
  const [kind, setKind] = useState<AgreementKind>('transit'),
    [duration, setDuration] = useState(0),
    [regions, setRegions] = useState<number[]>([])
  const rel = relation(world, nation, target)!,
    policy = borderPolicy(rel, nation),
    foreign = borderPolicy(rel, target),
    access = diplomaticAccessView(world),
    trade = tradePolicy(world),
    war = rel.treaty === 'war',
    other = world.nations[target].shortName
  const update = (patch: Partial<BorderPolicy>) =>
    command({ type: 'border-policy', nation, target, policy: { ...policy, ...patch } })
  const proposals =
    world.statecraft?.offers.filter(
      (o) =>
        o.status === 'proposed' &&
        o.parties.includes(nation) &&
        o.parties.includes(target) &&
        !o.signatures.some((s) => s.nation === nation) &&
        o.terms.every((t) => ['transit', 'access', 'basing', 'preferential-trade', 'trade'].includes(t.kind)),
    ) ?? []
  const permitted = world.regions.filter(
    (r) => r.nation === target && access(nation, target, 'transit', r.id),
  )
  return (
    <section className="border-access" aria-label="Trade and military access">
      <h3>Trade and military access</h3>
      {war && (
        <p className="panel-note">
          At war: formal trade and peaceful military access are suspended, regardless of agreements or
          permissions below.
        </p>
      )}
      <div className="data-row">
        <span>Trade with {other}</span>
        <b>
          {!trade.allowed(nation, target)
            ? 'Closed'
            : trade.restricted(nation, target)
              ? 'Restricted'
              : 'Open'}
        </b>
      </div>
      <div className="data-row">
        <span>Your troops in {other}</span>
        <b>{!permitted.length ? 'No access' : `${permitted.length} provinces`}</b>
      </div>
      <label className="select-label">
        Your trade policy toward {other}
        <select
          value={policy.trade}
          onChange={(e) => update({ trade: e.target.value as BorderPolicy['trade'] })}
        >
          <option value="normal">Normal trade and treaty tariffs</option>
          <option value="restricted">Restrict trade and prohibit arms</option>
          <option value="embargo">Embargo trade and commercial transit</option>
        </select>
      </label>
      <p className="panel-note">
        Restrictions limit each route to 20% of normal capacity, prohibit arms and add 25 tariff points. An
        embargo closes imports, exports and transit. {other} currently applies{' '}
        {foreign.trade === 'normal'
          ? 'normal trade rules'
          : foreign.trade === 'embargo'
            ? 'an embargo'
            : 'trade restrictions'}{' '}
        toward you.
      </p>
      <label className="select-label">
        Their troops on your territory
        <select
          value={policy.military}
          onChange={(e) => update({ military: e.target.value as BorderPolicy['military'] })}
        >
          <option value="treaties">Follow existing agreements</option>
          <option value="closed">Deny access and require withdrawal</option>
          <option value="transit">Transit only</option>
          <option value="supply">Transit and resupply</option>
          <option value="basing">Allow permanent basing</option>
        </select>
      </label>
      <p className="panel-note">
        Transit and resupply permit visits of up to three months. Permanent stations need basing rights.
        Revoked or overstaying troops must find a physical route home.
      </p>
      <details>
        <summary>Negotiate access or preferential trade</summary>
        <label className="select-label">
          Agreement
          <select value={kind} onChange={(e) => setKind(e.target.value as AgreementKind)}>
            {Object.entries(agreementLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="select-label">
          Term
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            <option value={0}>Standing agreement</option>
            <option value={12}>One year</option>
            <option value={60}>Five years</option>
            <option value={120}>Ten years</option>
          </select>
        </label>
        {kind !== 'preferential-trade' && (
          <label className="select-label">
            Host provinces (none selected means all)
            <select
              multiple
              size={4}
              value={regions.map(String)}
              onChange={(e) => setRegions(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
            >
              {world.regions
                .filter((r) => r.nation === target)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <p className="panel-note">
          {kind === 'preferential-trade'
            ? 'Reduce both states’ normal tariffs by half. Free trade and customs unions remove them entirely.'
            : `Request permission for your forces to enter ${other}. Named provinces form the permitted corridor or basing area.`}{' '}
          The other government must sign. Explicit border restrictions still take precedence.
        </p>
        <button
          className="button full"
          disabled={war}
          onClick={() => command({ type: 'access-proposal', nation, target, kind, duration, regions })}
        >
          Propose agreement
        </button>
      </details>
      {proposals.map((offer) => (
        <div className="diplomatic-document" key={offer.id}>
          <h4>{offer.title}</h4>
          {offer.terms.map((term, index) => (
            <p key={index}>{describeClause(world, term)}</p>
          ))}
          <p>Awaiting your government’s decision.</p>
          <div className="action-grid">
            <button
              className="button"
              onClick={() => command({ type: 'access-answer', nation, offer: offer.id, accept: true })}
            >
              Sign terms
            </button>
            <button
              className="button secondary"
              onClick={() => command({ type: 'access-answer', nation, offer: offer.id, accept: false })}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
