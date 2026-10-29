/** All constitutional transitions share one journal and treasury settlement path.
 * Breaches suspend rights immediately; the council gets six months to repair the body. */
import { governmentAccount, transfer } from './ledger'
import { relation, type World } from './types'
import type { Institution, InstitutionEvent, InstitutionVersion } from './institution-types'

/** Snapshot only constitutional fields, never the growing journal itself. */
export function institutionVersion(o: Institution): InstitutionVersion {
  return {
    name: o.name,
    members: [...o.members],
    charter: { ...o.charter, powers: [...o.charter.powers] },
    status: o.status,
    suspended: [...(o.suspended ?? [])],
    withdrawals: (o.withdrawals ?? []).map((x) => ({ ...x })),
    ...(o.crisis ? { crisis: { ...o.crisis } } : {}),
    ...(o.dissolved !== undefined ? { dissolved: o.dissolved } : {}),
  }
}
/** Legacy imports establish observations, never invented founding-era membership. */
export function ensureInstitutionRecord(w: World, o: Institution) {
  if (o.events) return
  o.events = []
  recordInstitution(
    w,
    o,
    'baseline',
    'First preserved institutional observation. Earlier membership and decisions are unknown.',
  )
}
/** Events are append-only, ordered within each month, and isolated inside settlement trials. */
export function recordInstitution(
  w: World,
  o: Institution,
  kind: InstitutionEvent['kind'],
  detail: string,
  nations: number[] = [],
  offer?: number,
  call?: InstitutionEvent['call'],
) {
  o.events ??= []
  const event: InstitutionEvent = {
    id: o.events.length + 1,
    month: w.month,
    kind,
    detail,
    nations: [...nations],
    ...(offer !== undefined ? { offer } : {}),
    ...(call ? { call: structuredClone(call) } : { version: institutionVersion(o) }),
  }
  o.events.push(event)
  return event
}
/** Constitutionally eligible members. Suspensions affect benefits, votes and new commitments. */
export function institutionMembers(o: Institution) {
  return o.status === 'dissolved' ? [] : o.members.filter((id) => !o.suspended?.includes(id))
}
/** Voting weights are square roots of population, matching the existing charter contract. */
export function institutionQuorum(w: World, o: Institution, voters: readonly number[], excluded?: number) {
  const electorate = institutionMembers(o).filter((id) => id !== excluded)
  if (!electorate.length) return false
  const present = electorate.filter((id) => voters.includes(id))
  if (o.charter.rule === 'unanimity') return present.length === electorate.length
  if (o.charter.rule === 'majority') return present.length > electorate.length / 2
  const weight = (ids: number[]) =>
    ids.reduce((sum, id) => sum + Math.sqrt(Math.max(1, w.nations[id].population)), 0)
  return weight(present) > weight(electorate) / 2
}
/** A declaration must revoke incompatible privileges before the next monthly tick. */
export function institutionEligible(w: World, o: Institution, id: number) {
  return (
    o.status !== 'dissolved' &&
    o.members.includes(id) &&
    !o.suspended?.includes(id) &&
    !o.members.some((other) => {
      const r = relation(w, id, other)
      return r?.treaty === 'war' && (r.aggressor === id || r.aggressor === undefined)
    })
  )
}
export function beginInstitutionCrisis(w: World, o: Institution, reason: string, offenders: number[] = []) {
  ensureInstitutionRecord(w, o)
  const added = offenders.filter((id) => !o.suspended?.includes(id))
  if (o.status === 'dissolved' || (o.crisis && !added.length)) return
  o.suspended = [...new Set([...(o.suspended ?? []), ...offenders])]
  o.status = 'crisis'
  o.crisis ??= { since: w.month, due: w.month + 6, reason }
  recordInstitution(w, o, 'crisis', reason, offenders)
}
/** Refund the complete balance exactly once; the final recipient gets rounding residue. */
export function dissolveInstitution(w: World, o: Institution, reason: string, offer?: number) {
  if (o.status === 'dissolved') return
  ensureInstitutionRecord(w, o)
  const recipients = institutionMembers(o),
    fallback = o.members
  const heirs = recipients.length ? recipients : fallback
  const share = o.treasury / Math.max(1, heirs.length)
  for (let i = 0; i < heirs.length; i++)
    transfer(
      w,
      `institution:${o.id}`,
      governmentAccount(heirs[i]),
      i === heirs.length - 1 ? o.treasury : share,
      'institution dissolution',
    )
  o.status = 'dissolved'
  o.dissolved = w.month
  o.income = 0
  o.grants = 0
  delete o.crisis
  o.withdrawals = []
  for (const call of o.calls ?? [])
    if (call.closed === undefined) {
      call.closed = w.month
      for (const response of call.responses)
        if (response.status === 'pending') {
          response.status = 'released'
          response.updated = w.month
        }
      recordInstitution(
        w,
        o,
        'defense',
        'Outstanding defense duties ended with dissolution.',
        [],
        undefined,
        call,
      )
    }
  recordInstitution(w, o, 'dissolved', reason, heirs, offer)
}
export function removeInstitutionMember(
  w: World,
  o: Institution,
  id: number,
  kind: 'left' | 'expelled',
  reason: string,
  offer?: number,
) {
  if (o.status === 'dissolved' || !o.members.includes(id)) return
  ensureInstitutionRecord(w, o)
  // Settle before removing the final member so there is always an identifiable estate.
  if (o.members.length === 1) {
    dissolveInstitution(w, o, reason, offer)
    return
  }
  o.members = o.members.filter((n) => n !== id)
  o.suspended = o.suspended?.filter((n) => n !== id)
  o.withdrawals = o.withdrawals?.filter((x) => x.nation !== id)
  recordInstitution(w, o, kind, reason, [id], offer)
  if (o.members.length < 2) dissolveInstitution(w, o, 'Fewer than two member states remain.', offer)
}
/** Purely political recovery requires no unresolved suspension or internal war. */
export function recoverInstitution(w: World, o: Institution) {
  if (
    o.status !== 'crisis' ||
    o.suspended?.length ||
    o.members.some((a, i) => o.members.slice(i + 1).some((b) => relation(w, a, b)?.treaty === 'war'))
  )
    return
  o.status = 'active'
  delete o.crisis
  recordInstitution(
    w,
    o,
    'recovered',
    'The constitutional dispute has been settled; normal cooperation resumes.',
  )
}
const isDissolved = (o: Institution) => o.status === 'dissolved'
/** Reconcile every war entry point and succession without charging another month's contributions. */
export function reconcileInstitutions(w: World) {
  const alive = new Set(w.regions.map((r) => r.nation))
  for (const o of w.institutions?.organizations ?? []) {
    if (isDissolved(o)) continue
    ensureInstitutionRecord(w, o)
    for (const id of [...o.members])
      if (!alive.has(id))
        removeInstitutionMember(w, o, id, 'left', 'The member no longer holds sovereign territory.')
    if (isDissolved(o)) continue
    for (const exit of [...(o.withdrawals ?? [])])
      if (exit.due <= w.month)
        removeInstitutionMember(w, o, exit.nation, 'left', 'The charter notice period has ended.')
    if (isDissolved(o)) continue
    for (let i = 0; i < o.members.length; i++)
      for (let j = i + 1; j < o.members.length; j++) {
        const r = relation(w, o.members[i], o.members[j])
        if (r?.treaty === 'war')
          beginInstitutionCrisis(
            w,
            o,
            'War between member states violates peaceful cooperation.',
            r.aggressor === undefined ? [] : [r.aggressor],
          )
      }
    if (o.crisis && w.month >= o.crisis.due) {
      // AI cabinets may vote to remove violators. A human's required vote is never invented.
      const voters = institutionMembers(o).filter((id) => w.nations[id].ai)
      for (const id of [...(o.suspended ?? [])])
        if (institutionQuorum(w, o, voters, id))
          removeInstitutionMember(
            w,
            o,
            id,
            'expelled',
            'The eligible council voted to expel a member after an unresolved charter breach.',
          )
      recoverInstitution(w, o)
      if (o.status === 'crisis')
        dissolveInstitution(
          w,
          o,
          'The constitutional crisis reached its deadline without a viable settlement.',
        )
    } else recoverInstitution(w, o)
  }
}

/** Trial worlds share immutable journal entries but isolate mutable constitutions and duties. */
export function cloneInstitutions(state: World['institutions']): World['institutions'] {
  if (!state) return state
  return {
    nextId: state.nextId,
    organizations: state.organizations.map(({ events, ...o }) => ({
      ...structuredClone(o),
      ...(events ? { events: [...events] } : {}),
    })),
  }
}
