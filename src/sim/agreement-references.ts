import type { DiplomaticOffer, Statecraft } from './statecraft-types'

export type AgreementTextPart = { text: string; agreement?: number }
export const agreementReference = (id: number) => `[[agreement:${id}]]`

/** References are citations, never consent, executable markup, or changes to signed terms. */
export function splitAgreementReferences(text: string): AgreementTextPart[] {
  const pattern =
    /\[\[agreement:([1-9]\d{0,12})\]\]|\b(?:agreements?|offers?|proposals?|treaties|treaty|accords?|pacts?)\s*(?:no\.?\s*|number\s*|#\s*)?([1-9]\d{0,12})(?!\w)/gi
  const parts: AgreementTextPart[] = []
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    const id = Number(match[1] ?? match[2]),
      at = match.index!
    // Avoid mistaking durations and amounts for old document IDs.
    if (
      !Number.isSafeInteger(id) ||
      id > 1e12 ||
      (!match[1] &&
        !/#|\b(?:no\.?|number)\s*\d/i.test(match[0]) &&
        /^(?:\s*[-–]\s*|\s+)(?:months?|years?|tonnes?|tons?|crowns?|percent|%)(?:\b|$)|^\.\d/i.test(
          text.slice(at + match[0].length),
        ))
    )
      continue
    if (at > offset) parts.push({ text: text.slice(offset, at) })
    parts.push({ text: match[0], agreement: id })
    offset = at + match[0].length
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) })
  return parts.length ? parts : [{ text }]
}
export function referencedAgreementIds(text: string) {
  return splitAgreementReferences(text).flatMap((part) =>
    part.agreement === undefined ? [] : [part.agreement],
  )
}
export function agreementTitle(offer: DiplomaticOffer) {
  return (
    splitAgreementReferences(offer.title)
      .map((part) => (part.agreement === undefined ? part.text : 'prior agreement'))
      .join('') || 'Untitled agreement'
  )
}
export function visibleAgreement(
  offers: DiplomaticOffer[],
  id: number,
  nation: number,
  confidential: boolean,
) {
  return offers.find(
    (offer) =>
      offer.id === id && (offer.visibility === 'public' || (confidential && offer.parties.includes(nation))),
  )
}
export function offerReferenceIds(offer: DiplomaticOffer) {
  return [
    ...(offer.supersedes ? [offer.supersedes] : []),
    ...referencedAgreementIds(
      [
        offer.title,
        offer.ruling,
        ...offer.terms.map((t) => t.text),
        ...offer.resolved.map((t) => t.text),
      ].join('\n'),
    ),
  ]
}
/** Keep cited ancestors when trimming the working ledger; cycles are harmless. */
export function retainAgreementReferences(state: Statecraft) {
  const byId = new Map(state.offers.map((offer) => [offer.id, offer]))
  const ordered = [...state.offers].sort((a, b) => a.month - b.month || a.id - b.id)
  const keep = new Set(
    ordered
      .filter((offer) => offer.status === 'proposed' || offer.status === 'ratified')
      .map((offer) => offer.id),
  )
  const inactive = ordered.filter((offer) => !keep.has(offer.id)),
    slots = Math.max(0, 240 - keep.size)
  if (slots) for (const offer of inactive.slice(-slots)) keep.add(offer.id)
  const texts = [
    ...state.messages.flatMap((m) => [m.subject, m.body]),
    ...state.agents.flatMap((a) => [a.assessment, a.strategy, a.memory, a.escalation, ...a.goals]),
    ...state.rulings.map((r) => r.reasoning),
    ...state.audit.map((a) => a.message),
  ]
  const queue = [
    ...keep,
    ...state.messages.map((m) => m.offer),
    ...state.rulings.map((r) => r.offer),
    ...texts.flatMap(referencedAgreementIds),
  ]
  const visited = new Set<number>()
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i],
      offer = byId.get(id)
    if (!offer || visited.has(id)) continue
    visited.add(id)
    keep.add(id)
    queue.push(...offerReferenceIds(offer))
  }
  return ordered.filter((offer) => keep.has(offer.id))
}

/** A bounded, visibility-filtered citation catalog, including references in inherited memory. */
export function agreementReferenceIndex(offers: DiplomaticOffer[], texts: string[]) {
  const byId = new Map(offers.map((offer) => [offer.id, offer])),
    selected = new Set<number>()
  const queue = texts.flatMap(referencedAgreementIds)
  for (let i = 0; i < queue.length && selected.size < 120; i++) {
    const id = queue[i],
      offer = byId.get(id)
    if (!offer || selected.has(id)) continue
    selected.add(id)
    queue.push(...offerReferenceIds(offer))
  }
  const recent = [...offers].sort((a, b) => b.month - a.month || b.id - a.id).slice(0, 60)
  for (const offer of recent) if (selected.size < 120) selected.add(offer.id)
  return [...selected].map((id) => {
    const offer = byId.get(id)!
    return {
      id,
      reference: agreementReference(id),
      title: offer.title,
      month: offer.month,
      status: offer.status,
      visibility: offer.visibility,
      parties: offer.parties,
      supersedes: offer.supersedes,
    }
  })
}
