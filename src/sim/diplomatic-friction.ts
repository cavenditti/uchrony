import { publicExpense } from './ledger'
import { nationalRealService } from './public-services'
import { relation, type World } from './types'
import type { DiplomaticClause, DiplomaticOffer, StateAgentPlan } from './statecraft-types'
import { agreementTerms } from './agreements'
import { sharedInstitution } from './institutions'
import { intelligenceService, reportedWar } from './intelligence'
import { hashSeed } from './random'

type Proposal = StateAgentPlan['offers'][number]
interface Initiative {
  month: number
  key: string
  pressure: string
  parties: number[]
  kind: 'proposal' | 'message'
  offer: number
}
export interface ForeignOffice {
  nation: number
  load: number
  spent: number
  totalSpent: number
  lastMonth: number
  notice: string
  initiatives: Initiative[]
}
export interface ForeignOffices {
  offices: ForeignOffice[]
}
export class DiplomaticFriction extends Error {}
export function hasActiveReplacement(w: World, parent: number, current = 0) {
  const offers = w.statecraft?.offers ?? [],
    byId = new Map(offers.map((p) => [p.id, p]))
  return offers.some((p) => {
    if (p.id === current || p.status !== 'ratified' || (p.ends && p.ends <= w.month)) return false
    const seen = new Set<number>()
    let id = p.supersedes
    while (id && !seen.has(id)) {
      if (id === parent) return true
      seen.add(id)
      id = byId.get(id)?.supersedes ?? 0
    }
    return false
  })
}
const symmetric = new Set(['trade', 'alliance', 'peace', 'nonaggression'])
const ordinaryRights = new Set([
  'trade',
  'preferential-trade',
  'alliance',
  'access',
  'transit',
  'basing',
  'settlement',
  'nonaggression',
  'guarantee',
])
function termKey(t: DiplomaticClause) {
  const pair = symmetric.has(t.kind) ? [t.from, t.to].sort((a, b) => a - b) : [t.from, t.to]
  return [
    t.kind,
    pair,
    t.good,
    t.field,
    t.amount,
    [...t.regions].sort((a, b) => a - b),
    t.charter
      ? [
          t.charter.operation,
          t.charter.id,
          t.charter.form,
          [...t.charter.powers].sort(),
          t.charter.rule,
          t.charter.contribution,
          t.charter.exit,
          t.charter.defense ?? 'either',
          t.charter.responseMonths ?? 6,
        ]
      : null,
    t.delegation ? [...t.delegation.powers].sort() : null,
    ['custom', 'create', 'merge'].includes(t.kind) ? t.text.toLowerCase().replace(/\s+/g, ' ').trim() : '',
  ]
}
function semanticKey(p: Pick<Proposal, 'parties' | 'terms'>) {
  return String(
    hashSeed(
      JSON.stringify([
        [...p.parties].sort((a, b) => a - b),
        p.terms
          .map(termKey)
          .map((t) => JSON.stringify(t))
          .sort(),
      ]),
    ),
  )
}
function pressure(w: World, nation: number) {
  const n = w.nations[nation]
  return String(
    hashSeed(
      JSON.stringify([
        n.character?.leader.generation,
        w.regions.filter((r) => r.nation === nation).length,
        n.foodCoverage < 0.75 ? 0 : n.foodCoverage < 0.95 ? 1 : 2,
        n.stability < 30 ? 0 : n.stability < 50 ? 1 : 2,
        w.relations
          .filter((r) => r.treaty === 'war' && (r.a === nation || r.b === nation))
          .map((r) => [r.a, r.b, r.since]),
        w.sovereignty?.provinces.some((r) => r.nation === nation && r.stage === 'contested') ?? false,
      ]),
    ),
  )
}
function office(w: World, nation: number) {
  w.foreignOffices ??= { offices: [] }
  let found = w.foreignOffices.offices.find((o) => o.nation === nation)
  if (!found) {
    found = { nation, load: 0, spent: 0, totalSpent: 0, lastMonth: w.month, notice: '', initiatives: [] }
    w.foreignOffices.offices.push(found)
  }
  return found
}
export function diplomaticCapacity(w: World, nation: number) {
  const n = w.nations[nation],
    skill = n.character?.leader.skills.diplomacy ?? 0.5,
    staff = Math.min(
      1.4,
      (nationalRealService(w, nation, 'administration') / Math.max(1, n.population / 100000)) * 0.04,
    )
  return {
    capacity: 3 + skill * 0.8 + n.technologies.logistics * 0.2 + staff,
    recovery: (0.35 + skill * 0.2 + staff * 0.15) * (0.5 + n.stability / 200),
  }
}
export function advanceDiplomaticOffices(w: World) {
  for (const body of w.institutions?.organizations ?? [])
    if (body.status !== 'dissolved') for (const id of body.members) office(w, id)
  for (const p of w.statecraft?.offers ?? [])
    if (p.status === 'ratified' && (!p.ends || p.ends > w.month)) for (const id of p.parties) office(w, id)
  for (const o of w.foreignOffices?.offices ?? []) {
    const elapsed = w.month - o.lastMonth
    if (elapsed <= 0) continue
    if (!w.regions.some((r) => r.nation === o.nation)) {
      o.load = 0
      o.spent = 0
      o.lastMonth = w.month
      continue
    }
    const burden = ongoingBurden(w, o.nation),
      due = fee(w, o.nation, burden * 0.04),
      paid = Math.min(Math.max(0, w.nations[o.nation].treasury), due)
    publicExpense(w, o.nation, paid, 'diplomatic maintenance')
    const funding = due > 0 ? 0.25 + (0.75 * paid) / due : 1
    o.load = Math.max(
      0,
      o.load - (diplomaticCapacity(w, o.nation).recovery * elapsed * funding) / (1 + burden * 0.04),
    )
    o.lastMonth = w.month
    o.spent = paid
    o.totalSpent += paid
    o.initiatives = o.initiatives.filter((i) => w.month - i.month <= 60).slice(-96)
  }
}
function ongoingBurden(w: World, nation: number) {
  return (
    (w.statecraft?.offers.filter(
      (p) =>
        p.status === 'ratified' &&
        (!p.ends || p.ends > w.month) &&
        p.parties.includes(nation) &&
        p.resolved.some((t) => !['war', 'payment', 'devolution', 'institution'].includes(t.kind)),
    ).length ?? 0) +
    (w.institutions?.organizations.filter((o) => o.status !== 'dissolved' && o.members.includes(nation))
      .length ?? 0) *
      1.5
  )
}
function exempt(p: Proposal) {
  return p.parties.length === 1 && p.terms.every((t) => t.kind === 'war' || t.kind === 'devolution')
}
function urgent(w: World, nation: number, p: Proposal) {
  const security = p.terms.every(
    (t) =>
      ['peace', 'alliance', 'guarantee', 'access'].includes(t.kind) ||
      (t.kind === 'institution' && t.charter?.powers.length === 1 && t.charter.powers[0] === 'defense'),
  )
  if (!security) return false
  return w.relations.some(
    (r) =>
      r.treaty === 'war' &&
      p.parties.some((id) => id === r.a || id === r.b) &&
      reportedWar(w, nation, r.a, r.b),
  )
}
function effort(p: Proposal) {
  return (
    1 +
    Math.max(0, p.parties.length - 2) * 0.3 +
    Math.max(0, p.terms.length - 1) * 0.2 +
    (p.terms.some((t) => ['cede', 'create', 'merge', 'institution', 'custom'].includes(t.kind)) ? 1.5 : 0)
  )
}
function travel(w: World, nation: number, parties: number[]) {
  const s = intelligenceService(w, nation),
    home = w.cells[w.regions[w.nations[nation].capital].center]
  const distances = parties
    .filter((id) => id !== nation)
    .map((id) => {
      const places = s.chart.filter((r) => r.nation === id).map((r) => w.cells[w.regions[r.id].center])
      return places.length ? Math.min(...places.map((c) => Math.hypot(home.q - c.q, home.r - c.r))) : 45
    })
  return Math.min(
    6,
    Math.ceil(Math.max(0, ...distances) / (18 + w.nations[nation].technologies.logistics * 4)),
  )
}
function fee(w: World, nation: number, weight: number) {
  return (0.5 + Math.min(3, w.nations[nation].population / 1000000)) * weight
}
function remaining(w: World, offer: DiplomaticOffer, term: DiplomaticClause) {
  return (
    Math.min(offer.ends || Infinity, term.duration ? offer.activated + term.duration : Infinity) - w.month
  )
}
function covered(w: World, t: DiplomaticClause, parties: number[], nation: number) {
  if (t.kind !== 'institution' && t.from !== nation && t.to !== nation) return false
  if (t.kind === 'institution' && t.charter?.operation === 'found')
    return (
      w.institutions?.organizations.some(
        (o) =>
          o.status !== 'dissolved' &&
          parties.every((id) => o.members.includes(id)) &&
          t.charter!.powers.every((p) => o.charter.powers.includes(p)),
      ) ?? false
    )
  if (!ordinaryRights.has(t.kind) && !['tribute', 'goods', 'research'].includes(t.kind)) return false
  const active = agreementTerms(w).filter(({ term, offer }) => remaining(w, offer, term) > 12)
  if (active.some(({ term }) => JSON.stringify(termKey(term)) === JSON.stringify(termKey(t)))) return true
  const pair = (a: number, b: number) => [a, b].includes(t.from) && [a, b].includes(t.to),
    rel = relation(w, t.from, t.to),
    bilateral = active.some(({ term }) => term.kind === 'alliance' && pair(term.from, term.to)),
    alliance =
      (rel?.treaty === 'alliance' &&
        (!agreementTerms(w, 'alliance').some(({ term }) => pair(term.from, term.to)) || bilateral)) ||
      bilateral,
    defense = sharedInstitution(w, t.from, t.to, 'defense'),
    trade = sharedInstitution(w, t.from, t.to, 'trade')
  if (t.kind === 'alliance') return alliance || (defense && trade)
  if (t.kind === 'access' || t.kind === 'nonaggression') return alliance || defense
  if (t.kind === 'trade')
    return (
      alliance ||
      trade ||
      (rel?.treaty === 'trade' && !agreementTerms(w, 'trade').some(({ term }) => pair(term.from, term.to)))
    )
  return false
}
function deny(w: World, nation: number, reason: string): never {
  office(w, nation).notice = reason
  throw new DiplomaticFriction(reason)
}
function debit(w: World, nation: number, weight: number, emergency: boolean) {
  const o = office(w, nation),
    cash = fee(w, nation, weight),
    n = w.nations[nation],
    capacity = diplomaticCapacity(w, nation).capacity,
    pending = (w.statecraft?.offers ?? [])
      .filter(
        (p) =>
          p.status === 'proposed' &&
          p.parties.includes(nation) &&
          p.signatures.some((s) => s.nation === nation) &&
          w.month - p.month < 24,
      )
      .reduce((sum, p) => sum + effort({ ...p, duration: 0 }) * 0.25 * (1 - (w.month - p.month) / 24), 0),
    load = Math.max(o.load, pending)
  const limit = emergency ? 16 : load <= 0.2 ? Math.min(24, Math.max(capacity, load + weight)) : capacity
  if (load + weight > limit)
    deny(
      w,
      nation,
      'The foreign office is occupied with existing commitments. Let negotiations progress before opening another initiative.',
    )
  if (!emergency && n.treasury < cash)
    deny(w, nation, 'The foreign office lacks funds for dispatches and negotiations.')
  const spent = Math.min(Math.max(0, n.treasury), cash)
  publicExpense(w, n.id, spent, 'diplomatic dispatch')
  o.spent += spent
  o.totalSpent += spent
  o.load = load + weight
  o.notice = ''
}
/** Admission happens before signature; signed text and treaty durations are never rewritten. */
export function openDiplomaticProposal(w: World, nation: number, p: Proposal) {
  if (exempt(p)) return { notBefore: w.month, key: '', pressure: '' }
  if (p.supersedes) {
    const parent = w.statecraft?.offers.find((x) => x.id === p.supersedes)
    if (
      parent &&
      !parent.parties.includes(nation) &&
      !intelligenceService(w, nation).agreements.some((r) => r.offer.id === parent.id)
    )
      throw new Error('A replacement must refer to an agreement known to this government.')
    if (!parent || !parent.parties.every((id) => p.parties.includes(id)))
      throw new Error(
        'Replacing an agreement requires every existing party to participate. Use a citation for a document that is only background context.',
      )
    if (parent.parties.includes(nation) && hasActiveReplacement(w, parent.id))
      deny(
        w,
        nation,
        'A newer agreement already replaced those terms. Negotiate from the current arrangement instead of creating a parallel branch.',
      )
  }
  const o = office(w, nation),
    key = semanticKey(p),
    current = pressure(w, nation),
    emergency = urgent(w, nation, p),
    old = w.statecraft?.offers ?? [],
    counterpart = p.parties.filter((id) => id !== nation),
    prior = o.initiatives
      .filter((i) => i.kind === 'proposal' && i.parties.some((id) => counterpart.includes(id)))
      .at(-1),
    changed = !!prior && prior.pressure !== current,
    duplicate = old.find((x) => x.status === 'proposed' && semanticKey(x) === key)
  if (duplicate)
    deny(
      w,
      nation,
      'Those terms are already under negotiation. Reply to the existing document instead of opening a duplicate.',
    )
  const parent = p.supersedes ? old.find((past) => past.id === p.supersedes) : undefined,
    materialReplacement = parent && semanticKey(parent) !== key
  if (!materialReplacement && p.terms.every((t) => covered(w, t, p.parties, nation)))
    deny(w, nation, 'Existing arrangements already provide these rights. No new agreement is needed.')
  const same = old
    .filter((x) => x.author === nation && semanticKey(x) === key)
    .sort((a, b) => b.month - a.month)[0]
  if (
    same &&
    ((same.status === 'ratified' &&
      p.terms.every(
        (t) => ordinaryRights.has(t.kind) || ['tribute', 'goods', 'research'].includes(t.kind),
      )) ||
      (!changed && w.month - same.month < 12))
  ) {
    const expiring = same.status === 'ratified' && same.resolved.some((t) => remaining(w, same, t) <= 12)
    if (!expiring)
      deny(
        w,
        nation,
        'This initiative was already pursued recently. Reopen it after a material change or near the agreement’s expiry.',
      )
  }
  const pending = old.find(
    (x) =>
      x.status === 'proposed' &&
      x.parties.includes(nation) &&
      x.parties.some((id) => counterpart.includes(id)) &&
      x.id !== p.supersedes,
  )
  if (pending && !changed && !emergency)
    deny(
      w,
      nation,
      'A negotiation with this counterpart is already open. Consolidate the terms or answer that proposal first.',
    )
  if (prior && !changed && !emergency && w.month - prior.month < (p.supersedes ? 2 : 6))
    deny(
      w,
      nation,
      'Recent diplomatic work with this counterpart needs time to settle. A new initiative is premature.',
    )
  const weight = effort(p) * (p.supersedes ? 0.7 : 1)
  debit(w, nation, weight, emergency)
  const politics = Math.ceil((1 - (w.nations[nation].character?.effective.centralization ?? 0.5)) * 2),
    delay = emergency ? 1 : Math.min(18, 1 + Math.ceil(weight) + travel(w, nation, p.parties) + politics)
  return { notBefore: w.month + delay, key, pressure: current }
}
export function rememberProposal(
  w: World,
  nation: number,
  p: Proposal,
  id: number,
  admission: ReturnType<typeof openDiplomaticProposal>,
) {
  if (exempt(p)) return
  office(w, nation).initiatives.push({
    month: w.month,
    key: admission.key,
    pressure: admission.pressure,
    parties: [...p.parties],
    kind: 'proposal',
    offer: id,
  })
  office(w, nation).initiatives = office(w, nation).initiatives.slice(-96)
}
export function admitDiplomaticConsent(w: World, nation: number, offer: DiplomaticOffer) {
  if (!offer.parties.includes(nation) || offer.status !== 'proposed')
    throw new Error('This government cannot sign those terms.')
  if (offer.signatures.some((s) => s.nation === nation && s.digest === offer.digest)) return true
  // Existing save documents keep their original admission contract.
  if (offer.notBefore !== undefined && !exempt({ ...offer, duration: 0 })) {
    try {
      debit(w, nation, effort({ ...offer, duration: 0 }) * 0.55, urgent(w, nation, { ...offer, duration: 0 }))
    } catch (e) {
      if (e instanceof DiplomaticFriction) return false
      throw e
    }
  }
  offer.signatures.push({ nation, digest: offer.digest, month: w.month })
  return true
}
export function admitDiplomaticMessage(
  w: World,
  nation: number,
  message: StateAgentPlan['messages'][number],
) {
  const o = office(w, nation),
    parties = [nation, ...message.to],
    key = String(
      hashSeed(
        JSON.stringify([
          [...message.to].sort((a, b) => a - b),
          message.offer,
          message.subject.toLowerCase().trim(),
          message.body.toLowerCase().trim(),
        ]),
      ),
    ),
    last = o.initiatives
      .filter((i) => i.kind === 'message' && i.parties.some((id) => id !== nation && message.to.includes(id)))
      .at(-1),
    duplicate = o.initiatives.some((i) => i.kind === 'message' && i.key === key && w.month - i.month < 12)
  if (duplicate || (last && w.month - last.month < 2)) {
    o.notice =
      'Recent correspondence is still in transit or repeats an existing message. Wait for a substantive response.'
    return false
  }
  try {
    debit(w, nation, 0.2 + Math.max(0, message.to.length - 1) * 0.08, false)
  } catch (e) {
    if (e instanceof DiplomaticFriction) return false
    throw e
  }
  o.initiatives.push({ month: w.month, key, pressure: '', parties, kind: 'message', offer: message.offer })
  o.initiatives = o.initiatives.slice(-96)
  return true
}
export function foreignOfficeContext(w: World, nation: number) {
  const o = w.foreignOffices?.offices.find((o) => o.nation === nation),
    capacity = diplomaticCapacity(w, nation)
  return {
    ...capacity,
    committed: o?.load ?? 0,
    spent: o?.spent ?? 0,
    notice: o?.notice ?? '',
    pending:
      w.statecraft?.offers
        .filter((p) => p.status === 'proposed' && p.parties.includes(nation))
        .map((p) => ({
          offer: p.id,
          title: p.title,
          earliestImplementation: p.notBefore ?? p.month,
        })) ?? [],
    guidance:
      'Existing arrangements remain useful without new paperwork. Open fewer substantive negotiations, consolidate related terms, and allow attention, dispatches and review time. Rejection and abstention require no diplomatic expenditure. Unilateral war orders remain available.',
  }
}
