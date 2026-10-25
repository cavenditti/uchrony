import { transfer, governmentAccount } from './ledger'
import { purchasePublicLabor } from './macroeconomy'
import { clamp, population, relation, type World, type Region } from './types'
import type { DiplomaticClause, DiplomaticOffer, Visibility } from './statecraft-types'
export const INSTITUTION_POWERS = ['defense', 'trade', 'research', 'taxation', 'foreignPolicy'] as const
export const PROVINCIAL_POWERS = ['taxation', 'education', 'policing', 'infrastructure'] as const
export interface Charter {
  operation: 'found' | 'join' | 'withdraw' | 'amend'
  id: number
  form: 'defense-league' | 'customs-union' | 'research-community' | 'confederation' | 'federation' | 'bespoke'
  powers: (typeof INSTITUTION_POWERS)[number][]
  rule: 'unanimity' | 'majority' | 'weighted'
  contribution: number
  exit: 'free' | 'notice'
}
export interface Institution {
  id: number
  name: string
  founded: number
  members: number[]
  charter: Charter
  visibility: Visibility
  treasury: number
  income: number
  grants: number
  status: 'active' | 'dissolved'
  sourceOffer: number
}
export interface InstitutionalState {
  nextId: number
  organizations: Institution[]
}
export interface ProvincialDelegation {
  autonomy: number
  powers: (typeof PROVINCIAL_POWERS)[number][]
  income: number
  budget: number
  treasury: number
  since: number
}
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
        o.status === 'active' &&
        o.members.includes(a) &&
        o.members.includes(b) &&
        o.charter.powers.includes(power),
    ) ??
      false)
  )
}
export function foreignPolicyMandate(w: World, nation: number, parties: number[] = []) {
  const bodies =
    w.institutions?.organizations.filter(
      (o) =>
        o.status === 'active' && o.members.includes(nation) && o.charter.powers.includes('foreignPolicy'),
    ) ?? []
  return bodies.every((o) => {
    if (o.charter.rule === 'unanimity') return o.members.every((id) => parties.includes(id))
    if (o.charter.rule === 'majority')
      return o.members.filter((id) => parties.includes(id)).length > o.members.length / 2
    const total = o.members.reduce((s, id) => s + Math.sqrt(Math.max(1, w.nations[id].population)), 0),
      votes = o.members
        .filter((id) => parties.includes(id))
        .reduce((s, id) => s + Math.sqrt(Math.max(1, w.nations[id].population)), 0)
    return votes > total / 2
  })
}
/** A standing mutual-defense commitment authorizes defense against the specific aggressor. */
export function collectiveDefense(w: World, nation: number, attacker: number) {
  return w.relations.some(
    (r) =>
      r.treaty === 'war' &&
      r.aggressor === attacker &&
      (r.a === attacker || r.b === attacker) &&
      sharedInstitution(w, nation, r.a === attacker ? r.b : r.a, 'defense'),
  )
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
  if (
    !c ||
    !Number.isFinite(c.contribution) ||
    c.contribution < 0 ||
    c.contribution > 0.15 ||
    !c.powers.length ||
    c.powers.some((p) => !INSTITUTION_POWERS.includes(p))
  )
    throw new Error('A charter needs explicit supported powers and bounded contributions.')
  if (c.operation === 'found') {
    if (
      parties.length < 2 ||
      parties.length > 32 ||
      !term.text.trim() ||
      ensureInstitutions(w).organizations.length >= 128
    )
      throw new Error(
        'Founding an institution needs two to thirty-two consenting states and an explicit name.',
      )
    return
  }
  const organization = w.institutions?.organizations.find((o) => o.id === c.id && o.status === 'active')
  if (!organization) throw new Error('This institution is no longer active.')
  if (c.operation === 'withdraw') {
    if (!organization.members.includes(term.from))
      throw new Error('A government can only withdraw its own membership.')
    return
  }
  if (c.operation === 'join' && organization.members.includes(term.from))
    throw new Error('This state already belongs to the institution.')
  const voters = organization.members.filter((id) => parties.includes(id))
  if (organization.charter.rule === 'unanimity' && !organization.members.every((id) => parties.includes(id)))
    throw new Error('The charter requires every existing member to consent.')
  if (organization.charter.rule === 'majority' && voters.length <= organization.members.length / 2)
    throw new Error('The charter requires a majority of existing members.')
  if (organization.charter.rule === 'weighted') {
    const weight = (ids: number[]) =>
      ids.reduce((s, id) => s + Math.sqrt(Math.max(1, w.nations[id].population)), 0)
    if (weight(voters) <= weight(organization.members) / 2)
      throw new Error('The charter requires a majority of weighted votes.')
  }
  if (c.operation === 'amend' && !organization.members.includes(term.from))
    throw new Error('Only a member can propose a charter amendment.')
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
    c = structuredClone(term.charter!)
  if (c.operation === 'found')
    state.organizations.push({
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
    })
  else {
    const organization = state.organizations.find((o) => o.id === c.id)!
    if (c.operation === 'join') organization.members.push(term.from)
    else if (c.operation === 'amend') {
      organization.charter = c
      if (term.text.trim()) organization.name = term.text.slice(0, 140)
    } else {
      organization.members = organization.members.filter((id) => id !== term.from)
      if (organization.charter.exit === 'notice') {
        w.nations[term.from].legitimacy = Math.max(0, w.nations[term.from].legitimacy - 3)
        for (const id of organization.members) {
          const rel = relation(w, id, term.from)
          if (rel) rel.opinion = Math.max(-100, rel.opinion - 8)
        }
      }
    }
    if (organization.members.length < 2) {
      const beneficiary = organization.members[0] ?? term.from
      transfer(
        w,
        `institution:${organization.id}`,
        governmentAccount(beneficiary),
        organization.treasury,
        'institution dissolution',
      )
      organization.status = 'dissolved'
    }
  }
}
export function institutionalFunds(w: World) {
  return (
    (w.institutions?.organizations.reduce((s, o) => s + o.treasury, 0) ?? 0) +
    w.regions.reduce((s, r) => s + (r.delegation?.treasury ?? 0), 0)
  )
}
export function transferInstitutionMembership(w: World, from: number, to: number) {
  for (const o of w.institutions?.organizations ?? []) {
    o.members = [...new Set(o.members.map((id) => (id === from ? to : id)))]
    if (o.status === 'active' && o.members.length < 2) {
      transfer(w, `institution:${o.id}`, governmentAccount(to), o.treasury, 'institution succession')
      o.status = 'dissolved'
    }
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
            Math.min(1.5, provincialServiceBudget(r, 'policing') / Math.max(1, population(r) / 10000)) * 0.2,
          0,
          100,
        )
    }
  for (const o of w.institutions?.organizations ?? []) {
    if (o.status !== 'active') continue
    o.income = 0
    o.grants = 0
    const former = o.members,
      active = former.filter((id) => w.regions.some((r) => r.nation === id))
    o.members = active
    if (active.length < 2) {
      const beneficiary = active[0] ?? former[0]
      if (beneficiary !== undefined)
        transfer(
          w,
          `institution:${o.id}`,
          governmentAccount(beneficiary),
          o.treasury,
          'institution dissolution',
        )
      o.status = 'dissolved'
      continue
    }
    for (const id of active) {
      const n = w.nations[id],
        paid = Math.min(Math.max(0, n.treasury), n.income * o.charter.contribution)
      transfer(w, governmentAccount(n.id), `institution:${o.id}`, paid, 'institution contribution')
      o.income += paid
    }
    if (o.charter.powers.includes('defense')) {
      const recipients = active
        .filter((id) => w.relations.some((r) => r.treaty === 'war' && (r.a === id || r.b === id)))
        .sort((a, b) => w.nations[a].treasury - w.nations[b].treasury)
      const budget = Math.min(o.treasury, o.income * 0.8)
      for (const id of recipients) {
        const grant = budget / recipients.length
        transfer(w, `institution:${o.id}`, governmentAccount(id), grant, 'institution defense grant')
        o.grants += grant
      }
    }
    if (o.charter.powers.includes('research')) {
      const knowledge = active.reduce((s, id) => s + w.nations[id].budget.research, 0) * 0.004
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
    if (!integer(s.nextId, 1, 1e12) || !Array.isArray(s.organizations) || s.organizations.length > 128) fail()
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
        !['active', 'dissolved'].includes(o.status) ||
        !['public', 'secret'].includes(o.visibility) ||
        !finite(o.treasury, 0, 1e14) ||
        !finite(o.income, 0, 1e14) ||
        !finite(o.grants, 0, 1e14) ||
        !integer(o.sourceOffer, 1, 1e12) ||
        !c ||
        !['found', 'join', 'withdraw', 'amend'].includes(c.operation) ||
        !integer(c.id, 0, 1e12) ||
        ![
          'defense-league',
          'customs-union',
          'research-community',
          'confederation',
          'federation',
          'bespoke',
        ].includes(c.form) ||
        !['unanimity', 'majority', 'weighted'].includes(c.rule) ||
        !['free', 'notice'].includes(c.exit) ||
        !finite(c.contribution, 0, 0.15) ||
        !Array.isArray(c.powers) ||
        !c.powers.length ||
        new Set(c.powers).size !== c.powers.length ||
        c.powers.some((p) => !INSTITUTION_POWERS.includes(p))
      )
        fail()
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
