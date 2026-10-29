/** Validate every archived revision, not just today's charter; imports are untrusted. */
import {
  INSTITUTION_OPERATIONS,
  INSTITUTION_POWERS,
  type Charter,
  type Institution,
  type InstitutionVersion,
  type DefenseCall,
} from './institution-types'
import type { World } from './types'
/** One constitutional shape is accepted by commands, provider output and saves. */
export const validInstitutionCharter = (c: Charter) =>
  c &&
  INSTITUTION_OPERATIONS.includes(c.operation) &&
  Number.isSafeInteger(c.id) &&
  c.id >= 0 &&
  c.id <= 1e12 &&
  [
    'defense-league',
    'customs-union',
    'research-community',
    'confederation',
    'federation',
    'bespoke',
  ].includes(c.form) &&
  ['unanimity', 'majority', 'weighted'].includes(c.rule) &&
  ['free', 'notice'].includes(c.exit) &&
  Number.isFinite(c.contribution) &&
  c.contribution >= 0 &&
  c.contribution <= 0.15 &&
  Array.isArray(c.powers) &&
  c.powers.length > 0 &&
  new Set(c.powers).size === c.powers.length &&
  c.powers.every((p) => INSTITUTION_POWERS.includes(p)) &&
  (c.defense === undefined || ['military', 'aid', 'either'].includes(c.defense)) &&
  (c.responseMonths === undefined ||
    (Number.isSafeInteger(c.responseMonths) && c.responseMonths >= 1 && c.responseMonths <= 24))

export function validateInstitutionHistory(w: World, o: Institution) {
  const fail = (): never => {
    throw new Error('Invalid institutional history in this save.')
  }
  const integer = (x: unknown, max: number, min = 0) =>
    Number.isSafeInteger(x) && (x as number) >= min && (x as number) <= max
  const ids = (x: unknown): x is number[] =>
    Array.isArray(x) &&
    x.length <= 32 &&
    new Set(x).size === x.length &&
    x.every((id) => integer(id, w.nations.length - 1))
  const text = (x: unknown, max = 2000) => typeof x === 'string' && x.length > 0 && x.length <= max
  const version = (v: InstitutionVersion, month: number) => {
    if (
      !v ||
      !text(v.name, 140) ||
      !ids(v.members) ||
      !ids(v.suspended) ||
      v.suspended.some((id) => !v.members.includes(id)) ||
      !validInstitutionCharter(v.charter) ||
      !['active', 'crisis', 'dissolved'].includes(v.status) ||
      (v.status !== 'dissolved' && v.members.length < 2) ||
      !Array.isArray(v.withdrawals) ||
      new Set(v.withdrawals.map((x) => x.nation)).size !== v.withdrawals.length ||
      v.withdrawals.some((x) => !x || !v.members.includes(x.nation) || !integer(x.due, month + 24)) ||
      (v.dissolved !== undefined && (!integer(v.dissolved, month) || v.status !== 'dissolved')) ||
      (v.status === 'crisis' && !v.crisis) ||
      (v.crisis &&
        (v.status !== 'crisis' ||
          !integer(v.crisis.since, month) ||
          !integer(v.crisis.due, v.crisis.since + 24, v.crisis.since) ||
          !text(v.crisis.reason)))
    )
      fail()
  }
  const call = (c: DefenseCall, month: number) => {
    if (
      !c ||
      !text(c.id, 100) ||
      !integer(c.victim, w.nations.length - 1) ||
      !integer(c.aggressor, w.nations.length - 1) ||
      c.victim === c.aggressor ||
      !integer(c.since, month) ||
      !integer(c.opened, month, c.since) ||
      (c.closed !== undefined && !integer(c.closed, month, c.opened)) ||
      !['military', 'aid', 'either'].includes(c.requirement) ||
      !Array.isArray(c.responses) ||
      new Set(c.responses.map((r) => r.nation)).size !== c.responses.length
    )
      fail()
    for (const r of c.responses)
      if (
        !r ||
        !integer(r.nation, w.nations.length - 1) ||
        !integer(r.notified, month, c.opened) ||
        !integer(r.due, r.notified + 24, r.notified) ||
        !integer(r.updated, month, r.notified) ||
        !Number.isFinite(r.requiredAid) ||
        r.requiredAid < 1 ||
        !Number.isFinite(r.aid) ||
        r.aid < 0 ||
        !['pending', 'fulfilled', 'refused', 'overdue', 'released'].includes(r.status)
      )
        fail()
  }
  if (!validInstitutionCharter(o.charter)) fail()
  if (o.events === undefined) {
    if (
      o.status === 'crisis' ||
      o.suspended !== undefined ||
      o.calls !== undefined ||
      o.withdrawals !== undefined ||
      o.dissolved !== undefined
    )
      fail()
    return
  }
  if (!Array.isArray(o.events) || !o.events.length) fail()
  // Old dissolved records may contain a single surviving estate; operating revisions may not.
  version({ ...o, suspended: o.suspended ?? [], withdrawals: o.withdrawals ?? [] }, w.month)
  let prior = -1
  for (let i = 0; i < o.events.length; i++) {
    const e = o.events[i]
    if (
      !e ||
      e.id !== i + 1 ||
      !integer(e.month, w.month) ||
      e.month < prior ||
      !text(e.detail) ||
      !ids(e.nations) ||
      ![
        'baseline',
        'founded',
        'joined',
        'withdrawal',
        'left',
        'amended',
        'renamed',
        'expelled',
        'reinstated',
        'crisis',
        'recovered',
        'dissolved',
        'succession',
        'defense',
      ].includes(e.kind) ||
      (e.offer !== undefined && !integer(e.offer, 1e12, 1)) ||
      (!e.version && !e.call)
    )
      fail()
    prior = e.month
    if (e.version) {
      // A departure/succession event can precede dissolution in the same transaction.
      if (e.version.members.length < 2 && ['left', 'expelled', 'succession'].includes(e.kind))
        version({ ...e.version, status: 'dissolved', crisis: undefined }, e.month)
      else version(e.version, e.month)
    }
    if (e.call) call(e.call, e.month)
  }
  if (
    o.calls !== undefined &&
    (!Array.isArray(o.calls) || new Set(o.calls.map((c) => c.id)).size !== o.calls.length)
  )
    fail()
  for (const c of o.calls ?? []) call(c, w.month)
}
