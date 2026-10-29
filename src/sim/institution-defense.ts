/** Defense promises become dated duties; only delivered money or deployed forces fulfill them. */
import { reportedWar } from './intelligence'
import { transfer, governmentAccount } from './ledger'
import { relation, type World } from './types'
import type { DefenseCall, Institution } from './institution-types'
import { beginInstitutionCrisis, institutionEligible, recordInstitution } from './institution-lifecycle'

function deployed(w: World, member: number, call: DefenseCall) {
  return (
    relation(w, member, call.aggressor)?.treaty === 'war' &&
    w.armies.some(
      (a) =>
        a.nation === member &&
        a.soldiers > 0 &&
        [call.victim, call.aggressor].includes(w.regions[a.region]?.nation),
    )
  )
}
/** Aid uses actual national funds and records the amount delivered, never a verbal pledge. */
export function respondToInstitutionDefense(
  w: World,
  institution: number,
  callId: string,
  nation: number,
  response: 'aid' | 'refuse',
) {
  const o = w.institutions?.organizations.find((o) => o.id === institution),
    call = o?.calls?.find((c) => c.id === callId)
  const duty = call?.responses.find((r) => r.nation === nation)
  if (
    !o ||
    !call ||
    call.closed !== undefined ||
    !duty ||
    duty.status !== 'pending' ||
    !institutionEligible(w, o, nation)
  )
    throw new Error('This government has no pending defense duty in this institution.')
  if (response === 'aid') {
    if (call.requirement === 'military')
      throw new Error('This charter requires deployed military assistance.')
    const required = Math.max(0, duty.requiredAid - duty.aid)
    if (w.nations[nation].treasury < required)
      throw new Error('The treasury cannot fund the required defense assistance.')
    duty.aid += transfer(
      w,
      governmentAccount(nation),
      governmentAccount(call.victim),
      required,
      'member defense assistance',
    )
    duty.status = 'fulfilled'
  } else {
    duty.status = 'refused'
    beginInstitutionCrisis(w, o, 'A member refused its mutual-defense obligation.', [nation])
  }
  duty.updated = w.month
  recordInstitution(
    w,
    o,
    'defense',
    response === 'aid'
      ? 'The member delivered the required defense funding.'
      : 'The member refused assistance.',
    [nation, call.victim],
    undefined,
    call,
  )
}
/** Calls are identified by the war's parties and opening month, so repeated ticks cannot duplicate them. */
export function advanceInstitutionDefense(w: World, o: Institution) {
  if (o.status === 'dissolved') return
  o.calls ??= []
  // An amendment changes future promises; already notified duties retain their original terms.
  for (const war of o.charter.powers.includes('defense') ? w.relations : []) {
    if (war.treaty !== 'war' || war.aggressor === undefined || war.defenseOf !== undefined) continue
    const victim = war.a === war.aggressor ? war.b : war.a
    if (!institutionEligible(w, o, victim)) continue
    const id = `${war.a}:${war.b}:${war.since}`
    let call = o.calls.find((c) => c.id === id)
    if (!call) {
      call = {
        id,
        victim,
        aggressor: war.aggressor,
        since: war.since,
        opened: w.month,
        requirement: o.charter.defense ?? 'either',
        responses: [],
      }
      o.calls.push(call)
      recordInstitution(
        w,
        o,
        'defense',
        'The league opened a mutual-defense call.',
        [victim, war.aggressor],
        undefined,
        call,
      )
    }
    for (const member of o.members) {
      if (
        member === victim ||
        member === call.aggressor ||
        !institutionEligible(w, o, member) ||
        call.responses.some((r) => r.nation === member) ||
        !reportedWar(w, member, call.aggressor, victim)
      )
        continue
      // One tenth of current monthly public income is a concrete, bounded aid obligation.
      call.responses.push({
        nation: member,
        notified: w.month,
        due: w.month + (o.charter.responseMonths ?? 6),
        requiredAid: Math.max(1, w.nations[member].income * 0.1),
        aid: 0,
        status: 'pending',
        updated: w.month,
      })
      recordInstitution(
        w,
        o,
        'defense',
        'A member received the defense call and its response deadline.',
        [member],
        undefined,
        call,
      )
    }
  }
  for (const call of o.calls) {
    if (call.closed !== undefined) continue
    const war = relation(w, call.victim, call.aggressor)
    if (war?.treaty !== 'war' || war.since !== call.since || !o.members.includes(call.victim)) {
      call.closed = w.month
      for (const r of call.responses)
        if (r.status === 'pending') {
          r.status = 'released'
          r.updated = w.month
        }
      recordInstitution(
        w,
        o,
        'defense',
        'The defense call ended; pending duties were released.',
        [],
        undefined,
        call,
      )
      continue
    }
    for (const duty of call.responses) {
      if (duty.status !== 'pending') continue
      if (!institutionEligible(w, o, duty.nation)) {
        duty.status = 'released'
        duty.updated = w.month
      } else if (call.requirement !== 'aid' && deployed(w, duty.nation, call)) {
        duty.status = 'fulfilled'
        duty.updated = w.month
      } else {
        const n = w.nations[duty.nation]
        // Autonomous cabinets honor affordable aid; military-only charters keep military consequences.
        if (
          n.ai &&
          call.requirement !== 'military' &&
          n.treasury >= duty.requiredAid &&
          (relation(w, n.id, call.victim)?.opinion ?? 0) >= -30
        ) {
          respondToInstitutionDefense(w, o.id, call.id, n.id, 'aid')
          continue
        }
        if (w.month < duty.due) continue
        duty.status = 'overdue'
        duty.updated = w.month
        beginInstitutionCrisis(w, o, 'A member missed the deadline for its mutual-defense obligation.', [
          duty.nation,
        ])
      }
      recordInstitution(w, o, 'defense', `Defense response ${duty.status}.`, [duty.nation], undefined, call)
    }
  }
}
