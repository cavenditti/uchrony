/** Read-only atlas observations. Stable geography is shared; ownership changes are sparse,
 * with ten-year checkpoints bounding reconstruction to at most 120 monthly observations.
 * These projections are never accepted as simulation state or used to rerun history. */
import type { World } from './types'
import type { DiplomaticOffer } from './statecraft-types'
import type { Institution, InstitutionEvent, InstitutionVersion, DefenseCall } from './institution-types'
import { ensureInstitutionRecord } from './institution-lifecycle'
export interface ArchiveNation {
  id: number
  name: string
  shortName: string
  color: string
  capital: number
  government: string
  population: number
  gdp: number
  treasury: number
  stability: number
  extinct?: number
}
export interface ArchiveProvince {
  id: number
  name: string
  nation: number
}
export interface ArchiveFrame {
  month: number
  approximate: boolean
  checkpoint: boolean
  provinces: ArchiveProvince[]
  nations: ArchiveNation[]
  wars: { a: number; b: number; since: number; aggressor?: number }[]
  funds: { id: number; treasury: number; income: number; grants: number }[]
}
export interface WorldArchive {
  version: 1
  since: number
  frames: ArchiveFrame[]
}
export interface ArchiveQuery {
  id: number
  month: number
  institution?: number
  confidential?: boolean
  offset?: number
}
export interface ArchiveInstitution extends InstitutionVersion {
  id: number
  founded: number
  visibility: Institution['visibility']
  treasury: number
  income: number
  grants: number
}
export interface ArchiveMembership {
  nation: number
  since: number
  until?: number
  outcome?: string
  observed: boolean
}
export type ArchiveDocument = Pick<
  DiplomaticOffer,
  'id' | 'title' | 'month' | 'parties' | 'terms' | 'signatures'
>
export interface ArchiveResult {
  request: number
  requestedMonth: number
  month: number
  since: number
  latest: number
  approximate: boolean
  nations: ArchiveNation[]
  provinces: ArchiveProvince[]
  wars: ArchiveFrame['wars']
  institutions: ArchiveInstitution[]
  selected?: ArchiveInstitution & {
    events: InstitutionEvent[]
    totalEvents: number
    calls: DefenseCall[]
    offset: number
    memberships: ArchiveMembership[]
    finances: ({ month: number } & ArchiveFrame['funds'][number])[]
    documents: ArchiveDocument[]
    pending: ArchiveDocument[]
  }
}
const previousProvinces = new WeakMap<WorldArchive, { frame: ArchiveFrame; provinces: ArchiveProvince[] }>()
const nationSnapshot = (n: World['nations'][number]): ArchiveNation => ({
  id: n.id,
  name: n.name,
  shortName: n.shortName,
  color: n.color,
  capital: n.capital,
  government: n.government,
  population: n.population,
  gdp: n.gdp,
  treasury: n.treasury,
  stability: n.stability,
  ...(n.extinct !== undefined ? { extinct: n.extinct } : {}),
})
/** Binary search returns the latest recorded observation at or before the requested date. */
export function archiveFrameIndex(frames: readonly { month: number }[], month: number) {
  let low = 0,
    high = frames.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (frames[mid].month <= month) low = mid + 1
    else high = mid
  }
  return low - 1
}
function provincesAt(archive: WorldArchive, index: number) {
  let start = index
  while (start > 0 && !archive.frames[start].checkpoint) start--
  const result: ArchiveProvince[] = []
  for (let i = start; i <= index; i++)
    for (const province of archive.frames[i].provinces) result[province.id] = province
  return result
}
/** Capture month-end facts, or replace the same month's observation after an intervention.
 * Baseline capture happens before the first advance; old saves start at their actual import date. */
export function recordWorldArchive(w: World) {
  const archive = (w.archive ??= { version: 1, since: w.month, frames: [] })
  const last = archive.frames.at(-1),
    replacing = last?.month === w.month
  if (last && last.month > w.month) throw new Error('Historical observations cannot move backwards.')
  const checkpoint =
    !last || (replacing ? last.checkpoint : Math.floor(last.month / 120) !== Math.floor(w.month / 120))
  // Replacements compare to the preceding frame, not the observation being discarded.
  const previousIndex = archive.frames.length - (replacing ? 2 : 1)
  const cached = previousProvinces.get(archive)
  const prior =
    previousIndex < 0
      ? []
      : cached?.frame === archive.frames[previousIndex]
        ? cached.provinces
        : provincesAt(archive, previousIndex)
  const provinces = w.regions.map((r) => ({ id: r.id, name: r.name, nation: r.nation }))
  const frame: ArchiveFrame = {
    month: w.month,
    approximate: (w.economy?.periodMonths ?? 1) > 1 || w.fastForward?.lastMonth === w.month,
    checkpoint,
    provinces: checkpoint
      ? provinces
      : provinces.filter(
          (r) => !prior[r.id] || r.name !== prior[r.id].name || r.nation !== prior[r.id].nation,
        ),
    nations: w.nations.map(nationSnapshot),
    wars: w.relations
      .filter((r) => r.treaty === 'war')
      .map(({ a, b, since, aggressor }) => ({
        a,
        b,
        since,
        ...(aggressor !== undefined ? { aggressor } : {}),
      })),
    funds: (w.institutions?.organizations ?? []).map((o) => {
      ensureInstitutionRecord(w, o)
      return { id: o.id, treasury: o.treasury, income: o.income, grants: o.grants }
    }),
  }
  if (replacing) archive.frames[archive.frames.length - 1] = frame
  else archive.frames.push(frame)
  previousProvinces.set(archive, { frame, provinces })
}
/** Project one institution without leaking later names, members, decisions or defense outcomes. */
export function institutionAt(o: Institution, month: number): InstitutionVersion | undefined {
  const events = o.events ?? []
  for (let i = archiveFrameIndex(events, month); i >= 0; i--) if (events[i].version) return events[i].version
}
/** Resolve a bounded page. Confidential records are opt-in observer data, never government intelligence. */
export function queryWorldArchive(w: World, query: ArchiveQuery): ArchiveResult {
  if (!Number.isFinite(query.month)) throw new Error('Choose a valid historical date.')
  const archive = w.archive
  if (!archive?.frames.length) throw new Error('Historical observations are not available yet.')
  const index = archiveFrameIndex(archive.frames, query.month)
  if (index < 0) throw new Error('Detailed history is unknown before the first preserved observation.')
  const frame = archive.frames[index],
    funds = new Map(frame.funds.map((f) => [f.id, f]))
  const institutions: ArchiveInstitution[] = []
  let selected: ArchiveResult['selected']
  for (const o of w.institutions?.organizations ?? []) {
    if (o.visibility === 'secret' && !query.confidential) continue
    const version = institutionAt(o, frame.month)
    if (!version) continue
    const value: ArchiveInstitution = {
      ...version,
      id: o.id,
      founded: o.founded,
      visibility: o.visibility,
      treasury: 0,
      income: 0,
      grants: 0,
      ...funds.get(o.id),
    }
    institutions.push(value)
    if (query.institution !== o.id) continue
    const count = archiveFrameIndex(o.events ?? [], frame.month) + 1,
      offset = Math.max(0, Math.floor(query.offset ?? 0))
    const calls = new Map<string, DefenseCall>()
    for (let i = 0; i < count; i++) {
      const call = o.events![i].call
      if (call) calls.set(call.id, call)
    }
    const events = o.events!.slice(Math.max(0, count - offset - 50), Math.max(0, count - offset)).reverse()
    const references = new Set(events.flatMap((e) => (e.offer === undefined ? [] : [e.offer])))
    const document = (p: DiplomaticOffer): ArchiveDocument => ({
      id: p.id,
      title: p.title,
      month: p.month,
      parties: p.parties,
      terms: p.terms,
      signatures: p.signatures.filter((s) => s.month <= frame.month),
    })
    selected = {
      ...value,
      events,
      totalEvents: count,
      calls: [...calls.values()],
      offset,
      memberships: institutionMemberships(o.events!.slice(0, count)),
      finances: archive.frames.slice(Math.max(0, index - 23), index + 1).flatMap((f) => {
        const funds = f.funds.find((x) => x.id === o.id)
        return funds ? [{ month: f.month, ...funds }] : []
      }),
      documents: (w.statecraft?.offers ?? [])
        .filter(
          (p) =>
            references.has(p.id) &&
            p.month <= frame.month &&
            (p.visibility === 'public' || query.confidential),
        )
        .map(document),
      pending:
        frame.month === w.month
          ? (w.statecraft?.offers ?? [])
              .filter(
                (p) =>
                  p.status === 'proposed' &&
                  p.expires >= w.month &&
                  (p.visibility === 'public' || query.confidential) &&
                  p.terms.some((t) => t.kind === 'institution' && t.charter?.id === o.id),
              )
              .map(document)
          : [],
    }
  }
  return {
    request: query.id,
    requestedMonth: query.month,
    month: frame.month,
    since: archive.since,
    latest: archive.frames.at(-1)!.month,
    approximate: frame.approximate,
    nations: frame.nations,
    provinces: provincesAt(archive, index),
    wars: frame.wars,
    institutions,
    ...(selected ? { selected } : {}),
  }
}
/** Save validation checks references and ordering before any imported record can be rendered. */
export function validateWorldArchive(w: World) {
  const a = w.archive
  if (a === undefined) return
  const fail = (): never => {
    throw new Error('Invalid historical atlas archive in this save.')
  }
  const integer = (x: unknown, max: number, min = 0) =>
    Number.isSafeInteger(x) && (x as number) >= min && (x as number) <= max
  const text = (x: unknown) => typeof x === 'string' && x.length <= 1000
  if (
    !a ||
    a.version !== 1 ||
    !integer(a.since, w.month) ||
    !Array.isArray(a.frames) ||
    !a.frames.length ||
    !a.frames[0].checkpoint ||
    a.frames[0].month !== a.since
  )
    fail()
  const organizations = new Set(w.institutions?.organizations.map((o) => o.id) ?? [])
  let previous = -1
  for (const f of a.frames) {
    if (
      !f ||
      !integer(f.month, w.month) ||
      f.month <= previous ||
      typeof f.checkpoint !== 'boolean' ||
      typeof f.approximate !== 'boolean' ||
      !Array.isArray(f.nations) ||
      !Array.isArray(f.provinces) ||
      !Array.isArray(f.wars) ||
      !Array.isArray(f.funds)
    )
      fail()
    previous = f.month
    if (f.nations.some((n, i) => n?.id !== i)) fail()
    const ids = new Set<number>()
    for (const n of f.nations) {
      if (
        !n ||
        !integer(n.id, w.nations.length - 1) ||
        ids.has(n.id) ||
        !text(n.name) ||
        !text(n.shortName) ||
        !text(n.color) ||
        !text(n.government) ||
        !integer(n.capital, w.regions.length - 1) ||
        ![n.population, n.gdp, n.treasury, n.stability].every(Number.isFinite) ||
        n.population < 0 ||
        (n.extinct !== undefined && !integer(n.extinct, f.month))
      )
        fail()
      ids.add(n.id)
    }
    const provinces = new Set<number>()
    for (const p of f.provinces) {
      if (
        !p ||
        !integer(p.id, w.regions.length - 1) ||
        provinces.has(p.id) ||
        !integer(p.nation, w.nations.length - 1, -1) ||
        (p.nation !== -1 && !ids.has(p.nation)) ||
        !text(p.name)
      )
        fail()
      provinces.add(p.id)
    }
    if (f.checkpoint && provinces.size !== w.regions.length) fail()
    for (const r of f.wars)
      if (
        !r ||
        !ids.has(r.a) ||
        !ids.has(r.b) ||
        r.a >= r.b ||
        !integer(r.since, f.month) ||
        (r.aggressor !== undefined && r.aggressor !== r.a && r.aggressor !== r.b)
      )
        fail()
    const bodies = new Set<number>()
    for (const fnd of f.funds) {
      if (
        !fnd ||
        !organizations.has(fnd.id) ||
        bodies.has(fnd.id) ||
        ![fnd.treasury, fnd.income, fnd.grants].every((x) => Number.isFinite(x) && x >= 0)
      )
        fail()
      bodies.add(fnd.id)
    }
  }
}

/** Repeated admissions produce separate episodes; baseline membership is explicitly only observed. */
export function institutionMemberships(events: readonly InstitutionEvent[]): ArchiveMembership[] {
  const episodes: ArchiveMembership[] = [],
    current = new Map<number, ArchiveMembership>()
  for (const e of events) {
    if (!e.version) continue
    const members = e.version.status === 'dissolved' ? [] : e.version.members
    for (const [id, episode] of current)
      if (!members.includes(id)) {
        episode.until = e.month
        episode.outcome = e.kind
        current.delete(id)
      }
    for (const id of members)
      if (!current.has(id)) {
        const episode: ArchiveMembership = { nation: id, since: e.month, observed: e.kind === 'baseline' }
        current.set(id, episode)
        episodes.push(episode)
      }
  }
  return episodes
}
