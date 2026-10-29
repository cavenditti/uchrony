/** Dated institutional evidence and present-day proposals share the same reading surface. */
import { useState } from 'react'
import { dateLabel, type Command } from '../sim/types'
import { INSTITUTION_POWERS, type Charter } from '../sim/institution-types'
import type { ArchiveDocument, ArchiveResult } from '../sim/world-archive'
import { institutionProposal } from '../sim/archive-presentation'
const number = (v: number) => Math.round(v).toLocaleString()
export function InstitutionDossier({
  result,
  startYear,
  currentMonth,
  controlled,
  onCommand,
  onDate,
  onNation,
  onPage,
}: {
  result: ArchiveResult
  startYear: number
  currentMonth: number
  controlled: number[]
  onCommand: (command: Command) => void
  onDate: (month: number) => void
  onNation: (id: number) => void
  onPage: (offset: number) => void
}) {
  const o = result.selected!
  const date = (month: number) => dateLabel({ startYear, month })
  const stateName = (id: number) => result.nations[id]?.shortName ?? `State ${id}`
  const [operation, setOperation] = useState<Charter['operation']>('rename'),
    [actor, setActor] = useState(controlled[0] ?? -1),
    [voters, setVoters] = useState(o.members.filter((id) => !o.suspended.includes(id))),
    [name, setName] = useState(o.name),
    [target, setTarget] = useState(-1),
    [charter, setCharter] = useState(o.charter)
  const writable = result.month === currentMonth && o.status !== 'dissolved' && controlled.length > 0
  return (
    <article className="institution-dossier">
      <h2>{o.name}</h2>
      <p className="history-state">
        {o.status === 'crisis' ? 'Constitutional crisis' : o.status === 'dissolved' ? 'Dissolved' : 'Active'}{' '}
        · {o.charter.form.replaceAll('-', ' ')}
        {o.visibility === 'secret' && ' · Confidential'}
      </p>
      <p>
        Founded {date(o.founded)}
        {o.dissolved !== undefined && ` · Dissolved ${date(o.dissolved)}`}
      </p>
      {o.crisis && (
        <p className="history-notice">
          {o.crisis.reason} Resolution due {date(o.crisis.due)}.
        </p>
      )}
      <h3>Members</h3>
      <ul className="history-member-list">
        {o.members.map((id) => (
          <li key={id}>
            <button className="text-button" onClick={() => onNation(id)}>
              {stateName(id)}
            </button>
            <span>
              {o.suspended.includes(id)
                ? 'Suspended'
                : o.withdrawals.some((x) => x.nation === id)
                  ? `Leaving ${date(o.withdrawals.find((x) => x.nation === id)!.due)}`
                  : 'Member'}
            </span>
          </li>
        ))}
      </ul>
      <details className="history-call">
        <summary>Membership history</summary>
        {o.memberships.map((m, i) => (
          <p key={i}>
            <button className="text-button" onClick={() => onNation(m.nation)}>
              {stateName(m.nation)}
            </button>{' '}
            · {m.observed ? 'First observed' : 'Joined'} {date(m.since)}
            {m.until !== undefined ? ` — ${date(m.until)} (${m.outcome})` : ' — present at selected date'}
          </p>
        ))}
      </details>
      <h3>Charter at this date</h3>
      <dl className="history-facts">
        <div>
          <dt>Powers</dt>
          <dd>{o.charter.powers.join(', ')}</dd>
        </div>
        <div>
          <dt>Decisions</dt>
          <dd>
            {o.charter.rule === 'weighted'
              ? 'Population-weighted vote (square-root weights)'
              : o.charter.rule}
          </dd>
        </div>
        <div>
          <dt>Contribution</dt>
          <dd>{Math.round(o.charter.contribution * 100)}% of public income</dd>
        </div>
        <div>
          <dt>Withdrawal</dt>
          <dd>{o.charter.exit === 'notice' ? 'Six months’ notice' : 'Free withdrawal'}</dd>
        </div>
        {o.charter.powers.includes('defense') && (
          <div>
            <dt>Defense duty</dt>
            <dd>
              {o.charter.defense === 'military'
                ? 'Deployed forces'
                : o.charter.defense === 'aid'
                  ? 'Delivered financial aid'
                  : 'Deployed forces or delivered aid'}{' '}
              within {o.charter.responseMonths ?? 6} months of notification
            </dd>
          </div>
        )}
        <div>
          <dt>Common treasury</dt>
          <dd>{number(o.treasury)}k crowns</dd>
        </div>
        <div>
          <dt>Latest contributions / grants</dt>
          <dd>
            {number(o.income)}k / {number(o.grants)}k crowns
          </dd>
        </div>
      </dl>
      <details className="history-call">
        <summary>Recent treasury observations</summary>
        <div className="history-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Treasury</th>
                <th>Contributions</th>
                <th>Grants</th>
              </tr>
            </thead>
            <tbody>
              {o.finances.map((f) => (
                <tr key={f.month}>
                  <td>{date(f.month)}</td>
                  <td>{number(f.treasury)}k</td>
                  <td>{number(f.income)}k</td>
                  <td>{number(f.grants)}k</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="subtle">Latest 24 recorded observations, in thousands of crowns.</p>
      </details>
      {o.pending.length > 0 && (
        <>
          <h3>Pending decisions</h3>
          {o.pending.map((p) => (
            <div key={p.id}>
              <InstitutionDocument document={p} stateName={stateName} />
              {writable &&
                controlled
                  .filter((id) => p.parties.includes(id) && !p.signatures.some((s) => s.nation === id))
                  .map((id) => (
                    <div className="history-actions" key={id}>
                      <span>{stateName(id)}</span>
                      <button
                        className="button"
                        onClick={() =>
                          onCommand({ type: 'institution-answer', nation: id, offer: p.id, accept: true })
                        }
                      >
                        Sign proposal
                      </button>
                      <button
                        className="button-secondary"
                        onClick={() =>
                          onCommand({ type: 'institution-answer', nation: id, offer: p.id, accept: false })
                        }
                      >
                        Reject proposal
                      </button>
                    </div>
                  ))}
            </div>
          ))}
        </>
      )}
      <h3>Defense commitments</h3>
      {!o.calls.length && <p className="subtle">No defense calls recorded by this date.</p>}
      {o.calls
        .slice()
        .reverse()
        .map((call) => (
          <details key={call.id} className="history-call" open={call.closed === undefined}>
            <summary>
              {stateName(call.victim)} against {stateName(call.aggressor)} ·{' '}
              {call.closed === undefined ? 'Open' : `Closed ${date(call.closed)}`}
            </summary>
            <p>
              Opened {date(call.opened)}.{' '}
              {call.requirement === 'military'
                ? 'Military assistance required.'
                : call.requirement === 'aid'
                  ? 'Funded assistance required.'
                  : 'Funded assistance or deployed forces required.'}
            </p>
            {!call.responses.length && <p>No eligible member has yet received a report of this attack.</p>}
            {call.responses.map((r) => (
              <div className="history-response" key={r.nation}>
                <strong>
                  {stateName(r.nation)} · {r.status}
                </strong>
                <span>
                  Notified {date(r.notified)} · Due {date(r.due)}
                </span>
                <span>
                  {number(r.aid)}k of {number(r.requiredAid)}k crowns delivered
                  {call.requirement === 'military' ? ' (funding does not fulfill this charter)' : ''}
                </span>
                {writable &&
                  controlled.includes(r.nation) &&
                  r.status === 'pending' &&
                  call.closed === undefined && (
                    <div className="history-actions">
                      {call.requirement !== 'military' && (
                        <button
                          className="button"
                          onClick={() =>
                            onCommand({
                              type: 'institution-defense',
                              institution: o.id,
                              call: call.id,
                              nation: r.nation,
                              response: 'aid',
                            })
                          }
                        >
                          Send required aid
                        </button>
                      )}
                      <button
                        className="button-secondary"
                        onClick={() =>
                          onCommand({
                            type: 'institution-defense',
                            institution: o.id,
                            call: call.id,
                            nation: r.nation,
                            response: 'refuse',
                          })
                        }
                      >
                        Refuse assistance
                      </button>
                    </div>
                  )}
              </div>
            ))}
          </details>
        ))}
      <h3>Institutional history</h3>
      <p className="subtle">
        Names, membership and charter versions are preserved with each decision. Earlier than the first
        observation may be unknown.
      </p>
      <ol className="institution-timeline">
        {o.events.map((e) => (
          <li key={e.id}>
            <button className="text-button" onClick={() => onDate(e.month)}>
              {date(e.month)}
            </button>
            <strong>
              {e.kind.replaceAll('-', ' ')}
              {e.version && e.version.name !== o.name ? ` · ${e.version.name}` : ''}
            </strong>
            <p>{e.detail}</p>
            {e.nations.length > 0 && <p>{e.nations.map(stateName).join(' · ')}</p>}
            {e.offer !== undefined &&
              (o.documents.find((d) => d.id === e.offer) ? (
                <InstitutionDocument
                  document={o.documents.find((d) => d.id === e.offer)!}
                  stateName={stateName}
                />
              ) : (
                <small>Original agreement #{e.offer} is unavailable in this record.</small>
              ))}
            {e.version && (
              <details>
                <summary>Charter and membership at this decision</summary>
                <p>
                  {e.version.name} · {e.version.status}
                </p>
                <p>{e.version.members.map(stateName).join(' · ')}</p>
                <p>
                  {e.version.charter.powers.join(', ')} · {e.version.charter.rule} ·{' '}
                  {Math.round(e.version.charter.contribution * 100)}% contribution
                </p>
              </details>
            )}
          </li>
        ))}
      </ol>
      <div className="history-actions">
        <button
          className="button-secondary"
          disabled={o.offset === 0}
          onClick={() => onPage(Math.max(0, o.offset - 50))}
        >
          Newer decisions
        </button>
        <button
          className="button-secondary"
          disabled={o.offset + 50 >= o.totalEvents}
          onClick={() => onPage(o.offset + 50)}
        >
          Older decisions
        </button>
      </div>
      {writable && (
        <details className="institution-governance">
          <summary>Propose an institutional change</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onCommand(institutionProposal(o, actor, operation, name, target, charter, voters))
            }}
          >
            <label>
              Government
              <select value={actor} onChange={(e) => setActor(Number(e.target.value))}>
                {controlled.map((id) => (
                  <option key={id} value={id}>
                    {stateName(id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Decision
              <select
                value={operation}
                onChange={(e) => setOperation(e.target.value as Charter['operation'])}
              >
                {(['rename', 'join', 'withdraw', 'amend', 'expel', 'reinstate', 'dissolve'] as const).map(
                  (op) => (
                    <option key={op} value={op}>
                      {
                        {
                          rename: 'Rename',
                          join: 'Apply to join',
                          withdraw: 'Withdraw',
                          amend: 'Amend charter',
                          expel: 'Expel suspended member',
                          reinstate: 'Reinstate suspended member',
                          dissolve: 'Dissolve',
                        }[op]
                      }
                    </option>
                  ),
                )}
              </select>
            </label>
            {operation !== 'withdraw' && (
              <fieldset>
                <legend>Governments invited to ratify</legend>
                {o.members
                  .filter((id) => !o.suspended.includes(id))
                  .map((id) => (
                    <label className="checkbox-row" key={id}>
                      <input
                        type="checkbox"
                        checked={voters.includes(id)}
                        onChange={(e) =>
                          setVoters((v) => (e.target.checked ? [...v, id] : v.filter((n) => n !== id)))
                        }
                      />
                      {stateName(id)}
                    </label>
                  ))}
                <p className="subtle">
                  Select the coalition required by the existing voting rule. The proposing government also
                  signs.
                </p>
              </fieldset>
            )}
            {(operation === 'rename' || operation === 'amend') && (
              <label>
                Institution name
                <input value={name} maxLength={140} required onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            {(operation === 'expel' || operation === 'reinstate') && (
              <label>
                Suspended member
                <select required value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                  <option value={-1}>Choose a member</option>
                  {o.suspended.map((id) => (
                    <option value={id} key={id}>
                      {stateName(id)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {operation === 'amend' && (
              <>
                <fieldset>
                  <legend>Delegated powers</legend>
                  {INSTITUTION_POWERS.map((power) => (
                    <label key={power} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={charter.powers.includes(power)}
                        onChange={(e) =>
                          setCharter((c) => ({
                            ...c,
                            powers: e.target.checked
                              ? [...c.powers, power]
                              : c.powers.filter((p) => p !== power),
                          }))
                        }
                      />
                      {power}
                    </label>
                  ))}
                </fieldset>
                <label>
                  Voting rule
                  <select
                    value={charter.rule}
                    onChange={(e) => setCharter((c) => ({ ...c, rule: e.target.value as Charter['rule'] }))}
                  >
                    <option value="unanimity">Unanimity</option>
                    <option value="majority">Majority</option>
                    <option value="weighted">Population-weighted</option>
                  </select>
                </label>
                <label>
                  Contribution (% of public income)
                  <input
                    type="number"
                    min={0}
                    max={15}
                    step={0.5}
                    value={charter.contribution * 100}
                    onChange={(e) =>
                      setCharter((c) => ({ ...c, contribution: Number(e.target.value) / 100 }))
                    }
                  />
                </label>
                <label>
                  Withdrawal
                  <select
                    value={charter.exit}
                    onChange={(e) => setCharter((c) => ({ ...c, exit: e.target.value as Charter['exit'] }))}
                  >
                    <option value="notice">Six months’ notice</option>
                    <option value="free">Free withdrawal</option>
                  </select>
                </label>
                <label>
                  Defense requirement
                  <select
                    value={charter.defense ?? 'either'}
                    onChange={(e) =>
                      setCharter((c) => ({ ...c, defense: e.target.value as Charter['defense'] }))
                    }
                  >
                    <option value="either">Deployed forces or delivered aid</option>
                    <option value="military">Deployed forces</option>
                    <option value="aid">Delivered aid</option>
                  </select>
                </label>
                <label>
                  Response deadline (months)
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={charter.responseMonths ?? 6}
                    onChange={(e) => setCharter((c) => ({ ...c, responseMonths: Number(e.target.value) }))}
                  />
                </label>
              </>
            )}
            <p className="subtle">
              This sends a proposal. Eligible governments must ratify it under the existing charter.
            </p>
            <button
              className="button"
              disabled={actor < 0 || ((operation === 'expel' || operation === 'reinstate') && target < 0)}
            >
              Submit proposal
            </button>
          </form>
        </details>
      )}
      {result.month < currentMonth && <p className="history-notice">Historical record · Read only</p>}
      {!controlled.length && result.month === currentMonth && (
        <p className="subtle">
          Governments handle institutional changes autonomously. Control a state to submit proposals or
          respond to its defense calls.
        </p>
      )}
    </article>
  )
}

/** Show every signed clause before offering consent, including bundled non-institutional terms. */
function InstitutionDocument({
  document: p,
  stateName,
}: {
  document: ArchiveDocument
  stateName: (id: number) => string
}) {
  return (
    <details className="history-call">
      <summary>
        Agreement #{p.id}: {p.title}
      </summary>
      <p>Parties: {p.parties.map(stateName).join(' · ')}</p>
      <p>Signed: {p.signatures.map((s) => stateName(s.nation)).join(' · ') || 'Awaiting signatures'}</p>
      <ol>
        {p.terms.map((t, i) => (
          <li key={i}>
            <strong>
              {t.kind} · {stateName(t.from)}
              {t.to >= 0 ? ` → ${stateName(t.to)}` : ''}
            </strong>
            <p>{t.text}</p>
            {t.charter && (
              <p>
                {t.charter.operation} · {t.charter.form} · {t.charter.powers.join(', ')} · {t.charter.rule} ·{' '}
                {Math.round(t.charter.contribution * 100)}% contribution · {t.charter.exit} withdrawal ·
                Defense: {t.charter.defense ?? 'either'}, {t.charter.responseMonths ?? 6} months
              </p>
            )}
            {t.amount !== 0 && (
              <p>
                Amount: {t.amount} {t.good || t.field}
              </p>
            )}
            {t.regions.length > 0 && <p>Provinces: {t.regions.join(', ')}</p>}
            {t.duration > 0 && <p>Duration: {t.duration} months</p>}
          </li>
        ))}
      </ol>
    </details>
  )
}
