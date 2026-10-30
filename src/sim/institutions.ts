/** Institutional consent, constitutional changes and monthly shared services. */
import { dependencyMandate } from './state-dependencies'
import { validateInstitutionHistory, validInstitutionCharter } from './institution-validation'
import { transfer, governmentAccount } from './ledger'
import { purchasePublicLabor } from './macroeconomy'
import { provincialRealService, nationalRealService } from './public-services'
import { clamp, population, relation, type World, type Region } from './types'
import type { DiplomaticClause, DiplomaticOffer } from './statecraft-types'
import { INSTITUTION_POWERS, PROVINCIAL_POWERS, type Institution } from './institution-types'
import {
  ensureInstitutionRecord,
  recordInstitution,
  institutionMembers,
  institutionEligible,
  institutionQuorum,
  reconcileInstitutions,
  dissolveInstitution,
  removeInstitutionMember,
  recoverInstitution,
} from './institution-lifecycle'
import { advanceInstitutionDefense } from './institution-defense'
export { INSTITUTION_POWERS, INSTITUTION_OPERATIONS, PROVINCIAL_POWERS } from './institution-types'
export type { Charter, Institution, InstitutionalState, ProvincialDelegation } from './institution-types'
export function ensureInstitutions(w: World) {
  return (w.institutions ??= { nextId: 1, organizations: [] })
}
export function sharedInstitution(
  w: World,
  a: number,
  b: number,
  power: (typeof INSTITUTION_POWERS)[number],
) {
  return (
    a !== b &&
    (w.institutions?.organizations.some(
      (o) =>
        institutionEligible(w, o, a) &&
        institutionEligible(w, o, b) &&
        relation(w, a, b)?.treaty !== 'war' &&
        o.charter.powers.includes(power),
    ) ??
      false)
  )
}
export function foreignPolicyMandate(w: World, nation: number, parties: number[] = []) {
  return (
    dependencyMandate(w, nation, parties) &&
    (w.institutions?.organizations ?? [])
      .filter((o) => institutionEligible(w, o, nation) && o.charter.powers.includes('foreignPolicy'))
      .every((o) => institutionQuorum(w, o, parties))
  )
}
/** A standing mutual-defense commitment authorizes defense against the specific aggressor. */
export function collectiveDefense(w: World, nation: number, attacker: number) {
  return collectiveDefenseBeneficiary(w, nation, attacker) !== undefined
}
/** Preserve the original aggressor when a member enters an existing defense commitment. */
export function collectiveDefenseBeneficiary(w: World, nation: number, attacker: number) {
  const war = w.relations.find(
    (r) =>
      r.treaty === 'war' &&
      r.defenseOf === undefined &&
      r.aggressor === attacker &&
      (r.a === attacker || r.b === attacker) &&
      sharedInstitution(w, nation, r.a === attacker ? r.b : r.a, 'defense'),
  )
  return war ? (war.a === attacker ? war.b : war.a) : undefined
}
export function validateInstitutionTerm(w: World, term: DiplomaticClause, parties: number[]) {
  if (term.kind === 'devolution') {
    if (
      !term.delegation ||
      !Number.isFinite(term.amount) ||
      term.amount < 0 ||
      term.amount > 0.8 ||
      !term.regions.length ||
      term.regions.some((id) => w.regions[id]?.nation !== term.from) ||
      term.delegation.powers.some((p) => !PROVINCIAL_POWERS.includes(p))
    )
      throw new Error(
        'Provincial delegation needs owned provinces, supported powers and autonomy between 0 and 0.8.',
      )
    return
  }
  const c = term.charter
  if (!c || !validInstitutionCharter(c))
    throw new Error('A charter needs explicit supported powers and bounded contributions.')
  if (!parties.includes(term.from))
    throw new Error('The proposing government must consent to its own institutional act.')
  if (c.operation === 'found') {
    if (
      parties.length < 2 ||
      parties.length > 32 ||
      !term.text.trim() ||
      ensureInstitutions(w).organizations.filter((o) => o.status !== 'dissolved').length >= 128
    )
      throw new Error(
        'Founding an institution needs two to thirty-two consenting states and an explicit name.',
      )
    return
  }
  const organization = w.institutions?.organizations.find((o) => o.id === c.id && o.status !== 'dissolved')
  if (!organization) throw new Error('This institution is no longer active.')
  if (c.operation === 'withdraw') {
    if (!organization.members.includes(term.from))
      throw new Error('A government can only withdraw its own membership.')
    return
  }
  if (c.operation === 'join' && organization.members.includes(term.from))
    throw new Error('This state already belongs to the institution.')
  if (c.operation === 'join' && (organization.members.length >= 32 || organization.suspended?.length))
    throw new Error('Admissions require a settled institution with fewer than thirty-two members.')
  if (c.operation !== 'join' && !institutionMembers(organization).includes(term.from))
    throw new Error('Only an eligible member can propose this institutional decision.')
  if (c.operation === 'expel' || c.operation === 'reinstate') {
    if (!organization.members.includes(term.to) || term.to === term.from)
      throw new Error('Choose another current member.')
    if (!organization.suspended?.includes(term.to))
      throw new Error('Expulsion or reinstatement requires a recorded suspension.')
    if (
      c.operation === 'reinstate' &&
      organization.members.some((id) => relation(w, id, term.to)?.treaty === 'war')
    )
      throw new Error('A member at war with its partners cannot be reinstated.')
  }
  if (!institutionQuorum(w, organization, parties, c.operation === 'expel' ? term.to : undefined))
    throw new Error('The charter requires the eligible council’s voting mandate.')
  if ((c.operation === 'rename' || c.operation === 'amend') && !term.text.trim())
    throw new Error('An institution needs a name.')
}
export function applyInstitutionTerm(w: World, term: DiplomaticClause, offer: DiplomaticOffer) {
  validateInstitutionTerm(w, term, offer.parties)
  if (term.kind === 'devolution') {
    for (const id of term.regions) {
      const r = w.regions[id]
      r.delegation = {
        autonomy: term.amount,
        powers: [...term.delegation!.powers],
        income: 0,
        budget: 0,
        treasury: r.delegation?.treasury ?? 0,
        since: w.month,
      }
    }
    return
  }
  const state = ensureInstitutions(w),
    c = { ...term.charter!, powers: [...term.charter!.powers] }
  if (c.operation === 'found') {
    const organization: Institution = {
      id: state.nextId++,
      name: term.text.slice(0, 140),
      founded: w.month,
      members: [...offer.parties],
      charter: c,
      visibility: offer.visibility,
      treasury: 0,
      income: 0,
      grants: 0,
      status: 'active',
      sourceOffer: offer.id,
      events: [],
    }
    state.organizations.push(organization)
    recordInstitution(
      w,
      organization,
      'founded',
      'The founding governments ratified the charter.',
      offer.parties,
      offer.id,
    )
    return
  }
  const o = state.organizations.find((o) => o.id === c.id)!
  ensureInstitutionRecord(w, o)
  switch (c.operation) {
    case 'join':
      o.members.push(term.from)
      recordInstitution(
        w,
        o,
        'joined',
        'The applicant and council approved admission.',
        [term.from],
        offer.id,
      )
      break
    case 'amend':
      o.charter = c
      o.name = term.text.slice(0, 140)
      recordInstitution(
        w,
        o,
        'amended',
        'The council ratified a new charter version.',
        offer.parties,
        offer.id,
      )
      break
    case 'rename':
      o.name = term.text.slice(0, 140)
      recordInstitution(
        w,
        o,
        'renamed',
        'The council adopted a new institutional name.',
        offer.parties,
        offer.id,
      )
      break
    case 'withdraw':
      if (o.withdrawals?.some((x) => x.nation === term.from))
        throw new Error('Withdrawal notice is already pending.')
      if (o.charter.exit === 'notice') {
        o.withdrawals ??= []
        o.withdrawals.push({ nation: term.from, due: w.month + 6 })
        recordInstitution(
          w,
          o,
          'withdrawal',
          'The member gave six months’ notice of withdrawal.',
          [term.from],
          offer.id,
        )
      } else
        removeInstitutionMember(
          w,
          o,
          term.from,
          'left',
          'The member exercised its right of withdrawal.',
          offer.id,
        )
      break
    case 'expel':
      removeInstitutionMember(
        w,
        o,
        term.to,
        'expelled',
        'The eligible council voted to expel the suspended member.',
        offer.id,
      )
      break
    case 'reinstate':
      o.suspended = o.suspended?.filter((id) => id !== term.to)
      recordInstitution(
        w,
        o,
        'reinstated',
        'The council restored the member’s rights following settlement.',
        [term.to],
        offer.id,
      )
      recoverInstitution(w, o)
      break
    case 'dissolve':
      dissolveInstitution(w, o, 'The council voted to dissolve the institution.', offer.id)
      break
  }
}

export function institutionalFunds(w: World) {
  return (
    (w.institutions?.organizations.reduce((s, o) => s + o.treasury, 0) ?? 0) +
    w.regions.reduce((s, r) => s + (r.delegation?.treasury ?? 0), 0)
  )
}
/** Succession changes present membership, never archived identities or decisions. */
export function transferInstitutionMembership(w: World, from: number, to: number) {
  for (const o of w.institutions?.organizations ?? []) {
    if (o.status === 'dissolved' || !o.members.includes(from)) continue
    ensureInstitutionRecord(w, o)
    o.members = [...new Set(o.members.map((id) => (id === from ? to : id)))]
    o.suspended = [...new Set((o.suspended ?? []).map((id) => (id === from ? to : id)))]
    o.withdrawals = (o.withdrawals ?? []).filter((x) => x.nation !== from)
    recordInstitution(w, o, 'succession', 'Membership passed to the successor state.', [from, to])
    if (o.members.length < 2) dissolveInstitution(w, o, 'State succession left fewer than two members.')
  }
}
export function allocateProvincialTaxes(w: World, nation: number, gross: number) {
  const own = w.regions.filter((r) => r.nation === nation),
    output = Math.max(
      1,
      own.reduce((s, r) => s + r.gdp, 0),
    )
  let retained = 0
  for (const r of own)
    if (r.delegation) {
      const d = r.delegation
      d.income = d.powers.includes('taxation') ? gross * (Math.max(0, r.gdp) / output) * d.autonomy : 0
      d.income = transfer(
        w,
        governmentAccount(nation),
        `province:${r.id}`,
        d.income,
        'provincial tax retention',
      )
      retained += d.income
    }
  return retained
}
export function provincialServiceBudget(r: Region, power: 'education' | 'policing' | 'infrastructure') {
  const d = r.delegation
  if (!d?.powers.includes(power)) return 0
  // Administration retains one tenth; delegated services divide the remaining appropriation.
  return (d.budget * 0.9) / Math.max(1, d.powers.filter((p) => p !== 'taxation').length)
}
export function advanceInstitutions(w: World) {
  for (const r of w.regions)
    if (r.delegation) {
      const d = r.delegation
      d.budget = Math.min(d.treasury, d.income * 0.85 + d.treasury * 0.01)
      d.budget = purchasePublicLabor(w, r, `province:${r.id}`, d.budget, 'provincial services')
      if (d.powers.includes('policing'))
        r.unrest = clamp(
          r.unrest -
            Math.min(1.5, provincialRealService(w, r, 'policing') / Math.max(1, population(r) / 10000)) * 0.2,
          0,
          100,
        )
    }
  reconcileInstitutions(w)
  for (const o of w.institutions?.organizations ?? []) {
    if (o.status === 'dissolved') continue
    advanceInstitutionDefense(w, o)
    o.income = 0
    o.grants = 0
    const active = o.members.filter((id) => institutionEligible(w, o, id))
    for (const id of active) {
      const n = w.nations[id],
        paid = Math.min(Math.max(0, n.treasury), n.income * o.charter.contribution)
      transfer(w, governmentAccount(n.id), `institution:${o.id}`, paid, 'institution contribution')
      o.income += paid
    }
    if (o.charter.powers.includes('defense')) {
      const recipients = active
        .filter((id) =>
          w.relations.some((r) => r.treaty === 'war' && r.aggressor !== id && (r.a === id || r.b === id)),
        )
        .sort((a, b) => w.nations[a].treasury - w.nations[b].treasury)
      const budget = Math.min(o.treasury, o.income * 0.8)
      for (const id of recipients) {
        const grant = budget / recipients.length
        transfer(w, `institution:${o.id}`, governmentAccount(id), grant, 'institution defense grant')
        o.grants += grant
      }
    }
    if (o.charter.powers.includes('research')) {
      const knowledge = active.reduce((s, id) => s + nationalRealService(w, id, 'research'), 0) * 0.004
      for (const id of active)
        w.nations[id].researchProgress[w.nations[id].researchFocus] += Math.min(12, knowledge / active.length)
    }
  }
}
export function validateInstitutions(w: World) {
  const finite = (v: unknown, min: number, max: number) =>
      typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max,
    integer = (v: unknown, min: number, max: number) => finite(v, min, max) && Number.isInteger(v),
    fail = (): never => {
      throw new Error('Invalid inter-state charter or provincial delegation in this save.')
    }
  if (w.institutions) {
    const s = w.institutions
    if (
      !integer(s.nextId, 1, 1e12) ||
      !Array.isArray(s.organizations) ||
      s.organizations.filter((o) => o.status !== 'dissolved').length > 128
    )
      fail()
    const ids = new Set<number>()
    for (const o of s.organizations) {
      const c = o.charter
      if (
        !integer(o.id, 1, s.nextId - 1) ||
        ids.has(o.id) ||
        typeof o.name !== 'string' ||
        !o.name.trim() ||
        o.name.length > 140 ||
        !integer(o.founded, 0, w.month) ||
        !Array.isArray(o.members) ||
        o.members.length > 32 ||
        (o.status === 'active' && o.members.length < 2) ||
        new Set(o.members).size !== o.members.length ||
        o.members.some((id) => !integer(id, 0, w.nations.length - 1)) ||
        !['active', 'crisis', 'dissolved'].includes(o.status) ||
        !['public', 'secret'].includes(o.visibility) ||
        !finite(o.treasury, 0, 1e14) ||
        !finite(o.income, 0, 1e14) ||
        !finite(o.grants, 0, 1e14) ||
        !integer(o.sourceOffer, 1, 1e12) ||
        !validInstitutionCharter(c)
      )
        fail()
      validateInstitutionHistory(w, o)
      ids.add(o.id)
    }
  }
  for (const r of w.regions)
    if (r.delegation) {
      const d = r.delegation
      if (
        !finite(d.autonomy, 0, 0.8) ||
        !Array.isArray(d.powers) ||
        new Set(d.powers).size !== d.powers.length ||
        d.powers.some((p) => !PROVINCIAL_POWERS.includes(p)) ||
        !finite(d.treasury, 0, 1e14) ||
        !finite(d.income, 0, 1e14) ||
        !finite(d.budget, 0, 1e14) ||
        !integer(d.since, 0, w.month)
      )
        fail()
    }
}
