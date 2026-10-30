/** Constitutional events drive naming reviews; ordinary defense bookkeeping never spends a call.
 * The journal is authoritative. A saved review cursor also acknowledges a name that still fits. */
import { ensureInstitutionRecord, institutionMembers, recordInstitution } from './institution-lifecycle'
import type { Institution, InstitutionEvent } from './institution-types'
import type { World } from './types'

const latestEvents = new WeakMap<
  Institution,
  { journal: InstitutionEvent[]; length: number; event: InstitutionEvent | undefined }
>()

/** Cache the latest relevant revision so scheduler polls do not rescan centuries of history. */
function namingEvent(o: Institution) {
  const journal = o.events!
  const cached = latestEvents.get(o)
  if (cached?.journal === journal && cached.length === journal.length) return cached.event
  // Journals append in place during play; imports and settlement trials may replace the array.
  const prior = cached?.journal === journal && cached.length <= journal.length ? cached : undefined
  let event = prior?.event
  for (let i = journal.length - 1; i >= (prior?.length ?? 0); i--)
    if (journal[i].kind !== 'defense' && journal[i].kind !== 'withdrawal') {
      event = journal[i]
      break
    }
  latestEvents.set(o, { journal, length: journal.length, event })
  return event
}

/** Pick up old saves as well as new transitions, without reopening a council's explicit rename. */
function pendingReview(w: World, o: Institution) {
  if (o.status === 'dissolved') return false
  ensureInstitutionRecord(w, o)
  const event = namingEvent(o)
  return !!event && event.kind !== 'renamed' && event.id > (o.nameReview?.event ?? 0)
}

const nationName = (w: World, id: number) => ({
  id,
  name: w.nations[id].name,
  shortName: w.nations[id].shortName,
})
const words = (name: string) =>
  ` ${name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `
const namesNation = (normalizedName: string, nation: ReturnType<typeof nationName>) =>
  [nation.name, nation.shortName].some((label) => label.trim() && normalizedName.includes(words(label)))

/** Compact context built only after the worker's request budget allows a launch. */
export function institutionNamingContext(w: World) {
  const pending = (w.institutions?.organizations ?? []).filter((o) => pendingReview(w, o))
  // Separate confidential and public batches so private histories cannot inform public names.
  const selected = pending.filter((o) => o.visibility === pending[0]?.visibility).slice(0, 6)
  return {
    kind: 'institution-naming' as const,
    month: w.month,
    targets: selected.map((o) => {
      const members = institutionMembers(o)
      const former = new Set<number>()
      for (const event of o.events!) for (const id of event.version?.members ?? []) former.add(id)
      // Defense updates must not crowd the constitutional trigger out of the small prompt window.
      const recent: InstitutionEvent[] = []
      for (let i = o.events!.length - 1; i >= 0 && recent.length < 8; i--)
        if (o.events![i].kind !== 'defense') recent.push(o.events![i])
      // A legacy baseline may already have lost members named in the old title.
      const normalizedName = words(o.name)
      const excluded = w.nations.filter(
        (n) => !members.includes(n.id) && (former.has(n.id) || namesNation(normalizedName, n)),
      )
      return {
        id: `institution:${o.id}`,
        kind: 'institution' as const,
        name: o.name,
        event: namingEvent(o)!.id,
        visibility: o.visibility,
        status: o.status,
        charter: { ...o.charter, powers: [...o.charter.powers] },
        members: members.map((id) => nationName(w, id)),
        excludedMembers: excluded.map((n) => nationName(w, n.id)),
        recentEvents: recent.reverse().map((e) => ({
          month: e.month,
          kind: e.kind,
          detail: e.detail.slice(0, 600),
          nations: e.nations.map((id) => nationName(w, id)),
        })),
      }
    }),
  }
}
/** Requested revisions travel with the response so later constitutional changes invalidate it. */
export type InstitutionNamingContext = ReturnType<typeof institutionNamingContext>
interface NameProposal {
  id: string
  name: string
  reason: string
  alternatives: string[]
}
const cleanText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f<>]/.test(v)

/** Validate a complete batch before applying cosmetic changes; stale replies are harmless no-ops.
 * Names cannot restore expelled/suspended states, change powers, or rewrite earlier versions. */
export function acceptInstitutionNames(
  w: World,
  context: InstitutionNamingContext,
  value: unknown,
  model: string,
): boolean {
  const names = (value as { names?: unknown } | null)?.names
  if (!cleanText(model, 160) || !Array.isArray(names) || names.length !== context.targets.length)
    throw new Error('Return one name review for each requested institution.')
  const targets = new Map(context.targets.map((target) => [target.id, target]))
  const organizations = new Map(w.institutions?.organizations.map((o) => [`institution:${o.id}`, o]))
  const seen = new Set<string>()
  const accepted: {
    o: Institution
    target: InstitutionNamingContext['targets'][number]
    name: NameProposal
  }[] = []
  for (const name of names as NameProposal[]) {
    if (
      !name ||
      !targets.has(name.id) ||
      seen.has(name.id) ||
      !cleanText(name.name, 100) ||
      !cleanText(name.reason, 240) ||
      !Array.isArray(name.alternatives) ||
      name.alternatives.length > 3 ||
      name.alternatives.some((alt) => !cleanText(alt, 100))
    )
      throw new Error('Institution names must be plain, short and attached to requested IDs.')
    seen.add(name.id)
    const target = targets.get(name.id)!,
      o = organizations.get(name.id)
    if (!o || !pendingReview(w, o) || namingEvent(o)?.id !== target.event || o.name !== target.name) continue
    const members = institutionMembers(o)
    if (
      target.members.length !== members.length ||
      target.members.some(
        (n, i) =>
          n.id !== members[i] || n.name !== w.nations[n.id].name || n.shortName !== w.nations[n.id].shortName,
      )
    )
      continue
    const proposed = name.name.trim()
    const normalizedName = words(proposed)
    if (w.nations.some((n) => !members.includes(n.id) && namesNation(normalizedName, n)))
      throw new Error('An institution name cannot include a departed, suspended or nonmember state.')
    accepted.push({ o, target, name: { ...name, name: proposed } })
  }
  const proposed = new Map(accepted.map(({ o, name }) => [o.id, name.name.toLowerCase()]))
  const active = [...organizations.values()].filter((o) => o.status !== 'dissolved')
  for (const { o, name } of accepted)
    if (
      active.some(
        (other) =>
          other.id !== o.id &&
          (proposed.get(other.id) ?? other.name.toLowerCase()) === name.name.toLowerCase(),
      )
    )
      throw new Error('Choose distinct names for active institutions.')
  for (const { o, target, name } of accepted) {
    if (o.name !== name.name) {
      const former = o.name
      o.name = name.name
      recordInstitution(w, o, 'renamed', `${former} became ${o.name}. ${name.reason}`, institutionMembers(o))
    }
    o.nameReview = { event: target.event, model }
  }
  return accepted.length > 0
}
