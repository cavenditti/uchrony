import { ensureInstitutionRecord } from './institution-lifecycle'
import { dateLabel, type World } from './types'
import { geographicNeighbors } from './grid'
import { hashSeed } from './random'
import { worldMemory, rememberFact } from './event-memory'
import type {
  AtlasEntry,
  PlaceKind,
  NamingTradition,
  WorldFact,
  PlaceQuery,
  PlaceResult,
  WritingRequest,
  WritingContext,
  PlaceAccount,
} from './almanac-types'

const syllables = [
  ['Ar', 'Bel', 'Cor', 'Dar', 'El', 'Fer', 'Mar', 'Val'],
  ['Ash', 'Nir', 'Sar', 'Tal', 'Zar', 'Mir', 'Hal', 'Ush'],
  ['Bryn', 'Cael', 'Dun', 'Gwyn', 'Maer', 'Pen', 'Rhu', 'Tal'],
  ['Aki', 'Ira', 'Koa', 'Mao', 'Nai', 'Oru', 'Tai', 'Uma'],
  ['An', 'Bor', 'Dra', 'Gor', 'Kel', 'Mor', 'Tor', 'Vor'],
  ['Ae', 'Ili', 'Lae', 'Nae', 'Oli', 'Rae', 'Sae', 'Vae'],
]
const endings = [
  ['a', 'en', 'is', 'or', 'um'],
  ['an', 'ar', 'esh', 'ir', 'un'],
  ['ach', 'en', 'in', 'og', 'wyn'],
  ['ka', 'ma', 'na', 'ro', 'ta'],
  ['ak', 'en', 'ik', 'ov', 'un'],
  ['la', 'li', 'na', 'ra', 'th'],
]
export function namingTradition(w: World, language: number): NamingTradition {
  const saved = w.almanac?.languages[language]
  if (saved) return saved
  const family = hashSeed(`${w.seed}:language:${language}`) % syllables.length
  return {
    language,
    roots: syllables[family],
    endings: endings[family],
    convention: 'Related local names share roots and endings; older names remain in use.',
    demonym: 'local',
    model: 'native',
  }
}
function languageAt(w: World, cell: number) {
  const r = w.regions[w.cells[cell]?.region]
  const community = r?.communities?.reduce(
    (best, g) =>
      !best ||
      Object.values(g.population).reduce((a, b) => a + b, 0) >
        Object.values(best.population).reduce((a, b) => a + b, 0)
        ? g
        : best,
    r.communities[0],
  )
  return community?.language ?? w.nations[r?.nation]?.identity?.language ?? 0
}
function generatedName(w: World, id: string, kind: PlaceKind, language: number) {
  const t = namingTradition(w, language),
    h = hashSeed(`${w.seed}:atlas:${id}`)
  const root = t.roots[h % t.roots.length] + t.endings[Math.floor(h / t.roots.length) % t.endings.length]
  const suffix: Partial<Record<PlaceKind, string>> = {
    river: 'River',
    peak: 'Peak',
    range: 'Mountains',
    pass: 'Pass',
    valley: 'Valley',
    forest: 'Forest',
    sea: 'Sea',
    bay: 'Bay',
    strait: 'Strait',
    port: 'Harbor',
    island: 'Island',
    route: 'Road',
  }
  return `${root}${suffix[kind] ? ` ${suffix[kind]}` : ''}`
}
function entry(
  w: World,
  id: string,
  kind: PlaceKind,
  cell: number,
  name?: string,
  attributes: AtlasEntry['attributes'] = {},
  geometry?: number[],
) {
  const a = worldMemory(w)
  if (a.entries[id]) return a.entries[id]
  const language = languageAt(w, cell)
  const regions = [
    ...new Set((geometry ?? [cell]).map((c) => w.cells[c]?.region).filter((r) => r !== undefined && r >= 0)),
  ]
  const base = name || generatedName(w, id, kind, language)
  const p: AtlasEntry = {
    id,
    kind,
    name: base,
    names: [],
    language,
    cell,
    located: kind !== 'bank',
    regions: kind === 'bank' ? [] : regions,
    since: w.month,
    related: kind === 'bank' ? [] : regions.map((r) => `province:${r}`),
    facts: [],
    accounts: [],
    attributes,
    naming: 'pending',
    revision: 0,
    ...(geometry ? { geometry } : {}),
  }
  a.entries[id] = p
  for (const related of p.related) {
    const parent = a.entries[related]
    if (parent && parent.id !== p.id && !parent.related.includes(p.id)) parent.related.push(p.id)
  }
  p.related = p.related.filter((related) => related !== p.id)
  rememberFact(w, {
    id: `${id}/charted`,
    month: w.month,
    title: `${p.name} enters the atlas`,
    detail: `First preserved atlas observation of this ${kind}. This date does not establish its founding or earlier history.`,
    places: [id],
    source: a.initialized ? 'recorded' : 'initial',
  })
  a.revision++
  return p
}
function fact(
  w: World,
  p: AtlasEntry,
  key: string,
  title: string,
  detail: string,
  source: WorldFact['source'] = 'recorded',
) {
  rememberFact(w, { id: `${p.id}/${key}`, month: w.month, title, detail, places: [p.id], source })
}
function state(w: World, p: AtlasEntry, values: AtlasEntry['attributes']) {
  for (const [key, value] of Object.entries(values)) {
    const before = p.milestones?.[key] ?? p.attributes[key]
    if (before === value) continue
    const significant =
      before !== undefined &&
      (typeof value !== 'number' ||
        typeof before !== 'number' ||
        ['owner', 'mergedInto'].includes(key) ||
        Math.abs(value - before) >= Math.max(100, Math.abs(before) * 0.25))
    if (significant)
      fact(w, p, `${key}:${w.month}`, `${p.name}: ${key} changed`, `${key}: ${before} → ${value}.`)
    if (significant || before === undefined) (p.milestones ??= {})[key] = value
    p.attributes[key] = value
  }
}
function connected(w: World, matches: (id: number) => boolean) {
  const seen = new Uint8Array(w.cells.length),
    groups: number[][] = []
  for (const c of w.cells) {
    if (seen[c.id] || !matches(c.id)) continue
    const group = [c.id]
    seen[c.id] = 1
    for (let i = 0; i < group.length; i++)
      for (const n of geographicNeighbors(w.cells, group[i], w.width, w.height)) {
        if (!seen[n] && matches(n)) {
          seen[n] = 1
          group.push(n)
        }
      }
    groups.push(group)
  }
  return groups
}
function naturalPlaces(w: World) {
  const incoming = new Map<number, number[]>()
  for (const c of w.cells)
    if (c.river && c.terrain !== 'water' && c.downstream !== undefined) {
      const list = incoming.get(c.downstream) ?? []
      list.push(c.id)
      incoming.set(c.downstream, list)
    }
  const main = new Map(
    [...incoming].map(([id, list]) => [
      id,
      list.sort((a, b) => (w.cells[b].riverFlow ?? 0) - (w.cells[a].riverFlow ?? 0) || a - b)[0],
    ]),
  )
  const riverAt = new Map<number, string>()
  const rivers: AtlasEntry[] = []
  for (const c of w.cells) {
    if (!c.river || c.terrain === 'water' || incoming.has(c.id)) continue
    const path: number[] = [],
      seen = new Set<number>()
    let at: number | undefined = c.id
    while (at !== undefined && !seen.has(at) && w.cells[at]?.terrain !== 'water') {
      seen.add(at)
      path.push(at)
      const next: number | undefined = w.cells[at].downstream
      if (next !== undefined && main.has(next) && main.get(next) !== at) break
      at = next
    }
    if (path.length < 3) continue
    const p = entry(
      w,
      `river:${c.id}`,
      'river',
      path[Math.floor(path.length / 2)],
      undefined,
      { reaches: path.length, flow: w.cells[path.at(-1)!].riverFlow ?? 0 },
      path,
    )
    for (const cell of path) riverAt.set(cell, p.id)
    rivers.push(p)
    fact(
      w,
      p,
      'geography',
      `${p.name} is charted`,
      `A connected river with ${path.length} terrain reaches.`,
      'initial',
    )
  }
  for (const p of rivers) {
    const last = p.geometry!.at(-1)!,
      target = riverAt.get(w.cells[last].downstream ?? -1)
    if (target && target !== p.id) {
      p.related.push(target)
      worldMemory(w).entries[target].related.push(p.id)
    }
    if (p.geometry!.length >= 12) {
      const v = entry(w, `valley:${p.id}`, 'valley', p.cell, undefined, { river: p.id }, p.geometry)
      v.related.push(p.id)
      p.related.push(v.id)
    }
  }
  for (const [kind, match, min] of [
    ['forest', (id: number) => w.cells[id].terrain === 'forest', 12],
    ['range', (id: number) => ['mountains', 'hills'].includes(w.cells[id].terrain), 12],
    ['sea', (id: number) => w.cells[id].terrain === 'water', 12],
    ['island', (id: number) => w.cells[id].terrain !== 'water', 3],
  ] as const) {
    for (const g of connected(w, match)) {
      if (g.length < min) continue
      const type = kind === 'island' && g.length > w.cells.length * 0.06 ? 'continent' : kind
      const anchor = g[Math.floor(g.length / 2)]
      entry(
        w,
        `${type}:${Math.min(...g.slice(0, 50000))}`,
        type,
        anchor,
        undefined,
        { areaCells: g.length },
        g,
      )
    }
  }
  const peaks: number[] = []
  for (const c of [...w.cells]
    .filter((c) => c.terrain === 'mountains')
    .sort((a, b) => b.elevation - a.elevation || a.id - b.id)) {
    if (geographicNeighbors(w.cells, c.id, w.width, w.height).some((n) => w.cells[n].elevation > c.elevation))
      continue
    if (peaks.some((id) => Math.hypot(w.cells[id].q - c.q, w.cells[id].r - c.r) < 5)) continue
    peaks.push(c.id)
    entry(w, `peak:${c.id}`, 'peak', c.id, undefined, { elevationIndex: c.elevation })
  }
  // Saddles and inlets are geographic classifications, with no invented infrastructure.
  for (const c of w.cells) {
    const ns = geographicNeighbors(w.cells, c.id, w.width, w.height),
      land = ns.filter((n) => w.cells[n].terrain !== 'water')
    if (
      c.terrain === 'hills' &&
      ns.filter((n) => w.cells[n].terrain === 'mountains').length >= 2 &&
      ns.some((n) => w.cells[n].terrain === 'plains') &&
      hashSeed(`${w.seed}:pass:${c.id}`) % 7 === 0
    )
      entry(w, `pass:${c.id}`, 'pass', c.id, undefined, { terrain: c.terrain })
    if (c.terrain === 'water') {
      const n = c.r > 0 ? w.cells[c.id - w.width] : undefined,
        south = c.r + 1 < w.height ? w.cells[c.id + w.width] : undefined,
        east = c.q + 1 < w.width ? w.cells[c.id + 1] : undefined,
        west = c.q > 0 ? w.cells[c.id - 1] : undefined
      if (
        n &&
        south &&
        east &&
        west &&
        ((n.terrain === 'water' &&
          south.terrain === 'water' &&
          east.terrain !== 'water' &&
          west.terrain !== 'water') ||
          (n.terrain !== 'water' &&
            south.terrain !== 'water' &&
            east.terrain === 'water' &&
            west.terrain === 'water'))
      )
        entry(w, `strait:${c.id}`, 'strait', c.id, undefined, {
          geography: 'Narrow water passage between opposite shores',
        })
    }
    if (c.terrain === 'water' && land.length >= 5 && hashSeed(`${w.seed}:bay:${c.id}`) % 11 === 0)
      entry(w, `bay:${c.id}`, 'bay', c.id, undefined, { shorelineNeighbors: land.length })
  }
}
/** Called by generation/monthly simulation, never by a camera or inspection request. */
export function advanceAlmanac(w: World, force = false) {
  const a = worldMemory(w)
  if (!force && a.initialized && a.lastMonth === w.month) return
  const initial = !a.initialized
  for (const r of w.regions) {
    const p = entry(w, `province:${r.id}`, 'province', r.center, r.name)
    state(w, p, { owner: r.nation, terrain: r.terrain })
  }
  for (const n of w.nations) {
    const p = entry(w, `nation:${n.id}`, 'nation', w.regions[n.capital]?.center ?? 0, n.name)
    state(w, p, {
      government: n.government,
      population: Math.round(n.population),
      status: n.extinct === undefined ? 'active' : 'extinct',
    })
    const leader = n.character?.leader
    if (leader) {
      const person = entry(w, `leader:${n.id}:${leader.generation}`, 'person', p.cell, leader.name, {
        office: n.government,
        nation: n.id,
        since: leader.since,
      })
      person.related = [...new Set([...person.related, p.id])]
      state(w, person, { status: n.extinct === undefined ? 'serving' : 'former leader' })
      for (const id of p.related.filter((id) => id.startsWith(`leader:${n.id}:`) && id !== person.id))
        state(w, a.entries[id], { status: 'former leader' })
      if (!p.related.includes(person.id)) p.related.push(person.id)
    }
  }
  if (initial) naturalPlaces(w)
  for (const c of w.localEconomy?.cities ?? []) {
    const id = `city:${c.id}`,
      fresh = !a.entries[id],
      p = entry(w, id, 'city', c.nucleus, c.name)
    if (fresh)
      fact(
        w,
        p,
        'origin',
        `${p.name} enters the atlas`,
        `First recorded as a settlement in ${dateLabel({ startYear: w.startYear, month: c.founded })}. Earlier history is not known.`,
        initial ? 'initial' : 'recorded',
      )
    if (p.name !== c.name) {
      p.names.push({
        name: p.name,
        month: w.month,
        language: p.language,
        kind: 'former',
        reason: 'Settlement continuity',
      })
      p.name = c.name
      p.revision++
    }
    p.cell = c.nucleus
    p.regions = [...new Set(c.cells.map((cell) => w.cells[cell].region).filter((id) => id >= 0))]
    if (!p.regions.length) p.regions = [w.cells[c.nucleus].region].filter((id) => id >= 0)
    p.related = [
      ...new Set([
        ...p.related,
        ...p.regions.map((r) => `province:${r}`),
        ...c.parents.map((id) => `city:${id}`),
      ]),
    ]
    const language = languageAt(w, c.nucleus)
    if (language !== p.language && w.month % 12 === 0) {
      const alias = generatedName(w, `${p.id}:language:${language}`, 'city', language)
      if (!p.names.some((n) => n.name === alias))
        p.names.push({
          name: alias,
          month: w.month,
          language,
          kind: 'alternative',
          reason: 'A local-language variant after a change in the largest recorded language community.',
        })
      fact(
        w,
        p,
        `language:${w.month}`,
        `Another name for ${p.name}`,
        `The largest recorded language community changed; ${alias} is a generated linguistic variant, not evidence of an official renaming.`,
      )
      p.language = language
    }
    state(w, p, {
      population: Math.round(c.population),
      settlement: c.kind,
      owner: w.regions[w.cells[c.nucleus].region]?.nation ?? -1,
      status: c.absorbedBy !== undefined ? 'merged' : c.population > 0 ? 'inhabited' : 'abandoned',
      ...(c.absorbedBy !== undefined ? { mergedInto: c.absorbedBy } : {}),
    })
    if (c.absorbedBy !== undefined) p.related = [...new Set([...p.related, `city:${c.absorbedBy}`])]
    if (!initial && p.attributes.status === 'abandoned') {
      const site = entry(w, `ruin:${c.id}`, 'ruin', c.nucleus, `Former site of ${p.name}`, {
        status: 'abandoned settlement; surviving structures unverified',
      })
      if (!site.related.includes(p.id)) site.related.push(p.id)
      if (!p.related.includes(site.id)) p.related.push(site.id)
    }
  }
  for (const f of w.economy?.firms ?? []) {
    const unit = w.localEconomy?.units[f.locality ?? f.region],
      province = unit?.province ?? f.region,
      cell = f.cell ?? w.regions[province]?.center
    if (cell === undefined) continue
    const p = entry(w, `firm:${f.id}:${f.generation}`, 'firm', cell, undefined, {
      specialization: f.specialization ?? 'mixed',
    })
    state(w, p, { status: f.active ? 'trading' : 'closed', employment: Math.round(f.employment) })
  }
  for (const b of w.economy?.banking?.banks ?? [])
    entry(w, `bank:${b.id}`, 'bank', w.regions[0]?.center ?? 0, undefined, { scope: 'world banking system' })
  for (const org of w.institutions?.organizations ?? []) {
    if (org.visibility !== 'public') continue
    const p = entry(
      w,
      `institution:${org.id}`,
      'institution',
      w.regions[w.nations[org.members[0]]?.capital]?.center ?? 0,
      org.name,
      { founded: org.founded },
    )
    // Constitutional names have their own event-driven review, independent of language batches.
    p.naming = 'established'
    if (p.name !== org.name) {
      p.names.push({
        name: p.name,
        month: w.month,
        language: p.language,
        kind: 'former',
        reason: 'Institutional name changed',
      })
      p.name = org.name
    }
    ensureInstitutionRecord(w, org)
    const cursor = Number(p.milestones?.institutionEvent ?? 0)
    for (const e of org.events!.slice(cursor))
      rememberFact(w, {
        id: `institution:${org.id}/decision:${e.id}`,
        month: e.month,
        title: `${e.version?.name ?? org.name}: ${e.kind}`,
        detail: e.detail,
        places: [p.id, ...e.nations.map((id) => `nation:${id}`)],
        source: 'recorded',
      })
    p.milestones ??= {}
    p.milestones.institutionEvent = org.events!.length
    state(w, p, { status: org.status })
    p.related = [...new Set([...p.related, ...org.members.map((id) => `nation:${id}`)])]
  }
  for (const legacy of w.historical?.legacies ?? []) {
    const p = entry(
      w,
      `legacy:${legacy.event}:${legacy.kind}`,
      legacy.kind === 'literature' ? 'work' : legacy.kind === 'belief' ? 'belief' : 'institution',
      w.regions[legacy.region]?.center ?? 0,
      legacy.name,
      { since: legacy.month },
    )
    const id = `event:${legacy.event}`
    if (a.facts[id] && !p.facts.includes(id)) p.facts.push(id)
  }
  for (const lane of w.tradeLanes ?? []) {
    if (!lane.path?.length) continue
    const key = [lane.from, lane.to].sort((x, y) => x - y).join(':'),
      p = entry(
        w,
        `route:${key}`,
        'route',
        lane.path[Math.floor(lane.path.length / 2)],
        undefined,
        { from: lane.from, to: lane.to },
        lane.path,
      )
    p.related = [...new Set([...p.related, `province:${lane.from}`, `province:${lane.to}`])]
    state(w, p, { status: lane.lastActive >= w.month - 12 ? 'in use' : 'inactive' })
  }
  for (const r of w.regions)
    if ((r.publicWorks?.harbor ?? 0) > 0)
      entry(w, `port:${r.id}`, 'port', r.center, `${a.entries[`province:${r.id}`].name} Harbor`, {
        province: r.id,
        location: 'Province-level harbor investment',
      })
  for (const e of w.events) {
    const id = `event:${e.id}`
    if (!a.facts[id])
      rememberFact(w, {
        id,
        month: e.month,
        title: e.title,
        detail: e.detail,
        places: [
          ...(e.region !== undefined ? [`province:${e.region}`] : []),
          ...(e.nation !== undefined ? [`nation:${e.nation}`] : []),
        ],
        source: initial ? 'legacy' : 'recorded',
        event: e.id,
      })
    if (e.type === 'war' && e.region !== undefined) {
      const p = entry(
        w,
        `memory:${e.id}`,
        'battlefield',
        w.regions[e.region].center,
        `Site remembered: ${e.title}`,
        { location: 'Province-level record; exact site unknown' },
      )
      if (!p.facts.includes(id)) p.facts.push(id)
      p.naming = 'established'
    }
  }
  if (initial) {
    for (const f of Object.values(a.facts))
      for (const id of f.places)
        if (a.entries[id] && !a.entries[id].facts.includes(f.id)) a.entries[id].facts.push(f.id)
    // Generate native identities without changing simulation randomness.
    const seen = new Set<string>()
    for (const p of Object.values(a.entries)) {
      if (
        seen.has(p.name.toLocaleLowerCase()) &&
        !['province', 'nation', 'city', 'person', 'institution', 'work', 'belief'].includes(p.kind)
      )
        p.name += ` ${hashSeed(p.id).toString(36).slice(0, 3)}`
      seen.add(p.name.toLocaleLowerCase())
    }
  }
  for (const p of Object.values(a.entries)) {
    if (p.kind === 'city') {
      const r = a.entries[`province:${w.cells[p.cell].region}`]
      for (const id of r?.related ?? []) {
        const candidate = a.entries[id]
        if (
          candidate &&
          ['river', 'peak', 'forest', 'pass', 'port'].includes(candidate.kind) &&
          Math.hypot(
            w.cells[candidate.cell].q - w.cells[p.cell].q,
            w.cells[candidate.cell].r - w.cells[p.cell].r,
          ) <= 12 &&
          !p.related.includes(id)
        )
          p.related.push(id)
      }
    }
  }
  a.initialized = true
  a.lastMonth = w.month
  a.revision++
}
export function placeLabels(w: World) {
  return Object.values(w.almanac?.entries ?? {})
    .filter((p) =>
      [
        'river',
        'peak',
        'range',
        'forest',
        'pass',
        'valley',
        'island',
        'continent',
        'sea',
        'bay',
        'strait',
      ].includes(p.kind),
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      cell: p.cell,
      importance: Number(p.attributes.flow ?? p.attributes.areaCells ?? p.attributes.elevationIndex ?? 1),
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 1500)
}
const visibleEntry = (p: AtlasEntry, w?: World) => {
  const { geometry: _geometry, milestones: _milestones, ...rest } = p
  const attributes = { ...p.attributes }
  if (w) {
    for (const key of ['owner', 'nation'])
      if (typeof attributes[key] === 'number')
        attributes[key] = w.nations[Number(attributes[key])]?.name ?? 'Unclaimed'
    for (const key of ['from', 'to', 'province'])
      if (typeof attributes[key] === 'number')
        attributes[key] = w.regions[Number(attributes[key])]?.name ?? 'Unknown'
    if (typeof attributes.mergedInto === 'number')
      attributes.mergedInto =
        w.almanac?.entries[`city:${attributes.mergedInto}`]?.name ?? 'Another settlement'
    if (typeof attributes.river === 'string')
      attributes.river = w.almanac?.entries[attributes.river]?.name ?? attributes.river
  }
  return { ...rest, attributes }
}
export function queryPlaces(w: World, q: PlaceQuery): PlaceResult {
  const a = w.almanac,
    search = (q.search ?? '').toLocaleLowerCase().slice(0, 120),
    offset = Math.max(0, Math.floor(q.offset ?? 0))
  const all = Object.values(a?.entries ?? {}).filter(
    (p) =>
      (!q.kind || p.kind === q.kind) &&
      (q.region === undefined || p.regions.includes(q.region)) &&
      (!search ||
        p.name.toLocaleLowerCase().includes(search) ||
        p.names.some((n) => n.name.toLocaleLowerCase().includes(search))),
  )
  all.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const p = q.place ? a?.entries[q.place] : undefined
  const ids = p
    ? [...new Set([...p.facts, ...p.regions.flatMap((r) => a?.entries[`province:${r}`]?.facts ?? [])])]
    : []
  return {
    request: q.id,
    month: w.month,
    total: all.length,
    offset,
    entries: all.slice(offset, offset + 60).map((p) => visibleEntry(p, w)),
    selected: p ? visibleEntry(p, w) : undefined,
    facts: ids
      .map((id) => a!.facts[id])
      .filter(Boolean)
      .sort((a, b) => b.month - a.month || a.id.localeCompare(b.id)),
    related: p
      ? p.related
          .map((id) => a!.entries[id])
          .filter(Boolean)
          .map(({ id, name, kind }) => ({ id, name, kind }))
      : [],
  }
}
export function writingContext(w: World, r: WritingRequest): WritingContext {
  const p = w.almanac?.entries[r.place]
  if (!p) throw new Error('This place is no longer available.')
  const result = queryPlaces(w, { id: 0, place: p.id }),
    words = (r.question ?? '').toLowerCase().match(/[a-z]{3,}/g) ?? []
  let facts = [...result.facts]
    .sort((a, b) => {
      const score = (f: WorldFact) =>
        words.reduce((n, s) => n + Number(`${f.title} ${f.detail}`.toLowerCase().includes(s)), 0)
      return score(b) - score(a) || b.month - a.month
    })
    .slice(0, 32)
  if (!words.length) {
    const origins = result.facts.filter((f) => f.places.includes(p.id)).slice(-3)
    facts = [...new Map([...origins, ...facts].map((f) => [f.id, f])).values()].slice(0, 32)
  }
  const { geometry: _geometry, accounts: _accounts, facts: _facts, milestones: _milestones, ...place } = p
  return {
    task: r.task,
    month: w.month,
    revision: p.revision,
    place,
    facts,
    neighbors: result.related.slice(0, 24),
    tradition: namingTradition(w, p.language),
    question: (r.question ?? '').trim().slice(0, 500),
    targets: (r.task === 'naming'
      ? Object.values(w.almanac!.entries)
          .filter(
            (e) => e.naming === 'pending' && e.language === p.language && !e.id.startsWith('institution:'),
          )
          .slice(0, 20)
      : [p]
    ).map(({ id, name, kind, attributes }) => ({ id, name, kind, attributes })),
  }
}
const cleanText = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f<>]/.test(v)
/** Validate the entire response before committing any name or account. */
export function acceptWriting(w: World, context: WritingContext, value: unknown, model: string) {
  const a = w.almanac!,
    p = a.entries[context.place.id],
    v = value as any
  if (!p || !cleanText(model, 160)) throw new Error('Invalid writing provenance.')
  if (context.task === 'naming') {
    if (!Array.isArray(v?.names) || v.names.length < 1 || v.names.length > context.targets.length)
      throw new Error('Invalid name batch.')
    const seen = new Set<string>(),
      ids = new Set<string>(),
      targets = new Set(context.targets.map((p) => p.id)),
      used = new Set(
        Object.values(a.entries)
          .filter((p) => !targets.has(p.id))
          .map((p) => p.name.toLowerCase()),
      )
    for (const n of v.names) {
      if (
        !targets.has(n.id) ||
        ids.has(n.id) ||
        !cleanText(n.name, 100) ||
        !cleanText(n.reason, 240) ||
        !Array.isArray(n.alternatives) ||
        n.alternatives.length > 3 ||
        n.alternatives.some((x: unknown) => !cleanText(x, 100)) ||
        seen.has(n.name.toLowerCase()) ||
        used.has(n.name.toLowerCase())
      )
        throw new Error('Names must be unique, short and attached to requested places.')
      seen.add(n.name.toLowerCase())
      ids.add(n.id)
    }
    for (const n of v.names) {
      const place = a.entries[n.id]
      if (place.naming !== 'pending' || place.id.startsWith('institution:')) continue
      renamePlace(w, place, n.name, n.reason)
      for (const alt of n.alternatives)
        if (alt !== place.name && !place.names.some((x) => x.name === alt))
          place.names.push({
            name: alt,
            month: w.month,
            language: place.language,
            kind: 'alternative',
            reason: n.reason,
          })
      place.naming = 'model'
      place.nameModel = model
    }
  } else if (context.task === 'culture') {
    if (
      !Array.isArray(v?.roots) ||
      v.roots.length < 4 ||
      v.roots.length > 24 ||
      v.roots.some((x: unknown) => !cleanText(x, 20)) ||
      !Array.isArray(v.endings) ||
      v.endings.length < 3 ||
      v.endings.length > 16 ||
      v.endings.some((x: unknown) => !cleanText(x, 20)) ||
      !cleanText(v.convention, 500) ||
      !cleanText(v.demonym, 80)
    )
      throw new Error('Invalid naming tradition.')
    a.languages[p.language] = {
      language: p.language,
      roots: [...new Set(v.roots)] as string[],
      endings: [...new Set(v.endings)] as string[],
      convention: v.convention,
      demonym: v.demonym,
      model,
    }
  } else {
    const allowed = new Set(context.facts.map((f) => f.id))
    if (
      !cleanText(v?.title, 150) ||
      !cleanText(v?.text, 3000) ||
      !Array.isArray(v.sources) ||
      v.sources.length > 32 ||
      v.sources.some((id: unknown) => typeof id !== 'string' || !allowed.has(id))
    )
      throw new Error('The account must cite only supplied records.')
    if (['biography', 'chronicle'].includes(context.task) && context.facts.length && !v.sources.length)
      throw new Error('A historical account needs a recorded source.')
    const account: PlaceAccount = {
      task: context.task,
      title: v.title,
      text: v.text,
      sources: [...new Set(v.sources)] as string[],
      month: w.month,
      asOf: context.month,
      model,
      status: context.task === 'tradition' ? 'tradition' : 'interpretation',
      ...(context.question ? { question: context.question } : {}),
    }
    // Keep the latest account of each form, plus a bounded saved question/answer notebook.
    p.accounts = p.accounts
      .filter((x) => x.task !== context.task || context.task === 'historian')
      .concat(account)
    const answers = p.accounts.filter((x) => x.task === 'historian').slice(-12)
    p.accounts = p.accounts.filter((x) => x.task !== 'historian').concat(answers)
  }
  a.revision++
}
function renamePlace(w: World, p: AtlasEntry, name: string, reason: string) {
  if (p.name !== name) {
    p.names.push({ name: p.name, month: w.month, language: p.language, kind: 'former', reason })
    p.name = name
    p.revision++
  }
  const id = Number(p.id.split(':')[1])
  if (p.kind === 'city') {
    const c = w.localEconomy?.cities.find((c) => c.id === id)
    if (c) {
      c.aliases = [...new Set([...c.aliases, c.name])]
      c.name = name
      c.lastNameChange = w.month
      const label = w.spatial?.settlements.find((s) => s.id === p.id)
      if (label) label.name = name
    }
  }
  if (p.kind === 'province' && w.regions[id]) w.regions[id].name = name
  if (p.kind === 'nation' && w.nations[id]) {
    w.nations[id].name = name
    w.nations[id].shortName = name
  }
  if (p.kind === 'person' && p.id.startsWith('leader:')) {
    const generation = Number(p.id.split(':')[2]),
      leader = w.nations[id]?.character?.leader
    if (leader?.generation === generation) {
      leader.name = name
      const society = w.historical?.societies.find((s) => s.nation === id)
      if (society) society.leader = name
    }
  }
}
